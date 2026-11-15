"""Auth + organization views."""

from django.db import transaction
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import generics, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.filters import SearchFilter
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Organization, User
from .permissions import IsAdmin, IsDonor, NotSuspended
from .serializers import (
    OrganizationReviewSerializer,
    OrganizationSerializer,
    RegisterSerializer,
    UserSerializer,
)


class LoginSerializer(TokenObtainPairSerializer):
    """Email-based login. Adds the user object to the response so the SPA can hydrate instantly."""

    email = serializers.EmailField(write_only=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # The parent injects `username` as required; clients authenticate by email.
        self.fields["username"].required = False
        self.fields["username"].default = ""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["email"] = user.email
        return token

    def validate(self, attrs):
        email = (attrs.pop("email", "") or "").strip()
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            raise AuthenticationFailed(
                self.error_messages["no_active_account"], "no_active_account"
            )
        attrs["username"] = user.username
        data = super().validate(attrs)
        data["user"] = UserSerializer(user, context=self.context).data
        return data


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class AuthRegisterView(generics.CreateAPIView):
    """POST /api/v1/auth/register/ — create a donor or volunteer account."""

    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class AuthMeView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/v1/auth/me/ — profile & preference updates (base location, radius)."""

    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user


class OTPRequestView(generics.GenericAPIView):
    """POST /api/v1/auth/otp/request/ {"email": …} — returns in <300 ms.

    The code is hashed and stored, and a durable EmailOutbox row is created
    (status=pending) that a background thread delivers via the configured
    provider. DEBUG responses carry `dev_code` so local testing is instant.
    """

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        from . import otp

        email = str(request.data.get("email", "")).strip()
        if not email:
            return Response(
                {"error": {"code": "validation_error", "message": "Email is required.", "details": {}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        ok, cooldown, dev_code = otp.request_otp(email)
        if not ok:
            return Response(
                {"error": {"code": "throttled", "message": f"Please wait {cooldown}s before requesting another code.", "details": {"retry_after": cooldown}}},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
                headers={"Retry-After": str(cooldown)},
            )
        return Response(
            {
                "sent": True,
                "cooldown": cooldown,
                "expires_in": otp.OTP_TTL_SECONDS,
                "dev_code": dev_code,
                # Delivery is async: "pending" here means queued, not delivered.
                "delivery": otp.delivery_status_for(email),
            },
            status=status.HTTP_200_OK,
        )


class OTPStatusView(generics.GenericAPIView):
    """GET /api/v1/auth/otp/status/?email=… — latest delivery outcome.

    Returns only the delivery state (pending / accepted / failed + category).
    Never includes a code. Used by the login screen to show honest feedback
    ("accepted for delivery" vs "delivery failed — retry").
    """

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def get(self, request):
        from . import otp

        email = request.query_params.get("email", "").strip()
        if not email:
            return Response(
                {"error": {"code": "validation_error", "message": "Email is required.", "details": {}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"delivery": otp.delivery_status_for(email)})


class OTPVerifyView(generics.GenericAPIView):
    """POST /api/v1/auth/otp/verify/ {"email", "code"} → JWT pair + user."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        from . import otp
        from .serializers import UserSerializer

        email = str(request.data.get("email", "")).strip()
        code = str(request.data.get("code", "")).strip()
        ok, error = otp.verify_otp(email, code)
        if not ok:
            return Response(
                {"error": {"code": error, "message": {
                    "expired": "That code has expired — request a new one.",
                    "invalid": "That code isn't right. Check the 6 digits.",
                    "too_many_attempts": "Too many attempts. Request a new code.",
                }[error], "details": {}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user is None:
            return Response(
                {"error": {"code": "not_found", "message": "No FoodBridge account uses that email. Create one first.", "details": {}}},
                status=status.HTTP_404_NOT_FOUND,
            )
        refresh = RefreshToken.for_user(user)
        refresh["role"] = user.role
        refresh["email"] = user.email
        return Response(
            {
                "refresh": str(refresh),
                "access": str(refresh.access_token),
                "user": UserSerializer(user, context={"request": request}).data,
            }
        )


class OrganizationViewSet(viewsets.ModelViewSet):
    """Donor/NGO organizations and the admin verification queue."""

    serializer_class = OrganizationSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ["verification_status", "type"]
    search_fields = ["name", "address"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        if self.action == "create":
            permission_classes = [IsAuthenticated, NotSuspended, IsDonor]
        elif self.action in ("approve", "reject", "queue"):
            permission_classes = [IsAdmin]
        else:
            permission_classes = [IsAuthenticated]
        return [p() for p in permission_classes]

    def get_queryset(self):
        user = self.request.user
        if user.is_admin_role:
            return Organization.objects.select_related("owner").all()
        return Organization.objects.select_related("owner").filter(owner=user)

    def perform_create(self, serializer):
        org = serializer.save()
        # A fresh submission resets the owner's verified flag until re-approved.
        org.owner.is_verified = False
        org.owner.save(update_fields=["is_verified"])

    # -- admin verification -------------------------------------------------

    def _review(self, request, pk, approved: bool):
        org = self.get_object()
        note = ""
        serializer = OrganizationReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        note = serializer.validated_data.get("note", "")
        with transaction.atomic():
            org.verification_status = (
                Organization.VerificationStatus.APPROVED if approved else Organization.VerificationStatus.REJECTED
            )
            org.verification_note = note
            org.reviewed_by = request.user
            org.save(update_fields=["verification_status", "verification_note", "reviewed_by", "updated_at"])
            org.owner.is_verified = approved
            org.owner.save(update_fields=["is_verified"])
        return Response(self.get_serializer(org).data)

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None):
        return self._review(request, pk, approved=True)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, pk=None):
        return self._review(request, pk, approved=False)
