"""course access_duration_days

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-26
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NULL = lifetime; existing courses keep lifetime access by default.
    op.add_column(
        "courses",
        sa.Column("access_duration_days", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("courses", "access_duration_days")
