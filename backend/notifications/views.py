from django.db.models import Count, Q
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Notification
from .serializers import NotificationSerializer


class NotificationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """GET /notifications/?unread=true and POST /notifications/{id}/read/, /notifications/read-all/."""

    serializer_class = NotificationSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = Notification.objects.filter(user=self.request.user).select_related("listing")
        if self.request.query_params.get("unread") in ("true", "1"):
            qs = qs.filter(is_read=False)
        return qs

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        serializer = self.get_serializer(page, many=True)
        unread = Notification.objects.filter(user=request.user, is_read=False).count()
        data = self.get_paginated_response(serializer.data).data
        data["unread_count"] = unread
        return Response(data)

    @action(detail=True, methods=["post"], url_path="read")
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        notification.is_read = True
        notification.save(update_fields=["is_read"])
        return Response(self.get_serializer(notification).data)

    @action(detail=False, methods=["post"], url_path="read-all")
    def mark_all_read(self, request):
        updated = Notification.objects.filter(user=request.user, is_read=False).update(is_read=True)
        return Response({"marked_read": updated})
