from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from slowapi.middleware import SlowAPIMiddleware
from starlette.responses import JSONResponse

from .config import settings
from .routers import auth as auth_router
from .routers import videos as videos_router
from .routers import lessons as lessons_router
from .routers import admin as admin_router

limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])

app = FastAPI(title="Course Platform API", version="1.0.0")
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(_request, _exc):
    return JSONResponse({"detail": "rate limited"}, status_code=429)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Type"],
)

app.include_router(auth_router.router)
app.include_router(videos_router.router)
app.include_router(lessons_router.router)
app.include_router(admin_router.router)

# Expose /metrics for Prometheus. Excluded paths keep noise out of dashboards.
Instrumentator(
    excluded_handlers=["/healthz", "/metrics"],
).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


@app.get("/healthz")
def health():
    return {"ok": True}
