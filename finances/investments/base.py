"""Base contract for investment add-in plugins (v1.8.0)."""

from decimal import Decimal, ROUND_HALF_UP


class BaseInvestmentPlugin:
    """Contract implemented by every investment add-in.

    Rates are FIXED and MANUAL in this phase: plugins derive monthly
    interest from the ``annual_rate`` typed by the user (percent, e.g.
    ``13.15`` == 13.15% per year). No internet lookups (CSP / fully
    self-hosted); hooks below are the future seams for automatic rate
    fetching and scheduled routines.

    Subclasses must set: ``code``, ``name``, ``currency``, and
    ``supports_interest``. ``group`` labels the dropdown section in the
    Add Investment modal (country or 'International').
    """

    code = ''
    name = ''
    currency = ''
    group = ''
    supports_interest = False

    def calculate_monthly_interest(self, balance, annual_rate, period=None, investment=None):
        """Interest earned by ``balance`` over one month (Decimal).

        ``balance`` is the investment balance before interest; ``annual_rate``
        is the stored manual annual percent; ``period`` is the Period whose
        close is crediting the interest; ``investment`` is the record (for
        plugins that need record fields, e.g. GIC maturity, RDB IR rate).
        """
        raise NotImplementedError

    def on_period_close(self, investment, period):
        """Hook for scheduled routines (Celery) at period close.

        Initial phase: no-op beyond the interest calculation performed by
        ``investment_utils.calculate_interest_on_period_close``.
        """
        return None

    def _monthly_rate(self, annual_rate):
        """Monthly decimal rate from an annual percent value (13.15 -> 0.011)."""
        return Decimal(annual_rate) / Decimal('100') / Decimal('12')

    def _quantize(self, value):
        """Money-grade rounding for credited interest."""
        return Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
