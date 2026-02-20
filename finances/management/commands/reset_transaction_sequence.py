"""
Django management command to reset the transaction ID sequence.

This command resets the PostgreSQL sequence for the Transaction model's
primary key to the maximum ID + 1. This fixes duplicate key errors that
can occur when sequences become out of sync.

Usage:
    python manage.py reset_transaction_sequence

This is particularly useful after manual data manipulation or when
importing data where the sequence wasn't properly updated.
"""
from django.core.management.base import BaseCommand
from django.db import connection


class Command(BaseCommand):
    help = 'Reset Transaction ID sequence to fix duplicate key errors'

    def handle(self, *args, **options):
        """Execute the sequence reset."""
        self.stdout.write("[SEQUENCE] Resetting Transaction ID sequence...")

        try:
            with connection.cursor() as cursor:
                # Get the current maximum ID
                cursor.execute("SELECT COALESCE(MAX(id), 0) FROM finances_transaction")
                max_id = cursor.fetchone()[0]

                # Set the sequence to max_id + 1
                new_seq_value = max_id + 1
                cursor.execute(
                    "SELECT setval('finances_transaction_id_seq', %s, false)",
                    [new_seq_value]
                )

                # Verify the new sequence value
                cursor.execute("SELECT nextval('finances_transaction_id_seq')")
                next_val = cursor.fetchone()[0]

                self.stdout.write(
                    self.style.SUCCESS(
                        f"[OK] Sequence reset. Max ID was {max_id}, "
                        f"sequence set to {new_seq_value}, next value will be {next_val}"
                    )
                )

        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f"[ERROR] Failed to reset sequence: {e}")
            )
            raise
