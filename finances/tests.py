"""
Tests for SweetMoney Application

Includes tests for Celery tasks and notification functionality.
"""
from django.test import TestCase, override_settings
from django.utils import timezone
from django.contrib.auth import get_user_model
from django.core.mail import outbox

from finances.models import Family, FamilyMember, Notification
from finances.tasks import (
    send_daily_notification_emails,
    send_overdue_email_resend,
    debug_celery_task,
    create_overdue_notifications_task,
    create_overbudget_notifications_task,
)


User = get_user_model()


class CeleryTasksTest(TestCase):
    """Test Celery background tasks."""

    def setUp(self):
        """Set up test data."""
        # Create test user and family
        self.user = User.objects.create_user(
            username='testuser',
            email='test@example.com',
            password='testpass123'
        )
        self.family = Family.objects.create(name='Test Family')
        self.member = FamilyMember.objects.create(
            family=self.family,
            user=self.user,
            role='ADMIN'
        )

    def test_debug_celery_task(self):
        """Test that the debug Celery task executes successfully."""
        result = debug_celery_task()
        self.assertIn('task_id', result)
        self.assertIn('timestamp', result)
        self.assertIn('message', result)
        self.assertEqual(result['message'], 'Celery is working correctly!')

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_send_daily_notification_emails_empty(self):
        """Test daily notification task with no notifications."""
        result = send_daily_notification_emails()
        self.assertIsInstance(result, dict)
        self.assertIn('families_processed', result)
        self.assertEqual(result['overdue_emails_resent'], 0)

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_send_overdue_email_resend_empty(self):
        """Test overdue email resend with no notifications."""
        result = send_overdue_email_resend()
        self.assertIsInstance(result, int)
        self.assertEqual(result, 0)

    def test_create_overdue_notifications_task(self):
        """Test creating overdue notifications via Celery task."""
        result = create_overdue_notifications_task(self.family.id, self.member.id)
        self.assertIsInstance(result, int)
        # Should return count of created notifications (0 with no data)

    def test_create_overbudget_notifications_task(self):
        """Test creating overbudget notifications via Celery task."""
        result = create_overbudget_notifications_task(self.family.id, self.member.id)
        self.assertIsInstance(result, int)
        # Should return count of created notifications (0 with no data)


class CeleryConfigurationTest(TestCase):
    """Test Celery configuration."""

    def test_celery_settings_exist(self):
        """Test that Celery settings are configured."""
        from django.conf import settings

        self.assertTrue(hasattr(settings, 'CELERY_BROKER_URL'))
        self.assertTrue(hasattr(settings, 'CELERY_RESULT_BACKEND'))
        self.assertTrue(hasattr(settings, 'CELERY_BEAT_SCHEDULE'))

    def test_celery_beat_schedule_configured(self):
        """Test that Celery Beat schedule is configured."""
        from django.conf import settings

        schedule = settings.CELERY_BEAT_SCHEDULE
        self.assertIsInstance(schedule, dict)
        self.assertIn('send-daily-notification-emails', schedule)

        task_config = schedule['send-daily-notification-emails']
        self.assertEqual(task_config['task'], 'finances.tasks.send_daily_notification_emails')
        self.assertIn('schedule', task_config)


class NotificationUtilsTest(TestCase):
    """Test notification utility functions."""

    def setUp(self):
        """Set up test data."""
        self.user = User.objects.create_user(
            username='testuser',
            email='test@example.com',
            password='testpass123',
            email_notifications_enabled=True
        )
        self.family = Family.objects.create(name='Test Family')
        self.member = FamilyMember.objects.create(
            family=self.family,
            user=self.user,
            role='ADMIN'
        )

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_send_notification_email(self):
        """Test sending a notification email."""
        from finances.utils.notifications_utils import send_notification_email

        # Create a test notification
        notification = Notification.objects.create(
            family=self.family,
            member=self.member,
            notification_type='OVERDUE',
            message='Test overdue message'
        )

        # Clear email outbox
        outbox.clear()

        # Send email
        result = send_notification_email(self.member, notification)

        # Check email was sent
        self.assertTrue(result)
        self.assertEqual(len(outbox), 1)
        self.assertIn('SweetMoney', outbox[0].subject)
        self.assertEqual(outbox[0].to, [self.user.email])

    def test_check_member_access_to_flow_group(self):
        """Test FlowGroup access checking."""
        from finances.utils.notifications_utils import check_member_access_to_flow_group
        from finances.models import FlowGroup

        # Create a FlowGroup owned by the user
        flow_group = FlowGroup.objects.create(
            family=self.family,
            name='Test Group',
            owner=self.user,
            group_type='EXPENSE_MAIN'
        )

        # Admin should have access
        self.assertTrue(check_member_access_to_flow_group(self.member, flow_group))
