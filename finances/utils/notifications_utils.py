# finances/notification_utils.py

from django.utils import timezone
from django.urls import reverse
from django.conf import settings
from django.utils.translation import gettext as _
from decimal import Decimal
from django.db import transaction


# Mapping from notification_type to the user preference field
NOTIFICATION_TYPE_TO_EMAIL_FIELD = {
    'OVERDUE': 'email_notify_overdue',
    'OVERBUDGET': 'email_notify_overbudget',
    'NEW_TRANSACTION': 'email_notify_new_transaction',
    'OVERDUE_WARNING': 'email_notify_overdue',  # New type uses same preference as OVERDUE
}

# Human-readable labels for email subjects
NOTIFICATION_TYPE_LABELS = {
    'OVERDUE': 'Overdue Transaction',
    'OVERBUDGET': 'Over Budget',
    'NEW_TRANSACTION': 'New Transaction',
    'OVERDUE_WARNING': 'Upcoming Due Date',  # New type for upcoming warnings
}

# Human-readable descriptions for email body summaries
NOTIFICATION_TYPE_DESCRIPTIONS = {
    'OVERDUE': 'A payment is overdue and needs attention.',
    'OVERDUE_WARNING': 'A payment is coming due soon.',
    'OVERBUDGET': 'Spending has exceeded the budgeted amount.',
    'NEW_TRANSACTION': 'A new transaction was added to your account.',
}


def send_notification_email(member, notification):
    """
    Sends an email notification to a member if they have email notifications enabled
    for the given notification type.
    """
    user = member.user
    debug_enabled = getattr(settings, 'DEBUG', False)

    # Check if user opted out of emails for this specific notification
    if notification.email_opted_out:
        if debug_enabled:
            print(f"[DEBUG NOTIF EMAIL] Skipped (user opted out): {notification.id}")
        return False

    # Check if email system is configured
    if not (hasattr(settings, 'EMAIL_HOST') and settings.EMAIL_HOST):
        if debug_enabled:
            print(f"[DEBUG NOTIF EMAIL] Skipped (EMAIL_HOST not configured) - Email system is not configured in settings")
        return False

    # Check if user has email
    if not user.email:
        if debug_enabled:
            print(f"[DEBUG NOTIF EMAIL] Skipped (user {user.username} has no email)")
        return False

    # Check if user has email notifications enabled
    if not user.email_notifications_enabled:
        if debug_enabled:
            print(f"[DEBUG NOTIF EMAIL] Skipped (user {user.username} has email_notifications_enabled=False)")
        return False

    # Check if user has this specific notification type enabled
    email_field = NOTIFICATION_TYPE_TO_EMAIL_FIELD.get(notification.notification_type)
    if not email_field or not getattr(user, email_field, False):
        if debug_enabled:
            print(f"[DEBUG NOTIF EMAIL] Skipped (user {user.username} has {email_field}=False for type {notification.notification_type})")
        return False

    if debug_enabled:
        print(f"[DEBUG NOTIF EMAIL] Attempting to send email to {user.email} for notification {notification.id} (type: {notification.notification_type})")

    try:
        from django.core.mail import send_mail

        type_label = NOTIFICATION_TYPE_LABELS.get(notification.notification_type, notification.notification_type)
        type_description = NOTIFICATION_TYPE_DESCRIPTIONS.get(notification.notification_type, '')

        subject = f'SweetMoney - {type_label}'

        base_url = getattr(settings, 'SITE_URL', '').rstrip('/')
        full_url = f'{base_url}{notification.target_url}' if base_url and notification.target_url else notification.target_url

        # Generate unsubscribe URL
        unsubscribe_url = f'{base_url}/notifications/{notification.id}/unsubscribe/{notification.unsubscribe_token}' if base_url else ''

        # Build email with summary and full hyperlink
        message = f'''Hi {user.first_name or user.username},

{type_label}
{type_description}

{notification.message}

'''

        # Only include links if SITE_URL is configured
        if base_url:
            if full_url:
                message += f'''
View details: {full_url}
'''
            if unsubscribe_url:
                message += f'''
Unsubscribe from these emails: {unsubscribe_url}
'''

        message += '''
--
SweetMoney - Family Finance Management
'''

        from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', 'noreply@sweetmoney.local')

        send_mail(
            subject,
            message,
            from_email,
            [user.email],
            fail_silently=True,
        )

        # Defer the database update until after the current transaction completes
        # This prevents "You can't execute queries until the end of the 'atomic' block" errors
        def update_email_timestamp():
            notification.last_email_sent_at = timezone.now()
            notification.save(update_fields=['last_email_sent_at'])

        transaction.on_commit(update_email_timestamp)
        return True

    except Exception as e:
        debug_enabled = getattr(settings, 'DEBUG', False)
        if debug_enabled:
            print(f"[DEBUG NOTIF EMAIL] Error sending email to {user.email}: {e}")
        return False


