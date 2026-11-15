"""API v1 routes."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from accounts.admin_views import AdminUserViewSet
from accounts.views import (
    AuthMeView,
    AuthRegisterView,
    LoginView,
    OrganizationViewSet,
    OTPRequestView,
    OTPStatusView,
    OTPVerifyView,
)
from claims.reports_views import ReportViewSet
from claims.views import ClaimViewSet, RatingViewSet
from config.public import PlatformConfigView
from events.views import SSEStreamView, StreamTicketView
from listings.views import ListingViewSet
from notifications.views import NotificationViewSet
from stats.views import StatsView

router = DefaultRouter()
router.register("organizations", OrganizationViewSet, basename="organizations")
router.register("listings", ListingViewSet, basename="listings")
router.register("claims", ClaimViewSet, basename="claims")
router.register("ratings", RatingViewSet, basename="ratings")
router.register("notifications", NotificationViewSet, basename="notifications")
router.register("reports", ReportViewSet, basename="reports")

# Admin console router (mounted under /api/v1/admin/).
admin_router = DefaultRouter()
admin_router.register("users", AdminUserViewSet, basename="admin-users")

auth_urls = [
    path("register/", AuthRegisterView.as_view(), name="auth-register"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("refresh/", TokenRefreshView.as_view(), name="auth-refresh"),
    path("me/", AuthMeView.as_view(), name="auth-me"),
    path("otp/request/", OTPRequestView.as_view(), name="otp-request"),
    path("otp/status/", OTPStatusView.as_view(), name="otp-status"),
    path("otp/verify/", OTPVerifyView.as_view(), name="otp-verify"),
]

urlpatterns = [
    path("auth/", include(auth_urls)),
    path("admin/", include(admin_router.urls)),
    path("", include(router.urls)),
    path("config/", PlatformConfigView.as_view(), name="platform-config"),
    path("stats/", StatsView.as_view(), name="stats"),
    path("stream/", SSEStreamView.as_view(), name="sse-stream"),
    path("stream/ticket/", StreamTicketView.as_view(), name="stream-ticket"),
]
