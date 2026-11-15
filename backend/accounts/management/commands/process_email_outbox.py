
"""Retry pending/failed emails in the delivery outbox.

Cron (every minute or five):
    * * * * * python manage.py process_email_outbox
"""

import time

from django.core.management.base import BaseCommand
from django.utils import timezone

from accounts import otp


class Command(BaseCommand):
    help = "Deliver pending and retry failed emails from the durable outbox."

    def add_arguments(self, parser):
        parser.add_argument(
            "--batch",
            type=int,
            default=25,
            help="Max rows per run.",
        )
        parser.add_argument(
            "--loop",
            action="store_true",
            help="Keep running continuously (local development outbox worker).",
        )
        parser.add_argument(
            "--interval",
            type=int,
            default=30,
            help="Seconds between runs when --loop is set.",
        )

    def handle(self, *args, **options):
        if not options["loop"]:
            processed = otp.process_pending_emails(
                batch_size=options["batch"]
            )
            self.stdout.write(
                self.style.SUCCESS(
                    f"Outbox: {processed} row(s) changed state."
                )
            )
            return

        if options["interval"] < 1:
            raise ValueError("--interval must be at least 1 second.")

        self.stdout.write(
            self.style.SUCCESS(
                f"Outbox worker started "
                f"(every {options['interval']}s). Press Ctrl+C to stop."
            )
        )
        # NOTE: do NOT pass flush=True to stdout.write -- OutputWrapper does
        # not accept it (TypeError). Run the server with python -u (the start
        # script does) if unbuffered logging is needed.

        while True:
            try:
                processed = otp.process_pending_emails(
                    batch_size=options["batch"]
                )

                if processed:
                    timestamp = timezone.localtime().strftime("%H:%M:%S")
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"[{timestamp}] Outbox: "
                            f"{processed} row(s) changed state."
                        )
                    )

            except Exception as exc:
                timestamp = timezone.localtime().strftime("%H:%M:%S")
                self.stderr.write(
                    f"[{timestamp}] outbox loop error: {exc}"
                )

            time.sleep(options["interval"])