def create_overdue_notifications(family, member):
    """
    Creates notifications for overdue transactions AND upcoming due dates.
    Removes notifications when transactions are no longer overdue (paid or date updated).
    Does not create duplicates for transactions that have already been notified.

    IMPORTANT: Only creates notifications for FlowGroups the member has access to.
    This ensures users only receive notifications for transactions in FlowGroups
    they can actually see and access.
    """
    from ..models import Transaction, Notification, FlowGroup
    import datetime as dt
    from django.db.models import Q

    today = timezone.localdate()
    days_before = member.email_notify_overdue_days_before

    # Calculate warning threshold date
    # If days_before = 3 and today = Feb 12, warning_date = Feb 15
    # Notifications will be created on Feb 12 for transactions due Feb 15
    warning_date = today + dt.timedelta(days=days_before) if days_before > 0 else today

    debug_enabled = getattr(settings, 'DEBUG', False)

    if debug_enabled:
        print(f"[DEBUG OVERDUE] Checking for member: {member.user.username}")
        print(f"[DEBUG OVERDUE] Today: {today}")
        print(f"[DEBUG OVERDUE] Days before setting: {days_before}")
        print(f"[DEBUG OVERDUE] Warning date: {warning_date}")

    # Find transactions that are EITHER:
    # 1. Already overdue (date < today) AND unralized
    # 2. Due within warning period (date == warning_date) AND unralized
    transactions_to_check = Transaction.objects.filter(
        flow_group__family=family,
        realized=False,
    ).filter(
        Q(date__lt=today) | Q(date=warning_date)
    ).select_related('flow_group', 'member')

    if debug_enabled:
        print(f"[DEBUG OVERDUE] Transactions to check: {transactions_to_check.count()}")

    notifications_created = 0

    for transaction in transactions_to_check:
        # CRITICAL: Check if member has access to this FlowGroup before creating notification
        # Only notify users who have ACCESS to the FlowGroup containing the transaction
        has_access = check_member_access_to_flow_group(member, transaction.flow_group, transaction)

        if debug_enabled:
            print(f"[DEBUG OVERDUE] Transaction {transaction.id} ({transaction.description}): Member {member.user.username} has access: {has_access}")

        if not has_access:
            # Member does not have access to this FlowGroup - skip notification
            continue

        if transaction.date < today:
            # Already overdue
            days_overdue = (today - transaction.date).days
            if days_overdue == 1:
                message = _("Transaction '%(description)s' is %(days)d day overdue") % {
                    'description': transaction.description,
                    'days': days_overdue
                }
            else:
                message = _("Transaction '%(description)s' is %(days)d days overdue") % {
                    'description': transaction.description,
                    'days': days_overdue
                }
            notification_type = 'OVERDUE'
        elif transaction.date == warning_date and days_before > 0:
            # Upcoming warning
            message = _("Transaction '%(description)s' is due in %(days)d day(s)") % {
                'description': transaction.description,
                'days': days_before
            }
            notification_type = 'OVERDUE_WARNING'  # NEW TYPE for upcoming warnings
        else:
            continue

        # URL for FlowGroup
        target_url = reverse('edit_flow_group', kwargs={'group_id': transaction.flow_group.id}) + f"?period={transaction.flow_group.period_start_date.strftime('%Y-%m-%d')}"

        if debug_enabled:
            print(f"[DEBUG OVERDUE] Creating notification: {notification_type} - {message}")

        # Use get_or_create to prevent race conditions - ensures only ONE notification per transaction
        # Include notification_type in uniqueness check to allow both OVERDUE and OVERDUE_WARNING
        notif, created = Notification.objects.get_or_create(
            family=family,
            member=member,
            notification_type=notification_type,
            transaction=transaction,
            defaults={
                'flow_group': transaction.flow_group,
                'message': message,
                'target_url': target_url
            }
        )

        # Only send email and broadcast if this is a new notification
        if created:
            # Send email notification
            send_notification_email(member, notif)

            # Broadcast notification via WebSocket
            from finances.websocket_utils import WebSocketBroadcaster
            WebSocketBroadcaster.broadcast_to_family(
                family_id=family.id,
                message_type='notification_created',
                data={
                    'notification_id': notif.id,
                    'type': notif.notification_type,
                    'message': notif.message,
                    'target_url': notif.target_url,
                    'created_at': notif.created_at.isoformat()
                }
            )
            notifications_created += 1

    # Remove notifications for transactions that are NO LONGER overdue
    # This includes: realized transactions, future dates, or transactions that no longer exist
    all_overdue_notifs = Notification.objects.filter(
        member=member,
        notification_type__in=['OVERDUE', 'OVERDUE_WARNING']
    ).select_related('transaction')

    for notif in all_overdue_notifs:
        # Check if transaction still exists and is actually overdue
        transaction = notif.transaction
        if not transaction:
            # Transaction was deleted - remove notification
            notif_id = notif.id
            notif.delete()
            from finances.websocket_utils import WebSocketBroadcaster
            WebSocketBroadcaster.broadcast_to_family(
                family_id=family.id,
                message_type='notification_removed',
                data={
                    'notification_id': notif_id,
                    'type': notif.notification_type,
                    'transaction_id': None
                }
            )
            continue

        # Transaction exists - check if it's still overdue
        if transaction.realized or transaction.date >= today:
            # Transaction is no longer overdue - remove ALL notifications (acknowledged or not)
            notif_id = notif.id
            notif.delete()
            from finances.websocket_utils import WebSocketBroadcaster
            WebSocketBroadcaster.broadcast_to_family(
                family_id=family.id,
                message_type='notification_removed',
                data={
                    'notification_id': notif_id,
                    'type': notif.notification_type,
                    'transaction_id': transaction.id
                }
            )

    return notifications_created
