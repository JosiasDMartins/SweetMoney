# finances/views/views_post_update.py
"""
Post-update screen: runs on the first startup after an update (OTA local,
OTA GitHub or backup restore) and locks the system until finalized.

Flow:
1. GET  /post-update/               - runs migrations + pending update scripts
                                      (once, retried on failure) and renders
                                      the screen with corrective steps
2. POST /post-update/identify/      - step "assign_emails" (stage 1): selects
                                      an admin user from a dropdown and
                                      authenticates with that admin's password
3. POST /post-update/choose-admin/  - stage 2: chooses the single general
                                      admin of the account (an existing admin
                                      or a newly created one), sets its
                                      password and demotes every other admin
                                      to PARENT
4. GET  /post-update/step-data/     - stage payloads for the current stage
5. POST /post-update/save-emails/   - stage 3: saves emails for all non-admin
                                      users, re-validating (loop until every
                                      non-admin user of every family has a
                                      unique email)
6. POST /post-update/finalize/      - writes SystemVersion = VERSION and
                                      unlocks the system

The screen works without login because users may be unable to log in
(login is strictly by email and emails may be missing at this point).
"""

import json

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction as db_transaction
from django.http import JsonResponse, HttpResponseRedirect
from django.shortcuts import render, redirect
from django.urls import reverse
from django.utils.translation import gettext as _
from django.views.decorators.http import require_GET, require_POST

from ..context_processors import VERSION
from ..models import Family, FamilyMember, SystemVersion
from ..post_update_steps import get_pending_steps
from ..utils_user import build_admin_username, email_taken_by_non_admin
from .views_updater import (
    execute_update_script,
    get_available_update_scripts,
    get_db_version,
    run_migrations,
)

MAX_PASSWORD_ATTEMPTS = 5


def _redirect_to_post_update():
    return HttpResponseRedirect(reverse('post_update'))


def _apply_update_phase():
    """
    Run migrations + pending update scripts. Returns (ok, results) where
    results is a list of {'type', 'status', 'output'} dicts.
    """
    results = []
    ok, output = run_migrations()
    results.append({'type': 'migration', 'status': 'ok' if ok else 'error', 'output': output[-2000:]})
    if not ok:
        return False, results

    for script in get_available_update_scripts(get_db_version(), VERSION):
        entry = {'type': 'script', 'filename': script['filename'], 'version': script['version']}
        try:
            entry['output'] = execute_update_script(script['path'])[-2000:]
            entry['status'] = 'ok'
        except Exception as exc:
            entry['status'] = 'error'
            entry['output'] = str(exc)
            results.append(entry)
            return False, results
        results.append(entry)

    return True, results


def _admins_payload():
    """Every ADMIN member in the system (technical accounts, one per family
    is the norm, but legacy data may hold more)."""
    return [
        {
            'member_id': m.id,
            'username': m.user.username,
            'family': m.family.name,
        }
        for m in FamilyMember.objects.filter(role='ADMIN')
        .select_related('user', 'family')
        .order_by('family__name', 'user__username')
    ]


def _users_payload():
    """Every non-ADMIN member in the system: each of them must end up with a
    unique email before the update can be finalized."""
    return [
        {
            'member_id': m.id,
            'username': m.user.username,
            'family': m.family.name,
            'role': m.role,
            'email': m.user.email or '',
        }
        for m in FamilyMember.objects
        .exclude(role='ADMIN')
        .select_related('user', 'family')
        .order_by('family__name', 'user__username')
    ]


@require_GET
def post_update_view(request):
    """Render the post-update screen; run the automatic phase once."""
    if get_db_version() == VERSION:
        return redirect('dashboard')

    results = request.session.get('post_update_results')
    phase_ok = request.session.get('post_update_phase_ok')

    if results is None or not phase_ok:
        phase_ok, results = _apply_update_phase()
        request.session['post_update_phase_ok'] = phase_ok
        request.session['post_update_results'] = results

    context = {
        'db_version': get_db_version(),
        'target_version': VERSION,
        'phase_results': results,
        'phase_ok': phase_ok,
        'pending_steps': get_pending_steps() if phase_ok else [],
        'admins': _admins_payload(),
        'authed': bool(request.session.get('post_update_authed')),
        'family_id': request.session.get('post_update_family_id'),
    }
    return render(request, 'finances/post_update.html', context)


