"""Admin console API: user management for the React admin page."""

from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter
from rest_framework.response import Response

from events.publish import publish

from .models import User
from .permissions import IsAdmin
from .serializers import AdminUserSerializer


class AdminUserViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """GET /api/v1/admin/users/?role=&suspended=&search= — the console user table."""

    serializer_class = AdminUserSerializer
    permission_classes = [IsAdmin]
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ["role", "is_suspended", "is_verified"]
    search_fields = ["username", "email", "first_name", "last_name", "phone"]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return User.objects.all().order_by("-date_joined")

    @action(detail=True, methods=["post"], url_path="suspend")
    def suspend(self, request, pk=None):
        user = self.get_object()
        user.is_suspended = True
        user.save(update_fields=["is_suspended"])
        publish(
            "account.suspended",
            {"user_id": user.id},
            audience=f"user:{user.id}",
            notify_user_ids=[user.id],
            notification_type="account_suspended",
            message="Your account has been suspended. Contact support@foodbridge.example.",
        )
        return Response(AdminUserSerializer(user).data)

    @action(detail=True, methods=["post"], url_path="unsuspend")
    def unsuspend(self, request, pk=None):
        user = self.get_object()
        user.is_suspended = False
        user.save(update_fields=["is_suspended"])
        publish(
            "account.unsuspended",
            {"user_id": user.id},
            audience=f"user:{user.id}",
            notify_user_ids=[user.id],
            notification_type="account_suspended",
            message="Your account has been reinstated. Welcome back!",
        )
        return Response(AdminUserSerializer(user).data)
