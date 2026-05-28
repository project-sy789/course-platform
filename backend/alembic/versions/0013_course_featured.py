"""is_featured flag on courses — admin opt-in for the home-page carousel.

Defaults to FALSE for every existing course; we let the homepage fall back
to "newest 3" when nothing is featured, so flipping this on is purely
additive — there's no day-zero curation requirement.

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-27
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "courses",
        sa.Column(
            "is_featured", sa.Boolean(), nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("courses", "is_featured")
