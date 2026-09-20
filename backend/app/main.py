from contextlib import asynccontextmanager
from datetime import datetime, timezone
import asyncio
import json
import logging
import os
import re
from time import perf_counter
from uuid import uuid4

from alembic import command
from alembic.config import Config
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .api import (
    audit, dashboard, data_flows, devices, far, import_engine, intelligence,
    investigations, knowledge, logical_services, maintenance, monitoring, networks,
    projects, pv1, racks, rca, security, settings as settings_api, sites, tenants, workspaces,
    troubleshoot, vendors, pv1_communication, operational_actions, module_policy,
)
from .api.error_utils import standardize_validation_errors
from .api.import_engine import ROUND_TRIP_EXPOSE_HEADER_NAMES, ROUND_TRIP_EXPOSE_HEADERS
from .core.config import settings
from .database import ConfigSessionLocal, config_engine, default_engine
from .models.config import UserTenantAccess
from .api.utils import get_current_user_id
from .runtime_diagnostics import build_readiness_payload
from .observability import SlidingWindowRateLimiter, request_rate_limit_key, safe_request_metric
from .pv1 import models as pv1_models  # noqa: F401 - register PV1 tables with Base.metadata
from .architecture import models as architecture_models  # noqa: F401 - register canonical Architecture tables

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("sysgrid.api")
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def _upgrade_database_schema(backend_dir: str) -> None:
    """Upgrade the configured tenant database with Alembic's supported Python API."""
    config = Config(os.path.join(backend_dir, "alembic.ini"))
    command.upgrade(config, "head")


async def run_migrations() -> None:
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    logger.info("Checking database migrations")
    try:
        await asyncio.to_thread(_upgrade_database_schema, backend_dir)
    except Exception as exc:
        raise RuntimeError("Database migration failed") from exc
    logger.info("Database schema is current")


async def ping_engine(engine) -> tuple[bool, str | None]:
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        return True, None
    except Exception as exc:  # readiness reports a safe summary only
        logger.warning("Readiness database check failed", exc_info=exc)
        return False, exc.__class__.__name__


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.assert_production_safe()

    if settings.startup_schema_management_enabled:
        from .database import init_config_db
        await init_config_db()
        await run_migrations()
    else:
        logger.warning(
            "Automatic startup schema mutation is disabled; expecting operator-managed production migrations",
            extra={"startup_schema_policy": settings.startup_schema_policy},
        )
    yield


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[dict[str, object]] = []

    async def connect(self, websocket: WebSocket, *, user_id: str, tenant_id: int):
        await websocket.accept()
        self.active_connections.append({"websocket": websocket, "user_id": user_id, "tenant_id": tenant_id})

    def disconnect(self, websocket: WebSocket):
        self.active_connections = [
            connection for connection in self.active_connections
            if connection.get("websocket") is not websocket
        ]

    async def broadcast(self, message: str, *, tenant_id: int | None = None):
        for connection in list(self.active_connections):
            if tenant_id is not None and connection.get("tenant_id") != tenant_id:
                continue
            websocket = connection["websocket"]
            try:
                await websocket.send_text(message)
            except Exception:
                self.disconnect(websocket)


manager = ConnectionManager()
app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan, redirect_slashes=False)
standardize_validation_errors(app)
app.state.ws_manager = manager
app.state.rate_limiter = SlidingWindowRateLimiter(
    limit=settings.RATE_LIMIT_REQUESTS,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)

EXPOSED_DOWNLOAD_HEADERS = list(ROUND_TRIP_EXPOSE_HEADER_NAMES)
origins = settings.cors_origins
allow_creds = False if "*" in origins else True

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=allow_creds,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=EXPOSED_DOWNLOAD_HEADERS + audit.AUDIT_SCOPE_HEADER_NAMES + ["X-Request-ID"],
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=1)


