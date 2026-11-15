"""Concurrency test: 50 volunteers claim the same listing simultaneously.

Runs against a real PostgreSQL test database (TransactionTestCase so threads
see committed rows — pytest-django's per-test transactions must not wrap it).
Expected outcome: exactly 1 HTTP 201, 49 HTTP 409, exactly 1 Claim row.
"""

import threading
from datetime import timedelta

from django.db import connections
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Organization, User
from claims.models import Claim
from listings.models import Listing

N_THREADS = 50


class ClaimConcurrencyTest(TransactionTestCase):
    """Fires N_THREADS simultaneous claim requests at one listing."""

    def _make_fixtures(self):
        self.donor = User.objects.create_user("cdonor", "cdonor@t.in", "StrongPass123!", role="donor")
        self.org = Organization.objects.create(
            owner=self.donor, name="Concurrent Kitchen", type="restaurant",
            address="1 Race St", lat=18.5204, lng=73.8567,
            verification_status=Organization.VerificationStatus.APPROVED,
        )
        self.donor.is_verified = True
        self.donor.save(update_fields=["is_verified"])
        self.listing = Listing.objects.create(
            donor=self.donor, organization=self.org, title="One pot of biryani",
            food_type=Listing.FoodType.COOKED, is_veg=True,
            quantity_value=50, quantity_unit=Listing.QuantityUnit.MEALS,
            pickup_address="1 Race St", lat=18.5204, lng=73.8567,
            ready_from=timezone.now(), safe_until=timezone.now() + timedelta(hours=3),
        )
        self.volunteers = [
            User.objects.create_user(f"cvol{i}", f"cvol{i}@t.in", "StrongPass123!", role="volunteer")
            for i in range(N_THREADS)
        ]

    def test_fifty_simultaneous_claims_exactly_one_wins(self):
        self._make_fixtures()
        results = [None] * N_THREADS
        barrier = threading.Barrier(N_THREADS, timeout=30)

        def attempt(i: int):
            # Own client + own DB connection per thread (real parallel requests).
            connections.close_all()
            client = APIClient()
            client.force_authenticate(self.volunteers[i])
            try:
                barrier.wait(timeout=30)  # fire as close to simultaneously as possible
                resp = client.post(f"/api/v1/listings/{self.listing.id}/claim/", format="json")
                results[i] = resp.status_code
            except Exception as exc:  # pragma: no cover — surfaced via assertion below
                results[i] = f"error: {exc}"
            finally:
                connections.close_all()

        threads = [threading.Thread(target=attempt, args=(i,)) for i in range(N_THREADS)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=120)

        successes = sum(1 for r in results if r == 201)
        conflicts = sum(1 for r in results if r == 409)

        self.assertEqual(
            successes, 1,
            f"expected exactly 1 winner, got {successes}; results: {sorted(set(map(str, results)))}",
        )
        self.assertEqual(conflicts, N_THREADS - 1, f"expected {N_THREADS - 1} x 409")
        self.assertEqual(Claim.objects.count(), 1, "exactly one Claim row must exist")
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.status, Listing.Status.CLAIMED)
