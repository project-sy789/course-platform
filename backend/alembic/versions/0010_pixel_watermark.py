"""Per-course pixel-watermark opt-in flag.

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-27
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "courses",
        sa.Column("pixel_watermark", sa.Boolean(), nullable=False,
                  server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("courses", "pixel_watermark")
