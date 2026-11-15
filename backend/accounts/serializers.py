"""Serializers for auth, profile and organizations."""

from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import Organization, User


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, trim_whitespace=False, style={"input_type": "password"})
    confirm_password = serializers.CharField(write_only=True, trim_whitespace=False)
    full_name = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")

    class Meta:
        model = User
        fields = ["id", "email", "username", "full_name", "role", "phone", "password", "confirm_password"]
        read_only_fields = ["id", "username"]

    VALID_ROLES = (User.Role.DONOR, User.Role.VOLUNTEER)

    def validate_email(self, value: str) -> str:
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_role(self, value: str) -> str:
        if value not in self.VALID_ROLES:
            raise serializers.ValidationError("Role must be 'donor' or 'volunteer'.")
        return value

    def validate(self, attrs):
        if attrs["password"] != attrs.pop("confirm_password"):
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        validate_password(attrs["password"])
        return attrs

    def create(self, validated_data: dict) -> User:
        full_name = validated_data.pop("full_name", "")
        if full_name:
            parts = full_name.split(" ", 1)
            validated_data["first_name"] = parts[0]
            validated_data["last_name"] = parts[1] if len(parts) > 1 else ""
        email = validated_data["email"]
        # Derive a stable, unique username from the email.
        base = email.split("@")[0][:60] or "user"
        username, suffix = base, 1
        while User.objects.filter(username__iexact=username).exists():
            suffix += 1
            username = f"{base}{suffix}"
        return User.objects.create_user(username=username, **validated_data)


class UserSerializer(serializers.ModelSerializer):
    """Full profile serializer — only ever shown to the user themselves."""

    badge = serializers.CharField(read_only=True)
    has_approved_organization = serializers.BooleanField(read_only=True)
    is_admin_role = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "username",
            "first_name",
            "last_name",
            "role",
            "phone",
            "is_verified",
            "trust_score",
            "badge",
            "base_lat",
            "base_lng",
            "notify_radius_km",
            "is_suspended",
            "has_approved_organization",
            "is_admin_role",
            "created_at",
        ]
        read_only_fields = ["email", "username", "role", "is_verified", "trust_score", "is_suspended", "created_at"]

    def update(self, instance, validated_data):
        for field in ("first_name", "last_name", "phone", "base_lat", "base_lng", "notify_radius_km"):
            if field in validated_data:
                setattr(instance, field, validated_data[field])
        instance.save(update_fields=[f for f in ("first_name", "last_name", "phone", "base_lat", "base_lng", "notify_radius_km") if f in validated_data])
        return instance


class PublicUserSerializer(serializers.ModelSerializer):
    """Shown on listing cards / claim pages: name and trust signal only."""

    badge = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "username", "trust_score", "badge"]
        read_only_fields = fields


class OrganizationSerializer(serializers.ModelSerializer):
    owner = PublicUserSerializer(read_only=True)
    is_approved = serializers.BooleanField(read_only=True)

    class Meta:
        model = Organization
        fields = [
            "id",
            "owner",
            "name",
            "type",
            "address",
            "lat",
            "lng",
            "verification_status",
            "verification_note",
            "document",
            "is_approved",
            "created_at",
        ]
        read_only_fields = ["owner", "verification_status", "verification_note", "created_at"]

    def create(self, validated_data: dict) -> Organization:
        validated_data["owner"] = self.context["request"].user
        return super().create(validated_data)


class OrganizationReviewSerializer(serializers.Serializer):
    """Body for POST /organizations/{id}/approve/ and /reject/."""

    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class AdminUserSerializer(serializers.ModelSerializer):
    """Row of the admin console user table."""

    badge = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id", "email", "username", "first_name", "last_name", "role", "phone",
            "is_verified", "trust_score", "badge", "is_suspended", "is_active", "date_joined",
        ]
        read_only_fields = fields
