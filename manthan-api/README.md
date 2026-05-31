# manthan-api

Multi-tenant backend for Manthan: the API, workers, and adapter layer around
the agent brain. Speaks to `manthan-ui` (frontend) and imports `manthan-agent`
(the brain) as a library.

## Quick start (local dev)

```bash
# 1. Start Postgres
docker compose up -d postgres

# 2. Install Python deps with uv
uv sync

# 3. Copy + edit env
cp .env.example .env
# fill in OPENROUTER_API_KEY at minimum

# 4. Seed a dev org + admin member
uv run python -m manthan_api.scripts.bootstrap_dev_org

# 5. Run the API
uv run uvicorn manthan_api.main:app --reload --port 8000
```

Verify:

```bash
curl http://localhost:8000/healthz
# {"status":"ok","version":"0.1.0"}

curl http://localhost:8000/readyz
# {"status":"ready","db":true,"version":"0.1.0"}

curl -H "X-Manthan-Dev-Org: acme" http://localhost:8000/api/cases
# {"cases":[],"total":0}
```

## Layout

```
manthan-api/
├── pyproject.toml
├── docker-compose.yml         # Postgres for local dev
├── schema/
│   └── 001_initial.sql        # full DB schema
├── src/manthan_api/
│   ├── main.py                # FastAPI app entry
│   ├── config.py              # env-driven settings
│   ├── db.py                  # asyncpg pool
│   ├── models.py              # Pydantic request/response
│   ├── api/                   # HTTP routers
│   │   ├── health.py
│   │   └── cases.py
│   ├── middleware/
│   │   └── tenant.py          # org+member resolver (dev bypass + Clerk)
│   ├── workers/               # investigate / actor / cron (forthcoming)
│   ├── adapters/              # stripe / resend / slack / linear / hubspot writes
│   └── scripts/               # bootstrap_dev_org, etc.
└── README.md
```

## Architecture

Events table is the single source of truth (12-Factor Agents pattern).
Workers `LISTEN manthan_event` and react. Derived projections (cases,
actions) are updated by the same workers. The frontend reads from the
projection tables; the audit log reads from events directly.

See `/Users/akshmnd/Dev Projects/manthanv2/agent/` for the agent brain
that this backend wraps.
