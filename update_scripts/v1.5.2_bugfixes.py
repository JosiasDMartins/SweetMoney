#!/usr/bin/env python3
"""
Update script for SweetMoney v1.5.2-beta - Update Monitor Daphne Support

This script:
1. Updates SystemVersion to 1.5.2-beta
2. No database migrations needed (no model changes)
3. Updates the Update Monitor daemon to use Daphne instead of Gunicorn

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
    print(f"[Update v1.5.2-beta] {message}")


def run():
    """
    Main update process - called by the update manager
    This function is required by the update system

    Returns:
        dict: {'success': bool, 'message': str}
    """
    log("Starting update to v1.5.2-beta (Update Monitor Daphne Support)")

    try:
        # Update system version to 1.5.2-beta
        version, created = SystemVersion.objects.get_or_create(id=1)
        version.version = '1.5.2-beta'
        version.save()

        log("System version updated successfully to 1.5.2-beta!")
        log("")
        log("=" * 70)
        log("Update to v1.5.2-beta completed successfully!")
        log("")
        log("CHANGES IN THIS VERSION:")
        log("")
        log("1. Update Monitor Daemon:")
        log("   - Changed from Gunicorn SIGHUP to Daphne supervisorctl restart")
        log("   - Now properly restarts Daphne ASGI server after updates")
        log("   - Fixed hot-reload functionality for OTA updates")
        log("")
        log("2. OTA Update System:")
        log("   - Added support for Gitea repositories (in addition to GitHub)")
        log("   - Auto-detection of Git platform (GitHub, Gitea, GitLab)")
        log("   - Configurable repository URL via UPDATE_RELEASES_URL setting")
        log("   - Authentication support for private repositories")
        log("")
        log("3. JavaScript Fixes:")
        log("   - Resolved merge conflict markers in JS files")
        log("   - Fixed various UI issues")
        log("")
        log("NOTES:")
        log("- Container rebuild required to apply Update Monitor changes")
        log("- For Gitea, use: /api/v1/repos/{owner}/{repo}/releases/latest")
        log("- For GitHub, use: /repos/{owner}/{repo}/releases")
        log("=" * 70)

        return {
            'success': True,
            'message': 'Successfully updated to v1.5.2-beta - Update Monitor now uses Daphne'
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
