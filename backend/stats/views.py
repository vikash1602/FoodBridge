"""Impact stats endpoints: personal, platform-wide (admin), leaderboard.

Stats and leaderboard are cached in Django's LocMemCache for 45 seconds —
they are read-heavy, aggregate queries that change slowly (NO Redis).
"""

from django.core.cache import cache
from django.db.models import Avg, Count, F, Q, Sum
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from claims.models import Claim
from listings.models import Listing

# Rough conversion so a single "meals" number feels meaningful: 1 meal ≈ 0.45 kg.
KG_PER_MEAL = 0.45
STATS_CACHE_TTL = 45  # seconds


class StatsView(APIView):
    """GET /api/v1/stats/?scope=me|platform&metric=leaderboard"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        scope = request.query_params.get("scope", "me")
        metric = request.query_params.get("metric")

        if metric == "leaderboard":
            payload = cache.get("stats:leaderboard")
            if payload is None:
                payload = self.leaderboard()
                cache.set("stats:leaderboard", payload, STATS_CACHE_TTL)
            return Response(payload)

        if scope == "platform":
            if not request.user.is_admin_role:
                return Response(
                    {"error": {"code": "permission_denied", "message": "Admin access required.", "details": {}}},
                    status=403,
                )
            payload = cache.get("stats:platform")
            if payload is None:
                payload = self.platform_stats()
                cache.set("stats:platform", payload, STATS_CACHE_TTL)
            return Response(payload)

        cache_key = f"stats:me:{request.user.id}"
        payload = cache.get(cache_key)
        if payload is None:
            payload = self.personal_stats(request.user)
            cache.set(cache_key, payload, STATS_CACHE_TTL)
        return Response(payload)

    # -- building blocks ----------------------------------------------------

    def personal_stats(self, user) -> dict:
        delivered = Claim.objects.filter(status=Claim.Status.DELIVERED)
        mine_as_volunteer = delivered.filter(volunteer=user)
        mine_as_donor = delivered.filter(listing__donor=user)
        listings_created = Listing.objects.filter(donor=user)
        return {
            "role": user.role,
            "rescued": {
                "listings_created": listings_created.count(),
                "delivered_as_donor": mine_as_donor.count(),
                "delivered_as_volunteer": mine_as_volunteer.count(),
                "meals_equivalent": self._meals(mine_as_donor) + self._meals(mine_as_volunteer),
            },
            "trust_score": user.trust_score,
            "badge": user.badge,
        }

    def platform_stats(self) -> dict:
        delivered = Claim.objects.filter(status=Claim.Status.DELIVERED)
        return {
            "users": {
                "donors": User.objects.filter(role=User.Role.DONOR).count(),
                "volunteers": User.objects.filter(role=User.Role.VOLUNTEER).count(),
                "active_volunteers": User.objects.filter(role=User.Role.VOLUNTEER, claims__status=Claim.Status.DELIVERED).distinct().count(),
            },
            "rescued": {
                "listings": Listing.objects.count(),
                "delivered": delivered.count(),
                "meals_equivalent": self._meals(delivered),
            },
            "avg_time_to_claim_seconds": self._avg_time_to_claim(),
        }

    def leaderboard(self) -> dict:
        top_donors = (
            User.objects.filter(role=User.Role.DONOR, listings__claims__status=Claim.Status.DELIVERED)
            .annotate(deliveries=Count("listings__claims", distinct=True))
            .order_by("-deliveries", "-trust_score")[:10]
        )
        top_volunteers = (
            User.objects.filter(role=User.Role.VOLUNTEER, claims__status=Claim.Status.DELIVERED)
            .annotate(deliveries=Count("claims", distinct=True))
            .order_by("-deliveries", "-trust_score")[:10]
        )
        return {
            "donors": [
                {"id": u.id, "name": u.get_full_name() or u.username, "trust_score": u.trust_score, "badge": u.badge, "deliveries": u.deliveries}
                for u in top_donors
            ],
            "volunteers": [
                {"id": u.id, "name": u.get_full_name() or u.username, "trust_score": u.trust_score, "badge": u.badge, "deliveries": u.deliveries}
                for u in top_volunteers
            ],
        }

    def _meals(self, delivered_qs) -> float:
        agg = delivered_qs.aggregate(
            meals=Sum("listing__quantity_value", filter=Q(listing__quantity_unit=Listing.QuantityUnit.MEALS)),
            kg=Sum("listing__quantity_value", filter=Q(listing__quantity_unit=Listing.QuantityUnit.KG)),
        )
        return round((agg["meals"] or 0) + (agg["kg"] or 0) / KG_PER_MEAL, 1)

    def _avg_time_to_claim(self):
        agg = Claim.objects.annotate(delta=F("claimed_at") - F("listing__created_at")).aggregate(avg=Avg("delta"))
        return round(agg["avg"].total_seconds(), 1) if agg["avg"] else None
