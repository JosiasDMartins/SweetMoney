"""Investment business logic (v1.8.0): deposits, withdrawals, interest and
manual balance adjustment.

All operations are transactional, backend-first, and record an
InvestmentEvent for every balance change. Withdrawals land as realized
income on the dashboard of the investment's OWN currency silo; deposits
may optionally deduct the Available Investment Balance by creating an
expense in the investment pass-through group of the same silo.
"""

from decimal import Decimal

from django.db import transaction
from django.utils.translation import gettext as _
from moneyed import Money

from ..models import Investment, InvestmentEvent, FlowGroup, Transaction


def _broadcaster():
    # Deferred import: websocket_utils pulls the views package (money_to_decimal),
    # which must not be resolved while views modules are still initializing.
    from ..websocket_utils import WebSocketBroadcaster
    return WebSocketBroadcaster


class InsufficientBalanceError(ValueError):
    """Raised when a withdrawal exceeds the investment balance."""


def _pass_through_group(family, user, period_start_date, currency):
    """The investment pass-through FlowGroup (is_investment=True) for one
    currency silo; created on first deposit that deducts from available."""
    group = FlowGroup.objects.filter(
        family=family,
        period_start_date=period_start_date,
        is_investment=True,
        currency=currency,
    ).first()
    if group:
        return group
    return FlowGroup.objects.create(
        family=family,
        name=_('Investment Transfer'),
        group_type='EXPENSE_MAIN',
        budgeted_amount=Money(Decimal('0.00'), currency),
        period_start_date=period_start_date,
        currency=currency,
        is_investment=True,
        owner=user,
    )


def _income_group_for(family, user, period_start_date, currency):
    """The income FlowGroup of one currency silo.

    Reuses the canonical single income group per family/period/currency
    (``get_default_income_flow_group``). Creating a differently-named
    second income group would break the dashboard's one-income-group
    assumption, so the investment intent is expressed in the transaction
    description instead.
    """
    from ..views.views_utils import get_default_income_flow_group
    return get_default_income_flow_group(family, user, period_start_date, currency=currency)


def _record_event(investment, event_type, amount, user, note=''):
    return InvestmentEvent.objects.create(
        investment=investment,
        event_type=event_type,
        amount=amount.quantize(Decimal('0.01')),
        balance_after=investment.balance.amount.quantize(Decimal('0.01')),
        note=note,
        created_by=user,
    )


def _member_for(user, family):
    from ..models import FamilyMember
    return FamilyMember.objects.filter(user=user, family=family).first()


@transaction.atomic
def deposit(investment, amount, deduct_from_available, user, period):
    """Deposit ``amount`` into ``investment``.

    ``deduct_from_available``: also write a realized expense transaction
    into the pass-through group of the investment's silo so the Available
    Investment Balance decreases. Returns the updated investment.
    """
    amount = Decimal(amount)
    if amount <= 0:
        raise ValueError(_('Amount must be positive.'))

    investment.balance += Money(amount, str(investment.balance.currency))
    investment.save(update_fields=['balance'])

    _record_event(investment, InvestmentEvent.EVENT_DEPOSIT, amount, user)

    if deduct_from_available:
        member = _member_for(user, investment.family)
        group = _pass_through_group(
            investment.family, user, period.start_date, investment.currency or str(investment.balance.currency))
        Transaction.objects.create(
            flow_group=group,
            description=f"{investment.name} — deposit",
            amount=Money(-amount, str(investment.balance.currency)),
            member=member,
            realized=True,
        )
        _record_event(
            investment, InvestmentEvent.EVENT_DEDUCTED, amount, user,
            note=_('Deducted from Available Investment Balance'))

    _broadcaster().broadcast_investment_updated(investment, actor_user=user)
    return investment


@transaction.atomic
def withdraw(investment, amount, user, period):
    """Withdraw ``amount`` from ``investment`` into the dashboard of the
    investment's own currency as realized income. Returns the investment.
    """
    amount = Decimal(amount)
    if amount <= 0:
        raise ValueError(_('Amount must be positive.'))
    balance = investment.balance.amount
    if amount > balance:
        raise InsufficientBalanceError(
            _('Insufficient balance: the withdrawal exceeds the investment total.'))

    investment.balance -= Money(amount, str(investment.balance.currency))
    investment.save(update_fields=['balance'])

    member = _member_for(user, investment.family)
    group = _income_group_for(
        investment.family, user, period.start_date,
        investment.currency or str(investment.balance.currency))
    Transaction.objects.create(
        flow_group=group,
        description=f"{investment.name} — withdraw",
        amount=Money(amount, str(investment.balance.currency)),
        member=member,
        realized=True,
    )

    _record_event(investment, InvestmentEvent.EVENT_WITHDRAWAL, amount, user)
    _broadcaster().broadcast_investment_updated(investment, actor_user=user)
    return investment


@transaction.atomic
def adjust_balance(investment, new_balance, user, note=''):
    """Overwrite the balance (manual correction); logs the delta."""
    new_balance = Decimal(new_balance)
    delta = new_balance - investment.balance.amount
    investment.balance = Money(new_balance, str(investment.balance.currency))
    investment.save(update_fields=['balance'])

    delta_note = (f"{note}; " if note else "") + f"delta {delta:+.2f}"
    _record_event(investment, InvestmentEvent.EVENT_ADJUSTMENT, delta, user, note=delta_note)
    _broadcaster().broadcast_investment_updated(investment, actor_user=user)
    return investment


def calculate_interest_on_period_close(family, period, actor_user=None):
    """Credit one month of interest for every interest-bearing investment.

    Called by the period rollover (consolidation). Idempotent per (period,
    investment): the closing period's start date is stamped in the event
    note, and already-credited periods are skipped. Legacy records without
    an annual_rate are skipped. Returns the number of investments credited.
    """
    period_tag = f"period:{period.start_date.isoformat()}"
    credited = 0
    for investment in family.investments.all():
        if InvestmentEvent.objects.filter(
            investment=investment, event_type=InvestmentEvent.EVENT_INTEREST,
            note__contains=period_tag,
        ).exists():
            continue
        plugin = investment.plugin
        if not plugin.supports_interest or investment.annual_rate is None:
            continue
        interest = plugin.calculate_monthly_interest(
            investment.balance.amount, investment.annual_rate, period=period, investment=investment)
        if interest == 0:
            continue
        investment.balance += Money(interest, str(investment.balance.currency))
        investment.save(update_fields=['balance'])
        _record_event(investment, InvestmentEvent.EVENT_INTEREST, interest, actor_user, note=period_tag)
        _broadcaster().broadcast_investment_updated(investment, actor_user=actor_user)
        credited += 1
    return credited
