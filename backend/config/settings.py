"""
Django settings for the FoodBridge project.

All deployment-specific values come from environment variables (see .env.example),
loaded via python-dotenv so a plain `gunicorn/uvicorn` process picks them up too.
"""

from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

import os

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-insecure-change-me")
DEBUG = os.environ.get("DEBUG", "False").lower() in ("1", "true", "yes")
ALLOWED_HOSTS = [
    h.strip() for h in os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()
]

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
CORS_ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("CORS_ALLOWED_ORIGINS", FRONTEND_URL).split(",") if o.strip()
]
CSRF_TRUSTED_ORIGINS = [origin.rstrip("/") for origin in CORS_ALLOWED_ORIGINS]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    # FoodBridge
    "accounts",
    "listings",
    "claims",
    "notifications",
    "stats",
    "events",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "django.middleware.gzip.GZipMiddleware",
    "config.timing.TimingMiddleware",
]

# Response compression (Part 3): GZip for API responses; whitenoise already
# pre-compresses hashed static assets.
if not DEBUG:
    GZIP_MINIMUM_LENGTH = 500

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"


# ---------------------------------------------------------------------------
# Database — PostgreSQL only (the claim flow relies on SELECT ... FOR UPDATE
# row locking; SQLite has no equivalent under concurrent writers).
# ---------------------------------------------------------------------------

def _db_config_from_url(url: str) -> dict:
    parsed = urlparse(url)
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": parsed.path.lstrip("/"),
        "USER": parsed.username or "",
        "PASSWORD": parsed.password or "",
        "HOST": parsed.hostname or "127.0.0.1",
        "PORT": str(parsed.port or 5432),
        "CONN_MAX_AGE": 60,
    }


DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://foodbridge:foodbridge@127.0.0.1:5432/foodbridge")

if DATABASE_URL.startswith("sqlite"):
    raise RuntimeError(
        "FoodBridge requires PostgreSQL. Row locking (select_for_update) for "
        "race-free claiming does not work on SQLite."
    )

DATABASES = {
    "default": _db_config_from_url(DATABASE_URL),
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"


# ---------------------------------------------------------------------------
# Password / i18n
# ---------------------------------------------------------------------------

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
# All user-facing times (safe_until, countdowns, pickup windows) are IST.
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True


# ---------------------------------------------------------------------------
# Static & media
# ---------------------------------------------------------------------------

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    # Default storage is env-driven: local FileSystemStorage in development;
    # S3 (django-storages) when AWS_STORAGE_BUCKET_NAME is configured. Static
    # files always stay on WhiteNoise — only media moves to the cloud.
    # The selection logic lives in config.storage.default_storage_config.
    "default": __import__("config.storage", fromlist=["default_storage_config"]).default_storage_config(),
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024  # 10 MB — listing photos / org documents
DATA_UPLOAD_MAX_MEMORY_SIZE = FILE_UPLOAD_MAX_MEMORY_SIZE
# Listing/delivery photos are validated + re-encoded above this size (MB).
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "5"))


# ---------------------------------------------------------------------------
# Django REST Framework
# ---------------------------------------------------------------------------

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "config.pagination.FoodBridgePagination",
    "PAGE_SIZE": 12,
    "EXCEPTION_HANDLER": "config.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.AnonRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "user": "120/min",
        "anon": "30/min",
        # Env-overridable so load tests / staging can raise it without code changes.
        "auth": os.environ.get("AUTH_THROTTLE_RATE", "20/min"),
        "claim": "12/min",
        "listing_create": "20/hour",
        "report": "10/hour",
        "cron": "10/min",
    },
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}

from datetime import timedelta  # noqa: E402  (kept near the JWT config it belongs to)

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "AUTH_HEADER_TYPES": ("Bearer",),
    "UPDATE_LAST_LOGIN": True,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "FoodBridge API",
    "DESCRIPTION": (
        "Live surplus-food rescue network. Donors post food in 30 seconds, "
        "volunteers claim and deliver it before it spoils."
    ),
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SCHEMA_PATH_PREFIX": "/api/v1",
}

