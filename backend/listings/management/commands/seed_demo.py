"""Seed a demo city so FoodBridge looks alive on first run.

    python manage.py seed_demo            # skip if data already exists
    python manage.py seed_demo --force    # wipe & reseed

Demo region: Vaniyambadi + nearby towns (Ambur, Jolarpettai, Tirupattur,
Alangayam) in Tamil Nadu. Town coordinates verified against OpenStreetMap
(Nominatim, 2026-11). All business names are FICTIONAL; phone numbers are
demo numbers in the Indian format. Listings are spread 0–16 km with varied
ages and safety windows so the feed, urgency colours and escalation tiers
all show up on first run.
"""

import math
import random
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from accounts.models import Organization, User
from accounts.trust import adjust_trust, TrustAdjustment
from claims.models import Claim, Rating
from listings.models import Listing

random.seed(11)  # deterministic demo

# OSM-verified town anchors.
VANIYAMBADI = (12.6819, 78.6200)
AMBUR = (12.7874, 78.7188)
JOLARPETTAI = (12.5643, 78.5797)
TIRUPATTUR = (12.4984, 78.5618)
ALANGAYAM = (12.6227, 78.7525)

PASSWORD = "DemoPass123!"

# (org_name, org_type, first, last, email, address, lat, lng)
DONORS = [
    ("Mangala Kalyana Mandapam", "caterer", "Mangala", "Trustee", "mangala@demo.fb",
     "Mangala Mandapam, Oomerabad Road, Vaniyambadi", 12.6830, 78.6180),
    ("Anbu Bakery", "individual", "Anbu", "Chezhiyan", "anbu@demo.fb",
     "Anbu Bakery, Near Old Bus Stand, Vaniyambadi", 12.6800, 78.6230),
    ("New Crescent Student Hostel", "hostel", "Warden", "Crescent", "crescent@demo.fb",
     "New Crescent Hostel, Near Islamiah College, Vaniyambadi", 12.6740, 78.6330),
    ("Sri Lakshmi Mess", "restaurant", "Lakshmi", "Narayanan", "lakshmi@demo.fb",
     "Sri Lakshmi Mess, Amburpet, Vaniyambadi", 12.7180, 78.6420),
    ("Rukmini Biryani House", "restaurant", "Rukmini", "Iyer", "rukmini@demo.fb",
     "Rukmini Biryani House, Bazaar Street, Ambur", 12.7830, 78.7100),
    ("Jolarpet Junction Canteen", "restaurant", "Selvi", "Kannan", "selvi@demo.fb",
     "Junction Canteen, Near Railway Station, Jolarpettai", 12.5660, 78.5800),
    ("Thendral Farm Collective", "individual", "Thendral", "Muthu", "thendral@demo.fb",
     "Thendral Farms, Alangayam Road, Alangayam", 12.6230, 78.7520),
    ("Kandhili Tea Stall", "individual", "Murugan", "S", "murugan@demo.fb",
     "Kandhili Tea Stall, Vaniyambadi–Tirupattur Road", 12.5500, 78.5720),
]

# (full_name, email, lat, lng, notify_radius_km)
VOLUNTEERS = [
    ("Priya Sundaram", "priya@demo.fb", 12.6835, 78.6185, 6),
    ("Arjun Kumar", "arjun@demo.fb", 12.6750, 78.6100, 10),
    ("Sana Begum", "sana@demo.fb", 12.7185, 78.6425, 12),
    ("Devan Raj", "devan@demo.fb", 12.7850, 78.7120, 8),
    ("Isha Lakshmi", "isha@demo.fb", 12.6235, 78.7530, 15),
    ("Karan Selvam", "karan@demo.fb", 12.5650, 78.5810, 15),
    ("Meena Vasan", "meena@demo.fb", 12.5520, 78.5730, 10),
]

