// finances/static/finances/js/post_update.js
// Version: 20261017-001 - Admin dropdown identify flow, general admin
// selection, all-users email assignment with disabled OK until complete

(function () {
    'use strict';

    const i18n = () => window.POST_UPDATE_I18N || {};

    function getCookie(name) {
        const value = document.cookie
            .split('; ')
            .find(row => row.startsWith(name + '='));
        return value ? decodeURIComponent(value.split('=')[1]) : '';
    }

    async function postJson(url, payload) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify(payload || {})
        });
        let data;
        try {
            data = await response.json();
        } catch (e) {
            throw new Error(i18n().invalidResponse || 'Unexpected response from the server.');
        }
        if (!response.ok && !data.error) {
            throw new Error(i18n().invalidResponse || 'Unexpected response from the server.');
        }
        return data;
    }

    function showError(elementId, message) {
        const el = document.getElementById(elementId);
        if (!el) {
            console.error('[PostUpdate] ' + message);
            return;
        }
        el.textContent = message;
        el.classList.remove('hidden');
    }

    function hideError(elementId) {
        const el = document.getElementById(elementId);
        if (el) el.classList.add('hidden');
    }

    // --- Stage 1: identify (admin dropdown + password) ---
    const identifyForm = document.getElementById('identify-form');
    if (identifyForm) {
        identifyForm.addEventListener('submit', async function (event) {
            event.preventDefault();
            hideError('identify-error');

            const adminId = document.getElementById('identify-admin').value;
            const password = document.getElementById('identify-password').value;
            const btn = document.getElementById('btn-identify');
            btn.disabled = true;

            try {
                const data = await postJson('/post-update/identify/', {
                    admin_id: adminId,
                    password: password
                });
                if (data.success) {
                    window.location.reload();
                } else {
                    showError('identify-error', data.error || (i18n().invalidResponse || 'Unexpected response.'));
                }
            } catch (error) {
                showError('identify-error', error.message);
            } finally {
                btn.disabled = false;
            }
        });
    }

    // --- Stage 2: choose the general admin of the account ---
    const chooseForm = document.getElementById('choose-admin-form');
    if (chooseForm) {
        const select = document.getElementById('choose-admin-select');
        const passwords = document.getElementById('choose-admin-passwords');
        const passwordInput = document.getElementById('choose-admin-password');
        const confirmInput = document.getElementById('choose-admin-confirm');
        const btn = document.getElementById('btn-choose-admin');

        function updateChooseState() {
            const chosen = select.value;
            passwords.classList.toggle('hidden', !chosen);
            btn.disabled = !chosen;
        }

        select.addEventListener('change', function () {
            hideError('choose-admin-error');
            passwordInput.value = '';
            confirmInput.value = '';
            updateChooseState();
        });
        updateChooseState();

        chooseForm.addEventListener('submit', async function (event) {
            event.preventDefault();
            hideError('choose-admin-error');

            const choice = select.value;
            const password = passwordInput.value;
            const confirm = confirmInput.value;
            if (!choice) return;
            if (password !== confirm) {
                showError('choose-admin-error', i18n().passwordMismatch || 'Passwords do not match.');
                return;
            }

            btn.disabled = true;
            try {
                const data = await postJson('/post-update/choose-admin/', {
                    choice: choice,
                    password: password,
                    confirm: confirm
                });
                if (data.success) {
                    window.location.reload();
                } else {
                    showError('choose-admin-error', data.error || (i18n().invalidResponse || 'Unexpected response.'));
                }
            } catch (error) {
                showError('choose-admin-error', error.message);
            } finally {
                btn.disabled = false;
            }
        });
    }

    // --- Stage 3: emails for every user (OK disabled until all filled) ---
    const membersList = document.getElementById('members-list');
    const saveForm = document.getElementById('save-emails-form');

    function updateSaveButton() {
        const btn = document.getElementById('btn-save-emails');
        if (!btn || !membersList) return;
        const inputs = Array.from(membersList.querySelectorAll('input[type="email"]'));
        btn.disabled = inputs.some(function (input) { return !input.value.trim(); });
    }

    function renderMembers(members) {
        membersList.innerHTML = '';
        members.forEach(function (member) {
            const row = document.createElement('div');
            row.className = 'flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4';

            const label = document.createElement('div');
            label.className = 'sm:w-1/3';
            const name = document.createElement('p');
            name.className = 'font-medium text-gray-900 dark:text-white';
            name.textContent = member.username;
            const meta = document.createElement('p');
            meta.className = 'text-xs text-gray-500 dark:text-gray-400';
            meta.textContent = member.role + ' \u00b7 ' + member.family;
            label.appendChild(name);
            label.appendChild(meta);

            const input = document.createElement('input');
            input.type = 'email';
            input.required = true;
            input.placeholder = 'user@email.com';
            input.dataset.memberId = member.member_id;
            input.value = member.email || '';
            input.className = 'flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-teal-500';
            input.addEventListener('input', updateSaveButton);

            row.appendChild(label);
            row.appendChild(input);
            membersList.appendChild(row);
        });
        updateSaveButton();
    }

    if (saveForm && membersList) {
        fetch('/post-update/step-data/', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function (response) { return response.json(); })
            .then(function (data) {
                if (data.success && data.members) {
                    renderMembers(data.members);
                }
            })
            .catch(function (error) {
                console.error('[PostUpdate] Failed to load members:', error);
            });

        saveForm.addEventListener('submit', async function (event) {
            event.preventDefault();
            hideError('save-emails-errors');

            const emails = {};
            membersList.querySelectorAll('input[type="email"]').forEach(function (input) {
                emails[input.dataset.memberId] = input.value.trim();
            });

            const btn = document.getElementById('btn-save-emails');
            btn.disabled = true;

            try {
                const data = await postJson('/post-update/save-emails/', { emails: emails });
                if (data.success) {
                    // Reload: either more steps remain or the finalize box appears
                    window.location.reload();
                } else {
                    const errors = (data.errors || []).join('\n');
                    showError('save-emails-errors', (i18n().saveError || 'Some emails could not be saved:') + '\n' + errors);
                    updateSaveButton();
                }
            } catch (error) {
                showError('save-emails-errors', error.message);
                updateSaveButton();
            }
        });
    }
})();
