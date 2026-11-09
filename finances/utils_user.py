# finances/utils_user.py
"""
Helpers for technical admin usernames and user display names.

Admin accounts are technical users (one per family) that cannot log in
directly; they are only reachable through the permission-elevation flow.
Their usernames follow the pattern ``admin_<family_slug>_<NN>`` where NN
increments (01, 02, ...) per family-name slug in registration order.
"""

import re
import unicodedata

from django.contrib.auth import get_user_model


def slugify_family_name(family_name):
    """
    Convert a family name into a slug suitable for admin usernames:
    lowercase, accents stripped, non-alphanumeric runs collapsed to '_'.
    """
    normalized = unicodedata.normalize('NFKD', str(family_name or ''))
    ascii_name = normalized.encode('ascii', 'ignore').decode('ascii').lower()
    slug = re.sub(r'[^a-z0-9]+', '_', ascii_name).strip('_')
    return slug or 'family'


def build_admin_username(family_name):
    """
    Return the next available admin username for a family name, following
    the pattern admin_<slug>_<NN> (NN zero-padded, starting at 01).
    """
    slug = slugify_family_name(family_name)
    UserModel = get_user_model()
    pattern = r'^admin_%s_[0-9]{2}$' % re.escape(slug)
    existing = UserModel.objects.filter(username__regex=pattern).count()
    return 'admin_%s_%02d' % (slug, existing + 1)


def display_name(user):
    """
    Human-friendly name for a user: ADMIN members are always shown as
    'admin' (their real username is technical); anyone else is shown by
    username.
    """
    from .models import FamilyMember

    if user is None:
        return ''
    try:
        member = FamilyMember.objects.filter(user=user).first()
        if member and member.role == 'ADMIN':
            return 'admin'
    except Exception:
        pass
    return user.username


def get_users_missing_email():
    """
    Return FamilyMember objects (non-ADMIN) whose user has no email set.
    Used by the post-update 'assign emails' corrective step.
    """
    from django.db.models import Q
    from .models import FamilyMember

    return list(
        FamilyMember.objects
        .exclude(role='ADMIN')
        .select_related('user', 'family')
        .filter(Q(user__email__isnull=True) | Q(user__email=''))
        .order_by('family__id', 'user__username')
    )


def email_taken_by_non_admin(email, exclude_user_id=None):
    """
    True if a non-ADMIN user already uses this email. Admin accounts carry
    no login email, so they are excluded from uniqueness checks.
    """
    from .models import FamilyMember

    if not email:
        return False
    qs = FamilyMember.objects.exclude(role='ADMIN').filter(
        user__email__iexact=email
    )
    if exclude_user_id is not None:
        qs = qs.exclude(user_id=exclude_user_id)
    return qs.exists()


def username_taken_in_family(family, username, exclude_user_id=None):
    """
    True if a non-ADMIN member of this family already uses this username.
    Usernames may repeat across different families; admins hold technical
    usernames that never collide with user-chosen ones.
    """
    from .models import FamilyMember

    if not username:
        return False
    qs = FamilyMember.objects.filter(
        family=family,
        role__in=['PARENT', 'CHILD'],
    ).filter(user__username__iexact=username)
    if exclude_user_id is not None:
        qs = qs.exclude(user_id=exclude_user_id)
    return qs.exists()
