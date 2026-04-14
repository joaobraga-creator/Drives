# notused — Facility Driver Validation

Sistema de validação de motoristas escalados por facility (BRN).

## Estrutura

```
notused/
├── backend/
│   ├── main.py              # FastAPI — endpoints
│   ├── bigquery_client.py   # Queries BigQuery
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── index.html           # Login por email
    ├── dashboard.html       # Painel de drivers
    ├── style.css            # Dark theme IBM Plex
    └── app.js               # Lógica frontend
```

## Setup

### Backend

```bash
cd backend
cp .env.example .env
# edite .env e aponte GOOGLE_APPLICATION_CREDENTIALS para sua service account
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
python -m http.server 3000
# abra http://localhost:3000/index.html
```

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /health | Status do backend |
| POST | /auth/email | Descobre facility pelo email |
| GET | /drivers/{facility} | Lista motoristas escalados |
| POST | /confirm | Confirma chegada de um driver |
| DELETE | /confirm | Desfaz confirmação |

## Variáveis de ambiente

```
GOOGLE_APPLICATION_CREDENTIALS=./credentials.json   # service account com acesso ao BQ
CORS_ORIGINS=http://localhost:3000                  # origem do frontend
```
