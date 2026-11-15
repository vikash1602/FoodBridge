"""Consistent JSON error shape for every API error.

Every error response, from any layer of DRF, comes back as::

    {"error": {"code": "conflict", "message": "…", "details": {…}}}

so the frontend has exactly one branch to handle.
"""

from rest_framework import exceptions as drf_exceptions
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

# Maps DRF default codes (or explicit ones) onto compact API codes.
_CODE_OVERRIDES = {
    "not_authenticated": "not_authenticated",
    "authentication_failed": "not_authenticated",
    "permission_denied": "permission_denied",
    "not_found": "not_found",
    "method_not_allowed": "method_not_allowed",
    "validation_error": "validation_error",
    "parse_error": "parse_error",
    "throttled": "throttled",
    "unsupported_media_type": "unsupported_media_type",
}


def _human_message(detail) -> str:
    """Flatten DRF's nested detail structures into one readable sentence."""
    if isinstance(detail, str):
        return detail
    if hasattr(detail, "detail"):  # ErrorDetail
        return str(detail.detail)
    if isinstance(detail, dict) and detail:
        first = next(iter(detail.values()))
        return _human_message(first)
    if isinstance(detail, list) and detail:
        return _human_message(detail[0])
    return str(detail)


def api_exception_handler(exc, context):
    if isinstance(exc, drf_exceptions.ValidationError):
        code = "validation_error"
    elif isinstance(exc, drf_exceptions.AuthenticationFailed):
        code = "not_authenticated"
    elif isinstance(exc, drf_exceptions.NotAuthenticated):
        code = "not_authenticated"
    elif isinstance(exc, drf_exceptions.PermissionDenied):
        code = "permission_denied"
    elif isinstance(exc, drf_exceptions.NotFound):
        code = "not_found"
    elif isinstance(exc, drf_exceptions.MethodNotAllowed):
        code = "method_not_allowed"
    elif isinstance(exc, drf_exceptions.Throttled):
        code = "throttled"
    else:
        code = _CODE_OVERRIDES.get(getattr(exc, "default_code", "error"), "error")

    response = drf_exception_handler(exc, context)
    if response is None:
        # Unhandled server error: DRF returns None; we still shape the body.
        return Response(
            {"error": {"code": "server_error", "message": "Internal server error.", "details": {}}},
            status=500,
        )

    message = _human_message(getattr(exc, "detail", None) or exc)
    if code == "throttled":
        wait = getattr(exc, "wait", None)
        message = str(exc.detail)
        response.headers["Retry-After"] = str(wait or 60)

    raw_detail = getattr(exc, "detail", None)
    details = raw_detail if isinstance(raw_detail, (dict, list)) else {}
    response.data = {
        "error": {
            "code": code,
            "message": message,
            "details": details,
        }
    }
    return response
