"""Runtime-editable payment settings — receiver bank + SlipOK credentials.

Single-row table (id=1). NULL columns mean "fall back to .env" so existing
deploys keep working without any data move; admins can override per-field
through the UI without redeploying.

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-27
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("id", sa.SmallInteger(), primary_key=True),
        sa.Column("receiver_bank_name", sa.Text(), nullable=True),
        sa.Column("receiver_bank_account", sa.Text(), nullable=True),
        sa.Column("receiver_name", sa.Text(), nullable=True),
        sa.Column("promptpay_id", sa.Text(), nullable=True),
        sa.Column("slipok_api_key", sa.Text(), nullable=True),
        sa.Column("slipok_branch_id", sa.Text(), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.CheckConstraint("id = 1", name="ck_app_settings_singleton"),
    )
    # Seed the singleton row with NULL fields so the helper never has to
    # branch on "row missing".
    op.execute("INSERT INTO app_settings (id) VALUES (1)")


def downgrade() -> None:
    op.drop_table("app_settings")
