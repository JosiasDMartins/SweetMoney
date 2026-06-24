#!/usr/bin/env python3
"""
Update script for SweetMoney v1.7.0 - Shopping Lists

This script:
1. Runs Django migrations to create the ShopList and ShopListItem tables (migration 0037)
2. Compiles translation message catalogs (.mo) for new Shopping Lists strings
3. Updates SystemVersion to 1.7.0

Execution: This script runs during the update process via views_updater.py
Note: While the updater also runs migrations before scripts, this script
      explicitly calls migrate as a safety net to ensure the ShopList /
      ShopListItem tables exist before any downstream code accesses them.
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
    print(f"[Update v1.7.0] {message}")


def run():
    """
    Main update process - called by the update manager.

    Returns:
        dict: {'success': bool, 'message': str}
    """
    log("Starting update to v1.7.0")

    try:
        # =====================================================
        # 1. Run migrations to create ShopList / ShopListItem
        # =====================================================
        log("Running Django migrations...")
        call_command('migrate', verbosity=1)
        log("Migrations applied successfully")

        # Verify the new tables were created (idempotent safety check)
        try:
            from finances.models import ShopList, ShopListItem
            # Touch the models to confirm they are queryable
            ShopList.objects.count()
            ShopListItem.objects.count()
            log("ShopList and ShopListItem tables verified")
        except Exception as verify_err:
            log(f"WARNING: Could not verify ShopList tables: {verify_err}")

        # =====================================================
        # 2. Compile translation catalogs for new strings
        # =====================================================
        log("Compiling translation message catalogs...")
        try:
            call_command('compilemessages', verbosity=0)
            log("Translation catalogs compiled")
        except Exception as i18n_err:
            # compilemessages requires GNU gettext (msgfmt); not fatal if absent
            log(f"NOTE: Skipped compilemessages ({i18n_err}). "
                f"Ensure msgfmt is available if pt_BR translations are stale.")

        # =====================================================
        # 3. Update system version (REQUIRED)
        # =====================================================
        version, created = SystemVersion.objects.get_or_create(id=1)
        version.version = '1.7.0'
        version.save()

        log("System version updated successfully!")
        log("=" * 70)
        log("Update to v1.7.0 completed successfully!")
        log("")
        log("CHANGES IN THIS VERSION:")
        log("")
        log("1. Shopping Lists:")
        log("   - New ShopList and ShopListItem models (migration 0037)")
        log("   - Collaborative lists with share/assign support")
        log("   - Role-based access (ADMIN/PARENT see all; CHILD sees assigned)")
        log("   - Items with amount, link, and realized flag")
        log("   - Drag-and-drop reorder + mobile swipe actions")
        log("   - Clone with draft mode (unsaved clones are auto-discarded)")
        log("   - GenericModal for all confirmations (CSP compliant)")
        log("")
        log("2. UX Improvements:")
        log("   - Back button warns about unsaved changes")
        log("   - Desktop card hover actions (delayed, bottom-right)")
        log("   - Mobile delete/clone with dynamic DOM removal")
        log("=" * 70)

        return {
            'success': True,
            'message': 'Successfully updated to v1.7.0'
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
