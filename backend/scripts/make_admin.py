"""Promote a user to admin.

Usage:
  docker compose exec api python -m scripts.make_admin user@example.com
"""
import sys
from sqlalchemy import select

from app.db import SessionLocal
from app.models import User


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python -m scripts.make_admin <email>", file=sys.stderr)
        return 2
    email = sys.argv[1]
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.email == email))
        if not user:
            print(f"No user with email {email!r}", file=sys.stderr)
            return 1
        user.is_admin = True
        db.commit()
        print(f"OK: {email} is now admin (id={user.id})")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
