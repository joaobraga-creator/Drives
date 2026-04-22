import os
import google.auth
from google.oauth2.credentials import Credentials
from google.cloud import bigquery
from dotenv import load_dotenv

load_dotenv()

_client = None

def _get_client() -> bigquery.Client:
    global _client
    if _client is None:
        quota_project = os.getenv("GOOGLE_CLOUD_QUOTA_PROJECT", "calm-mariner-105612")

        client_id     = os.getenv("GOOGLE_CLIENT_ID")
        client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
        refresh_token = os.getenv("GOOGLE_REFRESH_TOKEN")

        if client_id and client_secret and refresh_token:
            # Produção: monta credenciais diretamente das env vars
            credentials = Credentials(
                token=None,
                refresh_token=refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=client_id,
                client_secret=client_secret,
            )
        else:
            # Local: usa ADC (gcloud auth application-default login)
            credentials, _ = google.auth.default()

        credentials = credentials.with_quota_project(quota_project)
        _client = bigquery.Client(credentials=credentials, project=quota_project)
    return _client


# ─── Auth ────────────────────────────────────────────────────────────────────

AUTH_SQL = """
SELECT DISTINCT
    PLC_PLACE_FACILITY AS facility,
    PLC_PLACE_NOME     AS place_name
FROM `meli-bi-data.WHOWNER.BT_CARTEIRA_MLB`
WHERE LOWER(PLC_PLACE_EMAIL) = LOWER(@email)
LIMIT 1
"""

def get_facility_by_email(email: str) -> dict | None:
    client = _get_client()
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("email", "STRING", email)]
    )
    rows = list(client.query(AUTH_SQL, job_config=job_config).result())
    if rows:
        return {"facility": rows[0].facility, "place_name": rows[0].place_name}
    return None


# ─── Drivers por facility ─────────────────────────────────────────────────────