@app.middleware("http")
async def request_context_and_export_headers(request: Request, call_next):
    started = perf_counter()
    incoming_request_id = request.headers.get("X-Request-ID", "")
    request_id = incoming_request_id if REQUEST_ID_PATTERN.fullmatch(incoming_request_id) else str(uuid4())
    request.state.request_id = request_id

    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    duration_ms = (perf_counter() - started) * 1000
    # Safe, structured request timing. The path is retained for operations;
    # bodies, query values, and response content are deliberately excluded.
    metric = safe_request_metric(
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
        duration_ms=duration_ms,
        workspace=("projects" if request.url.path.startswith("/api/v2/projects") or request.url.path.startswith("/api/v1/projects") else "architecture" if "/architecture" in request.url.path or "/models" in request.url.path else "other"),
        command_id_present=bool(request.headers.get("Idempotency-Key") or request.headers.get("X-Command-Id")),
        outcome="success" if response.status_code < 400 else "rate_limited" if response.status_code == 429 else "conflict" if response.status_code == 409 else "failure",
        projection_lag_ms=getattr(request.state, "projection_lag_ms", None),
        schedule_calculation_version=getattr(request.state, "schedule_calculation_version", None),
        schedule_calculation_duration_ms=getattr(request.state, "schedule_calculation_duration_ms", None),
        schedule_cache_status=getattr(request.state, "schedule_cache_status", None),
        upload_scan_state=getattr(request.state, "upload_scan_state", None),
        job_delivery_status=getattr(request.state, "job_delivery_status", None),
    )
    request.state.safe_metric = metric
    response.headers["Server-Timing"] = f"app;dur={metric['duration_ms']}"
    if "projection_lag_ms" in metric:
        response.headers["X-Projection-Lag-Ms"] = str(metric["projection_lag_ms"])
    if "schedule_calculation_version" in metric:
        response.headers["X-Schedule-Calculation-Version"] = str(metric["schedule_calculation_version"])
    if "schedule_calculation_duration_ms" in metric:
        response.headers["X-Schedule-Calculation-Duration-Ms"] = str(metric["schedule_calculation_duration_ms"])
    if "schedule_cache_status" in metric:
        response.headers["X-Schedule-Cache-Status"] = str(metric["schedule_cache_status"])
    logger.info("request_complete", extra={"pv1_metric": metric})
    if response.status_code == 200:
        response_header_names = {key.lower() for key in response.headers.keys()}
        if {
            "content-disposition",
            "x-sysgrid-import-profile",
            "x-sysgrid-schema-version",
        }.issubset(response_header_names):
            response.headers["Access-Control-Expose-Headers"] = ROUND_TRIP_EXPOSE_HEADERS
    return response


@app.middleware("http")
async def bounded_mutation_rate_limit(request: Request, call_next):
    method = request.method.upper()
    expensive_read = method == "GET" and any(token in request.url.path for token in ("/export", "/reports/"))
    if not settings.RATE_LIMIT_ENABLED or (method not in {"POST", "PUT", "PATCH", "DELETE"} and not expensive_read):
        return await call_next(request)
    decision = app.state.rate_limiter.check(request_rate_limit_key(request))
    if not decision.allowed:
        request_id = getattr(request.state, "request_id", str(uuid4()))
        return JSONResponse(
            status_code=429,
            content={
                "code": "RATE_LIMITED",
                "message": "Too many requests. Retry after the indicated delay.",
                "request_id": request_id,
                "retryable": True,
            },
            headers={"X-Request-ID": request_id, "Retry-After": str(decision.retry_after_seconds)},
        )
    response = await call_next(request)
    response.headers.setdefault("X-RateLimit-Remaining", str(decision.remaining))
    return response


