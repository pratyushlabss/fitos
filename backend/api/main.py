from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.deps import lifespan
from api.routes import (
    activities,
    barcode,
    dashboard,
    food_scan,
    health,
    messaging,
    nutrition,
    products,
    recommendations,
    social,
    system,
    workouts,
)

app = FastAPI(title="FitOS API", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


def _error_response(request: Request, code: str, message: str, details: object = None) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={
            "error": {
                "code": code,
                "message": message,
                "request_id": request.state.request_id,
                "details": details or {},
            }
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": detail.upper(),
                "message": detail.replace("_", " ").capitalize(),
                "request_id": request.state.request_id,
                "details": exc.detail if isinstance(exc.detail, dict) else {},
            }
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return _error_response(
        request,
        "VALIDATION_ERROR",
        "Request validation failed.",
        {"fields": exc.errors()},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for route in (
    health.router,
    dashboard.router,
    nutrition.router,
    workouts.router,
    activities.router,
    barcode.router,
    recommendations.router,
    products.router,
    food_scan.router,
    system.router,
    messaging.router,
    social.router,
):
    app.include_router(route)
    app.include_router(route, prefix="/api/v1")
