"""User, Organization and auth-support models."""

from datetime import timedelta

from django.contrib.auth.models import AbstractUser
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

from config.settings import (
    TRUST_BADGES,
    TRUST_SCORE_DEFAULT,
    TRUST_SCORE_MAX,
    TRUST_SCORE_MIN,
)

# Re-export so Django's app registry picks the model up for migrations.
from .trust import TrustAdjustment  # noqa: F401  isort:skip


class User(AbstractUser):
    """FoodBridge user: donor, volunteer (also used by NGOs) or admin."""

    class Role(models.TextChoices):
        DONOR = "donor", "Donor"
        VOLUNTEER = "volunteer", "Volunteer / NGO"
        ADMIN = "admin", "Admin"

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.VOLUNTEER)
    phone = models.CharField(max_length=20, blank=True, default="")
    # Set by an admin once the user's organization checks out. Unverified donors
    # cannot post listings (enforced in listings views).
    is_verified = models.BooleanField(default=False)
    trust_score = models.IntegerField(
        default=TRUST_SCORE_DEFAULT,
        validators=[MinValueValidator(TRUST_SCORE_MIN), MaxValueValidator(TRUST_SCORE_MAX)],
        db_index=True,
    )
    base_lat = models.FloatField(null=True, blank=True)
    base_lng = models.FloatField(null=True, blank=True)
    notify_radius_km = models.FloatField(default=5.0)

    # Suspended users may log in and read, but cannot create or claim anything.
    is_suspended = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["role", "is_verified"]),
        ]

    def __str__(self) -> str:
        return f"{self.get_full_name() or self.username} ({self.get_role_display()})"

    # -- role helpers -------------------------------------------------------

    @property
    def is_admin_role(self) -> bool:
        return self.role == self.Role.ADMIN or self.is_superuser

    @property
    def is_donor(self) -> bool:
        return self.role == self.Role.DONOR

    @property
    def is_volunteer(self) -> bool:
        return self.role == self.Role.VOLUNTEER

    @property
    def has_approved_organization(self) -> bool:
        """Donors/NGOs may only post under an approved organization."""
        if self.role == self.Role.VOLUNTEER:
            return True  # volunteers do not need an organization
        return self.organizations.filter(verification_status=Organization.VerificationStatus.APPROVED).exists()

    # -- trust --------------------------------------------------------------

    @property
    def badge(self) -> str:
        """Trust badge slug derived from trust_score (settings.TRUST_BADGES)."""
        for threshold, name in TRUST_BADGES:
            if self.trust_score >= threshold:
                return name
        return TRUST_BADGES[-1][1]


class Organization(models.Model):
    """A restaurant / hostel / caterer / NGO / individual profile that needs verification."""

    class OrgType(models.TextChoices):
        RESTAURANT = "restaurant", "Restaurant"
        HOSTEL = "hostel", "Hostel"
        CATERER = "caterer", "Caterer"
        NGO = "ngo", "NGO"
        INDIVIDUAL = "individual", "Individual"

    class VerificationStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    owner = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="organizations", limit_choices_to={"role": "donor"}
    )
    name = models.CharField(max_length=160)
    type = models.CharField(max_length=20, choices=OrgType.choices, default=OrgType.INDIVIDUAL)
    address = models.CharField(max_length=255)
    lat = models.FloatField(null=True, blank=True)
    lng = models.FloatField(null=True, blank=True)
    verification_status = models.CharField(
        max_length=20, choices=VerificationStatus.choices, default=VerificationStatus.PENDING, db_index=True
    )
    verification_note = models.CharField(
        max_length=255, blank=True, default="", help_text="Shown to the owner when rejected."
    )
    document = models.FileField(upload_to="org_documents/", blank=True, null=True)
    reviewed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="org_reviews"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["verification_status", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.get_type_display()})"

    @property
    def is_approved(self) -> bool:
        return self.verification_status == self.VerificationStatus.APPROVED


class OtpCode(models.Model):
    """One-time login codes. Stored in the DB (not a per-process cache) so OTP
    login works across multiple gunicorn/uvicorn workers and survives restarts.
    Only the SHA-256 hash of the code is persisted."""

    email = models.EmailField(db_index=True)
    code_hash = models.CharField(max_length=64)  # sha256 hex digest
    expires_at = models.DateTimeField(db_index=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    last_sent_at = models.DateTimeField(auto_now=True)
    send_failed = models.BooleanField(default=False)
    send_error = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        indexes = [
            models.Index(fields=["email", "expires_at"], name="otp_email_expires_idx"),
        ]

    def __str__(self) -> str:
        return f"OTP {self.email} (exp {self.expires_at:%H:%M}, attempts {self.attempts})"

    @staticmethod
    def purge_expired() -> int:
        deleted, _ = OtpCode.objects.filter(expires_at__lt=timezone.now()).delete()
        return deleted


class EmailOutbox(models.Model):
    """Durable delivery queue for transactional email (OTP codes).

    Why: the previous design kicked delivery off on a background thread only —
    a process restart lost the in-flight send and nothing recorded whether the
    provider accepted the message. Rows are created synchronously in the request
    path (status=pending), claimed atomically by a worker thread, and retried by
    `process_email_outbox` until accepted or permanently failed.

    The rendered body necessarily contains the OTP (a retry worker could not
    re-render it from the hashed OtpCode row) — this is a delivery queue, not a
    log; error metadata and server logs never include the code.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SENDING = "sending", "Sending"
        ACCEPTED = "accepted", "Accepted by provider"
        FAILED = "failed", "Failed"

    class Provider(models.TextChoices):
        RESEND = "resend", "Resend"
        CONSOLE = "console", "Console (dev)"

    to_email = models.EmailField(db_index=True)
    subject = models.CharField(max_length=200)
    body = models.TextField()
    html_body = models.TextField(blank=True, default="",
                                 help_text="Rendered HTML alternative. Empty = text-only message.")
    purpose = models.CharField(max_length=30, default="otp")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING, db_index=True)
    provider = models.CharField(max_length=12, choices=Provider.choices, default=Provider.RESEND)
    provider_message_id = models.CharField(max_length=120, blank=True, default="")
    provider_status_code = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="HTTP status returned by the provider for the latest attempt.",
    )
    failure_category = models.CharField(
        max_length=30, blank=True, default="",
        help_text="auth_error | restricted_api_key | domain_not_authorized | sandbox_recipient_restriction "
                  "| validation_error | rate_limited | provider_error | network_error | configuration_error",
    )
    attempts = models.PositiveSmallIntegerField(default=0)
    max_attempts = models.PositiveSmallIntegerField(default=5)
    last_error = models.CharField(max_length=255, blank=True, default="")
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "attempts"], name="outbox_status_attempts_idx"),
        ]

    def __str__(self) -> str:
        return f"Outbox #{self.pk} → {self.to_email} [{self.status}]"

    @staticmethod
    def purge_accepted(older_than_days: int = 7) -> int:
        cutoff = timezone.now() - timedelta(days=older_than_days)
        deleted, _ = EmailOutbox.objects.filter(
            status=EmailOutbox.Status.ACCEPTED, created_at__lt=cutoff
        ).delete()
        return deleted
