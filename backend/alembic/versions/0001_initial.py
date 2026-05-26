"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("email", postgresql.CITEXT(), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "courses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("slug", sa.Text(), nullable=False, unique=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("price_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "videos",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("r2_manifest_key", sa.Text(), nullable=False),
        sa.Column("duration_sec", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "lessons",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("course_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("video_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("videos.id"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("is_preview", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.UniqueConstraint("course_id", "position", name="uq_lesson_position"),
    )

    op.create_table(
        "video_keys",
        sa.Column("video_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("videos.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("key_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("key_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("key_tag", sa.LargeBinary(), nullable=False),
        sa.Column("kek_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "enrollments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("course_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "course_id", name="uq_enroll_user_course"),
    )
    op.create_index("idx_enroll_user", "enrollments", ["user_id"])

    op.create_table(
        "key_access_log",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("video_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("videos.id"), nullable=False),
        sa.Column("ip", postgresql.INET(), nullable=False),
        sa.Column("user_agent", sa.Text()),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.Column("reason", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_kal_user_video", "key_access_log", ["user_id", "video_id", "created_at"])


def downgrade() -> None:
    op.drop_index("idx_kal_user_video", "key_access_log")
    op.drop_table("key_access_log")
    op.drop_index("idx_enroll_user", "enrollments")
    op.drop_table("enrollments")
    op.drop_table("video_keys")
    op.drop_table("lessons")
    op.drop_table("videos")
    op.drop_table("courses")
    op.drop_table("users")