@require_POST
def post_update_retry(request):
    """Clear the recorded phase result and retry migrations/scripts."""
    request.session.pop('post_update_results', None)
    request.session.pop('post_update_phase_ok', None)
    return _redirect_to_post_update()


def _json_error(message, status=400):
    return JsonResponse({'success': False, 'error': message}, status=status)


def _parse_json_body(request):
    try:
        return json.loads(request.body), None
    except (json.JSONDecodeError, ValueError):
        return None, _json_error(_('Invalid request.'), status=400)


@require_POST
def post_update_identify(request):
    """
    Stage 1 of the assign-emails step: authenticate with one of the admin
    users listed in the dropdown. Rate-limited by session.
    """
    data, error = _parse_json_body(request)
    if error:
        return error

    admin_id = data.get('admin_id')
    password = data.get('password') or ''
    try:
        admin_id = int(admin_id)
    except (TypeError, ValueError):
        return _json_error(_('Select an admin user and enter its password.'))

    if not password:
        return _json_error(_('Select an admin user and enter its password.'))

    attempts = request.session.get('post_update_attempts', 0)
    if attempts >= MAX_PASSWORD_ATTEMPTS:
        return _json_error(
            _('Too many attempts. Restart your browser and try again.'), status=429
        )

    admin_member = FamilyMember.objects.filter(
        id=admin_id,
        role='ADMIN',
    ).select_related('user', 'family').first()

    if not admin_member or not admin_member.user.check_password(password):
        request.session['post_update_attempts'] = attempts + 1
        remaining = MAX_PASSWORD_ATTEMPTS - (attempts + 1)
        return _json_error(
            _('Incorrect admin password. Attempts left: %(remaining)s') % {'remaining': remaining}
        )

    request.session['post_update_authed'] = True
    request.session['post_update_admin_family_id'] = admin_member.family_id
    request.session['post_update_attempts'] = 0
    return JsonResponse({'success': True, 'admins': _admins_payload()})


@require_POST
def post_update_choose_admin(request):
    """
    Stage 2 of the assign-emails step: choose the single general admin of
    the account - either an existing admin or a newly created one - set its
    password and demote every other admin to PARENT.
    """
    if not request.session.get('post_update_authed'):
        return _json_error(_('Identify with an admin user first.'))

    data, error = _parse_json_body(request)
    if error:
        return error

    choice = str(data.get('choice') or '')
    password = data.get('password') or ''
    confirm = data.get('confirm') or ''

    if not choice:
        return _json_error(_('Choose the general admin of the account.'))
    if not password or password != confirm:
        return _json_error(_('Password and confirmation are required and must match.'))

    with db_transaction.atomic():
        if choice == 'new':
            # New admin for the identified family, standard naming pattern
            family_id = request.session.get('post_update_admin_family_id')
            family = None
            if family_id:
                member = FamilyMember.objects.filter(
                    family_id=family_id
                ).select_related('family').first()
                family = member.family if member else None
            if family is None:
                family = Family.objects.first()
            if family is None:
                return _json_error(_('No family found to create the admin for.'))

            UserModel = get_user_model()
            new_user = UserModel.objects.create_user(
                username=build_admin_username(family.name),
                password=password,
            )
            chosen = FamilyMember.objects.create(
                user=new_user,
                family=family,
                role='ADMIN',
            )
        else:
            try:
                member_id = int(choice)
            except (TypeError, ValueError):
                return _json_error(_('Invalid admin selection.'))
            chosen = FamilyMember.objects.filter(
                id=member_id,
                role='ADMIN',
            ).select_related('user', 'family').first()
            if not chosen:
                return _json_error(_('Invalid admin selection.'))
            chosen.user.set_password(password)
            chosen.user.save()

        # The chosen admin is the only ADMIN left in the account; every
        # other admin is demoted to PARENT (and will then need an email).
        FamilyMember.objects.filter(role='ADMIN').exclude(id=chosen.id).update(role='PARENT')

    request.session['post_update_family_id'] = chosen.family_id
    return JsonResponse({
        'success': True,
        'admin_username': chosen.user.username,
        'members': _users_payload(),
    })


