"""Default (media) storage selection — pure function, no import side effects.

Local FileSystemStorage in development; S3 via django-storages when a bucket is
configured. Static files always stay on WhiteNoise (see settings.STORAGES).

Two deployment shapes are supported:

- **AWS S3** (no ``AWS_S3_ENDPOINT_URL``): virtual-hosted addressing, objects
  created with ``x-amz-acl: private``.
- **S3-compatible stores** such as **Neon Object Storage** (endpoint URL set):
  these require *path-style* addressing and return ``501`` for ACL writes on
  the wire (PutObjectAcl/PutBucketPolicy). Their buckets are private by
  default (public access is blocked at the bucket level), so no ACL parameter
  is sent. Presigned GET/PUT (SigV4) are supported and are how the private
  photos are served (``querystring_auth`` defaults to true).
"""

import os


def default_storage_config(env: dict | None = None) -> dict:
    env = env if env is not None else os.environ
    if not env.get("AWS_STORAGE_BUCKET_NAME"):
        return {"BACKEND": "django.core.files.storage.FileSystemStorage"}
    endpoint_url = env.get("AWS_S3_ENDPOINT_URL", "") or None
    options: dict = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "access_key": env.get("AWS_ACCESS_KEY_ID", ""),
        "secret_key": env.get("AWS_SECRET_ACCESS_KEY", ""),
        "bucket_name": env.get("AWS_STORAGE_BUCKET_NAME", ""),
        "region_name": env.get("AWS_S3_REGION_NAME", ""),
        "endpoint_url": endpoint_url,
        "custom_domain": env.get("AWS_S3_CUSTOM_DOMAIN", "") or None,
        "querystring_auth": env.get("AWS_S3_QUERYSTRING_AUTH", "true").lower() in ("1", "true", "yes"),
        "default_acl": env.get("AWS_S3_DEFAULT_ACL", "") or ("private" if endpoint_url is None else None),
        "file_overwrite": False,
    }
    # S3-compatible stores (Neon Object Storage, MinIO, …): path-style only.
    addressing_style = env.get("AWS_S3_ADDRESSING_STYLE", "") or ("path" if endpoint_url else "")
    if addressing_style:
        options["addressing_style"] = addressing_style
    return {"BACKEND": "storages.backends.s3.S3Storage", "OPTIONS": options}
