"""Claim lifecycle + ratings: race-free claim, pickup verification, delivery, cancellation.

The claim is the heart of FoodBridge. POST /api/v1/listings/{id}/claim/ runs
inside transaction.atomic() with select_for_update() on the listing row, so
exactly one concurrent request wins; the rest see HTTP 409.
"""

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from accounts.permissions import IsAuthenticatedAndNotSuspended, IsVolunteer
from accounts.trust import adjust_trust
from events.publish import publish
from listings.models import Listing

from .models import Claim, Rating
from .serializers import ClaimCreateSerializer, ClaimSerializer, RatingCreateSerializer, RatingSerializer


class ClaimViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    serializer_class = ClaimSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        if self.action in ("verify_pickup", "deliver", "cancel_claim"):
            permission_classes = [IsAuthenticated, IsAuthenticatedAndNotSuspended, IsVolunteer]
        else:
            permission_classes = [IsAuthenticated]
        return [p() for p in permission_classes]

    def get_queryset(self):
        user = self.request.user
        qs = Claim.objects.select_related(
            "listing", "listing__donor", "volunteer", "listing__organization"
        )
        if user.is_admin_role:
            return qs
        return qs.filter(volunteer=user) | qs.filter(listing__donor=user)

    # ----------------------------------------------------------- pickup flow

    @action(detail=True, methods=["post"], url_path="verify-pickup")
    def verify_pickup(self, request, pk=None):
        """Volunteer enters the 4-digit code the donor shows."""
        claim = self.get_object()
        if claim.status != Claim.Status.ACTIVE:
            return Response(
                {"error": {"code": "conflict", "message": "This claim is not awaiting pickup.", "details": {"status": claim.status}}},
                status=status.HTTP_409_CONFLICT,
            )
        code = str(request.data.get("code", "")).strip()
        if code != claim.pickup_code:
            return Response(
                {"error": {"code": "validation_error", "message": "That pickup code doesn't match. Ask the donor for the 4-digit code.", "details": {}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            claim.status = Claim.Status.PICKED_UP
            claim.picked_up_at = timezone.now()
            claim.save(update_fields=["status", "picked_up_at"])
            claim.listing.status = Listing.Status.PICKED_UP
            claim.listing.save(update_fields=["status", "updated_at"])

        publish(
            "listing.picked_up",
            {"listing_id": claim.listing_id, "claim_id": claim.id},
            audience="all",
            notify_user_ids=[claim.listing.donor_id],
            notification_type="listing_picked_up",
            listing=claim.listing,
            message=f"Food picked up — '{claim.listing.title}' is on its way.",
        )
        return Response(ClaimSerializer(claim, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="deliver")
    def deliver(self, request, pk=None):
        claim = self.get_object()
        if claim.status != Claim.Status.PICKED_UP:
            return Response(
                {"error": {"code": "conflict", "message": "Pick up the food before delivering.", "details": {"status": claim.status}}},
                status=status.HTTP_409_CONFLICT,
            )
        note = str(request.data.get("delivery_note", "") or "")
        with transaction.atomic():
            claim.status = Claim.Status.DELIVERED
            claim.delivered_at = timezone.now()
            claim.delivery_note = note
            if request.FILES.get("delivery_photo"):
                from listings.image_utils import validate_and_strip_exif

                cleaned = validate_and_strip_exif(request.FILES["delivery_photo"])
                extension = getattr(cleaned, "extension", "jpg")
                from django.core.files.base import File as DjangoFile

                claim.delivery_photo = DjangoFile(cleaned, name=f"delivery_{claim.pk}.{extension}")
            claim.save()
            claim.listing.status = Listing.Status.DELIVERED
            claim.listing.save(update_fields=["status", "updated_at"])
            # Trust reward for completing the rescue.
            adjust_trust(claim.volunteer, "delivered", reference_id=claim.id)
            adjust_trust(claim.listing.donor, "delivered", reference_id=claim.id)

        publish(
            "listing.delivered",
            {"listing_id": claim.listing_id, "claim_id": claim.id},
            audience="all",
            notify_user_ids=[claim.listing.donor_id],
            notification_type="listing_delivered",
            listing=claim.listing,
            message=f"Delivered! '{claim.listing.title}' reached its destination. 🎉",
        )
        return Response(ClaimSerializer(claim, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel_claim(self, request, pk=None):
        """Volunteer cancels before pickup: listing reopens, small trust penalty."""
        claim = self.get_object()
        if claim.status != Claim.Status.ACTIVE:
            return Response(
                {"error": {"code": "conflict", "message": "Only claims awaiting pickup can be cancelled here.", "details": {"status": claim.status}}},
                status=status.HTTP_409_CONFLICT,
            )
        reason = str(request.data.get("reason", "") or "")
        with transaction.atomic():
            claim.status = Claim.Status.CANCELLED
            claim.cancel_reason = reason
            claim.save(update_fields=["status", "cancel_reason"])
            listing = claim.listing
            if listing.safe_until <= timezone.now():
                listing.status = Listing.Status.EXPIRED
            else:
                listing.status = Listing.Status.OPEN
            listing.save(update_fields=["status", "updated_at"])
            adjust_trust(claim.volunteer, "late_cancel", reference_id=claim.id)

        publish(
            "listing.reopened",
            {"listing_id": listing.id, "title": listing.title},
            audience="all",
            notify_user_ids=[listing.donor_id],
            notification_type="listing_cancelled",
            listing=listing,
            message=f"A volunteer cancelled — '{listing.title}' is open again.",
        )
        return Response(ClaimSerializer(claim, context={"request": request}).data)


class RatingViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    """After a delivered claim, both sides can rate each other (once each).

    Trust: ratee gains +2 for a 5-star rating, +1 for 4 stars.
    """

    serializer_class = RatingSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        if self.action == "create":
            permission_classes = [IsAuthenticated, IsAuthenticatedAndNotSuspended]
        else:
            permission_classes = [IsAuthenticated]
        return [p() for p in permission_classes]

    def get_queryset(self):
        user = self.request.user
        qs = Rating.objects.select_related("claim", "rater", "ratee")
        if user.is_admin_role:
            return qs
        return qs.filter(rater=user) | qs.filter(ratee=user)

    def create(self, request, *args, **kwargs):
        serializer = RatingCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        rating = serializer.save()
        out = RatingSerializer(rating, context={"request": request})
        return Response(out.data, status=status.HTTP_201_CREATED)