def websocket_origin_allowed(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    if "*" in settings.cors_origins:
        return not settings.is_production
    return bool(origin and origin in settings.cors_origins)


@app.websocket(f"{settings.API_V1_STR}/ws/sync")
async def websocket_endpoint(websocket: WebSocket):
    if not websocket_origin_allowed(websocket):
        await websocket.close(code=1008, reason="Origin is not allowed")
        return
    if settings.identity_mode == "trusted_proxy" and not websocket.headers.get(settings.TRUSTED_PROXY_USER_HEADER):
        await websocket.close(code=1008, reason="Authenticated proxy identity is missing")
        return

    user_id = get_current_user_id(websocket)
    raw_tenant_id = websocket.query_params.get("tenant_id")
    try:
        tenant_id = int(raw_tenant_id or "")
    except (TypeError, ValueError):
        await websocket.close(code=1008, reason="Tenant scope is required")
        return

    async with ConfigSessionLocal() as config_db:
        access = await config_db.execute(
            select(UserTenantAccess).where(
                UserTenantAccess.user_id == user_id,
                UserTenantAccess.tenant_id == tenant_id,
            )
        )
        if not access.scalar_one_or_none():
            await websocket.close(code=1008, reason="Tenant scope is not authorized")
            return

    await manager.connect(websocket, user_id=user_id, tenant_id=tenant_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
        logger.exception("WebSocket sync connection failed")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", str(uuid4()))
    logger.exception(
        "Unhandled request failure",
        extra={"request_id": request_id, "path": request.url.path, "method": request.method},
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal Server Error. Please consult system logs.",
            "path": request.url.path,
            "request_id": request_id,
        },
        headers={"X-Request-ID": request_id},
    )


for router in (
    tenants.router, devices.router, import_engine.router, networks.router, security.router,
    dashboard.router, racks.router, audit.router, sites.router, maintenance.router,
    logical_services.router, settings_api.router, monitoring.router, troubleshoot.router,
    data_flows.router, intelligence.router, rca.router, investigations.router, far.router,
    projects.router, vendors.router, knowledge.router, workspaces.router,
    operational_actions.router,
):
    app.include_router(router, prefix=settings.API_V1_STR)

app.include_router(module_policy.router, prefix=settings.API_V1_STR)

app.include_router(pv1.router, prefix="/api/v2")
app.include_router(pv1_communication.router, prefix="/api/v2")
from .architecture import api as architecture_api
app.include_router(architecture_api.router, prefix="/api/v2")


@app.get(f"{settings.API_V1_STR}/health")
def health_check():
    return {
        "status": "online",
        "alive": True,
        "api_prefix": settings.API_V1_STR,
        "server_timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get(f"{settings.API_V1_STR}/readiness")
async def readiness_check():
    config_ok, config_error = await ping_engine(config_engine)
    default_ok, default_error = await ping_engine(default_engine)
    ready = config_ok and default_ok and not settings.production_guard_errors()
    payload = build_readiness_payload()
    payload.update({
        "status": "ready" if ready else "not_ready",
        "dependencies": {
            "config_database": {"ready": config_ok, "error_type": config_error},
            "default_database": {"ready": default_ok, "error_type": default_error},
            "production_guard": {
                "ready": not settings.production_guard_errors(),
                "error_count": len(settings.production_guard_errors()),
            },
        },
    })
    return JSONResponse(status_code=200 if ready else 503, content=payload)


@app.get("/")
def read_root():
    return {
        "status": "online",
        "system": settings.PROJECT_NAME,
        "environment": settings.environment_name,
    }


@app.post(f"{settings.API_V1_STR}/observability/performance", status_code=202)
async def ingest_field_performance(request: Request):
    """Accept bounded, privacy-safe field metric aggregates.

    This endpoint is deliberately not a production-gate producer. Pilot/release
    analysis must independently authorize and sample these records; synthetic
    browser artifacts never become field evidence.
    """
    raw = await request.body()
    if len(raw) > 256 * 1024:
        return JSONResponse(status_code=413, content={"code": "OBSERVABILITY_PAYLOAD_TOO_LARGE"})
    try:
        payload = json.loads(raw or b"{}")
    except (TypeError, ValueError):
        return JSONResponse(status_code=400, content={"code": "OBSERVABILITY_INVALID_JSON"})
    if not isinstance(payload, dict) or not isinstance(payload.get("metrics"), list) or len(payload["metrics"]) > 500:
        return JSONResponse(status_code=400, content={"code": "OBSERVABILITY_INVALID_METRICS"})
    candidate = str(payload.get("candidate_sha256") or "").strip().lower()
    configured_candidate = settings.PV1_RELEASE_CANDIDATE_SHA.strip().lower()
    if candidate and not re.fullmatch(r"[0-9a-f]{64}", candidate):
        return JSONResponse(status_code=400, content={"code": "OBSERVABILITY_INVALID_CANDIDATE"})
    if configured_candidate and not re.fullmatch(r"[0-9a-f]{64}", configured_candidate):
        logger.error("pv1_field_metrics_release_identity_misconfigured")
        return JSONResponse(status_code=503, content={"code": "OBSERVABILITY_RELEASE_IDENTITY_UNAVAILABLE"})
    allowed = {"kind", "name", "value", "value_ms", "unit", "route_class", "workspace", "status_class", "command_id_present", "projection_lag_ms", "schedule_calculation_version", "schedule_calculation_duration_ms", "viewport_class", "candidate_sha256", "release", "measurement_boundary", "at_ms"}
    for metric in payload["metrics"]:
        if not isinstance(metric, dict) or set(metric) - allowed or not isinstance(metric.get("name"), str) or not isinstance(metric.get("value"), (int, float)):
            return JSONResponse(status_code=400, content={"code": "OBSERVABILITY_INVALID_METRIC"})
    release = str(payload.get("release") or "").strip()[:80]
    if configured_candidate and candidate != configured_candidate:
        logger.warning("pv1_field_metrics_candidate_mismatch", extra={"pv1_field_metrics": {"release": release, "sample_count": len(payload["metrics"])}})
        return JSONResponse(status_code=202, content={"accepted": 0, "quarantined": len(payload["metrics"]), "eligible_for_release_evidence": False, "field_evidence_status": "NOT_EVALUATED", "reason": "Candidate identity is missing or does not match trusted deployment identity.", "owner_phase": "P14_PILOT_RELEASE_HANDOFF"})
    eligible = bool(configured_candidate and candidate == configured_candidate and release)
    logger.info("pv1_field_metrics_received", extra={"pv1_field_metrics": {"candidate_sha256": candidate if eligible else "unattributed", "release": release or "unattributed", "sample_count": len(payload["metrics"])}})
    return {"accepted": len(payload["metrics"]) if eligible else 0, "quarantined": 0 if eligible else len(payload["metrics"]), "eligible_for_release_evidence": eligible, "field_evidence_status": "NOT_EVALUATED", "owner_phase": "P14_PILOT_RELEASE_HANDOFF"}