@require_GET
def post_update_step_data(request):
    """Return the payload of the current assign-emails stage."""
    if request.session.get('post_update_family_id'):
        return JsonResponse({
            'success': True,
            'stage': 'emails',
            'members': _users_payload(),
            'pending_steps': [p['id'] for p in get_pending_steps()],
        })

    if request.session.get('post_update_authed'):
        return JsonResponse({
            'success': True,
            'stage': 'choose_admin',
            'admins': _admins_payload(),
            'pending_steps': [p['id'] for p in get_pending_steps()],
        })

    return JsonResponse({
        'success': True,
        'stage': 'identify',
        'admins': _admins_payload(),
        'pending_steps': [p['id'] for p in get_pending_steps()],
    })


@require_POST
def post_update_save_emails(request):
    """
    Save emails for the non-admin users. Validates format and uniqueness
    among non-admin users (across every family); keeps the system locked
    until every non-admin user of every family has an email assigned.
    """
    if not request.session.get('post_update_family_id'):
        return _json_error(_('Complete the admin selection step first.'))

    data, error = _parse_json_body(request)
    if error:
        return error

    emails = data.get('emails') or {}
    if not isinstance(emails, dict) or not emails:
        return _json_error(_('No emails to save.'))

    members = {
        m.id: m for m in FamilyMember.objects
        .exclude(role='ADMIN')
        .select_related('user')
    }

    errors = []
    seen_emails = set()
    for member_id_raw, email in emails.items():
        try:
            member_id = int(member_id_raw)
        except (TypeError, ValueError):
            errors.append(_('Invalid member.'))
            continue

        member = members.get(member_id)
        if not member:
            errors.append(_('Invalid member.'))
            continue

        email = (email or '').strip()
        try:
            validate_email(email)
        except ValidationError:
            errors.append(_("%(username)s: invalid email.") % {'username': member.user.username})
            continue

        email_lc = email.lower()
        if email_lc in seen_emails or email_taken_by_non_admin(email, exclude_user_id=member.user_id):
            errors.append(_("%(username)s: this email is already in use.") % {'username': member.user.username})
            continue
        seen_emails.add(email_lc)

        member.user.email = email
        member.user.save()

    pending = get_pending_steps()
    return JsonResponse({
        'success': len(errors) == 0,
        'errors': errors,
        'pending_steps': [p['id'] for p in pending],
        'complete': not pending,
    })


@require_POST
def post_update_finalize(request):
    """Write the code version to the DB and unlock the system."""
    pending = get_pending_steps()
    if pending:
        is_ajax = (request.headers.get('X-Requested-With') == 'XMLHttpRequest'
                   or request.content_type == 'application/json')
        if is_ajax:
            return JsonResponse({
                'success': False,
                'error': _('There are still pending post-update steps.'),
                'pending_steps': [p['id'] for p in pending],
            }, status=400)
        # Plain form post: render the screen again (steps still pending)
        return _redirect_to_post_update()

    with db_transaction.atomic():
        SystemVersion.set_version(VERSION)

    for key in (
        'post_update_family_id',
        'post_update_admin_family_id',
        'post_update_authed',
        'post_update_attempts',
        'post_update_results',
        'post_update_phase_ok',
    ):
        request.session.pop(key, None)

    # The OK button is a native form post and expects a redirect; JSON
    # clients (API/tests) get a success payload instead.
    is_ajax = (request.headers.get('X-Requested-With') == 'XMLHttpRequest'
               or request.content_type == 'application/json')
    if is_ajax:
        return JsonResponse({'success': True, 'redirect_url': reverse('dashboard')})
    return redirect('dashboard')
