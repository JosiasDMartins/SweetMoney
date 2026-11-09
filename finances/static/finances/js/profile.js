// Version: 20260626-001 - Added admin elevation handler
'use strict';

document.addEventListener('DOMContentLoaded', function() {
    // Admin Mode elevation translations (injected from template)
    var t = window.PROFILE_I18N || {};

    var btnAdminMode = document.getElementById('btn-admin-mode');
    if (btnAdminMode) {
        btnAdminMode.addEventListener('click', function() {
            var modal = document.getElementById('generic-modal');
            var modalTitle = document.getElementById('modal-title');
            var modalMessage = document.getElementById('modal-message');
            var modalButtons = document.getElementById('modal-buttons');
            var iconContainer = document.getElementById('modal-icon-container');
            var icon = document.getElementById('modal-icon');

            if (!modal) return;

            // Set up icon (warning style)
            iconContainer.className = 'mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full sm:mx-0 sm:h-10 sm:w-10 bg-red-100 dark:bg-red-900/20';
            icon.className = 'h-6 w-6 text-red-600 dark:text-red-500';
            icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />';

            modalTitle.textContent = t.adminMode || 'Admin Mode';
            modalMessage.innerHTML =
                '<p class="text-sm text-gray-600 dark:text-gray-300 mb-3">' +
                (t.elevationWarning || 'You are about to enter Admin Mode. Please enter the admin password for your family to continue.') +
                '</p>' +
                '<input type="password" id="admin-elevate-password" ' +
                'class="w-full border rounded-lg bg-background-light dark:bg-background-dark border-slate-300 dark:border-slate-700 focus:ring-red-500 focus:border-red-500 text-slate-800 dark:text-slate-200 p-3" ' +
                'placeholder="' + (t.adminPassword || 'Admin password') + '" autofocus>';

            // Clear buttons and create custom ones
            modalButtons.innerHTML = '';

            var btnCancel = document.createElement('button');
            btnCancel.type = 'button';
            btnCancel.textContent = t.cancel || 'Cancel';
            btnCancel.className = 'inline-flex w-full justify-center rounded-lg px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-inset bg-white hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white ring-gray-300 dark:ring-gray-600 sm:w-auto';
            btnCancel.addEventListener('click', function() {
                window.GenericModal.hide();
            });

            var btnElevate = document.createElement('button');
            btnElevate.type = 'button';
            btnElevate.textContent = t.elevate || 'Elevate';
            btnElevate.className = 'inline-flex w-full justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm bg-red-600 hover:bg-red-700 sm:w-auto';
            btnElevate.addEventListener('click', function() {
                var pwInput = document.getElementById('admin-elevate-password');
                var password = pwInput ? pwInput.value : '';
                if (!password) {
                    pwInput.focus();
                    return;
                }

                // Disable button and show loading
                btnElevate.disabled = true;
                btnElevate.textContent = t.elevating || 'Elevating...';

                fetch('/elevate-to-admin/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCookie('csrftoken')
                    },
                    body: JSON.stringify({ password: password })
                }).then(function(response) {
                    return response.json();
                }).then(function(data) {
                    if (data.success) {
                        window.location.href = data.redirect_url || '/';
                    } else {
                        // Re-enable button
                        btnElevate.disabled = false;
                        btnElevate.textContent = t.elevate || 'Elevate';
                        // Show error
                        var errorMsg = document.createElement('p');
                        errorMsg.className = 'text-sm text-red-600 dark:text-red-400 mt-2';
                        errorMsg.textContent = data.error || (t.failedElevate || 'Failed to elevate.');
                        var msgContainer = document.getElementById('modal-message');
                        var existing = msgContainer.querySelector('p.text-red-600');
                        if (existing) existing.remove();
                        msgContainer.appendChild(errorMsg);
                    }
                }).catch(function(error) {
                    btnElevate.disabled = false;
                    btnElevate.textContent = t.elevate || 'Elevate';
                    alert(t.networkError || 'Network error. Please try again.');
                });
            });

            modalButtons.appendChild(btnCancel);
            modalButtons.appendChild(btnElevate);

            modal.classList.remove('hidden');

            // Focus password input after modal is shown
            setTimeout(function() {
                var pwInput = document.getElementById('admin-elevate-password');
                if (pwInput) pwInput.focus();
            }, 100);
        });
    }

    // Overdue days before field toggle (existing functionality)
    var emailOverdueCheckbox = document.getElementById('email_notify_overdue');
    var overdueDaysPanel = document.getElementById('email-overdue-days-before-wrapper');
    if (emailOverdueCheckbox && overdueDaysPanel) {
        emailOverdueCheckbox.addEventListener('change', function() {
            overdueDaysPanel.style.display = this.checked ? 'block' : 'none';
        });
    }
});

// Helper to get CSRF cookie
function getCookie(name) {
    var cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        var cookies = document.cookie.split(';');
        for (var i = 0; i < cookies.length; i++) {
            var cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}
