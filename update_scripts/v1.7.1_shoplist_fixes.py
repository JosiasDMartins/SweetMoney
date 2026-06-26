#!/usr/bin/env python3
"""
Update script for SweetMoney v1.7.1 - Shopping Lists fixes & polish

This script:
1. Runs Django migrations (safety net; v1.7.1 has no new models, but this ensures
   any pending migrations are applied before downstream code runs)
2. Compiles translation message catalogs (.mo) for any updated strings
3. Updates SystemVersion to 1.7.1

v1.7.1 is a bugfix/polish release for the Shopping Lists feature (frontend + a
view-computed realized total). It introduces NO schema/model changes, so this
script performs no data migration.

Execution: This script runs during the update process via views_updater.py
Note: While the updater also runs migrations before scripts, this script
      explicitly calls migrate as a safety net.
"""

import os
import sys
import django

# Setup Django environment
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wimm_project.settings')
django.setup()

from django.core.management import call_command
from finances.models import SystemVersion


def log(message):
    """Print log message with prefix"""
    print(f"[Update v1.7.1] {message}")


def run():
    """
    Main update process - called by the update manager.

    Returns:
        dict: {'success': bool, 'message': str}
    """
    log("Starting update to v1.7.1")

    try:
        # =====================================================
        # 1. Run migrations (safety net)
        # =====================================================
        log("Running Django migrations...")
        call_command('migrate', verbosity=1)
        log("Migrations applied successfully")

        # =====================================================
        # 2. Compile translation catalogs for any updated strings
        # =====================================================
        log("Compiling translation message catalogs...")
        try:
            call_command('compilemessages', verbosity=0)
            log("Translation catalogs compiled")
        except Exception as i18n_err:
            # compilemessages requires GNU gettext (msgfmt); not fatal if absent
            log(f"NOTE: Skipped compilemessages ({i18n_err}). "
                f"Ensure msgfmt is available if translations are stale.")

        # =====================================================
        # 3. Update system version (REQUIRED)
        # =====================================================
        version, created = SystemVersion.objects.get_or_create(id=1)
        version.version = '1.7.1'
        version.save()

        log("System version updated successfully!")
        log("=" * 70)
        log("Update to v1.7.1 completed successfully!")
        log("")
        log("CHANGES IN THIS VERSION (Shopping Lists polish, Flow Group parity):")
        log("")
        log("1. Amount field behavior (edit page):")
        log("   - Locale money mask while typing + cursor positioned to end on first focus")
        log("   - Calculator modal on operator keys (shared utils.js / calculator.js)")
        log("   - Server-rendered amounts reformatted to the family locale on load")
        log("")
        log("2. Mobile swipe (edit page):")
        log("   - Edit now centers the row and enters edit mode (no more")
        log("     'window.toggleEditMode is not defined' error)")
        log("   - Swipe right while editing cancels the edit")
        log("   - Tap an item row to toggle its realized (checked-off) state")
        log("")
        log("3. Mobile swipe (dashboard):")
        log("   - No involuntary left-swipe when tapping a list to open it")
        log("   - Hidden action buttons no longer peek past the page padding")
        log("")
        log("4. Totals row (edit page): shows Total and Realized sums,")
        log("   recomputed live after every item change (matches Flow Group).")
        log("")
        log("No database schema changes in this version.")
        log("=" * 70)

        return {
            'success': True,
            'message': 'Successfully updated to v1.7.1'
        }

    except Exception as e:
        error_msg = f"Error updating: {str(e)}"
        log(error_msg)
        import traceback
        traceback.print_exc()

        return {
            'success': False,
            'message': error_msg
        }


def main():
    """Legacy main function for standalone execution"""
    result = run()
    return result['success']


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
