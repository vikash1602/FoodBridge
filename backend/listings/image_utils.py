"""Image upload validation + EXIF stripping.

Food listing and delivery photos must be:
- actual images (extension AND decoded content),
- under settings.MAX_UPLOAD_MB,
- free of EXIF metadata (phones embed GPS coordinates — a privacy leak),
- re-encoded as JPEG/PNG so random payloads can't masquerade as images.
"""

from io import BytesIO

from django.conf import settings
from django.core.exceptions import ValidationError
from PIL import Image, ImageOps

ALLOWED_FORMATS = {"JPEG", "PNG"}


def max_upload_bytes() -> int:
    return int(getattr(settings, "MAX_UPLOAD_MB", 5)) * 1024 * 1024


def validate_and_strip_exif(django_file) -> BytesIO:
    """Returns a clean, re-encoded image buffer; raises ValidationError otherwise.

    Re-encoding through Pillow drops EXIF (incl. GPS) and defeats polyglot
    files that rely on trailing data.
    """
    size = 0
    chunks = []
    for chunk in django_file.chunks():
        size += len(chunk)
        if size > max_upload_bytes():
            raise ValidationError(f"Image exceeds the {getattr(settings, 'MAX_UPLOAD_MB', 5)} MB limit.")
        chunks.append(chunk)

    try:
        image = Image.open(BytesIO(b"".join(chunks)))
    except Exception as exc:  # noqa: BLE001 — any decode failure is a rejection
        raise ValidationError("That file is not a valid image.") from exc

    # Format check BEFORE any transform — copies lose the format attribute.
    if image.format not in ALLOWED_FORMATS:
        raise ValidationError("Only JPEG and PNG images are accepted.")

    # Normalize orientation (phone photos); EXIF (incl. GPS) is dropped by the
    # re-encode below. Tolerate odd EXIF payloads.
    try:
        if image.getexif():
            transposed = ImageOps.exif_transpose(image)
            if transposed is not None:
                image = transposed
    except Exception:  # noqa: BLE001 — orientation is best-effort
        pass

    clean = Image.new(image.mode, image.size)  # new canvas → EXIF dropped
    clean.putdata(list(image.getdata()))

    buffer = BytesIO()
    if image.format == "PNG":
        clean.save(buffer, format="PNG")
        content_type = "image/png"
        extension = "png"
    else:
        clean.convert("RGB").save(buffer, format="JPEG", quality=88)
        content_type = "image/jpeg"
        extension = "jpg"
    buffer.seek(0)
    django_file.seek(0)
    buffer.content_type = content_type  # type: ignore[attr-defined]
    buffer.extension = extension  # type: ignore[attr-defined]
    return buffer
