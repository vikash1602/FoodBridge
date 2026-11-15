"""Public deployment config so the frontend adapts to any city via env alone."""

from django.conf import settings
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class PlatformConfigView(APIView):
    """GET /api/v1/config/ — city name, default center, zoom, service area, tiers."""

    permission_classes = [AllowAny]

    def get(self, request):
        tiers = [
            {"minutes": minutes, "radius_km": radius}
            for minutes, radius in settings.ESCALATION_TIERS
        ]
        tiers.append({"minutes": None, "radius_km": settings.ESCALATION_MAX_RADIUS_KM})
        return Response(
            {
                "city_name": settings.DEFAULT_CITY_NAME,
                "center": {"lat": settings.DEFAULT_CENTER_LAT, "lng": settings.DEFAULT_CENTER_LNG},
                "zoom": settings.DEFAULT_ZOOM,
                "service_area_km": settings.SERVICE_AREA_KM,
                "escalation_tiers": tiers,
                "quick_areas": [
                    {"name": name, "lat": lat, "lng": lng} for name, lat, lng in settings.QUICK_AREAS
                ],
                "timezone": settings.TIME_ZONE,
            }
        )
