"""Slip-upload payments (Thai bank-transfer + SlipOK verify).

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-27
"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "slip_uploads",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("course_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("courses.id", ondelete="SET NULL"), nullable=True),
        sa.Column("lesson_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("lessons.id", ondelete="SET NULL"), nullable=True),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("r2_image_key", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("verify_response", sa.Text(), nullable=True),
        sa.Column("slip_ref", sa.Text(), nullable=True, unique=True),
        sa.Column("payment_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("payments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        # Exactly one target: per-course OR per-lesson. Both null means we
        # have no idea what the user paid for; both set means an ambiguous row.
        sa.CheckConstraint(
            "(course_id IS NOT NULL)::int + (lesson_id IS NOT NULL)::int = 1",
            name="ck_slip_one_target",
        ),
    )
    op.create_index("idx_slip_uploads_user", "slip_uploads", ["user_id"])
    op.create_index("idx_slip_uploads_status", "slip_uploads", ["status"])

    # Stripe is going away; payments.stripe_session_id is currently NOT NULL +
    # UNIQUE which blocks slip-derived payments. Relax it but keep the unique
    # so existing Stripe rows remain de-duped.
    op.alter_column("payments", "stripe_session_id",
                    existing_type=sa.Text(), nullable=True)
    op.add_column(
        "payments",
        sa.Column("slip_upload_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("slip_uploads.id", ondelete="SET NULL"),
                  nullable=True),
    )
    op.add_column(
        "payments",
        sa.Column("payment_method", sa.Text(), nullable=False,
                  server_default="stripe"),
    )


def downgrade() -> None:
    op.drop_column("payments", "payment_method")
    op.drop_column("payments", "slip_upload_id")
    op.alter_column("payments", "stripe_session_id",
                    existing_type=sa.Text(), nullable=False)
    op.drop_index("idx_slip_uploads_status", "slip_uploads")
    op.drop_index("idx_slip_uploads_user", "slip_uploads")
    op.drop_table("slip_uploads")
