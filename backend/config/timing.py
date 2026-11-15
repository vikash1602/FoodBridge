"""Request timing middleware: logs duration + DB query count per request.

Active when DEBUG=True (locally and in the e2e environment). Output lines look
like:

    TIMING 200 GET /api/v1/listings/ 41.2ms  3 queries

Used to build the before/after performance table in PROJECT_REPORT.md.
"""

import time

from django.conf import settings
from django.db import connection


class TimingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not settings.DEBUG:
            return self.get_response(request)

        force_debug_cursor = connection.force_debug_cursor
        connection.force_debug_cursor = True
        start = time.perf_counter()
        try:
            response = self.get_response(request)
        finally:
            duration_ms = (time.perf_counter() - start) * 1000
            queries = len(connection.queries)
            connection.force_debug_cursor = force_debug_cursor
        print(f"TIMING {response.status_code} {request.method} {request.get_full_path()} "
              f"{duration_ms:.1f}ms  {queries} queries")
        response["X-Query-Count"] = str(queries)
        response["X-Duration-Ms"] = f"{duration_ms:.1f}"
        return response