# SSE -----------------------------------------------------------------------
SSE_MAX_LIFETIME_SECONDS = int(os.environ.get("SSE_MAX_LIFETIME_SECONDS", "300"))


# ---------------------------------------------------------------------------
# FoodBridge domain constants
# ---------------------------------------------------------------------------

# City this deployment serves. Change these env vars to run FoodBridge in any
# town — no code changes needed.
DEFAULT_CITY_NAME = os.environ.get("DEFAULT_CITY_NAME", "Vaniyambadi")
DEFAULT_CENTER_LAT = float(os.environ.get("DEFAULT_CENTER_LAT", "12.6819"))
DEFAULT_CENTER_LNG = float(os.environ.get("DEFAULT_CENTER_LNG", "78.6200"))
DEFAULT_ZOOM = int(os.environ.get("DEFAULT_ZOOM", "13"))
# Volunteers farther than this from the city centre get a "starting here" note,
# but are never blocked.
SERVICE_AREA_KM = float(os.environ.get("SERVICE_AREA_KM", "25"))

# One-tap quick-area chips in the location picker. "Name:lat:lng" comma separated.
QUICK_AREAS = [
    (name, float(lat), float(lng))
    for name, lat, lng in (
        triple.split(":") for triple in os.environ.get(
            "QUICK_AREAS",
            "Bus Stand:12.6800:78.6230,Amburpet:12.7180:78.6420,Railway Station:12.6772:78.6252,"
            "Nethaji Nagar:12.6890:78.6150,Ambur:12.7874:78.7188,Jolarpettai:12.5643:78.5797",
        ).split(",")
    )
]

# Escalation: alert radius grows the longer an open listing sits unclaimed.
# (minutes the listing has been open) -> (search radius in km)
# Defaults reach Ambur and Jolarpettai at the widest tier.
ESCALATION_TIERS = tuple(
    (int(minutes), float(radius))
    for minutes, radius in (
        pair.split(":") for pair in os.environ.get("ESCALATION_TIERS", "20:3,40:6").split(",")
    )
)
ESCALATION_MAX_RADIUS_KM = float(os.environ.get("ESCALATION_MAX_RADIUS_KM", "12.0"))

# Location privacy: public listings are fuzzed within this radius (metres).
LOCATION_FUZZ_METRES = int(os.environ.get("LOCATION_FUZZ_METRES", "300"))

# SSE stream tickets: short-lived, single-use tokens for browser EventSource.
SSE_TICKET_TTL_SECONDS = int(os.environ.get("SSE_TICKET_TTL_SECONDS", "60"))

# OTP email delivery: DEBUG prints the code to the console; set RESEND_API_KEY
# in production to send via the Resend HTTP API (no SMTP handshake). If the
# provider fails (e.g. Resend sandbox before domain verification), the code is
# printed to the server log as a fallback so the flow never hard-blocks.
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
OTP_EMAIL_FROM = os.environ.get("OTP_EMAIL_FROM", "FoodBridge <onboarding@resend.dev>")
OTP_EMAIL_FALLBACK_TO_CONSOLE = os.environ.get("OTP_EMAIL_FALLBACK_TO_CONSOLE", "true").lower() in ("1", "true", "yes")
# Cron-job.org endpoints: generate with `python -c "import secrets; print(secrets.token_urlsafe(32))"`.
# Endpoints stay closed until a 32+ char secret is configured.
CRON_SECRET_KEY = os.environ.get("CRON_SECRET_KEY", "")

# A volunteer may hold at most this many active (claimed, not yet picked up) listings.
MAX_ACTIVE_CLAIMS = 2

# Trust score bounds and badges.
TRUST_SCORE_MIN = 0
TRUST_SCORE_MAX = 100
TRUST_SCORE_DEFAULT = 50
TRUST_BADGES = (
    (90, "champion"),
    (75, "trusted"),
    (60, "reliable"),
    (0, "new"),
)
