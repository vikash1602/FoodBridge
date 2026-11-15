"""Claim and Rating models — the delivery lifecycle and its feedback loop."""

import random

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from listings.models import Listing


def generate_pickup_code() -> str:
    """4-digit code the donor shows to the volunteer at pickup."""
    return f"{random.randint(0, 9999):04d}"


class Claim(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"          # claimed, waiting for pickup
        PICKED_UP = "picked_up", "Picked up"
        DELIVERED = "delivered", "Delivered"
        CANCELLED = "cancelled", "Cancelled"
        NO_SHOW = "no_show", "No show"

    # Claim rows in any of these statuses "occupy" the listing — the partial
    # unique constraint below makes a second one impossible at the DB level,
    # the safety net under the select_for_update application check.
    OCCUPYING_STATUSES = (Status.ACTIVE, Status.PICKED_UP, Status.DELIVERED)

    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="claims")
    volunteer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="claims"
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    pickup_code = models.CharField(max_length=4, default=generate_pickup_code)

    claimed_at = models.DateTimeField(auto_now_add=True)
    picked_up_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    delivery_note = models.TextField(blank=True, default="")
    delivery_photo = models.ImageField(upload_to="delivery_photos/", blank=True, null=True)
    cancel_reason = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-claimed_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["listing"],
                condition=models.Q(status__in=["active", "picked_up", "delivered"]),
                name="unique_occupying_claim_per_listing",
            ),
        ]
        indexes = [
            models.Index(fields=["volunteer", "status"]),
        ]

    def __str__(self) -> str:
        return f"#{self.pk} {self.listing_id}:{self.volunteer_id} ({self.get_status_display()})"

    @property
    def is_active(self) -> bool:
        return self.status == self.Status.ACTIVE


class Rating(models.Model):
    """One rating per (claim, rater): donor rates volunteer, volunteer rates donor."""

    claim = models.ForeignKey(Claim, on_delete=models.CASCADE, related_name="ratings")
    rater = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ratings_given"
    )
    ratee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ratings_received"
    )
    stars = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(5)])
    comment = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["claim", "rater"], name="unique_rater_per_claim"),
        ]

    def __str__(self) -> str:
        return f"{self.rater_id} -> {self.ratee_id}: {self.stars}★ (claim {self.claim_id})"


class Report(models.Model):
    """A user report against a listing or another user, reviewed by admins."""

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        RESOLVED = "resolved", "Resolved"

    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reports_filed"
    )
    listing = models.ForeignKey(
        Listing, on_delete=models.SET_NULL, related_name="reports", null=True, blank=True
    )
    reported_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="reports_against",
        null=True,
        blank=True,
    )
    reason = models.CharField(max_length=120)
    details = models.TextField(blank=True, default="")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN, db_index=True)
    admin_note = models.TextField(blank=True, default="")
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, related_name="reports_resolved", null=True, blank=True
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        target = f"listing {self.listing_id}" if self.listing else f"user {self.reported_user_id}"
        return f"Report #{self.pk} on {target} ({self.get_status_display()})"
