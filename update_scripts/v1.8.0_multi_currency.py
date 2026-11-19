#!/usr/bin/env python3
"""
Update script for SweetMoney v1.8.0 - Multi-Currency data backfill

This script:
1. Backfills FlowGroup.currency with the family's base currency wherever it
   is still empty (''), so every existing group lands in its family's default
   currency silo. Covers all periods; cards and kids groups included.
2. Backfills Investment.currency (same rule) and assigns plugin_code='cash'
   to legacy investments created before the plugin system existed.
3. Backfills ShopList.currency (same rule), keeping lists in the family's
   default silo.

No FX conversion happens anywhere: each currency silo stays independent.

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
from finances.models import FlowGroup, Family


def log(message):
    """Print log message with prefix"""
    print(f"[Update v1.8.0] {message}")


def _family_base_currency(family):
    """The family's default currency code (single source of truth)."""
    config = getattr(family, 'configuration', None)
    return config.base_currency if config else 'USD'


def backfill_flowgroup_currency():
    """Stamp every empty-currency FlowGroup with its family base currency."""
    from django.db.models import Q

    adjusted = 0
    empty_groups = (FlowGroup.objects.filter(Q(currency='') | Q(currency__isnull=True))
                    .select_related('family').order_by('id'))
    for group in empty_groups:
        group.currency = _family_base_currency(group.family)
        group.save(update_fields=['currency'])
        adjusted += 1
    log(f"FlowGroup currency backfilled: {adjusted} group(s)")
    return adjusted


def backfill_investments():
    """Stamp legacy investments: default-currency silo + 'cash' plugin."""
    from finances.models import Investment

    adjusted = 0
    for investment in Investment.objects.select_related('family').order_by('id'):
        changes = []
        if not investment.currency:
            investment.currency = _family_base_currency(investment.family)
            changes.append(f"currency={investment.currency}")
        if not investment.plugin_code:
            investment.plugin_code = 'cash'
            changes.append("plugin_code='cash'")
        if changes:
            investment.save()
            log(f"Family {investment.family_id}: investment '{investment.name}' "
                f"(id={investment.id}) -> {', '.join(changes)}")
            adjusted += 1
    log(f"Investment backfill applied: {adjusted} record(s)")
    return adjusted


def backfill_shop_lists():
    """Stamp every empty-currency ShopList with its family base currency."""
    from django.db.models import Q
    from finances.models import ShopList

    adjusted = 0
    empty_lists = (ShopList.objects.filter(Q(currency='') | Q(currency__isnull=True))
                   .select_related('family').order_by('id'))
    for shop_list in empty_lists:
        shop_list.currency = _family_base_currency(shop_list.family)
        shop_list.save(update_fields=['currency'])
        adjusted += 1
    log(f"ShopList currency backfilled: {adjusted} list(s)")
    return adjusted


def sanity_check():
    """Warn about groups whose currency no longer matches any family currency."""
    orphans = 0
    for family in Family.objects.all():
        valid = set([_family_base_currency(family)])
        from finances.models import FamilyCurrency
        valid.update(FamilyCurrency.objects.filter(family=family).values_list('code', flat=True))
        orphans += FlowGroup.objects.filter(family=family).exclude(currency='').exclude(
            currency__in=valid).count()
    if orphans:
        log(f"WARNING: {orphans} FlowGroup(s) reference currencies outside their "
            f"family's enabled set (harmless: silos are per-record, chip menu hides them).")
    else:
        log("Sanity check OK: no orphan-currency groups")
    return orphans


def run():
    """
    Main update process - called by the update manager.

    Returns:
        dict: {'success': bool, 'message': str}
    """
    log("Starting update to v1.8.0 (Multi-Currency + Investments)")

    try:
        # =====================================================
        # 1. Run migrations (FamilyCurrency, FlowGroup.currency,
        #    Investment rework, InvestmentEvent, ShopList.currency)
        # =====================================================
        log("Running Django migrations...")
        call_command('migrate', verbosity=1)
        log("Migrations applied successfully")

        # =====================================================
        # 2. Data backfills (idempotent)
        # =====================================================
        log("Backfilling FlowGroup.currency with each family's base currency...")
        groups = backfill_flowgroup_currency()

        log("Backfilling legacy investments (currency + 'cash' plugin)...")
        investments = backfill_investments()

        log("Backfilling ShopList.currency with each family's base currency...")
        shop_lists = backfill_shop_lists()

        # =====================================================
        # 3. Consistency check
        # =====================================================
        sanity_check()

        # =====================================================
        # 4. Compile translation catalogs for any updated strings
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
        log("Update to v1.8.0 (Multi-Currency + Investments) completed successfully!")
        log("")
        log("CHANGES IN THIS VERSION:")
        log("")
        log("1. Multi-Currency silos (max 3 per family):")
        log("   - Dashboard, Credit Cards, Bank Reconciliation and Balances")
        log("     become independent instances per currency (no FX conversion)")
        log("   - Currency chips menu on the sidebar; login opens the default")
        log("")
        log("2. Investments add-in module:")
        log("   - 9 plugin types (HISA, GIC, Savings, Cash, Poupanca,")
        log("     RDB Nubank, CDB/LC, LCI/LCA, Tesouro Selic), manual fixed")
        log("     annual rate")
        log("   - Deposits (optionally deducting the Available Investment")
        log("     Balance), withdrawals as income, manual balance adjustment")
        log("   - Interest calculated on period close; full event history")
        log("   - Global screen: every record carries its own currency badge")
        log("")
        log("3. Shop Lists:")
        log("   - Global view across currencies, currency chosen per list")
        log("")
        log("4. Bug fixes:")
        log("   - due_day locked on closed bills (detail view), editable only")
        log("     through the Dashboard global bill edit")
        log("   - Recurring post-closing expenses no longer duplicate on the")
        log("     next bill (owned by the recurring engine)")
        log("")
        log(f"Backfilled: {groups} FlowGroup(s), {investments} investment(s), "
            f"{shop_lists} shop list(s)")
        log("=" * 70)

        return {
            'success': True,
            'message': f"Multi-currency backfill applied to {groups} group(s), "
                       f"{investments} investment(s), {shop_lists} shop list(s)."
        }

    except Exception as e:
        log(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'message': f"Multi-currency update failed: {e}"
        }


if __name__ == '__main__':
    result = run()
    sys.exit(0 if result['success'] else 1)
