"""email verification + password reset + payments

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-26
"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.create_table(
        "email_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_email_tokens_hash", "email_tokens", ["token_hash"])
    op.create_index("idx_email_tokens_user_purpose", "email_tokens", ["user_id", "purpose"])

    op.create_table(
        "payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("course_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("stripe_session_id", sa.Text(), nullable=False, unique=True),
        sa.Column("stripe_payment_intent", sa.Text()),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_payments_user_course", "payments", ["user_id", "course_id"])


def downgrade() -> None:
    op.drop_index("idx_payments_user_course", "payments")
    op.drop_table("payments")
    op.drop_index("idx_email_tokens_user_purpose", "email_tokens")
    op.drop_index("idx_email_tokens_hash", "email_tokens")
    op.drop_table("email_tokens")
    op.drop_column("users", "email_verified")
