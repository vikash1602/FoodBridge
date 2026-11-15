"""Listing serializers.

Location privacy: the public feed and detail endpoints never expose a donor's
exact pickup coordinates or street address — they are fuzzed within ~300 m
(deterministic per listing) and the address is withheld until someone claims.
Exact values are returned only to the donor themselves, an admin, or the
volunteer holding the occupying claim.
"""

import hashlib
import math

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from accounts.serializers import PublicUserSerializer
from accounts.models import Organization

from .models import Listing

ADDRESS_WITHHELD = "Shared with the assigned volunteer after claiming"


def fuzzed_coords(listing_id: int, lat: float, lng: float, metres: int | None = None) -> tuple[float, float]:
    """Deterministic offset within [120, LOCATION_FUZZ_METRES] m — stable across requests."""
    metres = metres or settings.LOCATION_FUZZ_METRES
    digest = hashlib.sha256(f"fb-fuzz:{listing_id}".encode()).digest()
    angle = (int.from_bytes(digest[:4], "big") / 0xFFFFFFFF) * 2 * math.pi
    distance = 120 + (int.from_bytes(digest[4:8], "big") / 0xFFFFFFFF) * (metres - 120)
    dlat = distance * math.cos(angle) / 111_320
    dlng = distance * math.sin(angle) / (111_320 * max(0.2, math.cos(math.radians(lat))))
    return round(lat + dlat, 6), round(lng + dlng, 6)


class ClaimGate:
    """Does this volunteer hold the occupying claim on this listing?"""

    @staticmethod
    def has_occupying_claim(volunteer_id: int, listing_id: int) -> bool:
        from claims.models import Claim

        return Claim.objects.filter(
            listing_id=listing_id, volunteer_id=volunteer_id, status__in=Claim.OCCUPYING_STATUSES
        ).exists()


class OrganizationBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ["id", "name", "type", "address", "lat", "lng"]
        read_only_fields = fields


class ListingSerializer(serializers.ModelSerializer):
    donor = PublicUserSerializer(read_only=True)
    organization = OrganizationBriefSerializer(read_only=True)
    quantity = serializers.CharField(read_only=True, source="quantity_label")
    # Writable image field; responses carry an absolute media URL via the
    # request context (the SPA may live on a different origin).
    photo = serializers.ImageField(required=False, allow_null=True, use_url=True)
    # Query-time annotations (present on feed/detail responses, absent elsewhere).
    distance_km = serializers.SerializerMethodField()
    minutes_open = serializers.SerializerMethodField()
    escalation_radius_km = serializers.SerializerMethodField()
    seconds_to_expiry = serializers.SerializerMethodField()
    is_expired_now = serializers.SerializerMethodField()

    class Meta:
        model = Listing
        fields = [
            "id",
            "donor",
            "organization",
            "title",
            "description",
            "food_type",
            "is_veg",
            "quantity_value",
            "quantity_unit",
            "quantity",
            "allergens",
            "photo",
            "pickup_address",
            "lat",
            "lng",
            "ready_from",
            "safe_until",
            "status",
            "distance_km",
            "minutes_open",
            "escalation_radius_km",
            "seconds_to_expiry",
            "is_expired_now",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["donor", "status", "created_at", "updated_at"]

    def validate_photo(self, photo):
        """Runs for create AND update: validate size/format, strip EXIF (phones
        embed GPS), and re-encode so the stored file is clean."""
        if photo:
            from .image_utils import validate_and_strip_exif

            cleaned = validate_and_strip_exif(photo)
            extension = getattr(cleaned, "extension", "jpg")
            base = (photo.name or "photo").rsplit("/", 1)[-1].rsplit(".", 1)[0]
            from django.core.files.base import File as DjangoFile

            return DjangoFile(cleaned, name=f"cleaned_{base}.{extension}")
        return photo

    # -- location privacy ---------------------------------------------------

    def _viewer_sees_exact(self, obj) -> bool:
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is None or not user.is_authenticated:
            return False
        if user.is_admin_role or user.id == obj.donor_id:
            return True
        # Exact coords for the volunteer holding the occupying claim — only worth
        # a lookup outside the paginated feed (single-object detail / nested).
        if getattr(self, "_allow_claim_lookup", False) or not self._is_feed_many():
            return ClaimGate.has_occupying_claim(user.id, obj.id)
        return False

    def _is_feed_many(self) -> bool:
        return bool(self.context.get("is_feed", False))

    def to_representation(self, obj):
        data = super().to_representation(obj)
        if self._viewer_sees_exact(obj):
            return data
        lat, lng = fuzzed_coords(obj.id, obj.lat, obj.lng)
        data["lat"], data["lng"] = lat, lng
        data["pickup_address"] = ADDRESS_WITHHELD
        return data

    def _attr(self, obj, name):
        return getattr(obj, name, None)

    def get_distance_km(self, obj):
        d = self._attr(obj, "distance_km")
        return round(float(d), 2) if d is not None else None

    def get_minutes_open(self, obj):
        m = self._attr(obj, "minutes_open")
        return round(float(m), 1) if m is not None else None

    def get_escalation_radius_km(self, obj):
        if hasattr(obj, "escalation_radius_km") and obj.escalation_radius_km is not None:
            return float(obj.escalation_radius_km)
        from .services import escalation_radius_for_listing

        return escalation_radius_for_listing(obj)

    def get_seconds_to_expiry(self, obj):
        return max(0, int((obj.safe_until - timezone.now()).total_seconds()))

    def get_is_expired_now(self, obj):
        return obj.safe_until <= timezone.now()

    def validate(self, attrs):
        ready_from = attrs.get("ready_from") or getattr(self.instance, "ready_from", None)
        safe_until = attrs.get("safe_until") or getattr(self.instance, "safe_until", None)
        if ready_from and safe_until and ready_from > safe_until:
            raise serializers.ValidationError(
                {"safe_until": "Food must stay safe at least until it becomes ready for pickup."}
            )
        org = attrs.get("organization") or getattr(self.instance, "organization", None)
        if org is not None and org.owner_id != self.context["request"].user.id:
            raise serializers.ValidationError({"organization": "This organization does not belong to you."})
        return attrs


class ListingCreateSerializer(ListingSerializer):
    organization = serializers.PrimaryKeyRelatedField(
        queryset=Organization.objects.all(), required=False, allow_null=True
    )

    def validate_photo(self, photo):
        if photo:
            from .image_utils import validate_and_strip_exif

            cleaned = validate_and_strip_exif(photo)
            extension = getattr(cleaned, "extension", "jpg")
            # Replace the uploaded file with the re-encoded, EXIF-free image.
            base = photo.name.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            from django.core.files.base import File as DjangoFile

            return DjangoFile(cleaned, name=f"cleaned_{base}.{extension}")
        return photo

    def create(self, validated_data):
        validated_data["donor"] = self.context["request"].user
        return super().create(validated_data)
