import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from dotenv import load_dotenv
import bigquery_client as bq

load_dotenv()

app = FastAPI(title="Notused — Facility Driver Validation", version="1.0.0")

origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Confirmações em memória: { "FACILITY:DRIVER_ID": True }
_confirmacoes: dict[str, bool] = {}


# ─── Modelos ──────────────────────────────────────────────────────────────────

class EmailRequest(BaseModel):
    email: str

class ConfirmRequest(BaseModel):
    facility: str
    driver_id: str


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/email")
def auth_by_email(req: EmailRequest):
    """Descobre o facility a partir do email do operador."""
    if not req.email or "@" not in req.email:
        raise HTTPException(status_code=400, detail="Email inválido.")
    facility = bq.get_facility_by_email(req.email.strip())
    if not facility:
        raise HTTPException(
            status_code=404,
            detail="Nenhum facility encontrado para este email."
        )
    return {"facility": facility, "email": req.email.strip().lower()}


@app.get("/drivers/{facility}")
def get_drivers(facility: str):
    """Retorna todos os motoristas escalados para o facility."""
    if not facility:
        raise HTTPException(status_code=400, detail="Facility é obrigatório.")
    drivers = bq.get_drivers_by_facility(facility.upper())
    # Enriquece com confirmações locais
    key_prefix = facility.upper() + ":"
    for d in drivers:
        driver_id = str(d.get("driver_id") or "")
        d["confirmado"] = _confirmacoes.get(key_prefix + driver_id, False)
    return {
        "facility": facility.upper(),
        "total": len(drivers),
        "drivers": drivers
    }


@app.post("/confirm")
def confirmar_chegada(req: ConfirmRequest):
    """Marca a chegada de um motorista como confirmada."""
    if not req.facility or not req.driver_id:
        raise HTTPException(status_code=400, detail="Facility e driver_id são obrigatórios.")
    key = req.facility.upper() + ":" + str(req.driver_id)
    _confirmacoes[key] = True
    return {"confirmado": True, "facility": req.facility.upper(), "driver_id": req.driver_id}


@app.delete("/confirm")
def desfazer_confirmacao(req: ConfirmRequest):
    """Desfaz a confirmação de chegada de um motorista."""
    key = req.facility.upper() + ":" + str(req.driver_id)
    _confirmacoes.pop(key, None)
    return {"confirmado": False, "facility": req.facility.upper(), "driver_id": req.driver_id}
