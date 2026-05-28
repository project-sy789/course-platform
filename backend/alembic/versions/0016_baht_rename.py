"""Rename satang/cents columns → baht (integer THB), divide values by 100.

We're moving away from minor-unit accounting because (a) the token wallet is
gone, (b) we don't need sub-baht prices, and (c) `price_cents` was confusing
admins who think in baht. New columns are still Integer but now hold whole
baht. Existing values divide by 100 (truncating any sub-baht remnants —
in practice all seeded prices are round-baht so nothing material is lost).

Affected:
  courses.price_cents          → price_baht
  lessons.price_cents          → price_baht
  payments.amount_cents        → amount_baht
  payments.subtotal_cents      → subtotal_baht
  payments.vat_cents           → vat_baht
  slip_uploads.amount_cents    → amount_baht

Revision ID: 0016
Revises: 0015
Create Date: 2026-05-27
"""
from typing import Union

from alembic import op


revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels = None
depends_on = None


_RENAMES = [
    ("courses",      "price_cents",    "price_baht"),
    ("lessons",      "price_cents",    "price_baht"),
    ("payments",     "amount_cents",   "amount_baht"),
    ("payments",     "subtotal_cents", "subtotal_baht"),
    ("payments",     "vat_cents",      "vat_baht"),
    ("slip_uploads", "amount_cents",   "amount_baht"),
]


def upgrade() -> None:
    for table, old, new in _RENAMES:
        op.alter_column(table, old, new_column_name=new)
        # Integer division — sub-baht satang values truncate. Acceptable for
        # this dataset; new prices will be entered as whole baht.
        op.execute(f"UPDATE {table} SET {new} = {new} / 100")


def downgrade() -> None:
    raise NotImplementedError("baht conversion is one-way")
