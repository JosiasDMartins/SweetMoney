# finances/post_update_steps.py
"""
Registry of corrective steps for the post-update screen.

When the DB version differs from the code version, the whole system locks
and every request is redirected to /post-update/ (see
PostUpdateRequiredMiddleware). That screen runs migrations + pending update
scripts once, then walks the user through every registered corrective step
until none is pending; only then can the version be finalized.

Each step is registered with:
    step_id   - unique identifier (used by views/templates/JS)
    check()   - returns None when nothing is pending, otherwise an opaque
                payload (dict) describing the pending work

New corrective steps for future updates just append to STEPS below.
"""

from .utils_user import get_users_missing_email


def _check_assign_emails():
    """
    Login is strictly by email, so every non-ADMIN user must have one.
    Users without email cannot log in until the email is assigned here.
    """
    missing = get_users_missing_email()
    if not missing:
        return None
    return {
        'count': len(missing),
        'families': sorted({m.family.name for m in missing}),
    }


STEPS = [
    {
        'id': 'assign_emails',
        'check': _check_assign_emails,
    },
]


def get_pending_steps():
    """Return a list of {'id': ..., **payload} for steps with pending work."""
    pending = []
    for step in STEPS:
        try:
            payload = step['check']()
        except Exception:
            # A failing check must not unlock the system; treat as pending.
            payload = {'count': 0, 'families': [], 'error': True}
        if payload:
            pending.append({'id': step['id'], **payload})
    return pending
