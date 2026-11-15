"""In-app notification model. Live delivery happens over SSE (events app)."""

from django.conf import settings
from django.db import models


class Notification(models.Model):
    class Type(models.TextChoices):
        LISTING_NEW = "listing_new", "New listing"
        LISTING_CLAIMED = "listing_claimed", "Listing claimed"
        LISTING_PICKED_UP = "listing_picked_up", "Picked up"
        LISTING_DELIVERED = "listing_delivered", "Delivered"
        LISTING_CANCELLED = "listing_cancelled", "Listing cancelled"
        LISTING_EXPIRED = "listing_expired", "Listing expired"
        CLAIM_REMINDER = "claim_reminder", "Pickup reminder"
        ORG_VERIFIED = "org_verified", "Organization verified"
        ORG_REJECTED = "org_rejected", "Organization rejected"
        RATING_RECEIVED = "rating_received", "Rating received"
        REPORT_RESOLVED = "report_resolved", "Report resolved"
        ACCOUNT_SUSPENDED = "account_suspended", "Account suspended"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    type = models.CharField(max_length=30, choices=Type.choices)
    message = models.TextField()
    listing = models.ForeignKey("listings.Listing", on_delete=models.SET_NULL, null=True, blank=True, related_name="notifications")
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "is_read", "created_at"], name="notif_user_read_created_idx"),
        ]

    def __str__(self) -> str:
        return f"[{self.user_id}] {self.type}: {self.message[:50]}"
