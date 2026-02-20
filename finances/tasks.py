"""
Celery Tasks for SweetMoney

This module contains all asynchronous tasks that are processed by Celery workers.
Tasks include:
- Daily notification email sending
- Overdue notification processing
- Overbudget notification processing

All tasks use Django's timezone-aware datetime handling and include
automatic retry logic for resilience.
"""
from celery import shared_task
from django.utils import timezone
from django.db.models import Q
import datetime
import logging

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_kwargs={'max_retries': 3, 'countdown': 60},
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
)
def send_daily_notification_emails(self):
    """
    Main daily task for sending notification emails.

    This task runs daily at midnight (server time) via Celery Beat.
    It performs two main functions:
    1. Re-send overdue email notifications for existing overdue items
    2. Create new overdue and overbudget notifications for all family members

    The task automatically retries up to 3 times if it fails,
    with exponential backoff between retries.

    Returns:
        dict: Summary of emails sent and notifications created
    """
    try:
        from finances.models import Notification, FamilyMember, Family
        from finances.utils.notifications_utils import (
            send_notification_email,
            create_overdue_notifications,
            create_overbudget_notifications
        )

        logger.info("[CELERY] Starting daily notification email task")

        threshold = timezone.now() - datetime.timedelta(hours=24)

        # Part 1: Re-send emails for existing OVERDUE notifications
        pending = Notification.objects.filter(
            notification_type='OVERDUE',
            is_acknowledged=False,
            email_opted_out=False,
        ).filter(
            Q(last_email_sent_at__isnull=True) | Q(last_email_sent_at__lt=threshold)
        ).select_related('member', 'member__user')

        count = 0
        for notif in pending:
            if send_notification_email(notif.member, notif):
                count += 1

        if count > 0:
            logger.info(f"[CELERY] Re-sent {count} overdue email notification(s)")
        else:
            logger.info("[CELERY] No overdue emails to re-send")

        # Part 2: CREATE NEW overdue and overbudget notifications for ALL family members
        all_families = Family.objects.all()

        summary = {
            'families_processed': 0,
            'overdue_emails_resent': count,
            'new_overdue_created': 0,
            'new_overbudget_created': 0,
        }

        for family in all_families:
            all_members = family.members.all()
            family_overdue_count = 0
            family_overbudget_count = 0

            for member in all_members:
                # Create overdue notifications for ALL members
                family_overdue_count += create_overdue_notifications(family, member)

                # Create overbudget notifications for ALL members
                family_overbudget_count += create_overbudget_notifications(family, member)

            summary['new_overdue_created'] += family_overdue_count
            summary['new_overbudget_created'] += family_overbudget_count
            summary['families_processed'] += 1

            if family_overdue_count > 0:
                logger.info(
                    f"[CELERY] Family '{family.name}': Created {family_overdue_count} "
                    f"new overdue notifications for {all_members.count()} members"
                )
            if family_overbudget_count > 0:
                logger.info(
                    f"[CELERY] Family '{family.name}': Created {family_overbudget_count} "
                    f"new overbudget notifications for {all_members.count()} members"
                )

        logger.info(
            f"[CELERY] Daily notification task completed. "
            f"Summary: {summary}"
        )

        return summary

    except Exception as exc:
        logger.error(f"[CELERY] Error in send_daily_notification_emails: {exc}")
        # Re-raise to trigger retry
        raise


@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_kwargs={'max_retries': 2, 'countdown': 30},
)
def send_overdue_email_resend(self):
    """
    Re-send overdue email notifications for existing notifications.

    This is a standalone task that can be triggered manually or on-demand
    to resend emails for overdue notifications that haven't been sent recently.

    Returns:
        int: Number of emails sent
    """
    try:
        from finances.models import Notification
        from finances.utils.notifications_utils import send_notification_email

        threshold = timezone.now() - datetime.timedelta(hours=24)

        pending = Notification.objects.filter(
            notification_type='OVERDUE',
            is_acknowledged=False,
            email_opted_out=False,
        ).filter(
            Q(last_email_sent_at__isnull=True) | Q(last_email_sent_at__lt=threshold)
        ).select_related('member', 'member__user')

        count = 0
        for notif in pending:
            if send_notification_email(notif.member, notif):
                count += 1

        logger.info(f"[CELERY] Re-sent {count} overdue email(s)")
        return count

    except Exception as exc:
        logger.error(f"[CELERY] Error in send_overdue_email_resend: {exc}")
        raise


@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_kwargs={'max_retries': 2, 'countdown': 30},
)
def create_overdue_notifications_task(self, family_id, member_id):
    """
    Create overdue notifications for a specific family member.

    Args:
        family_id: ID of the Family
        member_id: ID of the FamilyMember

    Returns:
        int: Number of notifications created
    """
    try:
        from finances.models import Family, FamilyMember
        from finances.utils.notifications_utils import create_overdue_notifications

        family = Family.objects.get(id=family_id)
        member = FamilyMember.objects.get(id=member_id)

        count = create_overdue_notifications(family, member)
        logger.info(
            f"[CELERY] Created {count} overdue notifications "
            f"for {member.user.username} in family '{family.name}'"
        )
        return count

    except Exception as exc:
        logger.error(f"[CELERY] Error in create_overdue_notifications_task: {exc}")
        raise


@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_kwargs={'max_retries': 2, 'countdown': 30},
)
def create_overbudget_notifications_task(self, family_id, member_id):
    """
    Create overbudget notifications for a specific family member.

    Args:
        family_id: ID of the Family
        member_id: ID of the FamilyMember

    Returns:
        int: Number of notifications created
    """
    try:
        from finances.models import Family, FamilyMember
        from finances.utils.notifications_utils import create_overbudget_notifications

        family = Family.objects.get(id=family_id)
        member = FamilyMember.objects.get(id=member_id)

        count = create_overbudget_notifications(family, member)
        logger.info(
            f"[CELERY] Created {count} overbudget notifications "
            f"for {member.user.username} in family '{family.name}'"
        )
        return count

    except Exception as exc:
        logger.error(f"[CELERY] Error in create_overbudget_notifications_task: {exc}")
        raise


@shared_task(
    bind=True,
)
def debug_celery_task(self):
    """
    Debug task for testing Celery connectivity.

    This task can be used to verify that Celery is properly configured
    and tasks are being executed.

    Returns:
        dict: Task information
    """
    logger.info(f"[CELERY DEBUG] Task executed successfully: {self.request.id}")
    return {
        'task_id': self.request.id,
        'timestamp': timezone.now().isoformat(),
        'message': 'Celery is working correctly!'
    }
