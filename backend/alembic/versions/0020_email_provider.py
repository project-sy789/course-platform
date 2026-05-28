"""Email provider config columns on app_settings.

Adds four nullable text columns so admins can pick a transactional sender
(Resend / Postmark / SendGrid) and store its API key in DB instead of
hard-coding env vars. NULL = fall back to .env, matching the rest of
app_settings.

Revision ID: 0020
Revises: 0019
Create Date: 2026-05-28
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("email_provider", sa.Text(), nullable=True))
    op.add_column("app_settings", sa.Column("email_api_key", sa.Text(), nullable=True))
    op.add_column("app_settings", sa.Column("email_from", sa.Text(), nullable=True))
    op.add_column("app_settings", sa.Column("email_from_name", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("app_settings", "email_from_name")
    op.drop_column("app_settings", "email_from")
    op.drop_column("app_settings", "email_api_key")
    op.drop_column("app_settings", "email_provider")
