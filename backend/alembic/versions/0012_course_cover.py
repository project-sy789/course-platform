"""Course cover image — optional R2 object key per course.

NULL = no cover; frontend falls back to a generated editorial plate.

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-27
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("courses", sa.Column("cover_image_key", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("courses", "cover_image_key")
