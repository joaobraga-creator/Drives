import sqlite3
import pathlib
from datetime import datetime, timezone

DB_PATH = pathlib.Path(__file__).parent / "notused.db"


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                facility    TEXT    NOT NULL,
                driver_id   TEXT    NOT NULL,
                email       TEXT,
                event_type  TEXT    NOT NULL,
                eta_time    TEXT,
                eta_date    TEXT,
                clicked_at  TEXT    NOT NULL,
                offender    TEXT
            )
        """)
        try:
            conn.execute("ALTER TABLE events ADD COLUMN offender TEXT")
        except Exception:
            pass  # coluna já existe
        conn.commit()


def upsert_event(facility: str, driver_id: str, email: str,
                 event_type: str, eta_time: str | None, eta_date: str | None,
                 offender: str | None = None) -> dict:
    clicked_at = datetime.now(timezone.utc).isoformat()
    fac = facility.upper()
    did = str(driver_id)
    with _conn() as conn:
        conn.execute("DELETE FROM events WHERE facility=? AND driver_id=?", (fac, did))
        conn.execute(
            "INSERT INTO events (facility, driver_id, email, event_type, eta_time, eta_date, clicked_at, offender)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (fac, did, email, event_type, eta_time, eta_date, clicked_at, offender)
        )
        conn.commit()
    return {"facility": fac, "driver_id": did, "event_type": event_type,
            "clicked_at": clicked_at, "offender": offender}


def delete_event(facility: str, driver_id: str) -> bool:
    with _conn() as conn:
        cur = conn.execute(
            "DELETE FROM events WHERE facility=? AND driver_id=?",
            (facility.upper(), str(driver_id))
        )
        conn.commit()
        return cur.rowcount > 0


def get_events_map(facility: str) -> dict[str, dict]:
    """Retorna {driver_id: event_row} para um facility."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM events WHERE facility=?", (facility.upper(),)
        ).fetchall()
    return {r["driver_id"]: dict(r) for r in rows}


def get_all_events(limit: int = 1000) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM events ORDER BY clicked_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def restore_event(ev: dict):
    """Restaura evento do BigQuery no SQLite (só se não existir registro mais recente)."""
    fac = str(ev.get("facility", "")).upper()
    did = str(ev.get("driver_id", ""))
    if not fac or not did:
        return
    with _conn() as conn:
        existing = conn.execute(
            "SELECT clicked_at FROM events WHERE facility=? AND driver_id=?",
            (fac, did)
        ).fetchone()
        if existing:
            return  # SQLite já tem dado mais recente da sessão atual
        conn.execute(
            "INSERT INTO events (facility, driver_id, email, event_type, eta_time, eta_date, clicked_at, offender)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (
                fac, did,
                ev.get("email", ""),
                ev.get("event_type", ""),
                ev.get("eta_time"),
                ev.get("eta_date"),
                str(ev.get("clicked_at", "")),
                ev.get("offender"),
            )
        )
        conn.commit()


def get_facility_summary() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute("""
            SELECT
                facility,
                COUNT(*)                                    AS total,
                SUM(event_type = 'ARRIVED')                 AS arrived,
                SUM(event_type = 'NOT_USED_CORRETO')        AS nuc,
                SUM(event_type = 'NOT_USED_INCORRETO')      AS nui,
                MAX(clicked_at)                             AS last_activity
            FROM events
            GROUP BY facility
            ORDER BY last_activity DESC
        """).fetchall()
    return [dict(r) for r in rows]
