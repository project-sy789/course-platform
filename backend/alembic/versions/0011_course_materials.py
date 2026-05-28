"""Course-scoped materials (one set of docs shared across all lessons).

`lesson_materials` already covered the per-lesson case. Extend it to also
allow course-scoped rows: make `lesson_id` nullable, add a nullable
`course_id`, and a CHECK constraint that exactly one is set. Mirrors the
shape `slip_uploads` already uses for its course/lesson target column.

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-27
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lesson_materials",
        sa.Column(
            "course_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("courses.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.alter_column("lesson_materials", "lesson_id", nullable=True)
    op.create_check_constraint(
        "ck_lesson_materials_scope",
        "lesson_materials",
        "(course_id IS NULL) <> (lesson_id IS NULL)",
    )
    op.create_index(
        "idx_lesson_materials_course", "lesson_materials", ["course_id"]
    )


def downgrade() -> None:
    op.drop_index("idx_lesson_materials_course", table_name="lesson_materials")
    op.drop_constraint("ck_lesson_materials_scope", "lesson_materials", type_="check")
    # Can't safely restore NOT NULL on lesson_id if course-scoped rows exist —
    # surface that loudly so the operator picks how to migrate the data.
    op.execute(
        "DO $$ BEGIN "
        "IF EXISTS (SELECT 1 FROM lesson_materials WHERE lesson_id IS NULL) THEN "
        "RAISE EXCEPTION 'course-scoped materials exist; delete or reassign before downgrading'; "
        "END IF; END $$;"
    )
    op.alter_column("lesson_materials", "lesson_id", nullable=False)
    op.drop_column("lesson_materials", "course_id")
