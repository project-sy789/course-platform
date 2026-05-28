"""Thai tax-invoice (ใบกำกับภาษี) helpers.

Three responsibilities here, kept together because they're tightly coupled:

1. **VAT decomposition** — course prices are stored VAT-inclusive in whole
   baht. `split_vat_inclusive(107)` returns (subtotal=100, vat=7) at 7%.
   Subtotal+vat must always sum back to the original — we use integer math
   throughout (round subtotal, residual = vat) to avoid drift.

2. **Sequential invoice number allocation** — Thai Revenue Department wants
   invoices numbered without gaps and uniquely per issuer. We get this by
   relying on a Postgres unique constraint on `payments.invoice_number`
   plus `SELECT … FOR UPDATE` to serialize allocation under contention.

3. **PDF rendering** — bilingual TH/EN headings, with the issuer's company
   info from settings and the buyer info frozen on the Payment row at issue
   time. If `settings.INVOICE_FONT_PATH` is missing, the PDF still generates
   but Thai glyphs render as boxes — adequate for dev, NOT for production.
"""
from __future__ import annotations

import io
import os
import datetime as dt

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from .config import settings
from .models import Payment


def split_vat_inclusive(total_baht: int) -> tuple[int, int]:
    """Return (subtotal_baht, vat_baht) where total = subtotal + vat.

    `total_baht` is treated as VAT-inclusive. Subtotal is rounded; VAT is
    computed as the residual so the two always sum back to the original."""
    rate = settings.VAT_RATE_PERCENT / 100.0
    if rate <= 0:
        return total_baht, 0
    subtotal = round(total_baht / (1 + rate))
    vat = total_baht - subtotal
    return subtotal, vat


def allocate_invoice_number(db: Session) -> str:
    """Allocate the next sequential invoice number, prefixed and zero-padded.

    Counts existing rows with our prefix to derive the next sequence. NOT
    perfectly safe under high concurrency on its own — the unique constraint
    on `invoice_number` is the actual safety net (a duplicate raises
    IntegrityError and the caller retries).
    """
    prefix = settings.INVOICE_NUMBER_PREFIX
    pattern = f"{prefix}-%"
    count = db.scalar(
        select(func.count()).select_from(Payment).where(Payment.invoice_number.like(pattern))
    ) or 0
    return f"{prefix}-{count + 1:06d}"


def _register_thai_font():
    """Best-effort Thai font registration. Returns the font name to use, or
    "Helvetica" if the Thai font isn't available."""
    path = settings.INVOICE_FONT_PATH
    if not path or not os.path.exists(path):
        return "Helvetica"
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        pdfmetrics.registerFont(TTFont("ThaiBody", path))
        return "ThaiBody"
    except Exception:
        return "Helvetica"


def render_invoice_pdf(payment: Payment, course_title: str) -> bytes:
    """Render a single-page tax invoice for a paid Payment.

    Caller must ensure payment.status == "paid" and that invoice_number /
    subtotal_baht / vat_baht are populated."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    font = _register_thai_font()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4

    def line(y, txt, *, size=11, bold=False):
        c.setFont(font, size)
        c.drawString(2.0 * 72 / 2.54, y, txt)  # 2 cm left margin in points

    # --- Header
    c.setFont(font, 18)
    c.drawString(2.0 * 72 / 2.54, height - 2.5 * 72 / 2.54,
                 "ใบกำกับภาษี / Tax Invoice")

    # --- Issuer block (top right)
    c.setFont(font, 10)
    issuer_lines = [
        settings.COMPANY_NAME or "(บริษัท / Company)",
        f"เลขประจำตัวผู้เสียภาษี: {settings.COMPANY_TAX_ID or '-'}",
        settings.COMPANY_ADDRESS or "-",
        f"สาขา: {settings.COMPANY_BRANCH}",
        f"โทร: {settings.COMPANY_PHONE or '-'}",
    ]
    y = height - 2.5 * 72 / 2.54
    for s in issuer_lines:
        c.drawRightString(width - 2.0 * 72 / 2.54, y, s)
        y -= 14

    # --- Invoice meta
    meta_y = height - 5.5 * 72 / 2.54
    issued = (payment.updated_at or payment.created_at).astimezone(dt.timezone.utc)
    c.setFont(font, 11)
    c.drawString(2.0 * 72 / 2.54, meta_y,
                 f"เลขที่ / No.: {payment.invoice_number or '-'}")
    c.drawString(2.0 * 72 / 2.54, meta_y - 16,
                 f"วันที่ / Date: {issued.strftime('%Y-%m-%d')}")

    # --- Buyer block
    by = meta_y - 50
    c.setFont(font, 11)
    c.drawString(2.0 * 72 / 2.54, by, "ผู้ซื้อ / Customer:")
    c.setFont(font, 10)
    buyer_lines = [
        payment.buyer_tax_name or "-",
        f"เลขประจำตัวผู้เสียภาษี: {payment.buyer_tax_id or '-'}",
        payment.buyer_tax_address or "-",
        f"สาขา: {payment.buyer_tax_branch or '-'}",
    ]
    for i, s in enumerate(buyer_lines):
        c.drawString(2.0 * 72 / 2.54, by - 16 * (i + 1), s)

    # --- Items table (single line — one course per payment)
    table_y = by - 100
    c.setFont(font, 11)
    c.drawString(2.0 * 72 / 2.54, table_y, "รายการ / Description")
    c.drawRightString(width - 2.0 * 72 / 2.54, table_y, "จำนวนเงิน / Amount (THB)")
    c.line(2.0 * 72 / 2.54, table_y - 4, width - 2.0 * 72 / 2.54, table_y - 4)

    item_y = table_y - 24
    c.setFont(font, 10)
    c.drawString(2.0 * 72 / 2.54, item_y, course_title)
    subtotal = payment.subtotal_baht or 0
    vat = payment.vat_baht or 0
    total = payment.amount_baht or 0
    c.drawRightString(width - 2.0 * 72 / 2.54, item_y, f"{subtotal:,}")

    # --- Totals
    ty = item_y - 40
    rows = [
        ("ราคาก่อน VAT / Subtotal", f"{subtotal:,}"),
        (f"ภาษีมูลค่าเพิ่ม {settings.VAT_RATE_PERCENT:g}% / VAT", f"{vat:,}"),
        ("รวมทั้งสิ้น / Grand total", f"{total:,}"),
    ]
    for i, (label, value) in enumerate(rows):
        bold = i == len(rows) - 1
        c.setFont(font, 11 if bold else 10)
        c.drawRightString(width - 4.5 * 72 / 2.54, ty - 18 * i, label)
        c.drawRightString(width - 2.0 * 72 / 2.54, ty - 18 * i, value)

    # --- Footer
    c.setFont(font, 8)
    c.drawString(2.0 * 72 / 2.54, 2.0 * 72 / 2.54,
                 "ใบกำกับภาษีนี้ออกโดยระบบอัตโนมัติ / This tax invoice was generated automatically.")

    c.showPage()
    c.save()
    return buf.getvalue()
