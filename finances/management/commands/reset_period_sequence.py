"""
Django management command to reset the Period ID sequence.

This command resets the PostgreSQL sequence for the Period model's
primary key to the maximum ID + 1. This fixes duplicate key errors that
can occur when sequences become out of sync.

Usage:
    python manage.py reset_period_sequence

This is particularly useful after manual data manipulation or when
importing data where the sequence wasn't properly updated.
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Reset Period ID sequence to fix duplicate key errors'

    def handle(self, *args, **options):
        """Execute the sequence reset."""
        self.stdout.write("[SEQUENCE] Resetting Period ID sequence...")

        try:
            from finances.utils.db_sequence_utils import reset_sequence_for_table
            result = reset_sequence_for_table('finances_period')

            if result['success']:
                self.stdout.write(
                    self.style.SUCCESS(
                        f"[OK] Sequence reset. Old value: {result['old_value']}, "
                        f"New value: {result['new_value']}"
                    )
                )
            else:
                self.stdout.write(
                    self.style.ERROR(f"[ERROR] Failed to reset sequence: {result.get('error')}")
                )
                raise Exception(result.get('error'))

        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f"[ERROR] Failed to reset sequence: {e}")
            )
            raise
