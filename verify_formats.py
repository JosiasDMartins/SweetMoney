import os
import sys
import django

# Add current directory to path
sys.path.append(os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "wimm_project.settings")
django.setup()

from django.utils import translation
from django.utils.formats import get_format
from babel.numbers import get_decimal_symbol, get_group_symbol

def check_formats(lang_code):
    with translation.override(lang_code):
        babel_locale = translation.to_locale(lang_code)
        try:
            babel_decimal = get_decimal_symbol(babel_locale)
            babel_thousand = get_group_symbol(babel_locale)
        except Exception as e:
            babel_decimal = f"Error: {e}"
            babel_thousand = "Error"
            
        django_decimal = get_format('DECIMAL_SEPARATOR')
        django_thousand = get_format('THOUSAND_SEPARATOR')
        
        print(f"Language: {lang_code}")
        print(f"  Django Decimal: '{django_decimal}' (Type: {type(django_decimal)})")
        print(f"  Babel Decimal:  '{babel_decimal}'")
        print(f"  Django Thousand: '{django_thousand}'")
        print(f"  Babel Thousand:  '{babel_thousand}'")
        
        if str(django_decimal) != str(babel_decimal):
            print("  MISMATCH: Decimal separators differ!")
        else:
            print("  MATCH: Decimal separators agree.")

print(" Checking Formats...")
print("-" * 30)
check_formats('en-us')
print("-" * 30)
check_formats('pt-br')
print("-" * 30)
