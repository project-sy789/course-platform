"""Per-lesson purchase: lesson price + lesson_entitlements.

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-26
"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lessons",
        sa.Column("price_cents", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("lessons", "price_cents", server_default=None)

    op.create_table(
        "lesson_entitlements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("lesson_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "lesson_id", name="uq_lesson_entitlement"),
    )
    op.create_index("idx_lesson_entitlement_user", "lesson_entitlements", ["user_id"])


def downgrade() -> None:
    op.drop_index("idx_lesson_entitlement_user", "lesson_entitlements")
    op.drop_table("lesson_entitlements")
    op.drop_column("lessons", "price_cents")
