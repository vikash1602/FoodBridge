"""Append-only event log backing the SSE stream.

Instead of Redis pub/sub, every domain event is inserted here once; SSE
connections then tail the table (`id > last_seen`), which also gives us
free replay on reconnect via the Last-Event-ID header.
"""

from django.db import models


class Event(models.Model):
    id = models.BigAutoField(primary_key=True)
    type = models.CharField(max_length=50, db_index=True)
    payload = models.JSONField(default=dict, blank=True)
    # 'all' | 'user:<id>' | 'role:<donor|volunteer|admin>'
    audience = models.CharField(max_length=60, default="all", db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"#{self.id} {self.type} -> {self.audience}"

    @staticmethod
    def audience_for_user(user_id, role) -> tuple[str, str]:
        return (f"user:{user_id}", f"role:{role}")
