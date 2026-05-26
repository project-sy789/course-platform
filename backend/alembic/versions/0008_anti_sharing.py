"""Anti-account-sharing: trusted devices + login events.

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-26
"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "trusted_devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("device_hash", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("last_ip", postgresql.INET(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "device_hash", name="uq_trusted_device"),
    )
    op.create_index("idx_trusted_device_user", "trusted_devices", ["user_id"])

    op.create_table(
        "login_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("email_attempted", sa.Text(), nullable=False),
        sa.Column("ip", postgresql.INET(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("device_hash", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("suspicious", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("suspicion_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_index("idx_login_events_user_time", "login_events", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("idx_login_events_user_time", "login_events")
    op.drop_table("login_events")
    op.drop_index("idx_trusted_device_user", "trusted_devices")
    op.drop_table("trusted_devices")
