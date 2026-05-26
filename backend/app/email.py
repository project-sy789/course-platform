"""Async SMTP wrapper. Use a real transactional provider (Resend/Postmark/SES)
in production — they handle DKIM/SPF, complaint loops, and bounce processing.

If SMTP_HOST is empty, send_email() logs and is a no-op. This lets dev/test
work without a configured mail relay.
"""
from __future__ import annotations

from email.message import EmailMessage

import aiosmtplib

from .config import settings
from .logging import log


async def send_email(to: str, subject: str, body_text: str, body_html: str | None = None) -> None:
    if not settings.SMTP_HOST:
        log.warning("smtp_disabled_email_skipped", to=to, subject=subject)
        return

    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    await aiosmtplib.send(
        msg,
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        username=settings.SMTP_USER or None,
        password=settings.SMTP_PASSWORD or None,
        start_tls=settings.SMTP_USE_TLS,
    )
    log.info("email_sent", to=to, subject=subject)


def render_verification_email(verify_url: str) -> tuple[str, str]:
    text = (
        f"Welcome!\n\n"
        f"Verify your email by clicking this link:\n\n  {verify_url}\n\n"
        f"This link expires in 24 hours.\n"
    )
    html = (
        f'<p>Welcome!</p>'
        f'<p>Verify your email: <a href="{verify_url}">{verify_url}</a></p>'
        f'<p style="color:#888">This link expires in 24 hours.</p>'
    )
    return text, html


def render_password_reset_email(reset_url: str) -> tuple[str, str]:
    text = (
        f"A password reset was requested for your account.\n\n"
        f"If this was you, click the link below to set a new password:\n\n"
        f"  {reset_url}\n\n"
        f"The link expires in 30 minutes. If you didn't request this, ignore this message.\n"
    )
    html = (
        f'<p>A password reset was requested for your account.</p>'
        f'<p>If this was you: <a href="{reset_url}">Reset password</a></p>'
        f'<p style="color:#888">The link expires in 30 minutes. '
        f'If you didn\'t request this, ignore this message.</p>'
    )
    return text, html
