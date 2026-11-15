"""Role permission classes shared across apps."""

from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsAdmin(BasePermission):
    message = "Admin access required."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_admin_role)


class IsDonor(BasePermission):
    message = "Only donors can perform this action."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_donor)


class IsVolunteer(BasePermission):
    message = "Only volunteers can perform this action."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_volunteer)


class IsVerifiedDonor(BasePermission):
    """Donor whose organization has been approved by an admin."""

    message = "Your organization must be verified before you can post food."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_donor and user.has_approved_organization)


class NotSuspended(BasePermission):
    """Mixed into the others: suspended users keep read access only."""

    message = "Your account is suspended. Contact support@foodbridge.example."

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return True
        return request.method in SAFE_METHODS or not user.is_suspended


class ReadOnly(BasePermission):
    def has_permission(self, request, view) -> bool:
        return request.method in SAFE_METHODS


class IsAuthenticatedAndNotSuspended(BasePermission):
    """Any logged-in, non-suspended user."""

    message = "Your account is suspended."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and not user.is_suspended)
