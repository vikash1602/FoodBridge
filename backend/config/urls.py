"""Root URL configuration. Everything lives under /api/v1/ (see config.api_urls)."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from config.cron_views import CronExpireListingsView, CronProcessOutboxView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("config.api_urls")),
    path("api/v1/cron/expire-listings/", CronExpireListingsView.as_view()),
    path("api/v1/cron/process-email-outbox/", CronProcessOutboxView.as_view()),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="api-docs",
    ),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
