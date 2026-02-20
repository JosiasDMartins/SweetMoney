#!/usr/bin/env python3
"""
Notification Scheduler Daemon for SweetMoney Docker container.
Runs daily at midnight (server time) to re-send overdue email notifications
for unresolved transactions.

================================================================================
DEPRECATED - This file is kept for reference only
================================================================================

This scheduler has been replaced by Celery + Celery Beat.
The new implementation provides:
- Better reliability with automatic retry
- Proper monitoring via Flower UI
- Industry-standard task queue management
- Better timezone handling

New implementation:
- Tasks: finances/tasks.py
- Configuration: wimm_project/celery.py
- Schedule: wimm_project/settings.py (CELERY_BEAT_SCHEDULE)

This file will be removed in a future version after the migration is complete.

Version: 1.6.0
Status: DEPRECATED - Use Celery instead
"""
import os
import sys
import time
import datetime
import pathlib

# Setup Django environment
sys.path.insert(0, '/app')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wimm_project.settings')

# Check interval in seconds (every 60s to avoid busy-waiting)
CHECK_INTERVAL = 60

# Heartbeat file for monitoring
HEARTBEAT_FILE = '/tmp/scheduler_heartbeat'


def log(message):
    """Print timestamped log message."""
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] [NOTIF_SCHEDULER] {message}", flush=True)


def heartbeat():
    """Write heartbeat timestamp to file for monitoring."""
    try:
        heartbeat_path = pathlib.Path(HEARTBEAT_FILE)
        heartbeat_path.parent.mkdir(parents=True, exist_ok=True)
        with open(HEARTBEAT_FILE, 'w') as f:
            f.write(str(time.time()))
    except Exception as e:
        log(f"Failed to write heartbeat: {e}")


def run_overdue_email_resend():
    """Re-send overdue email notifications for all family members.

    IMPORTANT: Also CREATES new overdue and overbudget notifications for all members.
    This ensures notifications are sent even if no user has accessed the system recently.
    """
    try:
        import django
        django.setup()

        from django.utils import timezone
        from django.db.models import Q
        from finances.models import Notification, FamilyMember, Family
        from finances.utils.notifications_utils import (
            send_notification_email,
            create_overdue_notifications,
            create_overbudget_notifications
        )

        threshold = timezone.now() - datetime.timedelta(hours=24)

        # Part 1: Re-send emails for existing OVERDUE notifications
        pending = Notification.objects.filter(
            notification_type='OVERDUE',
            is_acknowledged=False,
            email_opted_out=False,  # NEW: Skip opted-out notifications
        ).filter(
            Q(last_email_sent_at__isnull=True) | Q(last_email_sent_at__lt=threshold)
        ).select_related('member', 'member__user')

        count = 0
        for notif in pending:
            if send_notification_email(notif.member, notif):
                count += 1

        if count > 0:
            log(f"Re-sent {count} overdue email notification(s)")
        else:
            log("No overdue emails to re-send")

        # Part 2: CREATE NEW overdue and overbudget notifications for ALL family members
        # This runs daily to ensure notifications are created even if users don't access the system
        all_families = Family.objects.all()

        for family in all_families:
            all_members = family.members.all()
            new_overdue_count = 0
            new_overbudget_count = 0

            for member in all_members:
                # Create overdue notifications for ALL members
                new_overdue_count += create_overdue_notifications(family, member)

                # Create overbudget notifications for ALL members
                new_overbudget_count += create_overbudget_notifications(family, member)

            if new_overdue_count > 0:
                log(f"Family '{family.name}': Created {new_overdue_count} new overdue notifications for {all_members.count()} members")
            if new_overbudget_count > 0:
                log(f"Family '{family.name}': Created {new_overbudget_count} new overbudget notifications for {all_members.count()} members")

    except Exception as e:
        log(f"ERROR: {e}")
        import traceback
        traceback.print_exc()


def scheduler_loop():
    """Main loop: waits for midnight, then runs the task."""
    log("Notification scheduler started")
    log(f"Check interval: {CHECK_INTERVAL}s")
    log("Will run overdue email re-send daily at midnight")
    log(f"Heartbeat file: {HEARTBEAT_FILE}")

    last_run_date = None
    last_heartbeat_hour = None

    while True:
        try:
            now = datetime.datetime.now()
            today = now.date()
            current_hour = now.hour

            # Write heartbeat every hour
            if last_heartbeat_hour != current_hour:
                heartbeat()
                log(f"Heartbeat written (hour: {current_hour})")
                last_heartbeat_hour = current_hour

            # Run once per day after midnight (hour 0)
            if current_hour == 0 and last_run_date != today:
                log("Midnight reached - running overdue email re-send")
                run_overdue_email_resend()
                last_run_date = today

            time.sleep(CHECK_INTERVAL)

        except KeyboardInterrupt:
            log("Received interrupt signal, stopping scheduler")
            break
        except Exception as e:
            log(f"ERROR in scheduler loop: {e}")
            time.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    scheduler_loop()
