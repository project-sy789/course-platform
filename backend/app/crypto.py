import os
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from .config import settings


def _load_kek() -> bytes:
    """Resolve the KEK. Prefer KEK_FILE (systemd credential / Docker secret)
    over KEK_BASE64 so we don't leak the key into `env` / `docker inspect`."""
    if settings.KEK_FILE:
        with open(settings.KEK_FILE, "rb") as f:
            raw = f.read().strip()
        # File may hold either raw 32 bytes or a base64-encoded string.
        if len(raw) == 32:
            return raw
        return base64.b64decode(raw)
    if settings.KEK_BASE64:
        return base64.b64decode(settings.KEK_BASE64)
    raise RuntimeError("KEK not configured: set KEK_FILE or KEK_BASE64")


_KEK = _load_kek()
assert len(_KEK) == 32, "KEK must decode to exactly 32 bytes (AES-256)"

_AAD = b"video_key_v1"


def encrypt_video_key(plaintext_key: bytes) -> tuple[bytes, bytes, bytes]:
    """Encrypt a 16-byte AES-128 HLS key with the master KEK.

    Returns (ciphertext, nonce, tag). Stored separately in `video_keys`.
    """
    if len(plaintext_key) != 16:
        raise ValueError("HLS AES-128 key must be exactly 16 bytes")
    nonce = os.urandom(12)
    aes = AESGCM(_KEK)
    ct_and_tag = aes.encrypt(nonce, plaintext_key, associated_data=_AAD)
    ct, tag = ct_and_tag[:-16], ct_and_tag[-16:]
    return ct, nonce, tag


def decrypt_video_key(ciphertext: bytes, nonce: bytes, tag: bytes) -> bytes:
    aes = AESGCM(_KEK)
    return aes.decrypt(nonce, ciphertext + tag, associated_data=_AAD)
