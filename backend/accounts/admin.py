from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Organization, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("username", "email", "role", "is_verified", "trust_score", "is_suspended", "is_active")
    list_filter = ("role", "is_verified", "is_suspended", "is_active")
    search_fields = ("username", "email", "first_name", "last_name", "phone")
    fieldsets = BaseUserAdmin.fieldsets + (
        (
            "FoodBridge",
            {
                "fields": (
                    "role",
                    "phone",
                    "is_verified",
                    "trust_score",
                    "base_lat",
                    "base_lng",
                    "notify_radius_km",
                    "is_suspended",
                )
            },
        ),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (("FoodBridge", {"fields": ("role", "phone")}),)


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ("name", "type", "owner", "verification_status", "created_at")
    list_filter = ("verification_status", "type")
    search_fields = ("name", "address", "owner__email")
    raw_id_fields = ("owner", "reviewed_by")
