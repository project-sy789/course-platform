"""Drop credit_wallets + credit_ledger — token/wallet system removed.

Going forward purchases are direct: slip upload → admin/SlipOK approve →
enrollment / lesson_entitlement. No more wallet top-up step.

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-27
"""
from typing import Union

from alembic import op


revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("idx_credit_ledger_user_time", table_name="credit_ledger")
    op.drop_table("credit_ledger")
    op.drop_table("credit_wallets")


def downgrade() -> None:
    raise NotImplementedError("credit wallet removal is one-way")