# (title, food_type, is_veg, qty, unit, description, donor_index, hours_left, minutes_ago)
LISTINGS = [
    ("Wedding feast – veg meals (hot)", "cooked", True, 60, "meals", "Mandapam lunch surplus, packed in banana-leaf boxes", 0, 2.5, 10),
    ("Veg puff & sweet boxes", "bakery", True, 12, "boxes", "Evening stock from near the bus stand", 1, 4, 25),
    ("Evening rice & sambar", "cooked", True, 40, "meals", "Hostel mess extra after dinner headcount", 2, 3, 15),
    ("Curd rice pots", "cooked", True, 18, "meals", "Amburpet mess lunch surplus", 3, 2, 45),
    ("Ambur mutton biryani trays", "cooked", False, 25, "kg", "Sealed trays from the lunch rush", 4, 1.5, 30),
    ("Chicken 65 party packs", "cooked", False, 10, "kg", "From the evening shift", 4, 2, 50),
    ("Veg biryani (no onion)", "cooked", True, 15, "kg", "Jain-friendly batch", 4, 3, 5),
    ("Railway canteen veg meals", "cooked", True, 30, "meals", "Unsold dinner plates", 5, 2, 35),
    ("Idli batter & chutney", "raw", True, 8, "kg", "Freshly ground this morning", 5, 6, 60),
    ("Country eggs trays", "raw", False, 6, "kg", "Farm surplus, cold-stored", 6, 5, 70),
    ("Bananas & guava crates", "raw", True, 20, "kg", "Ripening fast — take today", 6, 1, 90),
    ("Bonda & bajji batter packs", "cooked", True, 40, "meals", "Tea stall evening surplus", 7, 2, 20),
    ("Mysore pak sweet boxes", "bakery", True, 5, "boxes", "Festival stock, unopened", 1, 4, 40),
    ("Chapati & veg kurma packs", "cooked", True, 22, "meals", "Mandapam breakfast leftover", 0, 2, 65),
    ("Veg noodles buckets", "cooked", True, 12, "meals", "Canteen evening extra", 5, 3, 12),
    ("Pepper chicken rice", "cooked", False, 9, "kg", "Ambur dinner surplus", 4, 1, 75),
    ("Tomato & onion sacks", "raw", True, 25, "kg", "Grade-A but oversupplied", 6, 4, 55),
    ("Sweet bun & rusk trays", "bakery", True, 15, "boxes", "Morning bake, end of day", 1, 2, 85),
    ("Payasam dessert pots", "cooked", True, 8, "kg", "Mandapam feast dessert", 0, 1.5, 95),
    ("Hostel breakfast pongal", "cooked", True, 35, "meals", "Extra after low attendance", 2, 2, 30),
    ("Fish curry meals", "cooked", False, 14, "meals", "Amburpet mess special", 3, 1.25, 18),
    ("Veg cutlet trays", "cooked", True, 30, "meals", "Kalyana mandapam starter trays", 0, 3, 8),
    ("Coconut chutney buckets", "raw", True, 5, "kg", "Mess morning batch", 3, 4, 42),
    ("Jolarpet veg kothu parotta", "cooked", True, 16, "meals", "Canteen night shift extra", 5, 1.75, 22),
    ("Guava jelly jars", "packaged", True, 10, "boxes", "Farm kitchen sealed jars", 6, 6, 48),
]


