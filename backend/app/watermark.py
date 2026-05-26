"""Per-user watermarking for downloadable course materials.

Threat model: a paying student saves a PDF and reposts it. We want both:
  1. Visible attribution — a footer on every page so a casual screenshotter
     spreads their own identifier with the leak.
  2. Invisible attribution — PDF metadata + a structural marker so even if
     the visible footer is cropped, we can still identify the source from
     a binary copy.

We also keep a `MaterialDownloadLog` row keyed by the `watermark_id` printed
in the file. Given a leaked file we can: read the watermark_id (visible or
from metadata), look up the row, find the user/IP/timestamp.

This is forensic, not cryptographic. A determined attacker with PDF tooling
can strip the watermark — that's fine, we're optimizing for casual leakage,
which is most of it.
"""
from __future__ import annotations

import datetime as dt
import io
import secrets

from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas


def new_watermark_id() -> str:
    """Short token (URL-safe). Stored on the log row + embedded in the file."""
    return secrets.token_urlsafe(8)


def _build_overlay(width: float, height: float, footer_text: str,
                   watermark_id: str) -> bytes:
    """Render a one-page transparent overlay: footer line + diagonal faint stamp."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))

    # Foot of page — readable but unobtrusive.
    c.setFont("Helvetica", 8)
    c.setFillGray(0.35)
    c.drawString(36, 18, footer_text)

    # Diagonal repeat — harder to crop out than a single footer.
    c.saveState()
    c.setFont("Helvetica-Bold", 38)
    c.setFillGray(0.92)  # very faint; visible but not page-ruining
    c.translate(width / 2, height / 2)
    c.rotate(35)
    stamp = f"id:{watermark_id}"
    c.drawCentredString(0, 0, stamp)
    c.drawCentredString(0, 120, stamp)
    c.drawCentredString(0, -120, stamp)
    c.restoreState()

    c.showPage()
    c.save()
    return buf.getvalue()


def watermark_pdf(pdf_bytes: bytes, *, user_id: str, user_email: str,
                  watermark_id: str) -> bytes:
    """Return a new PDF with per-user attribution stamped on every page."""
    ts = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    footer = f"สำหรับ {user_email} · รหัส:{watermark_id} · {ts}"

    src = PdfReader(io.BytesIO(pdf_bytes))
    out = PdfWriter()

    for page in src.pages:
        # PDF pages can have arbitrary sizes — match the overlay to each page.
        w = float(page.mediabox.width)
        h = float(page.mediabox.height)
        overlay_pdf = PdfReader(io.BytesIO(_build_overlay(w, h, footer, watermark_id)))
        page.merge_page(overlay_pdf.pages[0])
        out.add_page(page)

    # Invisible attribution. Anyone with `pdfinfo` or "File → Properties" sees
    # these — a useful smoking gun even when the footer has been cropped.
    out.add_metadata({
        "/WatermarkUserId": user_id,
        "/WatermarkUserEmail": user_email,
        "/WatermarkId": watermark_id,
        "/WatermarkIssuedAt": ts,
    })

    sink = io.BytesIO()
    out.write(sink)
    return sink.getvalue()


def safe_filename_with_user(original: str, watermark_id: str) -> str:
    """Insert the watermark_id before the extension so the saved filename
    itself carries the marker. Example: 'slides.pdf' -> 'slides__id-AbCd.pdf'."""
    if "." in original:
        stem, ext = original.rsplit(".", 1)
        return f"{stem}__id-{watermark_id}.{ext}"
    return f"{original}__id-{watermark_id}"
