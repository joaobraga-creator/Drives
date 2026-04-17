import os
import re
import logging
import pathlib
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
import bigquery_client as bq
import database as db

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    # Startup: garante tabela BQ e restaura eventos de hoje
    try:
        bq.ensure_events_table()
        today = bq.get_today_bq_events()
        for ev in today:
            db.restore_event(ev)
        logging.info(f"[Startup] {len(today)} eventos restaurados do BigQuery")
    except Exception as e:
        logging.error(f"[Startup] Restauração falhou: {e}")
    yield


app = FastAPI(title="Notused — Facility Driver Validation", version="2.0.0", lifespan=lifespan)

origins = os.getenv("CORS_ORIGINS", "http://localhost:8000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _is_admin(email: str) -> bool:
    return str(email or "").lower().endswith("@mercadolivre.com")


def _require_admin(email: str):
    if not _is_admin(email):
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores.")


# ─── Models ───────────────────────────────────────────────────────────────────

class EmailRequest(BaseModel):
    email: str

class EventRequest(BaseModel):
    facility:   str
    driver_id:  str
    event_type: str            # ARRIVED | NOT_USED_CORRETO | NOT_USED_INCORRETO
    email:      str = ""
    eta_time:   str | None = None
    eta_date:   str | None = None
    offender:   str | None = None  # DRIVER | OPERATION | None

class UndoRequest(BaseModel):
    facility:  str
    driver_id: str
    email:     str = ""


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/email")
def auth_by_email(req: EmailRequest):
    if not req.email or "@" not in req.email:
        raise HTTPException(status_code=400, detail="Email inválido.")
    email = req.email.strip().lower()

    # Admin: acesso direto, sem consulta ao BigQuery
    if _is_admin(email):
        return {"facility": None, "email": email, "is_admin": True}

    facility = bq.get_facility_by_email(email)
    if not facility:
        raise HTTPException(status_code=404, detail="Nenhum facility encontrado para este email.")
    return {"facility": facility, "email": email, "is_admin": False}


_FACILITY_RE = re.compile(r'^[A-Z0-9_\-]{1,30}$')

@app.get("/drivers/{facility}")
def get_drivers(facility: str):
    if not facility:
        raise HTTPException(status_code=400, detail="Facility é obrigatório.")
    facility_upper = facility.upper()
    if not _FACILITY_RE.match(facility_upper):
        raise HTTPException(status_code=400, detail="Facility inválido.")
    drivers = bq.get_drivers_by_facility(facility_upper)
    events  = db.get_events_map(facility_upper)
    for d in drivers:
        ev = events.get(str(d.get("driver_id") or ""))
        if ev:
            d["event_type"]  = ev["event_type"]
            d["clicked_at"]  = ev["clicked_at"]
            d["event_email"] = ev["email"]
        else:
            d["event_type"]  = None
            d["clicked_at"]  = None
            d["event_email"] = None
    return {"facility": facility_upper, "total": len(drivers), "drivers": drivers}


@app.post("/event")
def record_event(req: EventRequest):
    valid = {"ARRIVED", "NOT_USED_CORRETO", "NOT_USED_INCORRETO"}
    if req.event_type not in valid:
        raise HTTPException(status_code=400, detail=f"event_type inválido. Valores aceitos: {valid}")
    result = db.upsert_event(
        req.facility, req.driver_id, req.email,
        req.event_type, req.eta_time, req.eta_date,
        req.offender
    )
    bq.write_bq_event(
        req.facility, req.driver_id, req.email,
        req.event_type, req.eta_time, req.eta_date,
        result["clicked_at"], req.offender
    )
    return result


@app.delete("/event")
def undo_event(req: UndoRequest):
    removed = db.delete_event(req.facility, req.driver_id)
    if removed:
        bq.write_bq_undo(req.facility, req.driver_id, req.email)
    return {"removed": removed, "facility": req.facility.upper(), "driver_id": req.driver_id}


@app.get("/admin/summary")
def admin_summary(email: str = Query(...)):
    _require_admin(email)
    return {"summary": db.get_facility_summary()}


@app.get("/admin/events")
def admin_events(email: str = Query(...), limit: int = Query(default=500, le=2000)):
    _require_admin(email)
    events = bq.get_all_bq_events(limit)
    if not events:
        events = db.get_all_events(limit)
    return {"events": events}


# ─── Frontend estático ────────────────────────────────────────────────────────
_FRONTEND = pathlib.Path(__file__).parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(_FRONTEND), html=True), name="static")
