"""Auth helpers — extract user identity from optional identity headers."""

import logging

from fastapi import Request

logger = logging.getLogger(__name__)


def get_user_from_request(request: Request) -> dict:
    """
    Extract the user's identity from the request.

    This app has no login flow of its own; identity is best-effort only.
    If the frontend sets the optional X-User-Name / X-User-Email headers
    (e.g. because it's embedded behind some other identity layer), those
    are used to attribute deployment-history entries. Otherwise falls back
    to 'unknown' — this never blocks a deployment.
    """
    name  = request.headers.get("X-User-Name",  "").strip()
    email = request.headers.get("X-User-Email", "").strip()
    return {"username": name or "unknown", "email": email or "unknown"}
