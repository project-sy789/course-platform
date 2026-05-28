"""Admin audit log table.

Append-only ledger of every state-changing admin action. Keeps a snapshot of
the actor email so the audit row stays readable even if the admin user is
later deleted (FK SET NULL on actor_id, but actor_email is just text).

Revision ID: 0019
Revises: 0018
Create Date: 2026-05-28
"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("actor_email", sa.Text()),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target_type", sa.Text()),
        sa.Column("target_id", sa.Text()),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("detail", sa.Text()),
        sa.Column("ip", postgresql.INET()),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("idx_admin_audit_actor", "admin_audit_log", ["actor_id", "created_at"])
    op.create_index("idx_admin_audit_target", "admin_audit_log", ["target_type", "target_id"])
    op.create_index("idx_admin_audit_created", "admin_audit_log", ["created_at"])


def downgrade() -> None:
    op.drop_index("idx_admin_audit_created", table_name="admin_audit_log")
    op.drop_index("idx_admin_audit_target", table_name="admin_audit_log")
    op.drop_index("idx_admin_audit_actor", table_name="admin_audit_log")
    op.drop_table("admin_audit_log")
