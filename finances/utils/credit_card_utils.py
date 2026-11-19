"""
Credit card billing-cycle utilities (v1.7.2 Credit Cards feature).

A card (container FlowGroup) has a due_day (1-31). A transaction belongs to
the bill of the month in which it was made when its day is on or before the
effective due day; otherwise it belongs to the next month's bill. Months
without the due day use the month's last day (due_day=31 in April closes on
the 30th). The bill shown for a period is the bill of the calendar month of
that period's start date.

Cards without due_day (legacy groups migrated by the OTA script until the
user defines the day) put every transaction in the current bill (no split).
"""

import calendar
from datetime import date
from decimal import Decimal

from django.db.models import Sum

from finances.models import FlowGroup, Transaction


def get_effective_due_day(due_day, year, month):
    """Due day clamped to the last day of the given month."""
    last_day = calendar.monthrange(year, month)[1]
    return min(due_day, last_day)


def get_billing_period(transaction_date, due_day):
    """First day of the billing month a transaction date belongs to.

    due_day 15: Jan 12 -> Jan 1 (current bill); Jan 17 -> Feb 1 (next bill).
    """
    year, month = transaction_date.year, transaction_date.month
    if due_day is not None and transaction_date.day > get_effective_due_day(due_day, year, month):
        month += 1
        if month > 12:
            month = 1
            year += 1
    return date(year, month, 1)


def transaction_in_card_bill(transaction_date, due_day, period_start_date):
    """True when the transaction belongs to the bill shown for the period."""
    if due_day is None:
        return True
    return get_billing_period(transaction_date, due_day) == date(
        period_start_date.year, period_start_date.month, 1
    )


def get_card_groups(card):
    """The card itself plus the FlowGroups linked to it (same period)."""
    return [card, *card.linked_groups.all()]


def get_card_bill_transactions(card, period_start_date):
    """Transactions feeding the card's bill for the given period.

    Sources: transactions launched directly on the card and transactions of
    groups linked to the card. When the card has a due_day, the card's other
    period copies (recurrence keeps the same name) and their linked groups
    are included too, so a post-due-day expense entered in an earlier period
    shows up in the following period's bill. Only transactions whose billing
    cycle matches the period's month count towards the bill.
    """
    groups = list(get_card_groups(card))
    current_ids = {g.pk for g in groups}
    if card.due_day is not None:
        lineage = list(FlowGroup.objects.filter(
            family=card.family,
            name=card.name,
            currency=card.currency,
            is_credit_card=True,
            linked_card__isnull=True,
        ).exclude(pk__in=current_ids))
        lineage_ids = [g.pk for g in lineage]
        linked = list(FlowGroup.objects.filter(
            family=card.family,
            is_credit_card=True,
            linked_card_id__in=lineage_ids,
        ))
        groups += lineage + linked
    result = []
    seen_transactions = set()
    for group in groups:
        # Bug 3.2 (v1.8.0): recurring (fixed) transactions are owned by the
        # recurring engine, which replicates them into every period. The bill
        # advance must only pull one-off post-closing expenses from previous
        # period copies (lineage), never the engine's own fixed copies.
        from_lineage = group.pk not in current_ids
        for transaction in group.transactions.all():
            if transaction.pk in seen_transactions:
                continue
            if from_lineage and transaction.is_fixed:
                continue
            if transaction_in_card_bill(
                transaction.date, card.due_day, period_start_date
            ):
                seen_transactions.add(transaction.pk)
                result.append(transaction)
    return result


def get_card_bill_total(card, period_start_date):
    """Sum of the transactions in the card's bill for the given period."""
    total = Decimal('0.00')
    for transaction in get_card_bill_transactions(card, period_start_date):
        total += transaction.amount.amount
    return total.quantize(Decimal('0.01'))


def get_next_bill_start(period_start_date):
    """First day of the month following the period's billing month."""
    year, month = period_start_date.year, period_start_date.month
    if month == 12:
        return date(year + 1, 1, 1)
    return date(year, month + 1, 1)


def get_card_next_bill_total(card, period_start_date):
    """Sum committed to the NEXT month's bill (post-due-day entries).

    Issue #44 (comment 230): the cards interface shows the current and the
    next bill side by side so the user can plan around what is already
    committed to the following bill.

    Returns ``None`` for cards without a ``due_day``: those bills close only
    manually, so a "next bill" projection would just repeat the current one
    (every transaction matches every month). Callers must hide the split
    display instead of rendering a misleading duplicate.
    """
    if not getattr(card, 'due_day', None):
        return None
    return get_card_bill_total(card, get_next_bill_start(period_start_date))


def get_group_next_bill_total(group, period_start_date):
    """Sum of THIS group's transactions committed to the next bill.

    Issue #44 (comment 322): the dashboard expense table shows the current
    bill pending for open credit-card groups; this projection completes the
    current/next split at group scope (the card-level split lives in the
    Credit Cards box and the card detail page).

    Uses the same billing-cycle predicate as the card-level split, so a
    post-due-day expense lands in the next bill exactly like on the card's
    own view. Returns ``None`` when no due day applies (no split exists)
    or for non credit-card groups.
    """
    if not getattr(group, 'is_credit_card', False):
        return None
    if group.linked_card_id is not None:
        due_day = getattr(group.linked_card, 'due_day', None)
    else:
        due_day = getattr(group, 'due_day', None)
    if not due_day:
        return None
    next_start = get_next_bill_start(period_start_date)
    total = Decimal('0.00')
    for transaction in group.transactions.all():
        if get_billing_period(transaction.date, due_day) == next_start:
            total += transaction.amount.amount
    return total.quantize(Decimal('0.01'))


def is_card_bill_overdue(card, period_start_date, today=None):
    """True when the bill's closing date has passed and the card is still open.

    Closing is always manual (Close Bill button), so an open card whose due
    day of the period's month already passed shows the overdue warning.
    """
    if card.due_day is None or card.closed:
        return False
    if today is None:
        from django.utils import timezone
        today = timezone.localdate()
    effective = get_effective_due_day(
        card.due_day, period_start_date.year, period_start_date.month)
    return today > date(period_start_date.year, period_start_date.month, effective)
