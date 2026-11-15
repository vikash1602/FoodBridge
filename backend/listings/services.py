"""Geo + time services for listings.

Escalation and expiry are computed AT QUERY TIME — there is no scheduler.
- escalation_radius_km(minutes_open): 0-20 min -> 2 km, 20-40 -> 5 km, 40+ -> 10 km.
- A listing is "effectively expired" the moment now > safe_until, regardless of
  its stored status; feeds exclude it and detail views surface it as expired.
"""

import math

from django.db.models.expressions import RawSQL
from django.utils import timezone

from config.settings import ESCALATION_MAX_RADIUS_KM, ESCALATION_TIERS

KM_PER_DEGREE_LAT = 111.32
URGENCY_WINDOW_SECONDS = 2 * 3600  # urgency ramps up over the final 2 hours
URGENCY_WEIGHT = 0.65
DISTANCE_WEIGHT = 0.35
TRUST_WEIGHT = 0.05

_DB_TABLE = "listings_listing"


def escalation_radius_km(minutes_open: float) -> float:
    """Alert radius grows the longer a listing sits unclaimed."""
    for threshold_minutes, radius in ESCALATION_TIERS:
        if minutes_open < threshold_minutes:
            return radius
    return ESCALATION_MAX_RADIUS_KM


def escalation_radius_for_listing(listing, now=None) -> float:
    now = now or timezone.now()
    minutes_open = (now - listing.created_at).total_seconds() / 60
    return escalation_radius_km(minutes_open)


def bounding_box(lat: float, lng: float, radius_km: float) -> tuple[float, float, float, float]:
    """Cheap lat/lng prefilter box so the Haversine runs on few rows."""
    dlat = radius_km / KM_PER_DEGREE_LAT
    dlng = radius_km / (KM_PER_DEGREE_LAT * max(0.15, math.cos(math.radians(lat))))
    return lat - dlat, lat + dlat, lng - dlng, lng + dlng


def _haversine_sql(lat_param=1, lng_param=4) -> str:
    """Haversine expression string; placeholders are filled by the caller."""
    return (
        f"({KM_PER_DEGREE_LAT} * 2 * ASIN(SQRT("
        f"  POWER(SIN(RADIANS({_DB_TABLE}.lat - %s) / 2), 2) +"
        f"  COS(RADIANS({_DB_TABLE}.lat)) * COS(RADIANS(%s)) *"
        f"  POWER(SIN(RADIANS({_DB_TABLE}.lng - %s) / 2), 2)"
        ")))"
    )


def distance_annotation(lat: float, lng: float) -> RawSQL:
    """`distance_km` Haversine annotation (PostgreSQL, no PostGIS)."""
    return RawSQL(_haversine_sql(), (lat, lat, lng))


def minutes_open_annotation(now) -> RawSQL:
    """`minutes_open` annotation."""
    return RawSQL(f"(EXTRACT(EPOCH FROM (%s - {_DB_TABLE}.created_at)) / 60.0)", (now,))


def escalation_radius_annotation(now) -> RawSQL:
    """`escalation_radius_km` SQL CASE from minutes open."""
    when_clauses = " ".join(
        f"WHEN (EXTRACT(EPOCH FROM (%s - {_DB_TABLE}.created_at)) / 60.0) < {threshold} THEN {radius}"
        for threshold, radius in ESCALATION_TIERS
    )
    return RawSQL(
        f"(CASE {when_clauses} ELSE {ESCALATION_MAX_RADIUS_KM} END)",
        tuple([now] * len(ESCALATION_TIERS)),
    )


def feed_score_annotation(now, lat: float, lng: float, radius_km: float) -> RawSQL:
    """`score` = urgency (spoiling sooner first) + proximity + trust tie-break.

    urgency   = 1 - clamp(seconds_left / 7200)      [0..1, 1 = about to spoil]
    proximity = 1 - clamp(distance_km / radius_km)  [0..1, 1 = right here]
    score     = 0.65*urgency + 0.35*proximity + 0.05*(donor trust / 100)

    Placeholder order: seconds_left(now), distance(lat, lat, lng), radius.
    """
    sql = (
        f"( {URGENCY_WEIGHT} * (1 - LEAST(GREATEST("
        f"  EXTRACT(EPOCH FROM ({_DB_TABLE}.safe_until - %s)) / {URGENCY_WINDOW_SECONDS}.0, 0), 1))"
        f"+ {DISTANCE_WEIGHT} * (1 - LEAST(({_haversine_sql()}) / GREATEST(0.5, %s), 1))"
        f"+ {TRUST_WEIGHT} * (accounts_user.trust_score / 100.0) )"
    )
    return RawSQL(sql, (now, lat, lat, lng, radius_km))


def nearby_volunteer_ids(lat: float, lng: float, radius_km: float) -> list[int]:
    """Volunteers whose base location is within their own notify_radius_km.

    Bounding-box prefilter in SQL, exact Haversine check in Python — accurate
    per-volunteer radius without PostGIS.
    """
    import math

    from accounts.models import User

    min_lat, max_lat, min_lng, max_lng = bounding_box(lat, lng, radius_km)
    candidates = User.objects.filter(
        role=User.Role.VOLUNTEER,
        is_active=True,
        is_suspended=False,
        base_lat__isnull=False,
        base_lng__isnull=False,
        base_lat__range=(min_lat, max_lat),
        base_lng__range=(min_lng, max_lng),
    )
    cos_lat = max(0.15, math.cos(math.radians(lat)))
    ids = []
    for user in candidates:
        dlat = (user.base_lat - lat) * KM_PER_DEGREE_LAT
        dlng = (user.base_lng - lng) * KM_PER_DEGREE_LAT * cos_lat
        distance = math.hypot(dlat, dlng)
        if distance <= max(radius_km, user.notify_radius_km):
            ids.append(user.id)
    return ids
