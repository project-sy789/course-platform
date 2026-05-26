"""Credit wallet operations (ระบบเหรียญ/โทเค็น).

Single mutation entrypoint — `apply_delta` — that:
  1. Locks (or creates) the wallet row with `SELECT … FOR UPDATE`
  2. Computes the new balance, refusing to go negative on a "spend"
  3. Appends a CreditLedger row capturing the new balance
  4. Updates the wallet cache row

Holding the wallet lock for the whole transaction serialises concurrent
spends and topups for one user — overspend by race is structurally
impossible. The append-only ledger is the source of truth; the wallet
column is just a cache for fast `GET /balance`.

All amounts in satang (1 THB = 100 satang) to match course pricing.
"""
from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import CreditLedger, CreditWallet


class InsufficientCreditsError(Exception):
    """Raised by apply_delta when a spend would push the balance below zero.

    Routers translate this to HTTP 409 — it's a state conflict, not a bad
    request: the user simply doesn't have the credits."""


def get_balance(db: Session, user_id: uuid.UUID) -> int:
    w = db.get(CreditWallet, user_id)
    return w.balance_satang if w else 0


def apply_delta(
    db: Session,
    *,
    user_id: uuid.UUID,
    delta_satang: int,
    kind: str,
    ref: str | None = None,
    note: str | None = None,
    actor_user_id: uuid.UUID | None = None,
) -> CreditLedger:
    """Atomically mutate the wallet and append a ledger row.

    Caller is responsible for db.commit(); we don't commit here so the
    mutation can be part of a larger transaction (e.g. spend + create
    Enrollment in one shot)."""
    wallet = db.scalar(
        select(CreditWallet).where(CreditWallet.user_id == user_id).with_for_update()
    )
    if wallet is None:
        wallet = CreditWallet(user_id=user_id, balance_satang=0)
        db.add(wallet)
        db.flush()

    new_balance = wallet.balance_satang + delta_satang
    if new_balance < 0:
        raise InsufficientCreditsError(
            f"insufficient balance: have {wallet.balance_satang}, need {-delta_satang}"
        )

    wallet.balance_satang = new_balance
    entry = CreditLedger(
        user_id=user_id,
        delta_satang=delta_satang,
        balance_after_satang=new_balance,
        kind=kind,
        ref=ref,
        note=note,
        actor_user_id=actor_user_id,
    )
    db.add(entry)
    db.flush()
    return entry
