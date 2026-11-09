#!/usr/bin/env python3
"""
Update script for SweetMoney v1.7.2 - Credit Cards feature data migration

This script:
1. Ensures every FlowGroup marked is_credit_card=True (all periods) becomes
   a card container: is_recurring=True and linked_card=NULL. The new Credit
   Cards dashboard box lists cards per period, so these groups automatically
   move to the Credit Cards session with their transactions.
2. Leaves due_day=NULL on migrated cards: the user defines the closing day
   later and the UI shows a "set due date" warning meanwhile.

The system version is NOT written here: the post-update screen finalizes
the DB version after the server reboots with the new files.

Idempotent: running twice changes nothing and duplicates nothing.
"""

import os
import sys
import django

# Setup Django environment
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wimm_project.settings')
django.setup()

from django.core.management import call_command
from finances.models import FlowGroup


def log(message):
    """Print log message with prefix"""
    print(f"[Update v1.7.2] {message}")


def migrate_credit_card_groups():
    """
    Turn every credit-card FlowGroup into a recurring card container.

    Returns list of (group id, group name, changes applied) tuples.
    """
    adjusted = []

    credit_card_groups = FlowGroup.objects.filter(is_credit_card=True).order_by('id')

    for group in credit_card_groups:
        changes = []

        if not group.is_recurring:
            group.is_recurring = True
            changes.append('is_recurring=True')

        if group.linked_card_id is not None:
            group.linked_card_id = None
            changes.append('linked_card=NULL')

        if changes:
            group.save()
            log(f"Family {group.family_id}, period {group.period_start_date}: "
                f"card '{group.name}' (id={group.id}) -> {', '.join(changes)}")
            adjusted.append((group.id, group.name, changes))
        else:
            log(f"Family {group.family_id}, period {group.period_start_date}: "
                f"card '{group.name}' (id={group.id}) already a container card")

    return adjusted


def run():
    """
    Main update process - called by the update manager.

    Returns:
        dict: {'success': bool, 'message': str}
    """
    log("Starting update to v1.7.2 (Credit Cards feature)")

    try:
        # =====================================================
        # 1. Run migrations (FlowGroup.due_day / linked_card)
        # =====================================================
        log("Running Django migrations...")
        call_command('migrate', verbosity=1)
        log("Migrations applied successfully")

        # =====================================================
        # 2. Data migration: credit-card groups become cards
        # =====================================================
        log("Migrating credit-card groups to the Credit Cards session...")
        adjusted = migrate_credit_card_groups()
        log(f"Credit-card groups adjusted: {len(adjusted)}")

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
        log("Update to v1.7.2 (Credit Cards) completed successfully!")
        log("")
        log("CHANGES IN THIS VERSION (Credit Cards feature):")
        log("")
        log("1. Credit Cards Dashboard Box:")
        log("   - New box above Recent Income listing the family's cards")
        log("   - Card total shows the current bill (closing day based)")
        log("")
        log("2. Cards are recurring FlowGroups:")
        log("   - Copied to every new period until deleted manually")
        log("   - Copied with closed=False (new open bill)")
        log("")
        log("3. Legacy credit-card groups migrated:")
        log("   - Marked is_recurring=True, linked_card=NULL (containers)")
        log("   - due_day left empty; set it on the card to enable the")
        log("     billing cycle split (a warning badge shows meanwhile)")
        log("")
        log("4. FlowGroups can be linked to cards:")
        log("   - Marking a FlowGroup as Credit Card shows a card dropdown")
        log("   - Its expenses feed the linked card's bill")
        log("=" * 70)

        return {
            'success': True,
            'message': f"Credit Cards migration applied to {len(adjusted)} group(s)."
        }

    except Exception as e:
        log(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'message': f"Credit Cards migration failed: {e}"
        }


if __name__ == '__main__':
    result = run()
    sys.exit(0 if result['success'] else 1)
