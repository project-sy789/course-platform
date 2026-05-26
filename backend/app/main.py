from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse
from redis.asyncio import Redis

from .config import settings
from .db import get_session, get_redis
from .logging import configure_logging
from .middleware import RequestContextMiddleware
from .routers import auth as auth_router
from .routers import videos as videos_router
from .routers import lessons as lessons_router
from .routers import admin as admin_router
from .routers import payments as payments_router
from .routers import materials as materials_router
from .routers import progress as progress_router
from .routers import account as account_router

configure_logging()

limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])

app = FastAPI(title="Course Platform API", version="1.0.0")
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(RequestContextMiddleware)


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(_request, _exc):
    return JSONResponse({"detail": "rate limited"}, status_code=429)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Type"],
)

app.include_router(auth_router.router)
app.include_router(videos_router.router)
app.include_router(lessons_router.router)
app.include_router(admin_router.router)
app.include_router(payments_router.router)
app.include_router(materials_router.router)
app.include_router(progress_router.router)
app.include_router(account_router.router)

# Expose /metrics for Prometheus. Excluded paths keep noise out of dashboards.
Instrumentator(
    excluded_handlers=["/healthz", "/healthz/ready", "/metrics"],
).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


@app.get("/healthz")
def health():
    """Liveness — process is up. Used by container orchestrators."""
    return {"ok": True}


@app.get("/healthz/ready")
async def ready(
    db: Session = Depends(get_session),
    redis: Redis = Depends(get_redis),
):
    """Readiness — DB and Redis are reachable. Used by load balancers."""
    checks: dict[str, str] = {}
    status_code = 200
    try:
        db.execute(text("SELECT 1"))
        checks["db"] = "ok"
    except Exception as e:
        checks["db"] = f"fail: {type(e).__name__}"
        status_code = 503
    try:
        pong = await redis.ping()
        checks["redis"] = "ok" if pong else "fail"
        if not pong:
            status_code = 503
    except Exception as e:
        checks["redis"] = f"fail: {type(e).__name__}"
        status_code = 503
    return JSONResponse({"checks": checks}, status_code=status_code)


# ---------- E2E bypass ----------
# Only registered when E2E_BYPASS_TOKEN is set. In production this leaves the
# route off the OpenAPI schema *and* unregistered — defense-in-depth so a
# misconfigured deploy can't accidentally expose it.
if settings.E2E_BYPASS_TOKEN:
    from fastapi import Header, HTTPException
    from sqlalchemy import update
    from .models import User

    @app.post("/api/v1/_e2e/verify-email", include_in_schema=False)
    def _e2e_verify_email(
        email: str,
        x_e2e_token: str = Header(default=""),
        db: Session = Depends(get_session),
    ):
        if x_e2e_token != settings.E2E_BYPASS_TOKEN:
            raise HTTPException(403, "forbidden")
        db.execute(
            update(User).where(User.email == email).values(email_verified=True)
        )
        db.commit()
        return {"ok": True}
