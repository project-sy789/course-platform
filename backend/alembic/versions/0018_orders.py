"""Multi-item orders.

Adds:
  - orders                header (status, totals, optional coupon snapshot)
  - order_items           one row per course/lesson in an order
  - slip_uploads.order_id          FK to orders (legacy course_id/lesson_id stays nullable)
  - coupon_redemptions.order_id    FK to orders (audit linkage for multi-item)

Revision ID: 0018
Revises: 0017
Create Date: 2026-05-28
"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("subtotal_baht", sa.Integer(), nullable=False),
        sa.Column("discount_baht", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("final_baht", sa.Integer(), nullable=False),
        sa.Column("coupon_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("coupons.id", ondelete="SET NULL")),
        sa.Column("coupon_code", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending','awaiting','paid','cancelled')",
            name="ck_order_status",
        ),
    )
    op.create_index("idx_orders_user_status", "orders", ["user_id", "status"])

    op.create_table(
        "order_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("order_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("course_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("courses.id", ondelete="SET NULL")),
        sa.Column("lesson_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("lessons.id", ondelete="SET NULL")),
        sa.Column("title_snapshot", sa.Text(), nullable=False),
        sa.Column("unit_price_baht", sa.Integer(), nullable=False),
        sa.Column("line_discount_baht", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("line_final_baht", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "(course_id IS NULL) <> (lesson_id IS NULL)",
            name="ck_order_item_target",
        ),
    )
    op.create_index("idx_order_items_order", "order_items", ["order_id"])

    op.add_column(
        "slip_uploads",
        sa.Column("order_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("orders.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column(
        "coupon_redemptions",
        sa.Column("order_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("orders.id", ondelete="SET NULL"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("coupon_redemptions", "order_id")
    op.drop_column("slip_uploads", "order_id")
    op.drop_index("idx_order_items_order", table_name="order_items")
    op.drop_table("order_items")
    op.drop_index("idx_orders_user_status", table_name="orders")
    op.drop_table("orders")
