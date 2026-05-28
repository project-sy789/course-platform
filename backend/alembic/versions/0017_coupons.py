"""Coupon system — admin-managed discount codes.

Two tables:
  - coupons             definition (code, kind, scope, limits, validity)
  - coupon_redemptions  audit log + per-user limit source

Kinds: fixed (subtract baht), percent (1-100, optional cap), full (100% off).
Scope: all / course / lesson — narrows applicability to a target.

Revision ID: 0017
Revises: 0016
Create Date: 2026-05-27
"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "coupons",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.Text(), nullable=False, unique=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("amount_baht", sa.Integer()),
        sa.Column("percent", sa.SmallInteger()),
        sa.Column("max_discount_baht", sa.Integer()),
        sa.Column("min_purchase_baht", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("scope", sa.Text(), nullable=False, server_default="all"),
        sa.Column("target_course_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("courses.id", ondelete="CASCADE")),
        sa.Column("target_lesson_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("lessons.id", ondelete="CASCADE")),
        sa.Column("valid_from", sa.DateTime(timezone=True)),
        sa.Column("valid_until", sa.DateTime(timezone=True)),
        sa.Column("usage_limit", sa.Integer()),
        sa.Column("per_user_limit", sa.Integer()),
        sa.Column("usage_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("note", sa.Text()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("kind IN ('fixed','percent','full')", name="ck_coupon_kind"),
        sa.CheckConstraint("scope IN ('all','course','lesson')", name="ck_coupon_scope"),
        sa.CheckConstraint(
            "(scope = 'course' AND target_course_id IS NOT NULL AND target_lesson_id IS NULL) "
            "OR (scope = 'lesson' AND target_lesson_id IS NOT NULL AND target_course_id IS NULL) "
            "OR (scope = 'all' AND target_course_id IS NULL AND target_lesson_id IS NULL)",
            name="ck_coupon_target_scope",
        ),
        sa.CheckConstraint(
            "(kind = 'fixed' AND amount_baht IS NOT NULL AND amount_baht > 0) "
            "OR (kind = 'percent' AND percent IS NOT NULL AND percent BETWEEN 1 AND 100) "
            "OR (kind = 'full')",
            name="ck_coupon_value",
        ),
    )
    op.create_index("idx_coupons_active", "coupons", ["is_active", "valid_until"])

    op.create_table(
        "coupon_redemptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("coupon_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("coupons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("payment_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("payments.id", ondelete="SET NULL")),
        sa.Column("slip_upload_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("slip_uploads.id", ondelete="SET NULL")),
        sa.Column("original_baht", sa.Integer(), nullable=False),
        sa.Column("discount_baht", sa.Integer(), nullable=False),
        sa.Column("final_baht", sa.Integer(), nullable=False),
        sa.Column("redeemed_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("idx_coupon_redemptions_coupon", "coupon_redemptions", ["coupon_id"])
    op.create_index("idx_coupon_redemptions_user", "coupon_redemptions", ["user_id"])

    # Track which coupon (if any) was applied to a slip upload — needed so
    # materialise_approval can record the redemption only on approval.
    op.add_column(
        "slip_uploads",
        sa.Column("coupon_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("coupons.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column(
        "slip_uploads",
        sa.Column("original_amount_baht", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("slip_uploads", "original_amount_baht")
    op.drop_column("slip_uploads", "coupon_id")
    op.drop_index("idx_coupon_redemptions_user", table_name="coupon_redemptions")
    op.drop_index("idx_coupon_redemptions_coupon", table_name="coupon_redemptions")
    op.drop_table("coupon_redemptions")
    op.drop_index("idx_coupons_active", table_name="coupons")
    op.drop_table("coupons")
