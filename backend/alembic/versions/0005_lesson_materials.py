"""lesson materials with per-user watermarking

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-26
"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lesson_materials",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("lesson_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("r2_key", sa.Text(), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
                  nullable=False),
    )
    op.create_index("idx_lesson_materials_lesson", "lesson_materials", ["lesson_id"])

    op.create_table(
        "material_download_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("material_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("lesson_materials.id", ondelete="CASCADE"), nullable=False),
        sa.Column("watermark_id", sa.Text(), nullable=False, unique=True),
        sa.Column("ip", postgresql.INET(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
                  nullable=False),
    )
    op.create_index("idx_mat_dl_logs_material", "material_download_logs", ["material_id"])
    op.create_index("idx_mat_dl_logs_user", "material_download_logs", ["user_id"])
    op.create_index("idx_mat_dl_logs_watermark", "material_download_logs", ["watermark_id"])


def downgrade() -> None:
    op.drop_index("idx_mat_dl_logs_watermark", table_name="material_download_logs")
    op.drop_index("idx_mat_dl_logs_user", table_name="material_download_logs")
    op.drop_index("idx_mat_dl_logs_material", table_name="material_download_logs")
    op.drop_table("material_download_logs")
    op.drop_index("idx_lesson_materials_lesson", table_name="lesson_materials")
    op.drop_table("lesson_materials")
