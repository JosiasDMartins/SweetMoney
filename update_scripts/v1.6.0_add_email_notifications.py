#!/usr/bin/env python3
"""
Update script for SweetMoney v1.6.0-beta - Email Notifications

This script:
1. Updates SystemVersion to 1.6.0-beta
2. Ensures all existing users have email notifications disabled by default

Execution: This script runs during the update process via update_manager.py
Note: Database migrations (makemigrations + migrate) are run automatically
      by the updater BEFORE this script executes.
"""

import os
import sys
import django

# Setup Django environment
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wimm_project.settings')
django.setup()

from finances.models import SystemVersion


def log(message):
    """Print log message with prefix"""
    print(f"[Update v1.6.0-beta] {message}")


def run():
    """
    Main update process - called by the update manager.

    Returns:
        dict: {'success': bool, 'message': str}
    """
    log("Starting update to v1.6.0-beta")

    try:
        from django.contrib.auth import get_user_model
        User = get_user_model()

        # Ensure all existing users have email notifications disabled
        updated = User.objects.all().update(
            email_notifications_enabled=False,
            email_notify_overdue=False,
            email_notify_overbudget=False,
            email_notify_new_transaction=False,
        )
        log(f"Set email notifications to disabled for {updated} existing users")

        # Update system version
        version, created = SystemVersion.objects.get_or_create(id=1)
        version.version = '1.6.0-beta'
        version.save()

        log("System version updated successfully!")
        log("=" * 70)
        log("Update completed successfully!")
        log("")
        log("CHANGES IN THIS VERSION:")
        log("- Self-notifications filtered: users no longer receive notifications for their own actions")
        log("- Email notifications: users can enable email alerts per notification type in Profile")
        log("- Stacked bar chart: dashboard bar chart now shows investments separately")
        log("- Trend line: excludes current (open) period from calculation")
        log("=" * 70)

        return {
            'success': True,
            'message': 'Successfully updated to v1.6.0-beta'
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
