"""
Currency utility functions for managing period currencies.

This module handles currency-related operations including:
- Getting period currency
- Ensuring period exists with correct currency
- Multi-currency family silos (v1.8.0)
"""

import logging
from django.db.models import Q

from ..models import Period, FamilyCurrency

logger = logging.getLogger(__name__)

# Hard limit of simultaneous currencies per family (1 default + 2 secondary)
MAX_FAMILY_CURRENCIES = 3


def get_period_currency(family, period_start_date):
    """
    Retorna a moeda para um período específico.
    Consulta primeiro a tabela Period. Se não existir entrada, usa base_currency da família.
    """
    period = Period.objects.filter(
        family=family,
        start_date=period_start_date
    ).first()

    if period:
        return period.currency

    # Se não existe período registrado, usa moeda padrão da família
    config = getattr(family, 'configuration', None)
    if config:
        return config.base_currency

    return 'USD'  # Fallback padrão


def ensure_period_exists(family, start_date, end_date, period_type):
    """
    Garante que existe uma entrada de Period para o período especificado.
    Se não existir, cria uma nova com a moeda padrão da família.

    Returns: Period object
    """
    period, created = Period.objects.get_or_create(
        family=family,
        start_date=start_date,
        defaults={
            'end_date': end_date,
            'period_type': period_type,
            'currency': family.configuration.base_currency if hasattr(family, 'configuration') else 'USD'
        }
    )

    # Se já existe mas precisa atualizar end_date ou period_type
    if not created:
        updated = False
        if period.end_date != end_date:
            period.end_date = end_date
            updated = True
        if period.period_type != period_type:
            period.period_type = period_type
            updated = True
        if updated:
            period.save()

    return period


def get_default_currency(family):
    """The family's default currency code (derived, never stored twice)."""
    config = getattr(family, 'configuration', None)
    return config.base_currency if config else 'USD'


def get_family_currencies(family):
    """Ordered list of the family's currency codes (default first).

    The default (FamilyConfiguration.base_currency) is united with the
    FamilyCurrency rows, so it is always present exactly once.
    """
    default = get_default_currency(family)
    codes = [default]
    secondary = (
        FamilyCurrency.objects
        .filter(family=family)
        .exclude(code=default)
        .order_by('id')
        .values_list('code', flat=True)
    )
    codes.extend(secondary)
    return codes


def is_valid_family_currency(family, code):
    """True when the code is one of the family's enabled currencies."""
    return bool(code) and code in get_family_currencies(family)


def can_add_currency(family, code):
    """Validates a currency addition against duplicates and the 3 limit.

    Code existence in CURRENCY_CHOICES is validated by the calling view.
    Returns (error_key, allowed). error_key is None when allowed.
    """
    if not code:
        return 'missing_code', False
    if is_valid_family_currency(family, code):
        return 'already_added', False
    if len(get_family_currencies(family)) >= MAX_FAMILY_CURRENCIES:
        return 'limit_reached', False
    return None, True


def _all_currency_codes():
    """All codes accepted by the system (mirrors forms.CURRENCY_CHOICES)."""
    from ..forms import CURRENCY_CHOICES
    return [code for code, _label in CURRENCY_CHOICES]


def flowgroup_currency_q(family, active_code, prefix=''):
    """Q filter restricting FlowGroup queries to one currency silo.

    ``prefix`` targets related queries, e.g. prefix='flow_group__' filters
    Transaction queries on their group's silo.

    Legacy rows with currency='' belong to the default silo, so they are
    included when the active currency is the default (keeps pre-1.8.0 data
    visible even before the OTA backfill runs).
    """
    if active_code == get_default_currency(family):
        return Q(**{f'{prefix}currency': active_code}) | Q(**{f'{prefix}currency': ''})
    return Q(**{f'{prefix}currency': active_code})


def get_active_currency(request, family):
    """Valid currency code for the current request.

    Checks ?currency= first, then the session; invalid/absent falls back to
    the family default. Always returns a valid code for the family.
    """
    codes = get_family_currencies(family)
    candidate = (
        request.GET.get('currency')
        or request.session.get('currency')
    )
    if candidate in codes:
        return candidate
    return codes[0]


def set_session_currency(request, code):
    """Persists the chosen currency in the session (currency chip switch)."""
    request.session['currency'] = code
