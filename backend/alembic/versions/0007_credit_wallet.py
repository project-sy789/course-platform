"""Credit wallet (token system).

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-26
"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "credit_wallets",
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("balance_satang", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "credit_ledger",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("delta_satang", sa.Integer(), nullable=False),
        sa.Column("balance_after_satang", sa.Integer(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("ref", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "idx_credit_ledger_user_time", "credit_ledger", ["user_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("idx_credit_ledger_user_time", "credit_ledger")
    op.drop_table("credit_ledger")
    op.drop_table("credit_wallets")
