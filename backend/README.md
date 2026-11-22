# FitOS backend

FastAPI app with thin routes. Business logic lives in `domain/`. Vendors live in `adapters/`.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn api.main:app --reload --app-dir .
```
