"""Listing model — a surplus food post."""

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class Listing(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        CLAIMED = "claimed", "Claimed"
        PICKED_UP = "picked_up", "Picked up"
        DELIVERED = "delivered", "Delivered"
        EXPIRED = "expired", "Expired"
        CANCELLED = "cancelled", "Cancelled"

    class FoodType(models.TextChoices):
        COOKED = "cooked", "Cooked meal"
        PACKAGED = "packaged", "Packaged"
        RAW = "raw", "Raw ingredients"
        BAKERY = "bakery", "Bakery"
        OTHER = "other", "Other"

    class QuantityUnit(models.TextChoices):
        MEALS = "meals", "meals"
        KG = "kg", "kg"
        BOXES = "boxes", "boxes"

    donor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="listings"
    )
    organization = models.ForeignKey(
        "accounts.Organization", on_delete=models.SET_NULL, related_name="listings", null=True, blank=True
    )
    title = models.CharField(max_length=140)
    description = models.TextField(blank=True, default="")
    food_type = models.CharField(max_length=20, choices=FoodType.choices, default=FoodType.COOKED)
    is_veg = models.BooleanField(default=True)
    quantity_value = models.FloatField(validators=[MinValueValidator(0.1)])
    quantity_unit = models.CharField(max_length=10, choices=QuantityUnit.choices, default=QuantityUnit.MEALS)
    allergens = models.CharField(max_length=200, blank=True, default="", help_text="e.g. 'nuts, dairy'")
    photo = models.ImageField(upload_to="listing_photos/", blank=True, null=True)

    pickup_address = models.CharField(max_length=255)
    lat = models.FloatField()
    lng = models.FloatField()

    ready_from = models.DateTimeField(help_text="When the food is available for pickup.")
    safe_until = models.DateTimeField(help_text="Hard deadline — after this the food is not safe to rescue.")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN, db_index=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            # Composite index that serves the open-feed bounding-box prefilter.
            models.Index(fields=["status", "lat", "lng"], name="listing_status_latlng_idx"),
            # Serves expiry sweeps and "expiring soon" ordering.
            models.Index(fields=["safe_until"], name="listing_safe_until_idx"),
            models.Index(fields=["status", "safe_until"], name="listing_status_safe_idx"),
        ]
        constraints = [
            models.CheckConstraint(condition=models.Q(ready_from__lte=models.F("safe_until")), name="ready_before_safe"),
        ]

    def __str__(self) -> str:
        return f"{self.title} — {self.get_status_display()}"

    # Convenience flags used by serializers and views.
    @property
    def is_open(self) -> bool:
        return self.status == self.Status.OPEN

    @property
    def is_claimed_state(self) -> bool:
        return self.status in (self.Status.CLAIMED, self.Status.PICKED_UP)

    @property
    def quantity_label(self) -> str:
        value = int(self.quantity_value) if self.quantity_value == int(self.quantity_value) else self.quantity_value
        unit = self.quantity_unit if self.quantity_value != 1 else self.quantity_unit.rstrip("s") or self.quantity_unit
        return f"{value} {unit}"
