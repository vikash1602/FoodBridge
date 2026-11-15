"""Trust score engine.

Starts at 50 (0-100). Deltas (clamped, idempotent per application):
 +8  delivered claim (volunteer and the donor who fed them)
 +2  5-star rating, +1 for 4-star (ratee)
 -10 no-show (volunteer never picked up before safe_until)
 -6  late cancellation (volunteer cancels after claiming; food may have spoiled)
 -5  upheld report against the user
Badges: >=90 champion, >=75 trusted, >=60 reliable, else new.
"""

from django.db import models

from config.settings import TRUST_SCORE_MAX, TRUST_SCORE_MIN


class TrustAdjustment(models.Model):
    """Audit trail for every trust change."""

    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="trust_adjustments")
    delta = models.IntegerField()
    reason = models.CharField(max_length=60)
    reference_id = models.IntegerField(null=True, blank=True, help_text="claim/rating/report id")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.user_id} {self.delta:+d} ({self.reason})"


# Reasons -> deltas (single source of truth, imported by claims/stats/admin).
DELTAS = {
    "delivered": 8,
    "rating_5": 2,
    "rating_4": 1,
    "no_show": -10,
    "late_cancel": -6,
    "report_upheld": -5,
}


def adjust_trust(user, reason: str, reference_id=None) -> int:
    """Apply `reason`'s delta to `user`, clamped to [0, 100]. Returns new score."""
    delta = DELTAS[reason]
    user.trust_score = max(TRUST_SCORE_MIN, min(TRUST_SCORE_MAX, user.trust_score + delta))
    user.save(update_fields=["trust_score"])
    TrustAdjustment.objects.create(user=user, delta=delta, reason=reason, reference_id=reference_id)
    return user.trust_score