def create_overbudget_notifications(family, member, flow_group_to_check=None):
    """
    Cria notificações para FlowGroups que excederam o orçamento.
    Remove notificações de overbudget quando o budget volta ao normal.

    IMPORTANTE: Cria APENAS UMA notificação por FlowGroup, independentemente
    de quantos itens/transações o FlowGroup possui.

    IMPORTANTE: Apenas cria notificações para FlowGroups que o membro tem acesso.
    Isso garante que usuários só recebam notificações de grupos que podem ver.

    Args:
    family: Family object
    member: FamilyMember object
    flow_group_to_check: Optional - se fornecido, verifica apenas este FlowGroup
    """
    from ..models import FlowGroup, Notification
    from django.db.models import Sum, Q
    import logging
    logger = logging.getLogger(__name__)

    debug_enabled = getattr(settings, 'DEBUG', False)

    if debug_enabled:
        print(f"[DEBUG OVERBUDGET] Checking overbudget notifications for {member.user.username}")
        print(f"[DEBUG OVERBUDGET] Family: {family.name} (ID: {family.id})")
        if flow_group_to_check:
            print(f"[DEBUG OVERBUDGET] Checking ONLY flow_group: {flow_group_to_check.name}")

    # Se fornecido flow_group_to_check, verifica apenas aquele FlowGroup
    if flow_group_to_check:
        # Verifica se é do tipo correto
        if not (flow_group_to_check.group_type == 'EXPENSE_MAIN' or flow_group_to_check.group_type == 'EXPENSE_SECONDARY'):
            if debug_enabled:
                print(f"[DEBUG OVERBUDGET] FlowGroup is not expense type, skipping")
            return 0

        expense_groups = [flow_group_to_check]
    else:
        # Filter only Expense Flow Groups (EXPENSE MAIN and EXPENSE SECONDARY)
        # IMPORTANT: Filtered by member access - only notify users who can see the FlowGroup
        expense_groups = FlowGroup.objects.filter(
            family=family
        ).filter(
            Q(group_type='EXPENSE_MAIN') | Q(group_type='EXPENSE_SECONDARY')
        )

    if debug_enabled:
        print(f"[DEBUG OVERBUDGET] Found {len(expense_groups)} expense groups to check")

    notifications_created = 0

    for flow_group in expense_groups:
        if debug_enabled:
            print(f"[DEBUG OVERBUDGET] Checking group: {flow_group.name} (ID: {flow_group.id}, type: {flow_group.group_type})")

        # CRITICAL: Check if member has access to this FlowGroup before creating notification
        # Only notify users who have ACCESS to the FlowGroup
        has_access = check_member_access_to_flow_group(member, flow_group)

        if debug_enabled:
            print(f"[DEBUG OVERBUDGET] Member {member.user.username} has access: {has_access}")

        if not has_access:
            # Member does not have access to this FlowGroup - skip notification
            continue

        # Calculate total amount spent
        # IMPORTANT: Sum works directly with MoneyField in django-money
        transaction_total = flow_group.transactions.aggregate(
            total=Sum('amount')
        )['total'] or Decimal('0')

        # Extract the amount value from Money object and convert to Decimal
        if hasattr(transaction_total , 'amount'):
            transaction_total  = Decimal(str(transaction_total .amount))
        else:
            transaction_total  = Decimal(str(transaction_total ))

        # Extract budgeted amount and convert to Decimal
        if hasattr(flow_group.budgeted_amount, 'amount'):
            budgeted = Decimal(str(flow_group.budgeted_amount.amount))
        else:
            budgeted = Decimal(str(flow_group.budgeted_amount))

        if debug_enabled:
            print(f"[DEBUG OVERBUDGET]   Realized total: {transaction_total }")
            print(f"[DEBUG OVERBUDGET]   Budgeted amount: {budgeted}")
            print(f"[DEBUG OVERBUDGET]   Is over budget? {transaction_total  > budgeted}")

        # Verifica se está acima do orçamento
        if transaction_total  > budgeted:
            over_amount = (transaction_total - budgeted).quantize(Decimal('0.01'))
            message = _("%(name)s is over budget by %(amount)s") % {
                'name': flow_group.name,
                'amount': over_amount
            }

            target_url = reverse('edit_flow_group', kwargs={'group_id': flow_group.id}) + f"?period={flow_group.period_start_date.strftime('%Y-%m-%d')}"

            if debug_enabled:
                print(f"[DEBUG OVERBUDGET]   Creating overbudget notification!")
                print(f"[DEBUG OVERBUDGET]   Message: {message}")
                print(f"[DEBUG OVERBUDGET]   Target URL: {target_url}")

            # Use get_or_create to prevent race conditions - ensures only ONE notification per FlowGroup
            notif, created = Notification.objects.get_or_create(
                family=family,
                member=member,
                notification_type='OVERBUDGET',
                flow_group=flow_group,
                defaults={
                    'message': message,
                    'target_url': target_url
                }
            )

            # Only send email and broadcast if this is a new notification
            if created:
                logger.info(f"[OVERBUDGET] Created notification for {member.user.username}: {flow_group.name} over by {over_amount}")

                # Send email notification
                send_notification_email(member, notif)

                # Broadcast notification via WebSocket
                if debug_enabled:
                    print(f"[DEBUG OVERBUDGET] Broadcasting notification_created via WebSocket")
                from finances.websocket_utils import WebSocketBroadcaster
                WebSocketBroadcaster.broadcast_to_family(
                    family_id=family.id,
                    message_type='notification_created',
                    data={
                        'notification_id': notif.id,
                        'type': notif.notification_type,
                        'message': notif.message,
                        'target_url': notif.target_url,
                        'created_at': notif.created_at.isoformat(),
                        'flow_group_id': flow_group.id
                    }
                )
                if debug_enabled:
                    print(f"[DEBUG OVERBUDGET] Broadcast sent successfully")
                notifications_created += 1
            else:
                logger.debug(f"[OVERBUDGET] Notification already existed (race condition avoided): {flow_group.name}")
        else:
            # Budget is back to normal - remove ALL overbudget notifications (acknowledged or not)
            # This ensures new notifications can be created if overbudget occurs again
            deleted_notifications = Notification.objects.filter(
                member=member,
                flow_group=flow_group,
                notification_type='OVERBUDGET'
            )

            if deleted_notifications.exists():
                # Get notification IDs before deleting
                notification_ids = list(deleted_notifications.values_list('id', flat=True))
                deleted_notifications.delete()

                # Broadcast removal for each deleted notification
                from finances.websocket_utils import WebSocketBroadcaster
                for notif_id in notification_ids:
                    WebSocketBroadcaster.broadcast_to_family(
                        family_id=family.id,
                        message_type='notification_removed',
                        data={
                            'notification_id': notif_id,
                            'type': 'OVERBUDGET',
                            'flow_group_id': flow_group.id
                        }
                    )

    return notifications_created