DRIVERS_SQL = """
WITH Planejamento AS (
    SELECT
        facility, modal, svc,
        SUM(CASE WHEN SHP_CYCLE_NAME = 'AM1' THEN rotas_planejadas ELSE 0 END) AS Rotas_AM1,
        SUM(CASE WHEN SHP_CYCLE_NAME = 'CHP' THEN rotas_planejadas ELSE 0 END) AS Rotas_CHP,
        SUM(CASE WHEN SHP_CYCLE_NAME = 'PM1' THEN rotas_planejadas ELSE 0 END) AS Rotas_PM1,
        SUM(rotas_planejadas) AS total_planejado_geral
    FROM `meli-bi-data.SBOX_MLBPLACES.MLB_MANAGEMENT_OFFERS_NEX_ROUTE_PLANNED_ROUTES`
    WHERE facility = @facility
    GROUP BY 1, 2, 3
),
Ofertas AS (
    SELECT
        facility, svc, ETA, REGIONAL,
        CASE
            WHEN service_description LIKE '%Motocicleta%' THEN 'Moto 4hrs'
            WHEN service_description LIKE '%Passeio 6%'   THEN 'Carro 6hrs'
            WHEN service_description LIKE '%EXTRA%'       THEN 'Carro 4hrs'
            WHEN service_description LIKE '%Passeio%'     THEN 'Carro 4hrs'
            WHEN service_description LIKE '%Walker%'
              OR service_description LIKE '%Pedestre%'    THEN 'Walker'
            ELSE service_description
        END AS service_normalized,
        SUM(rotas_ofertadas)                   AS total_ofertadas,
        SUM(rotas_aceitas)                     AS total_aceitas,
        SUM(rotas_aceitas_canceladas_operacao) AS canceladas_operacao,
        SUM(rotas_aceitas_canceladas_driver)   AS canceladas_driver,
        SUM(rotas_canceladas_total)            AS total_canceladas
    FROM `meli-bi-data.SBOX_MLBPLACES.MLB_MANAGEMENT_OFFERS_NEX_OFFERS`
    WHERE facility = @facility
    GROUP BY 1, 2, 3, 4, 5
),
Broadcast_Drivers AS (
    SELECT
        FACILITY_ID, DRIVER_ID,
        DATE(OFFER_DATE)   AS DATA_BROADCAST,
        DATE(ETA)          AS DATA_ETA,
        TIME(ETA)          AS HORARIO_CHEGADA,
        ETA_GMT4,
        STATUS, SUBSTATUS,
        ACCEPTED_OFFER,
        CANCELLATION,
        VEHICLE_DESCRIPTION,
        DRIVER_TYPE,
        DRIVER_CATEGORY
    FROM `meli-bi-data.WHOWNER.BT_SHP_CROWD_BROADCAST`
    WHERE SITE_ID = 'MLB'
      AND FACILITY_ID = @facility
      AND DATE(OFFER_DATE, 'America/Sao_Paulo') = @query_date
      AND ACCEPTED_OFFER = TRUE
),
tb1 AS (
    SELECT
        p.facility,
        o.ETA AS ETA_OFERTA,
        CASE
            WHEN o.REGIONAL LIKE '%SPI%' THEN 'SPIO'
            ELSE o.REGIONAL
        END AS REGIONAL_NORM,
        p.modal,
        p.Rotas_AM1, p.Rotas_CHP, p.Rotas_PM1,
        p.total_planejado_geral,
        o.total_ofertadas, o.total_aceitas,
        o.canceladas_operacao, o.canceladas_driver,
        o.total_canceladas,
        p.svc, o.REGIONAL
    FROM Planejamento AS p
    LEFT JOIN Ofertas AS o
        ON  p.facility        = o.facility
        AND p.modal           = o.service_normalized
        AND p.svc             = o.svc
    WHERE
        (o.REGIONAL = 'SPI MAR' AND p.svc IN ('SPR2', 'SPR6'))
        OR (o.REGIONAL LIKE '%SPI%' AND o.REGIONAL != 'SPI MAR')
        OR o.REGIONAL IS NULL
)
SELECT
    b.FACILITY_ID               AS facility,
    b.DRIVER_ID                 AS driver_id,
    b.VEHICLE_DESCRIPTION       AS tipo_veiculo,
    b.DRIVER_TYPE               AS driver_type,
    b.DRIVER_CATEGORY           AS driver_category,
    CAST(b.HORARIO_CHEGADA AS STRING) AS horario_chegada,
    CAST(b.DATA_ETA AS STRING)        AS data_eta,
    CAST(b.DATA_BROADCAST AS STRING)  AS data_broadcast,
    b.STATUS                    AS status_driver,
    b.SUBSTATUS,
    b.CANCELLATION,
    CAST(TIME(t.ETA_OFERTA) AS STRING) AS eta_planejado_operacao,
    t.REGIONAL_NORM             AS regional,
    t.modal, t.svc,
    t.Rotas_AM1, t.Rotas_CHP, t.Rotas_PM1,
    t.total_planejado_geral,
    t.total_ofertadas, t.total_aceitas,
    t.canceladas_operacao,
    t.canceladas_driver,
    t.total_canceladas
FROM Broadcast_Drivers b
LEFT JOIN tb1 t ON b.FACILITY_ID = t.facility
ORDER BY b.HORARIO_CHEGADA ASC, b.DRIVER_ID ASC
"""

def get_drivers_by_facility(facility: str, query_date: str) -> list[dict]:
    client = _get_client()
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("facility",   "STRING", facility),
            bigquery.ScalarQueryParameter("query_date", "DATE",   query_date),
        ]
    )
    rows = client.query(DRIVERS_SQL, job_config=job_config).result()
    result = []
    for row in rows:
        result.append(dict(row.items()))
    return result


# ─── Events table (persistência) ─────────────────────────────────────────────

import logging as _logging
from google.api_core.exceptions import NotFound

_EVENTS_DATASET = "notused_events"
_EVENTS_TABLE   = "events"


def _events_table_id() -> str:
    project = os.getenv("GOOGLE_CLOUD_QUOTA_PROJECT", "calm-mariner-105612")
    return f"{project}.{_EVENTS_DATASET}.{_EVENTS_TABLE}"


