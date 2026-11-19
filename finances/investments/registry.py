"""Investment plugin registry and the 12 built-in add-ins (v1.8.0).

Canada (CAD): HISA, GIC, Savings, Cash, Custom.
Brazil (BRL): Poupanca, RDB Nubank, CDB/LC, LCI/LCA, Tesouro Selic, Custom.
International: Custom — currency chosen per record from the system's
supported currencies (issue #44 comment 324: behaves like an independent
country).

Every plugin computes from the manual ``annual_rate`` stored on the
Investment record (percent). No FX, no internet: silos stay independent
and self-hosted.
"""

from decimal import Decimal

from django.utils.translation import gettext_lazy as _

from .base import BaseInvestmentPlugin


class HISAPlugin(BaseInvestmentPlugin):
    """High-Interest Savings Account: compound monthly interest."""

    code = 'hisa'
    name = _('HISA (Canada)')
    currency = 'CAD'
    group = _('Canada')
    supports_interest = True

    def calculate_monthly_interest(self, balance, annual_rate, period=None, investment=None):
        # Monthly compounding: balance * ((1 + r/12) ** 1 - 1)
        monthly_factor = (Decimal('1') + self._monthly_rate(annual_rate)) ** 1 - Decimal('1')
        return self._quantize(Decimal(balance) * monthly_factor)


class GICPlugin(BaseInvestmentPlugin):
    """Guaranteed Investment Certificate: rate locked at deposit, yields
    until the record's ``maturity_date``; zero interest afterwards."""

    code = 'gic'
    name = _('GIC (Canada)')
    currency = 'CAD'
    group = _('Canada')
    supports_interest = True

    def calculate_monthly_interest(self, balance, annual_rate, period=None, investment=None):
        maturity = getattr(investment, 'maturity_date', None)
        period_end = getattr(period, 'end_date', None)
        if maturity is not None and period_end is not None and period_end > maturity:
            return Decimal('0.00')
        return self._quantize(Decimal(balance) * self._monthly_rate(annual_rate))


class SavingsPlugin(BaseInvestmentPlugin):
    """Canadian savings account: simple monthly interest proportional to the
    manual annual rate typed by the user (balance * rate / 12)."""

    code = 'savings'
    name = _('Savings (Canada)')
    currency = 'CAD'
    group = _('Canada')
    supports_interest = True

    def calculate_monthly_interest(self, balance, annual_rate, period=None, investment=None):
        return self._quantize(Decimal(balance) * self._monthly_rate(annual_rate))


class CashPlugin(BaseInvestmentPlugin):
    """Plain cash reserve: never yields interest."""

    code = 'cash'
    name = _('Cash')
    currency = 'CAD'
    group = _('Canada')
    supports_interest = False

    def calculate_monthly_interest(self, balance, annual_rate, period=None, investment=None):
        return Decimal('0.00')


class PoupancaPlugin(BaseInvestmentPlugin):
    """Brazilian savings account (poupança).

    Official rule: monthly rate = min(70% of the Selic target, 0.5%).
    Manual phase: the user types the ANNUAL rate used as the Selic
    reference; the plugin applies the same cap formula on it:
        monthly = min(annual * 0.70, 0.5) / 12   (in percent)
    (e.g. reference 10.5% a.a. -> min(7.35%, 0.5%) = 0.5% a month).
    """

    code = 'poupanca'
    name = _('Poupança (Brazil)')
    currency = 'BRL'
    group = _('Brazil')
    supports_interest = True

    def calculate_monthly_interest(self, balance, annual_rate, period=None, investment=None):
        annual = Decimal(annual_rate)
        effective_monthly_percent = min(annual * Decimal('0.70'), Decimal('0.5')) / Decimal('12')
        return self._quantize(Decimal(balance) * effective_monthly_percent / Decimal('100'))


class RdbNubankPlugin(BaseInvestmentPlugin):
    """Nubank RDB: 100% CDI with simplified regressive IR.

    Manual phase: ``annual_rate`` is the CDI-equivalent annual percent.
    Simplified IR: net interest = gross * (1 - ir_rate/100), where
    ``ir_rate`` is the Investment record's field (default 0).
    """

    code = 'rdb_nubank'
    name = _('RDB Nubank (Brazil)')
    currency = 'BRL'
    group = _('Brazil')
    supports_interest = True

    def calculate_monthly_interest(self, balance, annual_rate, period=None, investment=None):
        gross = Decimal(balance) * self._monthly_rate(annual_rate)
        ir_rate = Decimal(getattr(investment, 'ir_rate', 0) or 0)
        net = gross * (Decimal('1') - ir_rate / Decimal('100'))
        return self._quantize(net)


