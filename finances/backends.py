# finances/backends.py
"""
Custom authentication backend for SweetMoney.

Login is strictly by email (usernames may repeat across families, so they
cannot uniquely identify an account). Users with role 'ADMIN' are blocked
from interactive login — admin sessions can only be reached through the
permission-elevation flow (see elevate_to_admin_view).
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend

from .models import FamilyMember


class NonAdminModelBackend(ModelBackend):
    """
    Extends Django's ModelBackend to:

    * Authenticate strictly by email (``CustomUser.email`` is not unique at
      the database level — admins carry no email — so candidates are
      iterated and application-level uniqueness guarantees at most one
      non-admin match).
    * Deny interactive login for ADMIN users — admin sessions can only be
      reached through the permission-elevation flow (``elevate_to_admin_view``).

    The elevate view calls ``login()`` directly with ``ModelBackend`` (the
    parent class), bypassing the ADMIN restriction.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        if username is None:
            username = kwargs.get(get_user_model().USERNAME_FIELD)
        if username is None or password is None:
            return

        UserModel = get_user_model()
        # Strict email login: match candidates by email only. ADMIN users
        # are excluded by user_can_authenticate() below, so the standard
        # login form can never resolve to an admin account.
        candidates = UserModel._default_manager.filter(email__iexact=username)

        for user in candidates:
            if user.check_password(password) and self.user_can_authenticate(user):
                return user

        # Run default password-setting to avoid timing attack regardless of
        # whether a user was found.
        UserModel().set_password(password)
        return None

    def user_can_authenticate(self, user):
        # First, let the parent decide (checks is_active etc.)
        if not super().user_can_authenticate(user):
            return False

        # Deny login for ADMIN users via the standard login form
        try:
            member = FamilyMember.objects.get(user=user)
            if member.role == 'ADMIN':
                return False
        except FamilyMember.DoesNotExist:
            # User has no FamilyMember record yet (e.g. during initial setup)
            # — allow authentication so setup can complete.
            pass

        return True

    def get_user(self, user_id):
        # Session validation must accept ADMIN users: admin sessions are
        # created by the elevation flow (elevate_to_admin_view), which logs
        # in without going through authenticate(). Only is_active matters
        # here; interactive login remains blocked in authenticate() above.
        UserModel = get_user_model()
        try:
            user = UserModel._default_manager.get(pk=user_id)
        except UserModel.DoesNotExist:
            return None
        return user if user.is_active else None
