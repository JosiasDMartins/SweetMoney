#!/usr/bin/env python3
"""
Update script for SweetMoney v1.6.2 - Timezone Support

This script:
1. Runs Django migrations to add the timezone column (migration 0036)
2. Ensures all existing users have timezone set to UTC (default)
3. Updates SystemVersion to 1.6.2

Execution: This script runs during the update process via views_updater.py
Note: While the updater also runs migrations before scripts, this script
      explicitly calls migrate as a safety net to ensure the timezone
      column exists before accessing the CustomUser model.
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
    print(f"[Update v1.6.2] {message}")


def run():
    """
    Main update process - called by the update manager.

    Returns:
        dict: {'success': bool, 'message': str}
    """
    log("Starting update to v1.6.2")

    try:
        # Run migrations to ensure the timezone column exists
        log("Running Django migrations...")
        call_command('migrate', verbosity=1)
        log("Migrations applied successfully")

        from django.contrib.auth import get_user_model
        User = get_user_model()

        # Ensure all users have timezone set (migration default is UTC,
        # but explicitly set for safety / idempotency)
        users_no_tz = User.objects.filter(timezone__isnull=True) | User.objects.filter(timezone='')
        updated = users_no_tz.update(timezone='UTC')
        if updated:
            log(f"Set timezone to UTC for {updated} users without timezone")
        else:
            log("All users already have a timezone configured")

        # Update system version
        version, created = SystemVersion.objects.get_or_create(id=1)
        version.version = '1.6.2'
        version.save()

        log("System version updated successfully!")
        log("=" * 70)
        log("Update to v1.6.2 completed successfully!")
        log("")
        log("CHANGES IN THIS VERSION:")
        log("")
        log("1. Timezone Support:")
        log("   - Users can set their preferred timezone in Profile")
        log("   - Dates display correctly regardless of user location")
        log("   - Eliminates off-by-one date bugs for users in different timezones")
        log("   - Server stores dates as UTC; conversion happens at display time")
        log("")
        log("2. Mobile Drag and Drop:")
        log("   - Fixed drag and drop bug on mobile devices")
        log("")
        log("3. Database Export/Import:")
        log("   - Fixed database export/import functionality")
        log("")
        log("4. i18n:")
        log("   - Improved internationalization for numeric fields")
        log("=" * 70)

        return {
            'success': True,
            'message': 'Successfully updated to v1.6.2'
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
