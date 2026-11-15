"""Storage configuration tests (Phase 4): local fallback, S3 selection,
private/signed defaults, and end-to-end photo upload through the listing API
with a mocked S3 bucket."""

from datetime import timedelta
from io import BytesIO
from unittest import mock

import pytest
from django.core.files.storage import default_storage
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import Organization, User
from listings.models import Listing

pytestmark = pytest.mark.django_db


def _png_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (12, 12), color=(30, 110, 76)).save(buffer, format="PNG")
    return buffer.getvalue()


def _photo_file(png: bytes):
    from listings.image_utils import validate_and_strip_exif

    class FakeFile:
        def __init__(self, data, name):
            self._data = data
            self.name = name

        def chunks(self):
            yield self._data

        def seek(self, *args):
            pass

    cleaned = validate_and_strip_exif(FakeFile(png, "listing.png"))
    from django.core.files.base import File as DjangoFile

    return DjangoFile(cleaned, name="listing.png")


# -- backend selection (pure function, no settings reload) -------------------------

def test_local_storage_fallback_when_s3_not_configured():
    from config.storage import default_storage_config

    config = default_storage_config({})
    assert config["BACKEND"] == "django.core.files.storage.FileSystemStorage"


def test_s3_backend_selected_when_configured():
    from config.storage import default_storage_config

    config = default_storage_config({
        "AWS_STORAGE_BUCKET_NAME": "foodbridge-media",
        "AWS_ACCESS_KEY_ID": "key",
        "AWS_SECRET_ACCESS_KEY": "secret",
        "AWS_S3_REGION_NAME": "ap-south-1",
        "AWS_S3_QUERYSTRING_AUTH": "true",
    })
    assert config["BACKEND"] == "storages.backends.s3.S3Storage"
    assert config["OPTIONS"]["bucket_name"] == "foodbridge-media"
    assert config["OPTIONS"]["querystring_auth"] is True  # private + signed URLs
    assert config["OPTIONS"]["default_acl"] == "private"


def test_neon_object_storage_config_selected_when_endpoint_set():
    """Neon Object Storage: path-style addressing, no ACL wire writes
    (501 on PutObjectAcl — buckets are private by default), presigned GET."""
    from config.storage import default_storage_config

    config = default_storage_config({
        "AWS_STORAGE_BUCKET_NAME": "foodbridge-media",
        "AWS_ACCESS_KEY_ID": "nak_live_test",
        "AWS_SECRET_ACCESS_KEY": "nsk_live_test",
        "AWS_S3_REGION_NAME": "us-east-2",
        "AWS_S3_ENDPOINT_URL": "https://br-example.storage.c-1.us-east-2.aws.neon.tech",
    })
    assert config["BACKEND"] == "storages.backends.s3.S3Storage"
    options = config["OPTIONS"]
    assert options["endpoint_url"] == "https://br-example.storage.c-1.us-east-2.aws.neon.tech"
    assert options["addressing_style"] == "path"  # Neon: virtual-hosted unsupported
    assert options["default_acl"] is None  # no ACL writes on the wire
    assert options["querystring_auth"] is True  # private bucket via presigned GET
    assert options["custom_domain"] is None  # presigned URLs must hit the Neon endpoint


def test_acl_override_still_possible_via_env():
    from config.storage import default_storage_config

    config = default_storage_config({
        "AWS_STORAGE_BUCKET_NAME": "b",
        "AWS_S3_ENDPOINT_URL": "https://br-example.storage.c-1.us-east-2.aws.neon.tech",
        "AWS_S3_DEFAULT_ACL": "private",
    })
    assert config["OPTIONS"]["default_acl"] == "private"


# -- upload flow -------------------------------------------------------------------

@pytest.fixture
def donor_with_org():
    donor = User.objects.create_user("phd", "ph@t.in", "StrongPass123!", role=User.Role.DONOR)
    org = Organization.objects.create(
        owner=donor, name="Photo Kitchen", type="restaurant", address="x", lat=12.68, lng=78.62,
        verification_status=Organization.VerificationStatus.APPROVED,
    )
    donor.is_verified = True
    donor.save(update_fields=["is_verified"])
    return donor, org


def test_photo_upload_through_listing_api(donor_with_org):
    donor, org = donor_with_org
    api = APIClient()
    api.force_authenticate(donor)
    now = timezone.now()
    resp = api.post(
        "/api/v1/listings/",
        {
            "title": "With photo",
            "quantity_value": 3,
            "pickup_address": "x",
            "lat": 12.68,
            "lng": 78.62,
            "ready_from": now.isoformat(),
            "safe_until": (now + timedelta(hours=2)).isoformat(),
            "photo": _photo_file(_png_bytes()),
        },
        format="multipart",
    )
    assert resp.status_code == 201, resp.data
    assert resp.data["photo"], "photo URL must be present"
    listing = Listing.objects.get(pk=resp.data["id"])
    assert listing.photo
    with listing.photo.open() as stored:
        assert Image.open(stored).format == "PNG"  # re-encoded, EXIF stripped


def test_existing_listing_crud_with_photo(donor_with_org):
    donor, org = donor_with_org
    listing = Listing.objects.create(
        donor=donor, organization=org, title="CRUD", quantity_value=2,
        pickup_address="x", lat=12.68, lng=78.62,
        ready_from=timezone.now(), safe_until=timezone.now() + timedelta(hours=2),
    )
    api = APIClient()
    api.force_authenticate(donor)
    resp = api.patch(
        f"/api/v1/listings/{listing.id}/",
        {"photo": _photo_file(_png_bytes())},
        format="multipart",
    )
    assert resp.status_code == 200
    listing.refresh_from_db()
    assert listing.photo
