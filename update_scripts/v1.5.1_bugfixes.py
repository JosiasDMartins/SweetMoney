#!/usr/bin/env python3
"""
Update script for SweetMoney v1.5.1 - Bug Fixes

This script:
1. Updates SystemVersion to 1.5.1
2. Ensures proper reload after GitHub updates

Execution: This script runs during the update process via update_manager.py
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
    print(f"[Update v1.5.1] {message}")


def run():
    """
    Main update process - called by the update manager
    This function is required by the update system

    Returns:
        dict: {'success': bool, 'message': str}
    """
    log("Starting update to v1.5.1 (Bug Fixes)")

    try:
        # Update system version to 1.5.1
        version, created = SystemVersion.objects.get_or_create(id=1)
        version.version = '1.5.1'
        version.save()

        log("System version updated successfully to 1.5.1!")
        log("")
        log("=" * 70)
        log("Update to v1.5.1 completed successfully!")
        log("")
        log("Changes in v1.5.1:")
        log("- Fixed update loop issue when VERSION mismatch with GitHub release")
        log("- General bug fixes and stability improvements")
        log("=" * 70)

        return {
            'success': True,
            'message': 'Successfully updated to v1.5.1 - Bug fixes applied'
        }

    except Exception as e:
        error_msg = f"Error updating system version: {str(e)}"
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
