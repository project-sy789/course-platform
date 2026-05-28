"""Admin audit logging.

`record(...)` appends a row to admin_audit_log. Caller is responsible for
committing — we add the row to the same transaction as the action so a
rolled-back action leaves no audit dust. The actor's email is snapshotted
into the row so the audit stays readable even after that admin is deleted.

Example:
    record(db, actor=admin, action="user.suspend",
           target_type="user", target_id=str(u.id),
           summary=f"Suspended {u.email}",
           detail=json.dumps({"reason": body.reason}))
    db.commit()
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from .models import AdminAuditLog, User


def record(
    db: Session,
    *,
    actor: User | None,
    action: str,
    summary: str,
    target_type: str | None = None,
    target_id: str | None = None,
    detail: str | None = None,
    ip: str | None = None,
) -> AdminAuditLog:
    row = AdminAuditLog(
        actor_id=actor.id if actor else None,
        actor_email=actor.email if actor else None,
        action=action,
        target_type=target_type,
        target_id=target_id,
        summary=summary,
        detail=detail,
        ip=ip,
    )
    db.add(row)
    db.flush()
    return row
