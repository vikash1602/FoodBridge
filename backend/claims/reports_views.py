"""Report views: anyone can file; admins review and resolve."""

from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from accounts.models import User
from accounts.permissions import IsAdmin, IsAuthenticatedAndNotSuspended
from accounts.trust import adjust_trust
from events.publish import publish
from listings.models import Listing

from .models import Report
from .serializers import ReportCreateSerializer, ReportSerializer


class ReportViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet
):
    """File and review reports. `?status=open` is the admin review queue."""

    queryset = Report.objects.select_related("reporter", "listing", "reported_user", "resolved_by")
    serializer_class = ReportSerializer
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["status"]

    def get_permissions(self):
        if self.action == "create":
            permission_classes = [IsAuthenticated, IsAuthenticatedAndNotSuspended]
        elif self.action == "resolve":
            permission_classes = [IsAdmin]
        else:
            permission_classes = [IsAuthenticated]
        return [p() for p in permission_classes]

    def get_throttles(self):
        if self.action == "create":
            self.throttle_classes = [ScopedRateThrottle]
            self.throttle_scope = "report"
        return super().get_throttles()

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.is_admin_role:
            return qs
        return qs.filter(reporter=user)

    def create(self, request, *args, **kwargs):
        serializer = ReportCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        report = serializer.save(reporter=request.user)
        publish(
            "report.filed",
            {"report_id": report.id, "reason": report.reason},
            audience=f"role:admin",
        )
        return Response(ReportSerializer(report, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="resolve")
    def resolve(self, request, pk=None):
        """Admin closes a report. `upheld: true` penalizes the offender's trust."""
        report = self.get_object()
        upheld = str(request.data.get("upheld", "false")).lower() in ("1", "true", "yes")
        note = str(request.data.get("admin_note", "") or "")
        offender = report.reported_user or (report.listing.donor if report.listing else None)

        with transaction.atomic():
            report.status = Report.Status.RESOLVED
            report.admin_note = note
            report.resolved_by = request.user
            report.resolved_at = timezone.now()
            report.save()
            if upheld and offender is not None:
                adjust_trust(offender, "report_upheld", reference_id=report.id)

        if offender is not None:
            publish(
                "report.resolved",
                {"report_id": report.id, "upheld": upheld},
                audience=f"user:{offender.id}",
                notify_user_ids=[offender.id],
                notification_type="report_resolved",
                message=f"A report against you was reviewed — {'action taken' if upheld else 'no action'}.",
            )
        return Response(ReportSerializer(report, context={"request": request}).data)
