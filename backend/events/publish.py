"""One-call publishing: Event row (SSE) + Notification row (in-app bell)."""

from notifications.models import Notification
from notifications.selectors import user_ids_for_audience


def publish(
    event_type: str,
    payload: dict,
    audience: str = "all",
    notify_user_ids: list | None = None,
    notification_type: str | None = None,
    listing=None,
    message: str | None = None,
) -> None:
    """Insert the SSE event and (optionally) per-user in-app notifications.

    `notify_user_ids` defaults to the audience a user ids when audience is 'user:<id>'.
    `message`/`notification_type` must be provided together to also create Notification rows.
    """
    from .models import Event

    Event.objects.create(type=event_type, payload=payload, audience=audience)

    if notification_type and message is not None:
        if notify_user_ids is None:
            notify_user_ids = user_ids_for_audience(audience)
        if notify_user_ids:
            Notification.objects.bulk_create(
                [
                    Notification(
                        user_id=uid,
                        type=notification_type,
                        message=message,
                        listing=listing,
                    )
                    for uid in notify_user_ids
                ]
            )
