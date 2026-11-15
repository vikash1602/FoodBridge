"""Small query helpers for the notifications app."""


def user_ids_for_audience(audience: str) -> list[int]:
    """Resolve an Event audience string to user ids for notification fan-out."""
    from accounts.models import User

    if audience.startswith("user:"):
        try:
            return [int(audience.split(":", 1)[1])]
        except ValueError:
            return []
    if audience.startswith("role:"):
        role = audience.split(":", 1)[1]
        return list(User.objects.filter(role=role, is_active=True).values_list("id", flat=True))
    return list(User.objects.filter(is_active=True).values_list("id", flat=True))
