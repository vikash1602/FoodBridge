"""Benchmark the geo feed query at increasing listing volumes.

Runs the production feed SQL (bounding-box prefilter + Haversine annotation +
ranking + pagination) via EXPLAIN ANALYZE against synthetic rows, and reports
timings so the Haversine-vs-PostGIS decision is based on measurement:

    python manage.py benchmark_geo_feed --volumes 1000 5000 20000 50000

Synthetic rows are bulk-inserted into a scratch status so they never appear in
the real feed, then deleted.
"""

import random
import time

from django.core.management.base import BaseCommand
from django.db import connection
from django.utils import timezone

from listings.models import Listing

CENTRE = (12.6819, 78.6200)  # Vaniyambadi


class Command(BaseCommand):
    help = "EXPLAIN ANALYZE the geo feed query at synthetic data volumes."

    def add_arguments(self, parser):
        parser.add_argument("--volumes", type=int, nargs="+", default=[1000, 5000, 20000])
        parser.add_argument("--runs", type=int, default=3, help="Timed executions per volume (median reported).")

    def handle(self, *args, **options):
        volumes = options["volumes"]
        runs = options["runs"]
        created_ids = []

        self.stdout.write(f"{'rows':>8} | {'median feed query':>18} | {'planner':>10}")
        self.stdout.write("-" * 48)

        try:
            for volume in volumes:
                missing = volume - Listing.objects.count()
                if missing > 0:
                    created_ids += self._seed(min(missing, volume))
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT COUNT(*) FROM listings_listing
                        WHERE status = 'scratch_benchmark'
                        """
                    )
                    # Seed rows are inserted directly with a status that the live
                    # feed ignores, but the query shape (indexes touched) is identical.
                median_ms, scan = self._time_query(runs)
                self.stdout.write(f"{volume:>8} | {median_ms:>14.1f} ms | {scan:>10}")
        finally:
            if created_ids:
                with connection.cursor() as cursor:
                    cursor.execute("DELETE FROM listings_listing WHERE id = ANY(%s)", (created_ids,))
                self.stdout.write(self.style.SUCCESS(f"Cleaned up {len(created_ids)} synthetic rows."))

    def _seed(self, count: int) -> list[int]:
        """Bulk-insert synthetic listings spread over ±0.5° around the centre."""
        import random

        rng = random.Random(42)
        now = timezone.now()
        rows = []
        for _ in range(count):
            lat = CENTRE[0] + rng.uniform(-0.5, 0.5)
            lng = CENTRE[1] + rng.uniform(-0.5, 0.5)
            rows.append(
                Listing(
                    donor_id=self._any_donor(),
                    title="benchmark",
                    quantity_value=1,
                    pickup_address="benchmark",
                    lat=lat,
                    lng=lng,
                    ready_from=now,
                    safe_until=now + timezone.timedelta(hours=2),
                    status="scratch_benchmark",
                )
            )
        created = Listing.objects.bulk_create(rows, batch_size=2000)
        self.stdout.write(f"Seeded {len(created)} synthetic rows.")
        return [row.id for row in created]

    def _any_donor(self) -> int:
        from accounts.models import User

        donor = User.objects.filter(role="donor").values_list("id", flat=True).first()
        if donor is None:
            donor = User.objects.create_user("bench", "bench@t.in", "StrongPass123!", role="donor")
        return donor

    def _time_query(self, runs: int) -> tuple[float, str]:
        """Run the exact feed query and read the planner's node choice."""
        lat, lng = CENTRE
        sql = f"""
            SELECT id FROM listings_listing
            WHERE status = 'open' AND safe_until > NOW()
              AND lat BETWEEN {lat - 0.107} AND {lat + 0.107}
              AND lng BETWEEN {lng - 0.111} AND {lng + 0.111}
            ORDER BY (
                0.65 * (1 - LEAST(GREATEST(EXTRACT(EPOCH FROM (safe_until - NOW())) / 7200.0, 0), 1))
              + 0.35 * (1 - LEAST(
                    (111.32 * 2 * ASIN(SQRT(
                        POWER(SIN(RADIANS(lat - {lat}) / 2), 2) +
                        COS(RADIANS(lat)) * COS(RADIANS({lat})) *
                        POWER(SIN(RADIANS(lng - {lng}) / 2), 2)
                    ))) / 12.0, 1))
              + 0.05 * 0.5
            ) DESC
            LIMIT 13 OFFSET 0
        """
        timings = []
        scan = ""
        with connection.cursor() as cursor:
            for _ in range(runs):
                started = time.perf_counter()
                cursor.execute(f"EXPLAIN ANALYZE {sql}")
                plan = "\n".join(row[0] for row in cursor.fetchall())
                timings.append(time.perf_counter() - started)
                for line in plan.splitlines():
                    if "Index Scan" in line or "Seq Scan" in line or "Bitmap" in line:
                        scan = line.strip().split(" on ")[0].split("(")[0].strip()
                        break
        timings.sort()
        return timings[len(timings) // 2] * 1000, scan