def create_new_transaction_notification(transaction, exclude_member=None, is_edit=False):
    """
    Creates notifications for a new or edited transaction.
    Removes old notifications from the same transaction before creating a new one.

    Args:
    transaction: Transaction instance
    exclude_member: FamilyMember who should not receive notifications (who created/edited)
    is_edit: Boolean indicating if this is an edit (True) or new transaction (False)
    """
    from ..models import FamilyMember, Notification

    debug_enabled = getattr(settings, 'DEBUG', False)

    if debug_enabled:
        print(f"[DEBUG NOTIF] Starting create_new_transaction_notification")
        print(f"[DEBUG NOTIF] Transaction: {transaction.id} - {transaction.description}")
        print(f"[DEBUG NOTIF] Exclude member: {exclude_member.user.username if exclude_member else 'None'}")

    family = transaction.flow_group.family
    flow_group = transaction.flow_group

    if debug_enabled:
        print(f"[DEBUG NOTIF] Family: {family.name}")
        print(f"[DEBUG NOTIF] FlowGroup: {flow_group.name} (ID: {flow_group.id})")
        print(f"[DEBUG NOTIF] FlowGroup type: {flow_group.group_type}")
        print(f"[DEBUG NOTIF] Is shared: {flow_group.is_shared}")
        print(f"[DEBUG NOTIF] Is kids group: {flow_group.is_kids_group}")
        print(f"[DEBUG NOTIF] Transaction is_child_expense: {transaction.is_child_expense}")
        print(f"[DEBUG NOTIF] Transaction is_child_manual_income: {transaction.is_child_manual_income}")

    # Determines who should receive the notification
    members_to_notify = []

    # For each family member
    all_members = family.members.all()

    if debug_enabled:
        print(f"[DEBUG NOTIF] Total family members: {all_members.count()}")

    for member in all_members:
        if debug_enabled:
            print(f"[DEBUG NOTIF] Checking member: {member.user.username} (role: {member.role}, ID: {member.id})")

        # Does not notify who created/edited the transaction
        if exclude_member and member.id == exclude_member.id:
            if debug_enabled:
                print(f"[DEBUG NOTIF]   -> Skipped (is the editor)")
            continue

        # Verifica se o membro tem acesso ao FlowGroup
        has_access = check_member_access_to_flow_group(member, flow_group, transaction)

        if has_access:
            members_to_notify.append(member)
            if debug_enabled:
                print(f"[DEBUG NOTIF]   -> WILL BE NOTIFIED")
        else:
            if debug_enabled:
                print(f"[DEBUG NOTIF]   -> NO ACCESS - will not be notified")

    if debug_enabled:
        print(f"[DEBUG NOTIF] Total members to notify: {len(members_to_notify)}")
    
    # Remove notifications for members who should NO LONGER be notified
    # (e.g., they lost access to the FlowGroup)
    members_to_notify_ids = [m.id for m in members_to_notify]
    deleted_count = Notification.objects.filter(
        transaction=transaction,
        notification_type='NEW_TRANSACTION',
        is_acknowledged=False
    ).exclude(
        member_id__in=members_to_notify_ids
    ).delete()[0]

    if debug_enabled and deleted_count > 0:
        print(f"[DEBUG NOTIF] Deleted {deleted_count} notifications for members who lost access")

    # Create or update notifications
    notifications_created = 0
    for member in members_to_notify:
        creator_name = exclude_member.user.username if exclude_member else _("Someone")

        # Mensagem simplificada - diferente para edição vs criação
        if is_edit:
            message = _("%(creator)s edited '%(description)s' in '%(group)s'") % {
                'creator': creator_name,
                'description': transaction.description,
                'group': flow_group.name
            }
        else:
            message = _("%(creator)s added '%(description)s' in '%(group)s'") % {
                'creator': creator_name,
                'description': transaction.description,
                'group': flow_group.name
            }

        # URL para o FlowGroup específico
        target_url = reverse('edit_flow_group', kwargs={'group_id': flow_group.id}) + f"?period={flow_group.period_start_date.strftime('%Y-%m-%d')}"

        if debug_enabled:
            print(f"[DEBUG NOTIF] Creating/updating notification for {member.user.username}")
            print(f"[DEBUG NOTIF]   Message: {message}")
            print(f"[DEBUG NOTIF]   Target URL: {target_url}")

        # Use update_or_create to prevent duplicate notifications and broadcasts
        notif, created = Notification.objects.update_or_create(
            family=family,
            member=member,
            notification_type='NEW_TRANSACTION',
            transaction=transaction,
            is_acknowledged=False,  # Only update unacknowledged notifications
            defaults={
                'flow_group': flow_group,
                'message': message,
                'target_url': target_url
            }
        )

        if debug_enabled:
            print(f"[DEBUG NOTIF]   Notification {'created' if created else 'updated'} with ID: {notif.id}")

        # Only send email and broadcast if this is a NEW notification
        if created:
            # Send email notification
            send_notification_email(member, notif)

            # Broadcast notification via WebSocket
            from finances.websocket_utils import WebSocketBroadcaster
            WebSocketBroadcaster.broadcast_to_family(
                family_id=family.id,
                message_type='notification_created',
                data={
                    'notification_id': notif.id,
                    'type': notif.notification_type,
                    'message': notif.message,
                    'target_url': notif.target_url,
                    'created_at': notif.created_at.isoformat()
                }
            )

            notifications_created += 1

    if debug_enabled:
        print(f"[DEBUG NOTIF] Total NEW notifications created: {notifications_created}")

    return notifications_created



