"""Thai tax-invoice (ใบกำกับภาษี) fields on users + payments.

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-26
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Buyer-side tax info on the user profile.
    op.add_column("users", sa.Column("tax_name", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("tax_id", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("tax_address", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("tax_branch", sa.Text(), nullable=True))

    # Per-payment VAT breakdown + sequential invoice number + frozen buyer info.
    op.add_column("payments", sa.Column("subtotal_cents", sa.Integer(), nullable=True))
    op.add_column("payments", sa.Column("vat_cents", sa.Integer(), nullable=True))
    op.add_column("payments", sa.Column("invoice_number", sa.Text(), nullable=True))
    op.add_column("payments", sa.Column("buyer_tax_name", sa.Text(), nullable=True))
    op.add_column("payments", sa.Column("buyer_tax_id", sa.Text(), nullable=True))
    op.add_column("payments", sa.Column("buyer_tax_address", sa.Text(), nullable=True))
    op.add_column("payments", sa.Column("buyer_tax_branch", sa.Text(), nullable=True))
    op.create_unique_constraint("uq_payments_invoice_number", "payments", ["invoice_number"])


def downgrade() -> None:
    op.drop_constraint("uq_payments_invoice_number", "payments", type_="unique")
    for col in ("buyer_tax_branch", "buyer_tax_address", "buyer_tax_id", "buyer_tax_name",
                "invoice_number", "vat_cents", "subtotal_cents"):
        op.drop_column("payments", col)
    for col in ("tax_branch", "tax_address", "tax_id", "tax_name"):
        op.drop_column("users", col)
