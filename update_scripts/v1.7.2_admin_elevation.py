#!/usr/bin/env python3
"""
Update script for SweetMoney v1.7.2 - Admin Elevation & OTA Security

This script:
1. Runs Django migrations (safety net; v1.7.2 includes a migration to
   remove the unique constraint on CustomUser.username so that every
   family can have its own admin user)
2. Renames each family's ADMIN user to the technical pattern
   admin_<family_slug>_<NN> (idempotent)
3. Compiles translation message catalogs (.mo) for any updated strings

The system version is NOT written here: since v1.7.2 the DB version is
finalized by the post-update screen (/post-update/), which runs after the
server reboots with the new files.

Key changes in v1.7.2:
- Login is strictly by email; usernames may repeat across families
- Admin users cannot log in directly (blocked by NonAdminModelBackend)
- PARENT users can elevate to admin via "Admin Mode" on the profile page
- Initial setup creates one PARENT user; the technical admin account
  (admin_<family_slug>_<NN>, no email) is generated automatically
- OTA updates require admin password before applying
- Post-update screen finalizes the DB version after every update
"""

import os
import re
import sys
import django

# Setup Django environment
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wimm_project.settings')
django.setup()

from django.core.management import call_command
from finances.models import Family, FamilyMember


def log(message):
    """Print log message with prefix"""
    print(f"[Update v1.7.2] {message}")


def slugify_family_name(family_name):
    """Same rule as finances.utils_user.slugify_family_name."""
    import unicodedata
    normalized = unicodedata.normalize('NFKD', str(family_name or ''))
    ascii_name = normalized.encode('ascii', 'ignore').decode('ascii').lower()
    slug = re.sub(r'[^a-z0-9]+', '_', ascii_name).strip('_')
    return slug or 'family'


def rename_admin_users():
    """
    Rename every family's ADMIN user to admin_<slug>_<NN>, where NN
    increments per family-name slug in family registration (id) order.
    Idempotent: users already following the pattern keep their username.
    """
    slug_counters = {}
    renamed = []

    for family in Family.objects.order_by('id'):
        admin_member = FamilyMember.objects.filter(
            family=family,
            role='ADMIN'
        ).select_related('user').first()

        if not admin_member:
            log(f"WARNING: family '{family.name}' (id={family.id}) has no ADMIN user")
            continue

        slug = slugify_family_name(family.name)
        slug_counters[slug] = slug_counters.get(slug, 0) + 1
        target = 'admin_%s_%02d' % (slug, slug_counters[slug])

        if admin_member.user.username == target:
            log(f"Family '{family.name}': admin already named '{target}'")
            continue

        old = admin_member.user.username
        admin_member.user.username = target
        admin_member.user.save()
        renamed.append((old, target))
        log(f"Family '{family.name}': admin renamed '{old}' -> '{target}'")

    return renamed


def run():
    """
    Main update process - called by the update manager.

    Returns:
        dict: {'success': bool, 'message': str}
    """
    log("Starting update to v1.7.2")

    try:
        # =====================================================
        # 1. Run migrations (username unique constraint removal)
        # =====================================================
        log("Running Django migrations...")
        call_command('migrate', verbosity=1)
        log("Migrations applied successfully")

        # =====================================================
        # 2. Data migration: rename admin users to the
        #    admin_<family_slug>_<NN> pattern
        # =====================================================
        log("Renaming admin users...")
        renamed = rename_admin_users()
        log(f"Admin users renamed: {len(renamed)}")

        # =====================================================
        # 3. Compile translation catalogs for any updated strings
        # =====================================================
        log("Compiling translation message catalogs...")
        try:
            call_command('compilemessages', verbosity=0)
            log("Translation catalogs compiled")
        except Exception as i18n_err:
            # compilemessages requires GNU gettext (msgfmt); not fatal if absent
            log(f"NOTE: Skipped compilemessages ({i18n_err}). "
                f"Ensure msgfmt is available if translations are stale.")

        # NOTE: SystemVersion is intentionally NOT updated here. The
        # post-update screen finalizes the version after reboot.

        log("=" * 70)
        log("Update to v1.7.2 completed successfully!")
        log("")
        log("CHANGES IN THIS VERSION (Admin Elevation & OTA Security):")
        log("")
        log("1. Strict Email Login:")
        log("   - Users now log in with email + password")
        log("   - Usernames may repeat across families")
        log("")
        log("2. Admin Login Blocked:")
        log("   - Admin users can no longer log in via the standard login form")
        log("   - Admin usernames follow admin_<family_slug>_<NN>")
        log("")
        log("3. Permission Elevation (Admin Mode):")
        log("   - PARENT users can click 'Admin Mode' on their profile page")
        log("   - Prompts for admin password, then elevates session to admin")
        log("   - New endpoint: /elevate-to-admin/")
        log("")
        log("4. Post-Update Screen:")
        log("   - After any update, the system locks until the post-update")
        log("     screen is completed (assign missing emails, then finalize)")
        log("   - The DB version is written only when the user confirms it")
        log("")
        log("5. OTA Update Security:")
        log("   - Applying updates requires the admin password")
        log("   - New endpoint: /verify-admin-password/")
        log("")
        log("Schema changes: Removed unique=True from CustomUser.username")
        log("=" * 70)

        return {
            'success': True,
            'message': 'Successfully updated to v1.7.2'
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
