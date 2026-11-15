"""Image validation tests: EXIF stripping, size cap, format checks."""

from io import BytesIO

import pytest
from django.core.exceptions import ValidationError
from PIL import Image

from listings.image_utils import validate_and_strip_exif


def _jpeg_bytes(with_exif: bool = False) -> bytes:
    buffer = BytesIO()
    image = Image.new("RGB", (10, 10), color=(120, 30, 40))
    if with_exif:
        exif = image.getexif()
        exif[0x010F] = "TestPhone with embedded metadata"  # Model tag — EXIF present
        image.save(buffer, format="JPEG", exif=exif.tobytes())
    else:
        image.save(buffer, format="JPEG")
    return buffer.getvalue()


class _FakeFile:
    def __init__(self, data: bytes, name: str = "photo.jpg"):
        import io

        self.file = io.BytesIO(data)
        self.name = name
        self._data = data

    def chunks(self):
        yield self._data

    def seek(self, *args):
        self.file.seek(*args)


def test_valid_jpeg_passes_and_strips_exif():
    cleaned = validate_and_strip_exif(_FakeFile(_jpeg_bytes(with_exif=True)))
    reloaded = Image.open(cleaned)
    assert reloaded.format == "JPEG"
    # EXIF (and its GPS payload) must be gone after re-encode.
    assert not reloaded.getexif()


def test_oversized_image_rejected(settings):
    settings.MAX_UPLOAD_MB = 1
    big = Image.new("RGB", (40, 40), color=(255, 0, 0))
    buffer = BytesIO()
    big.save(buffer, format="JPEG", quality=100)
    # Simulate a declared size over the cap by wrapping chunks with padding:
    class Padded(_FakeFile):
        def chunks(self):
            yield self._data
            yield b"x" * (2 * 1024 * 1024)

    with pytest.raises(ValidationError):
        validate_and_strip_exif(Padded(buffer.getvalue()))


def test_non_image_rejected():
    with pytest.raises(ValidationError):
        validate_and_strip_exif(_FakeFile(b"definitely not an image", name="x.jpg"))


def test_wrong_format_rejected():
    with pytest.raises(ValidationError):
        validate_and_strip_exif(_FakeFile(b"GIF89a" + b"0" * 64, name="x.gif"))


def test_png_passes():
    buffer = BytesIO()
    Image.new("RGB", (8, 8)).save(buffer, format="PNG")
    cleaned = validate_and_strip_exif(_FakeFile(buffer.getvalue(), name="x.png"))
    assert Image.open(cleaned).format == "PNG"