def ensure_events_table():
    """Cria dataset e tabela de eventos no BigQuery se não existirem."""
    try:
        client  = _get_client()
        project = os.getenv("GOOGLE_CLOUD_QUOTA_PROJECT", "calm-mariner-105612")
        ds_ref  = f"{project}.{_EVENTS_DATASET}"
        try:
            client.get_dataset(ds_ref)
        except NotFound:
            client.create_dataset(bigquery.Dataset(ds_ref))
            _logging.info(f"[BQ Events] Dataset criado: {ds_ref}")

        tbl_id = _events_table_id()
        try:
            client.get_table(tbl_id)
        except NotFound:
            schema = [
                bigquery.SchemaField("facility",   "STRING"),
                bigquery.SchemaField("driver_id",  "STRING"),
                bigquery.SchemaField("email",      "STRING"),
                bigquery.SchemaField("event_type", "STRING"),
                bigquery.SchemaField("eta_time",   "STRING"),
                bigquery.SchemaField("eta_date",   "STRING"),
                bigquery.SchemaField("clicked_at", "TIMESTAMP"),
                bigquery.SchemaField("offender",   "STRING"),
            ]
            tbl = bigquery.Table(tbl_id, schema=schema)
            client.create_table(tbl)
            _logging.info(f"[BQ Events] Tabela criada: {tbl_id}")
    except Exception as e:
        _logging.error(f"[BQ Events] ensure_events_table falhou: {e}")


def write_bq_event(facility: str, driver_id: str, email: str,
                   event_type: str, eta_time, eta_date, clicked_at: str,
                   offender: str | None = None):
    """Insere evento na tabela BigQuery (streaming insert)."""
    try:
        client = _get_client()
        # Usa offender vindo do frontend (que tem timezone correta) se disponível
        if offender is None:
            offender = (
                "DRIVER"    if event_type == "NOT_USED_INCORRETO" else
                "OPERATION" if event_type == "NOT_USED_CORRETO"   else
                None
            )
        row = {
            "facility":   facility.upper(),
            "driver_id":  str(driver_id),
            "email":      email or "",
            "event_type": event_type,
            "eta_time":   eta_time,
            "eta_date":   eta_date,
            "clicked_at": clicked_at,
            "offender":   offender,
        }
        errors = client.insert_rows_json(_events_table_id(), [row])
        if errors:
            _logging.error(f"[BQ Events] Insert errors: {errors}")
    except Exception as e:
        _logging.error(f"[BQ Events] write_bq_event falhou: {e}")


def write_bq_undo(facility: str, driver_id: str, email: str):
    """Registra UNDO no BigQuery para rastreamento."""
    try:
        from datetime import datetime, timezone
        client = _get_client()
        row = {
            "facility":   facility.upper(),
            "driver_id":  str(driver_id),
            "email":      email or "",
            "event_type": "UNDO",
            "clicked_at": datetime.now(timezone.utc).isoformat(),
        }
        client.insert_rows_json(_events_table_id(), [row])
    except Exception as e:
        _logging.error(f"[BQ Events] write_bq_undo falhou: {e}")


def get_today_bq_events() -> list[dict]:
    """Retorna os eventos mais recentes de hoje (para restaurar SQLite no startup)."""
    try:
        client = _get_client()
        query  = f"""
        SELECT * EXCEPT (rn)
        FROM (
            SELECT *, ROW_NUMBER() OVER (
                PARTITION BY facility, driver_id ORDER BY clicked_at DESC
            ) AS rn
            FROM `{_events_table_id()}`
            WHERE DATE(clicked_at, 'America/Sao_Paulo') = CURRENT_DATE('America/Sao_Paulo')
        )
        WHERE rn = 1 AND event_type != 'UNDO'
        """
        rows = list(client.query(query).result())
        return [dict(r.items()) for r in rows]
    except Exception as e:
        _logging.error(f"[BQ Events] get_today_bq_events falhou: {e}")
        return []


def get_all_bq_events(limit: int = 500) -> list[dict]:
    """Retorna todos os eventos para o painel admin (do BigQuery)."""
    try:
        client = _get_client()
        query  = f"""
        SELECT * EXCEPT (rn)
        FROM (
            SELECT *, ROW_NUMBER() OVER (
                PARTITION BY facility, driver_id ORDER BY clicked_at DESC
            ) AS rn
            FROM `{_events_table_id()}`
            WHERE event_type != 'UNDO'
        )
        WHERE rn = 1
        ORDER BY clicked_at DESC
        LIMIT {int(limit)}
        """
        rows = list(client.query(query).result())
        result = []
        for r in rows:
            row = dict(r.items())
            # Converte Timestamp para string ISO
            if hasattr(row.get("clicked_at"), "isoformat"):
                row["clicked_at"] = row["clicked_at"].isoformat()
            result.append(row)
        return result
    except Exception as e:
        _logging.error(f"[BQ Events] get_all_bq_events falhou: {e}")
        return []
