"""Mark stale listings expired and penalize no-show claims.

Run by cron every few minutes:

    python manage.py expire_listings

Expiry is ALSO enforced at query time (feeds filter safe_until > now), so even
if cron hasn't run, no expired listing is ever served as open. This command
materializes the expired status and settles the trust consequences.
"""

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from accounts.trust import adjust_trust
from claims.models import Claim
from listings.models import Listing


class Command(BaseCommand):
    help = "Expire listings past safe_until; no-show + penalize claims never picked up."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report what would change.")

    def handle(self, *args, **options):
        now = timezone.now()
        dry = options["dry_run"]

        # 1) Open listings whose safety window has passed -> expired.
        stale = Listing.objects.filter(status=Listing.Status.OPEN, safe_until__lte=now)
        # 2) Claimed-but-never-picked-up (claim active, past safe_until) -> no_show.
        stale_claims = Claim.objects.filter(
            status=Claim.Status.ACTIVE,
            listing__safe_until__lte=now,
        )

        self.stdout.write(
            f"{stale.count()} listing(s) to expire, {stale_claims.count()} no-show claim(s)."
        )
        if dry:
            return

        with transaction.atomic():
            for claim in stale_claims.select_related("listing", "volunteer"):
                claim.status = Claim.Status.NO_SHOW
                claim.save(update_fields=["status"])
                adjust_trust(claim.volunteer, "no_show", reference_id=claim.id)
                listing = claim.listing
                listing.status = Listing.Status.EXPIRED
                listing.save(update_fields=["status", "updated_at"])

            expired = stale.update(status=Listing.Status.EXPIRED, updated_at=now)

        self.stdout.write(self.style.SUCCESS(f"Expired {expired} listing(s); settled no-shows."))
