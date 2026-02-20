"""
SweetMoney Django Project

This __init__.py ensures Celery app is loaded when Django starts.
This is required for Celery to work properly with Django.
"""
# This will make sure the app is always imported when
# Django starts so that shared_task will use this app.
from .celery import app as celery_app

__all__ = ('celery_app',)
