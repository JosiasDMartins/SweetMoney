# finances/templatetags/math_filters.py

from django import template
from django.contrib.humanize.templatetags.humanize import intcomma
from django.utils.formats import get_format
from decimal import Decimal, InvalidOperation

register = template.Library()

@register.filter
def sub(value, arg):
    """
    Subtracts the argument from the value.
    Ensures that values are converted to Decimal for precise math.
    """
    try:
        # Ensure both are converted to Decimal before subtraction
        return Decimal(value) - Decimal(arg)
    except (ValueError, TypeError, InvalidOperation):
        # Return 0 if conversion fails
        return 0

@register.filter
def divide(value, arg):
    """
    Divides the value by the argument.
    Handles division by zero by returning 0.
    Ensures that values are converted to Decimal for precise math.
    """
    try:
        # Check for None, 0, or '0' values for the divisor
        if arg in (None, 0, '0', Decimal(0)):
            return 0

        # Convert to Decimal for accurate financial calculations
        return Decimal(value) / Decimal(arg)
    except (ValueError, TypeError, InvalidOperation):
        # Catches conversion errors etc.
        return 0

@register.filter
def multiply(value, arg):
    """
    Multiplies the value by the argument.
    Ensures that values are converted to Decimal for precise math.
    """
    try:
        return Decimal(value) * Decimal(arg)
    except (ValueError, TypeError, InvalidOperation):
        return 0

@register.filter
def format_money(value, currency_symbol=''):
    """
    Format money value with currency symbol AFTER the negative sign.
    Formats as "CA$ -50.00" instead of "-CA$ 50.00" for negative values.

    Usage: {{ transaction.amount|format_money:currency_symbol }}
    """
    try:
        # Handle Money objects (django-money)
        if hasattr(value, 'amount'):
            amount = Decimal(str(value.amount))
            # Get currency code from Money object if available
            if not currency_symbol and hasattr(value, 'currency'):
                currency_symbol = str(value.currency.code)
        else:
            amount = Decimal(str(value))

        # Get absolute value for formatting
        abs_amount = abs(amount)

        # Split into integer and decimal parts to ensure 2 decimal places
        integer_part = str(int(abs_amount))
        decimal_part = '{0:.2f}'.format(abs_amount).split('.')[1]

        # Add thousand separators to integer part
        formatted_integer = intcomma(integer_part)

        # Combine with 2 decimal places using locale-aware decimal separator
        decimal_sep = get_format('DECIMAL_SEPARATOR')
        formatted_amount = f'{formatted_integer}{decimal_sep}{decimal_part}'

        # For negative values, format as "CA$ -50.00"
        # For positive values, format as "CA$ 50.00"
        if amount < 0:
            return f'{currency_symbol} -{formatted_amount}'
        else:
            return f'{currency_symbol} {formatted_amount}'
    except (ValueError, TypeError, InvalidOperation, AttributeError):
        # Return original value if formatting fails
        return value


@register.filter
def format_amount(value):
    """
    Format a numeric value with locale-aware separators, no currency symbol.
    Handles Money objects, Decimal, float, int, string, and None.

    Usage: {{ transaction.amount|format_amount }}
    Returns: "1,880.00" (EN) or "1.880,00" (PT-BR)
    """
    try:
        # Handle Money objects (django-money)
        if hasattr(value, 'amount'):
            amount = Decimal(str(value.amount))
        elif value is None or value == '':
            amount = Decimal('0.00')
        else:
            amount = Decimal(str(value))

        abs_amount = abs(amount)
        integer_part = str(int(abs_amount))
        decimal_part = '{0:.2f}'.format(abs_amount).split('.')[1]

        formatted_integer = intcomma(integer_part)

        decimal_sep = get_format('DECIMAL_SEPARATOR')
        formatted_number = f'{formatted_integer}{decimal_sep}{decimal_part}'

        if amount < 0:
            return f'-{formatted_number}'
        return formatted_number
    except (ValueError, TypeError, InvalidOperation, AttributeError):
        return value