def check_member_access_to_flow_group(member, flow_group, transaction=None):
    """
    Checks if a member has access to a FlowGroup.
    Considers child transactions.

    Args:

    member: FamilyMember instance
    flow_group: FlowGroup instance
    transaction: Transaction instance (optional, for special cases)

    Returns:
    bool: True if the member has access

    """
    from ..models import FlowGroupAccess

    debug_enabled = getattr(settings, 'DEBUG', False)

    if debug_enabled:
        print(f"[DEBUG ACCESS] Checking access for {member.user.username} to {flow_group.name}")
        print(f"[DEBUG ACCESS]   Member role: {member.role}")
        print(f"[DEBUG ACCESS]   FlowGroup owner: {flow_group.owner.username if flow_group.owner else 'None'}")
        print(f"[DEBUG ACCESS]   Is shared: {flow_group.is_shared}")
        print(f"[DEBUG ACCESS]   Is kids group: {flow_group.is_kids_group}")

    # ADMIN sempre tem acesso
    if member.role == 'ADMIN':
        if debug_enabled:
            print(f"[DEBUG ACCESS]   -> Access GRANTED (ADMIN)")
        return True
    
    # PARENT verifica vários critérios
    if member.role == 'PARENT':
        # Dono do FlowGroup
        if flow_group.owner == member.user:
            if debug_enabled:
                print(f"[DEBUG ACCESS]   -> Access GRANTED (owner)")
            return True

        # FlowGroup compartilhado
        if flow_group.is_shared:
            if debug_enabled:
                print(f"[DEBUG ACCESS]   -> Access GRANTED (shared group)")
            return True

        # Kids group (PARENT sempre vê)
        if flow_group.is_kids_group:
            if debug_enabled:
                print(f"[DEBUG ACCESS]   -> Access GRANTED (kids group)")
            return True

        # Membro explicitamente atribuído
        if flow_group.assigned_members.filter(id=member.id).exists():
            if debug_enabled:
                print(f"[DEBUG ACCESS]   -> Access GRANTED (assigned member)")
            return True

        # Transação de criança (PARENT sempre vê)
        if transaction and (transaction.is_child_expense or transaction.is_child_manual_income):
            if debug_enabled:
                print(f"[DEBUG ACCESS]   -> Access GRANTED (child transaction)")
            return True
    
    # CHILD verifica critérios específicos
    if member.role == 'CHILD':
        # Kids group onde foi atribuído
        if flow_group.is_kids_group and flow_group.assigned_children.filter(id=member.id).exists():
            if debug_enabled:
                print(f"[DEBUG ACCESS]   -> Access GRANTED (assigned to kids group)")
            return True

        # Acesso explícito via FlowGroupAccess
        if FlowGroupAccess.objects.filter(member=member, flow_group=flow_group).exists():
            if debug_enabled:
                print(f"[DEBUG ACCESS]   -> Access GRANTED (explicit access)")
            return True

    if debug_enabled:
        print(f"[DEBUG ACCESS]   -> Access DENIED")
    return False


