"""
Celery Configuration for SweetMoney

This module configures Celery to work with Django, using Redis as both
broker and result backend. Redis is already used for Django Channels,
so we reuse the existing infrastructure.

Key configurations:
- Broker: Redis (reuses existing connection)
- Result backend: Redis
- Task serialization: JSON
- Timezone: Uses Django's TIME_ZONE setting
- Beat scheduler: Enabled for periodic tasks
"""
import os
from celery import Celery

# Set default Django settings module for celery program
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wimm_project.settings')

# Create Celery app instance
app = Celery('sweetmoney')

# Load configuration from Django settings
# Using namespace='CELERY' means all celery-related settings should be
# prefixed with CELERY_ in Django settings (e.g., CELERY_BROKER_URL)
app.config_from_object('django.conf:settings', namespace='CELERY')

# Auto-discover tasks in all installed apps
# This will find @shared_task decorators in finances.tasks and other apps
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    """Debug task for testing Celery connectivity."""
    print(f'Request: {self.request!r}')


# Additional Celery configuration
app.conf.update(
    # Task settings
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,

    # Worker settings
    worker_prefetch_multiplier=1,  # Disable prefetch for long tasks
    worker_max_tasks_per_child=1000,  # Restart worker after N tasks to prevent memory leaks

    # Task result settings
    result_expires=3600,  # Results expire after 1 hour
    result_extended=True,

    # Security settings
    task_send_sent_event=True,  # Track when tasks are sent

    # Error handling
    task_acks_late=True,  # Acknowledge task after execution (prevents task loss on worker crash)
    task_reject_on_worker_lost=True,  # Re-queue task if worker crashes

    # Connection retry (Celery 6.0 compatibility)
    broker_connection_retry_on_startup=True,  # Retry connection on startup
)


# Optional: Configure Celery Beat to read from database (for dynamic scheduling)
# This allows adding periodic tasks without restarting the scheduler
# app.conf.beat_scheduler = 'django_celery_beat.schedulers:DatabaseScheduler'
