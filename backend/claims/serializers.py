"""Claim + Rating serializers."""

from django.db import IntegrityError
from rest_framework import serializers

from accounts.trust import adjust_trust
from listings.serializers import ListingSerializer
from listings.models import Listing

from .models import Claim, Rating, Report


class ClaimSerializer(serializers.ModelSerializer):
    volunteer_name = serializers.CharField(source="volunteer.get_full_name", read_only=True)
    listing = ListingSerializer(read_only=True)
    # The donor (and admins) need the code to show the volunteer at pickup;
    # volunteers must never read it — they have to receive it in person.
    pickup_code = serializers.SerializerMethodField()
    donor_name = serializers.CharField(source="listing.donor.get_full_name", read_only=True)

    class Meta:
        model = Claim
        fields = [
            "id",
            "listing",
            "volunteer",
            "volunteer_name",
            "donor_name",
            "status",
            "pickup_code",
            "claimed_at",
            "picked_up_at",
            "delivered_at",
            "delivery_note",
            "delivery_photo",
            "cancel_reason",
        ]
        read_only_fields = fields

    def get_pickup_code(self, obj) -> str | None:
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user and (user.is_admin_role or user.id == obj.listing.donor_id):
            return obj.pickup_code
        return None


class ClaimCreateSerializer(serializers.Serializer):
    listing = serializers.PrimaryKeyRelatedField(queryset=Listing.objects.all())


class RatingSerializer(serializers.ModelSerializer):
    rater_name = serializers.CharField(source="rater.get_full_name", read_only=True)
    ratee_name = serializers.CharField(source="ratee.get_full_name", read_only=True)

    class Meta:
        model = Rating
        fields = ["id", "claim", "rater", "rater_name", "ratee", "ratee_name", "stars", "comment", "created_at"]
        read_only_fields = fields


class RatingCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Rating
        fields = ["claim", "stars", "comment"]
    # (validation + create logic live below `ClaimCreateSerializer`)

    def validate_claim(self, claim) -> Claim:
        user = self.context["request"].user
        if claim.status != Claim.Status.DELIVERED:
            raise serializers.ValidationError("You can rate only after the food is delivered.")
        if claim.volunteer_id != user.id and claim.listing.donor_id != user.id:
            raise serializers.ValidationError("Only the donor and the volunteer of this claim can rate it.")
        return claim

    def validate(self, attrs):
        user = self.context["request"].user
        if Rating.objects.filter(claim=attrs["claim"], rater=user).exists():
            raise serializers.ValidationError({"claim": "You have already rated this rescue."})
        return attrs

    def create(self, validated_data) -> Rating:
        claim: Claim = validated_data["claim"]
        user = self.context["request"].user
        # The other side of the claim is who gets rated.
        ratee = claim.listing.donor if claim.volunteer_id == user.id else claim.volunteer
        try:
            rating = Rating.objects.create(
                claim=claim, rater=user, ratee=ratee,
                stars=validated_data["stars"], comment=validated_data.get("comment", ""),
            )
        except IntegrityError:
            raise serializers.ValidationError({"claim": "You have already rated this rescue."})
        if rating.stars == 5:
            adjust_trust(ratee, "rating_5", reference_id=rating.id)
        elif rating.stars == 4:
            adjust_trust(ratee, "rating_4", reference_id=rating.id)
        return rating


class ReportSerializer(serializers.ModelSerializer):
    reporter_name = serializers.CharField(source="reporter.get_full_name", read_only=True)
    reported_user_name = serializers.CharField(source="reported_user.get_full_name", read_only=True, default=None)
    listing_title = serializers.CharField(source="listing.title", read_only=True, default=None)

    class Meta:
        model = Report
        fields = [
            "id", "reporter", "reporter_name", "listing", "listing_title",
            "reported_user", "reported_user_name", "reason", "details",
            "status", "admin_note", "resolved_at", "created_at",
        ]
        read_only_fields = fields


class ReportCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Report
        fields = ["listing", "reported_user", "reason", "details"]

    def validate(self, attrs):
        if not attrs.get("listing") and not attrs.get("reported_user"):
            raise serializers.ValidationError("A report must target a listing or a user.")
        if attrs.get("listing") and attrs.get("reported_user"):
            raise serializers.ValidationError("Report either a listing or a user, not both.")
        return attrs