def get_accessible_flow_groups(family, member):
    """
    Returns a QuerySet of FlowGroups accessible to the member.
    """
    from ..models import FlowGroup, FlowGroupAccess
    from django.db.models import Q
    
    if member.role == 'ADMIN':
        # Admin vê tudo
        return FlowGroup.objects.filter(family=family)
    
    elif member.role == 'PARENT':
        # Parent views: own, shared, kids groups, and where it was explicitly added
        return FlowGroup.objects.filter(
            Q(family=family) & (
                Q(owner=member.user) |
                Q(is_shared=True) |
                Q(is_kids_group=True) |
                Q(assigned_members=member)
            )
        ).distinct()
    
    elif member.role == 'CHILD':
        # Child sees: kids groups where it was assigned and flow groups with explicit access
        accessible_ids = set()
        
        # Kids groups
        kids_groups = FlowGroup.objects.filter(
            family=family,
            is_kids_group=True,
            assigned_children=member
        ).values_list('id', flat=True)
        accessible_ids.update(kids_groups)
        
        # FlowGroups with explicit access
        explicit_access = FlowGroupAccess.objects.filter(
            member=member
        ).values_list('flow_group_id', flat=True)
        accessible_ids.update(explicit_access)
        
        return FlowGroup.objects.filter(id__in=accessible_ids)
    
    return FlowGroup.objects.none()


def check_and_create_notifications(family, member):
    """
    Verifica e cria todas as notificações necessárias para um membro.
    Chamada periodicamente ou quando o usuário acessa o sistema.
    Nota: Esta função verifica TODOS os FlowGroups (uso periódico/scheduler)
    """
    overdue_count = create_overdue_notifications(family, member)
    overbudget_count = create_overbudget_notifications(family, member)  # Sem flow_group_to_check = verifica todos
    
    return {
        'overdue': overdue_count,
        'overbudget': overbudget_count
    }