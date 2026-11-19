"""Investment add-in architecture (v1.8.0).

Each investment type is a plugin derived from BaseInvestmentPlugin and
registered in ``finances.investments.registry``. Plugins compute interest
from the manually entered annual rate; no external rate lookups.
"""
