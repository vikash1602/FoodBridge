"""Manual email smoke test — sends one controlled OTP-style email.

Server-side tooling only (never exposed as a public endpoint):

    python manage.py send_test_email --to you@gmail.com
    python manage.py send_test_email --to you@gmail.com --real   # skip console, force provider

With no RESEND_API_KEY configured (or without --real while DEBUG) the mail is
printed to the console by the console provider and marked accepted.
"""

from django.core.management.base import BaseCommand, CommandError

from accounts.models import EmailOutbox
from accounts.otp import process_outbox_email


class Command(BaseCommand):
    help = "Send one controlled test email through the delivery outbox."

    def add_arguments(self, parser):
        parser.add_argument("--to", required=True, help="Recipient email address.")
        parser.add_argument("--real", action="store_true", help="Force the provider path even in DEBUG.")
        parser.add_argument("--wait", action="store_true", help="Deliver synchronously and print the outcome.")

    def handle(self, *args, **options):
        to = options["to"].strip()
        if not to or "@" not in to:
            raise CommandError("A valid --to address is required.")

        row = EmailOutbox.objects.create(
            to_email=to,
            subject="FoodBridge email smoke test",
            body="This is a controlled FoodBridge delivery smoke test. No action is needed.",
            purpose="smoke_test",
        )
        self.stdout.write(f"Outbox row #{row.pk} created (pending).")
        if options["wait"] or options["real"]:
            process_outbox_email(row.pk)
            row.refresh_from_db()
            self.stdout.write(
                f"Outcome: status={row.status} provider={row.provider} "
                f"message_id={row.provider_message_id or '-'} "
                f"failure={row.failure_category or '-'} error={row.last_error or '-'}"
            )
            if row.status != EmailOutbox.Status.ACCEPTED:
                raise CommandError("Delivery did not reach the provider — see the failure category above.")
            self.stdout.write(self.style.SUCCESS("Provider accepted the message."))
        else:
            from accounts.otp import process_outbox_email as _deliver_async

            _deliver_async(row.pk)
            self.stdout.write(self.style.SUCCESS("Queued for background delivery (run with --wait to see the outcome)."))