class Command(BaseCommand):
    help = "Seed the Vaniyambadi demo region: donors, volunteers, listings, claims, ratings."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Wipe existing demo data first.")

    def handle(self, *args, **options):
        if options["force"]:
            self.stdout.write("Wiping existing data…")
            for model in (Rating, Claim, Listing, Organization, User):
                model.objects.all().delete()
            TrustAdjustment.objects.all().delete()

        if User.objects.filter(email="admin@foodbridge.dev").exists():
            self.stdout.write(self.style.WARNING("Demo data already present — pass --force to reseed."))
            return

        # --- admin -----------------------------------------------------------
        admin, _ = User.objects.get_or_create(
            email="admin@foodbridge.dev",
            defaults=dict(username="admin", role="admin", first_name="Platform", last_name="Admin", is_staff=True, is_superuser=True),
        )
        admin.is_staff = admin.is_superuser = True
        admin.role = "admin"
        admin.set_password(PASSWORD)
        admin.save()

        now = timezone.now()
        listings_created: list[Listing] = []
        donors: list[tuple[User, Organization]] = []

        # --- donors + orgs ----------------------------------------------------
        for org_name, org_type, first, last, email, address, lat, lng in DONORS:
            donor = User.objects.create_user(
                username=email.split("@")[0], email=email, password=PASSWORD,
                role="donor", first_name=first, last_name=last,
                phone=f"+9198{random.randint(10000000, 99999999)}",
                is_verified=True, trust_score=random.choice([72, 80, 88]), base_lat=lat, base_lng=lng,
            )
            org = Organization.objects.create(
                owner=donor, name=org_name, type=org_type, address=address,
                lat=lat, lng=lng, verification_status=Organization.VerificationStatus.APPROVED,
            )
            donors.append((donor, org))

        # --- volunteers ---------------------------------------------------------
        volunteers: list[User] = []
        for full_name, email, lat, lng, radius in VOLUNTEERS:
            first, last = full_name.split(" ", 1)
            volunteer = User.objects.create_user(
                username=email.split("@")[0], email=email, password=PASSWORD,
                role="volunteer", first_name=first, last_name=last,
                phone=f"+9197{random.randint(10000000, 99999999)}",
                base_lat=lat, base_lng=lng, notify_radius_km=radius,
                trust_score=random.choice([50, 58, 66, 75]),
            )
            volunteers.append(volunteer)

        # --- listings: varied ages, distances (0-16 km), safety windows --------
        for title, food_type, is_veg, qty, unit, description, donor_index, hours_left, minutes_ago in LISTINGS:
            donor, org = donors[donor_index]
            # Small jitter (±150 m) around each org so map pins don't stack.
            jitter_lat = random.uniform(-0.0013, 0.0013)
            jitter_lng = random.uniform(-0.0013, 0.0013)
            safe_until = now + timedelta(hours=hours_left)
            listing = Listing.objects.create(
                donor=donor, organization=org, title=title,
                description=description, food_type=food_type, is_veg=is_veg,
                quantity_value=qty, quantity_unit=unit,
                allergens=random.choice(["", "", "", "groundnut", "dairy, gluten"]),
                pickup_address=org.address,
                lat=org.lat + jitter_lat, lng=org.lng + jitter_lng,
                ready_from=now - timedelta(minutes=max(0, minutes_ago - 10)),
                safe_until=safe_until,
            )
            Listing.objects.filter(pk=listing.pk).update(created_at=now - timedelta(minutes=minutes_ago))
            listings_created.append(listing)

        # --- a few claims in various stages + ratings ---------------------------
        stages = [
            ("delivered", 0), ("delivered", 1), ("delivered", 2),
            ("picked_up", 3), ("active", 4), ("active", 5),
        ]
        for stage, volunteer_index in stages:
            listing = listings_created.pop()
            volunteer = volunteers[volunteer_index]
            listing.status = {
                "active": Listing.Status.CLAIMED,
                "picked_up": Listing.Status.PICKED_UP,
                "delivered": Listing.Status.DELIVERED,
            }[stage]
            listing.save(update_fields=["status", "updated_at"])
            claim = Claim.objects.create(
                listing=listing, volunteer=volunteer,
                picked_up_at=now - timedelta(minutes=20) if stage != "active" else None,
                delivered_at=now - timedelta(minutes=10) if stage == "delivered" else None,
                delivery_note="Handed to the shelter kitchen." if stage == "delivered" else "",
            )
            claim.status = {"active": Claim.Status.ACTIVE, "picked_up": Claim.Status.PICKED_UP, "delivered": Claim.Status.DELIVERED}[stage]
            claim.save(update_fields=["status"])
            if stage == "delivered":
                adjust_trust(volunteer, "delivered", reference_id=claim.id)
                adjust_trust(listing.donor, "delivered", reference_id=claim.id)
                Rating.objects.create(
                    claim=claim, rater=listing.donor, ratee=volunteer,
                    stars=random.choice([4, 5, 5]), comment="Quick and careful!",
                )
                Rating.objects.create(
                    claim=claim, rater=volunteer, ratee=listing.donor,
                    stars=random.choice([4, 5]), comment="Food was exactly as described.",
                )

        # --- some delivered history for charts -----------------------------------
        for _ in range(4):
            donor, org = random.choice(donors)
            Listing.objects.create(
                donor=donor, organization=org, title="Older batch (already rescued)",
                food_type="cooked", is_veg=True, quantity_value=random.choice([10, 15, 20]),
                quantity_unit="meals", pickup_address=org.address,
                lat=org.lat + random.uniform(-0.001, 0.001), lng=org.lng + random.uniform(-0.001, 0.001),
                ready_from=now - timedelta(days=3), safe_until=now - timedelta(days=3),
                status=Listing.Status.DELIVERED,
            )

        self.stdout.write(self.style.SUCCESS(
            f"Seeded Vaniyambadi region: 1 admin, {len(donors)} donors/orgs, {len(volunteers)} volunteers, "
            f"{len(LISTINGS) + 4} listings, 6 claims, 6 ratings."
        ))
        self.stdout.write(f"  admin@foodbridge.dev / {PASSWORD}")
        self.stdout.write(f"  rukmini@demo.fb / {PASSWORD} (donor, Ambur)")
        self.stdout.write(f"  priya@demo.fb / {PASSWORD} (volunteer, Vaniyambadi)")
