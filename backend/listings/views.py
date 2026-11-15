"""Listing views: donor CRUD + the live geo feed for volunteers."""

from django.db import transaction
from django.conf import settings
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from accounts.permissions import (
    IsAuthenticatedAndNotSuspended,
    IsVerifiedDonor,
    IsVolunteer,
)
from config.settings import MAX_ACTIVE_CLAIMS

from .models import Listing
from .serializers import ListingCreateSerializer, ListingSerializer
from . import services


class ListingViewSet(viewsets.ModelViewSet):
    serializer_class = ListingSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    lookup_value_regex = r"\d+"

    def get_permissions(self):
        if self.action == "create":
            permission_classes = [IsAuthenticated, IsAuthenticatedAndNotSuspended, IsVerifiedDonor]
        elif self.action in ("update", "partial_update", "cancel"):
            permission_classes = [IsAuthenticated, IsAuthenticatedAndNotSuspended]
        elif self.action == "claim":
            permission_classes = [IsAuthenticated, IsAuthenticatedAndNotSuspended, IsVolunteer]
        else:
            permission_classes = [IsAuthenticated]
        return [p() for p in permission_classes]

    def get_throttles(self):
        if self.action == "create":
            self.throttle_classes = [ScopedRateThrottle]
            self.throttle_scope = "listing_create"
        elif self.action == "claim":
            self.throttle_classes = [ScopedRateThrottle]
            self.throttle_scope = "claim"
        return super().get_throttles()

    def get_queryset(self):
        """Broad queryset for detail/actions; the feed (`list`) filters itself."""
        return Listing.objects.select_related("donor", "organization")

    def list(self, request, *args, **kwargs):
        """/listings/ — the live nearby feed (or `mine` donor listings).

        Query: ?lat&lng&radius&veg&type&min_quantity
        Bounding-box prefilter -> Haversine distance -> distance cut -> ranking.
        Feed rows are location-fuzzed unless the viewer owns them.
        """
        queryset = self._feed_queryset(request)
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page, many=True, context={**self.get_serializer_context(), "is_feed": True})
        return self.get_paginated_response(serializer.data)

    def _feed_queryset(self, request):
        now = timezone.now()
        qs = (
            Listing.objects.filter(status=Listing.Status.OPEN, safe_until__gt=now)
            .select_related("donor", "organization")
        )

        params = request.query_params
        try:
            lat = params.get("lat") and float(params["lat"])
            lng = params.get("lng") and float(params["lng"])
            radius = float(params.get("radius", 10))
        except (TypeError, ValueError):
            lat = lng = None
            radius = 10.0
        radius = min(max(radius, 0.5), services.KM_PER_DEGREE_LAT)  # sane caps

        if lat is not None and lng is not None:
            min_lat, max_lat, min_lng, max_lng = services.bounding_box(lat, lng, radius)
            qs = qs.filter(lat__range=(min_lat, max_lat), lng__range=(min_lng, max_lng))
            qs = qs.annotate(distance_km=services.distance_annotation(lat, lng)).filter(distance_km__lte=radius)

        # Optional filters
        veg = params.get("veg")
        if veg in ("true", "1"):
            qs = qs.filter(is_veg=True)
        food_type = params.get("type")
        if food_type:
            qs = qs.filter(food_type=food_type)
        try:
            min_qty = params.get("min_quantity") and float(params["min_quantity"])
            if min_qty:
                qs = qs.filter(quantity_value__gte=min_qty)
        except (TypeError, ValueError):
            pass

        if lat is not None and lng is not None:
            qs = qs.annotate(
                minutes_open=services.minutes_open_annotation(now),
                escalation_radius_km=services.escalation_radius_annotation(now),
                score=services.feed_score_annotation(now, lat, lng, radius),
            ).order_by("-score", "-created_at")
        else:
            qs = qs.order_by("-created_at")
        return qs

    # -- detail & donor views ------------------------------------------------

    def retrieve(self, request, *args, **kwargs):
        listing = self.get_object()
        data = self.get_serializer(listing).data
        data["escalation_radius_km"] = services.escalation_radius_for_listing(listing)
        data["seconds_to_expiry"] = max(0, int((listing.safe_until - timezone.now()).total_seconds()))
        if listing.status == Listing.Status.OPEN and listing.safe_until <= timezone.now():
            data["status"] = Listing.Status.EXPIRED  # computed at query time
        return Response(data)

    @action(detail=False, methods=["get"], url_path="mine")
    def mine(self, request):
        """The donor's own listings incl. expired/cancelled, newest first."""
        qs = Listing.objects.filter(donor=request.user).select_related("donor", "organization")
        page = self.paginate_queryset(qs)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    # -- mutations -------------------------------------------------------------

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        org = serializer.validated_data.get("organization")
        if org and org.owner_id != request.user.id:
            return Response(
                {"error": {"code": "permission_denied", "message": "This organization does not belong to you.", "details": {}}},
                status=status.HTTP_403_FORBIDDEN,
            )
        listing = serializer.save(donor=request.user, organization=org)

        # Live fan-out: global event + personal notifications for nearby volunteers.
        from events.models import Event
        from events.publish import publish
        from .services import nearby_volunteer_ids

        publish(
            "listing.created",
            {
                "listing_id": listing.id,
                "title": listing.title,
                "lat": listing.lat,
                "lng": listing.lng,
                "safe_until": listing.safe_until.isoformat(),
            },
            audience="all",
        )
        nearby_ids = nearby_volunteer_ids(listing.lat, listing.lng, services.ESCALATION_TIERS[0][1])
        for volunteer_id in nearby_ids:
            Event.objects.create(
                type="listing.new_nearby",
                payload={
                    "listing_id": listing.id,
                    "title": listing.title,
                    "lat": listing.lat,
                    "lng": listing.lng,
                    "distance_hint": "within your alert radius",
                },
                audience=f"user:{volunteer_id}",
            )
        if nearby_ids:
            from notifications.models import Notification

            Notification.objects.bulk_create(
                [
                    Notification(
                        user_id=uid,
                        type=Notification.Type.LISTING_NEW,
                        message=f"New near you: '{listing.title}' ({listing.quantity_label}).",
                        listing=listing,
                    )
                    for uid in nearby_ids
                ]
            )

        out = ListingSerializer(listing, context=self.get_serializer_context())
        headers = self.get_success_headers(out.data)
        return Response(out.data, status=status.HTTP_201_CREATED, headers=headers)

    def update(self, request, *args, **kwargs):
        """Donors may edit only their own OPEN listings."""
        listing = self.get_object()
        error = self._guard_owner_open(listing, request)
        if error:
            return error
        return super().update(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        """Donor cancels while open (or volunteer cancellation happens via claims)."""
        listing = self.get_object()
        error = self._guard_owner_open(listing, request)
        if error:
            return error
        with transaction.atomic():
            listing.status = Listing.Status.CANCELLED
            listing.save(update_fields=["status", "updated_at"])
        from events.publish import publish

        publish(
            "listing.cancelled",
            {"listing_id": listing.id, "title": listing.title},
            audience="all",
            notification_type=None,
        )
        return Response(self.get_serializer(listing).data)

    def _guard_owner_open(self, listing, request) -> Response | None:
        if listing.donor_id != request.user.id and not request.user.is_admin_role:
            return Response(
                {"error": {"code": "permission_denied", "message": "You can only manage your own listings.", "details": {}}},
                status=status.HTTP_403_FORBIDDEN,
            )
        if listing.status != Listing.Status.OPEN:
            return Response(
                {"error": {"code": "conflict", "message": "Only open listings can be edited or cancelled.", "details": {"status": listing.status}}},
                status=status.HTTP_409_CONFLICT,
            )
        return None

    # ------------------------------------------------------------------ claim

    @action(detail=True, methods=["post"], url_path="claim")
    def claim(self, request, pk=None):
        """Race-free claim.

        1. transaction.atomic() — claim + listing flip commit together.
        2. select_for_update() on the listing row — the first request locks it;
           concurrent claimers queue on the row lock.
        3. When each loser's turn comes, it re-reads status != open -> 409.
        """
        from claims.models import Claim
        from claims.serializers import ClaimSerializer
        from events.publish import publish

        volunteer = request.user
        with transaction.atomic():
            try:
                listing = Listing.objects.select_for_update().select_related("donor").get(pk=pk)
            except Listing.DoesNotExist:
                return Response(
                    {"error": {"code": "not_found", "message": "Listing not found.", "details": {}}},
                    status=status.HTTP_404_NOT_FOUND,
                )
            now = timezone.now()

            if listing.status == Listing.Status.EXPIRED or listing.safe_until <= now:
                return Response(
                    {"error": {"code": "conflict", "message": "Too late — this listing has expired.", "details": {}}},
                    status=status.HTTP_409_CONFLICT,
                )
            if listing.status != Listing.Status.OPEN:
                return Response(
                    {"error": {"code": "conflict", "message": "Someone just claimed this. Try another nearby rescue!", "details": {}}},
                    status=status.HTTP_409_CONFLICT,
                )

            active_claims = Claim.objects.filter(
                volunteer=volunteer, status__in=(Claim.Status.ACTIVE, Claim.Status.PICKED_UP)
            ).count()
            if active_claims >= MAX_ACTIVE_CLAIMS:
                return Response(
                    {"error": {"code": "conflict", "message": f"You already hold {active_claims} active claims — the limit is {MAX_ACTIVE_CLAIMS}.", "details": {}}},
                    status=status.HTTP_409_CONFLICT,
                )

            claim = Claim.objects.create(listing=listing, volunteer=volunteer)
            listing.status = Listing.Status.CLAIMED
            listing.save(update_fields=["status", "updated_at"])

        publish(
            "listing.claimed",
            {
                "listing_id": listing.id,
                "title": listing.title,
                "claim_id": claim.id,
                "volunteer": volunteer.get_full_name() or volunteer.username,
            },
            audience="all",
            notify_user_ids=[listing.donor_id],
            notification_type="listing_claimed",
            listing=listing,
            message=f"{volunteer.get_full_name() or volunteer.username} claimed '{listing.title}'.",
        )
        return Response(
            ClaimSerializer(claim, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def get_serializer_class(self):
        if self.action == "create":
            return ListingCreateSerializer
        return ListingSerializer
