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
SELECT DISTINCT PLC_PLACE_FACILITY AS facility
FROM `meli-bi-data.WHOWNER.BT_CARTEIRA_MLB`
WHERE LOWER(PLC_PLACE_EMAIL) = LOWER(@email)
LIMIT 1
"""

def get_facility_by_email(email: str) -> str | None:
    client = _get_client()
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("email", "STRING", email)]
    )
    rows = list(client.query(AUTH_SQL, job_config=job_config).result())
    if rows:
        return rows[0].facility
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
      AND DATE(OFFER_DATE) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
      AND ACCEPTED_OFFER = TRUE
    QUALIFY DATE(OFFER_DATE) = MAX(DATE(OFFER_DATE)) OVER (PARTITION BY FACILITY_ID)
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
    t.facility,
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
FROM tb1 t
LEFT JOIN Broadcast_Drivers b ON t.facility = b.FACILITY_ID
ORDER BY b.HORARIO_CHEGADA ASC, b.DRIVER_ID ASC
"""

def get_drivers_by_facility(facility: str) -> list[dict]:
    client = _get_client()
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("facility", "STRING", facility)]
    )
    rows = client.query(DRIVERS_SQL, job_config=job_config).result()
    result = []
    for row in rows:
        result.append(dict(row.items()))
    return result
