"""Request middleware: assigns a request_id, binds it (plus IP/UA hash) into
the structlog context so every log line inside the request inherits them.

Mounted in app.main.
"""
from __future__ import annotations

import hashlib
import time
import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from .logging import log


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        ip = request.headers.get("x-real-ip") or (
            request.client.host if request.client else "0.0.0.0"
        )
        ua = request.headers.get("user-agent", "")
        ua_hash = hashlib.sha256(ua.encode()).hexdigest()[:16]

        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            ip=ip,
            ua_hash=ua_hash,
            method=request.method,
            path=request.url.path,
        )
        request.state.request_id = request_id

        start = time.perf_counter()
        try:
            response: Response = await call_next(request)
        except Exception:
            log.exception("request_failed")
            raise
        elapsed_ms = (time.perf_counter() - start) * 1000

        log.info(
            "request",
            status=response.status_code,
            elapsed_ms=round(elapsed_ms, 2),
        )
        response.headers["X-Request-ID"] = request_id
        return response