class CdbLcPlugin(BaseInvestmentPlugin):
    """CDB / LC: a percentage of the CDI.

    Manual phase: the user converts "% of CDI" into the effective annual
    rate (e.g. 90% of a 13.15% CDI -> 11.84) and types it in; the plugin
    accrues it proportionally each month.
    """

    code = 'cdb_lc'
    name = _('CDB / LC (Brazil)')
    currency = 'BRL'
    group = _('Brazil')
    supports_interest = True

    def calculate_monthly_interest(self, balance, annual_rate, period=None, investment=None):
        return self._quantize(Decimal(balance) * self._monthly_rate(annual_rate))


class LciLcaPlugin(BaseInvestmentPlugin):
    """LCI / LCA: a percentage of the CDI, exempt from income tax.

    Same manual effective-annual-rate convention as CDB/LC; the exempt
    status is informational (no IR deduction in any phase).
    """

    code = 'lci_lca'
    name = _('LCI / LCA (Brazil)')
    currency = 'BRL'
    group = _('Brazil')
    supports_interest = True

    def calculate_monthly_interest(self, balance, annual_rate, period=None, investment=None):
        return self._quantize(Decimal(balance) * self._monthly_rate(annual_rate))


class TesouroSelicPlugin(BaseInvestmentPlugin):
    """Tesouro Selic: manual base annual rate (Selic + spread)."""

    code = 'tesouro_selic'
    name = _('Tesouro Selic (Brazil)')
    currency = 'BRL'
    group = _('Brazil')
    supports_interest = True

    def calculate_monthly_interest(self, balance, annual_rate, period=None, investment=None):
        return self._quantize(Decimal(balance) * self._monthly_rate(annual_rate))


class _CustomInterestMixin(BaseInvestmentPlugin):
    """Shared interest math for the Custom add-ins.

    Any non-predetermined investment type: simple monthly proportional
    interest from the manual annual rate; a blank rate yields nothing
    (``calculate_interest_on_period_close`` skips ``annual_rate=None``).
    """

    supports_interest = True

    def calculate_monthly_interest(self, balance, annual_rate, period=None, investment=None):
        if annual_rate in (None, ''):
            return Decimal('0.00')
        return self._quantize(Decimal(balance) * self._monthly_rate(Decimal(annual_rate)))


class CustomCaPlugin(_CustomInterestMixin):
    """Custom investment inside the Canada group: currency locked to CAD
    like every other plugin of the country (issue #44 comment 324)."""

    code = 'custom_ca'
    name = _('Custom (Canada)')
    currency = 'CAD'
    group = _('Canada')


class CustomBrPlugin(_CustomInterestMixin):
    """Custom investment inside the Brazil group: currency locked to BRL
    like every other plugin of the country (issue #44 comment 324)."""

    code = 'custom_br'
    name = _('Custom (Brazil)')
    currency = 'BRL'
    group = _('Brazil')


class CustomPlugin(_CustomInterestMixin):
    """Custom investment outside the countries: behaves like an independent
    country whose currency is chosen per record from the system's supported
    currencies (issue #44 comment 324)."""

    code = 'custom'
    name = _('Custom (International)')
    currency = ''
    group = _('International')


PLUGINS = {
    plugin.code: plugin
    for plugin in (
        HISAPlugin(), GICPlugin(), SavingsPlugin(), CashPlugin(),
        CustomCaPlugin(),
        PoupancaPlugin(), RdbNubankPlugin(), CdbLcPlugin(),
        LciLcaPlugin(), TesouroSelicPlugin(), CustomBrPlugin(),
        CustomPlugin(),
    )
}


def get_plugin(code):
    """Plugin instance for ``code``; Cash for unknown/legacy values."""
    return PLUGINS.get(code) or PLUGINS['cash']


def plugin_choices():
    """((code, translated_label), ...) for model/form choices."""
    return [(code, plugin.name) for code, plugin in PLUGINS.items()]
