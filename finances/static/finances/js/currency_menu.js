// finances/static/finances/js/currency_menu.js
// Version: 20261114-001 - click-only menu on every device (issue #44
// comment 324): hover no longer opens/closes; the menu opens by clicking
// the multi-currency toggle inside the Dashboard pill and stays open
// until a currency is picked or any other element is clicked
// Previous: 20261112-001
/**
 * Sidebar multi-currency menu (v1.8.0, reworked per issue #44 comments
 * 230 and 324).
 *
 * The toggle lives INSIDE the Dashboard pill. Behavior:
 * - Click on the multi-currency toggle opens/closes the submenu; the
 *   Dashboard link itself never opens it (it just navigates).
 * - The submenu stays open until a currency chip is clicked (collapses,
 *   then navigates), another element of the page is clicked, or Escape
 *   is pressed. No hover handling on any device (same as mobile).
 * - Extra currencies registered: toggle renders green with the active
 *   currency code; none: gray, click reveals the square "+ Add" button.
 * CSP compliant: no inline handlers, no native alert/confirm.
 */
(function () {
    'use strict';

    function getI18N() {
        var el = document.getElementById('currency-menu-i18n');
        if (!el) return {};
        try {
            return JSON.parse(el.textContent);
        } catch (e) {
            console.error('[CurrencyMenu] Invalid i18n JSON', e);
            return {};
        }
    }

    function getChoices() {
        var el = document.getElementById('currency-menu-data');
        if (!el) return { choices: [], current: [] };
        try {
            return {
                choices: JSON.parse(el.dataset.choices || '[]'),
                current: JSON.parse(el.dataset.currencies || '[]')
            };
        } catch (e) {
            console.error('[CurrencyMenu] Invalid data JSON', e);
            return { choices: [], current: [] };
        }
    }

    function getCsrf() {
        return window.getCookie ? window.getCookie('csrftoken') : '';
    }

    function ajaxPost(url, payload) {
        return fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrf(),
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify(payload)
        }).then(function (response) { return response.json(); });
    }

    function canManage() {
        var el = document.getElementById('currency-menu-data');
        return !!el && el.dataset.canManage === 'true';
    }

    function wrapper() { return document.getElementById('currency-menu-wrapper'); }
    function submenu() { return document.getElementById('currency-submenu'); }
    function toggle() { return document.getElementById('currency-menu-toggle'); }

    function isOpen() {
        var el = submenu();
        return !!el && el.classList.contains('currency-submenu-open');
    }

    function openSubmenu() {
        var el = submenu();
        var t = toggle();
        if (!el || isOpen()) return;
        el.classList.remove('currency-submenu-closing');
        el.classList.add('currency-submenu-open');
        if (t) t.setAttribute('aria-expanded', 'true');
    }

    function closeSubmenu(immediate) {
        var el = submenu();
        var t = toggle();
        if (!el || !isOpen()) return;
        if (t) t.setAttribute('aria-expanded', 'false');
        if (immediate) {
            el.classList.remove('currency-submenu-open', 'currency-submenu-closing');
            return;
        }
        el.classList.remove('currency-submenu-open');
        el.classList.add('currency-submenu-closing');
        el.addEventListener('animationend', function onEnd() {
            el.removeEventListener('animationend', onEnd);
            el.classList.remove('currency-submenu-closing');
        });
    }

    function bindOutsideClose() {
        document.addEventListener('click', function (event) {
            var w = wrapper();
            if (!w || !isOpen()) return;
            if (!w.contains(event.target)) closeSubmenu(false);
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') closeSubmenu(false);
        });
    }

    function buildAddModalHtml(available) {
        var i18n = getI18N();
        var options = available.map(function (choice) {
            return '<option value="' + choice.code + '">' +
                (choice.label || choice.code) + '</option>';
        }).join('');
        return (
            '<div class="space-y-4 text-left">' +
            '<div>' +
            '<label class="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">' +
            (i18n.currency || 'Currency') + '</label>' +
            '<select id="currency-add-select" class="w-full border rounded-lg bg-white dark:bg-gray-700 border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 p-2">' +
            options +
            '</select>' +
            '</div>' +
            '<div id="currency-add-error" class="hidden text-sm text-red-600 dark:text-red-400"></div>' +
            '</div>'
        );
    }

    function buildRemoveSection(current) {
        var i18n = getI18N();
        if (!current.length) return '';
        var rows = current.map(function (code) {
            return (
                '<div class="flex items-center justify-between py-1">' +
                '<span class="text-sm font-semibold text-slate-700 dark:text-slate-200">' + code + '</span>' +
                '<button type="button" data-action="remove-currency" data-currency="' + code + '" ' +
                'class="p-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">' +
                '<span class="material-symbols-outlined text-base">delete</span></button>' +
                '</div>'
            );
        }).join('');
        return (
            '<div class="mt-3 pt-3 border-t border-slate-200 dark:border-slate-600">' +
            '<p class="text-xs text-slate-500 dark:text-slate-400 mb-1">' +
            (i18n.removeHint || 'Removing a currency only hides its chip; its data is kept.') +
            '</p>' + rows + '</div>'
        );
    }

    function openAddModal() {
        var data = getChoices();
        var i18n = getI18N();
        var current = data.current || [];
        var available = (data.choices || []).filter(function (choice) {
            return current.indexOf(choice.code) === -1;
        });

        if (!available.length) {
            window.GenericModal.alert(i18n.limitReached || 'Currency limit reached: a family can have at most 3 currencies.');
            return;
        }

        window.GenericModal.show({
            type: 'info',
            title: i18n.addCurrency || 'Add Currency',
            message: buildAddModalHtml(available) + buildRemoveSection(current),
            buttons: [
                {
                    text: i18n.add || 'Add',
                    primary: true,
                    onClick: function () { submitAdd(); }
                },
                {
                    text: i18n.cancel || 'Cancel',
                    className: 'secondary',
                    callback: null
                }
            ]
        });
    }

    function showInlineError(message) {
        var box = document.getElementById('currency-add-error');
        if (!box) {
            window.GenericModal.alert(message);
            return;
        }
        box.textContent = message;
        box.classList.remove('hidden');
    }

    function submitAdd() {
        var select = document.getElementById('currency-add-select');
        var dataEl = document.getElementById('currency-menu-data');
        if (!select || !dataEl) return;
        var code = select.value;
        ajaxPost(dataEl.dataset.urlAdd, { code: code })
            .then(function (data) {
                if (data.error) {
                    showInlineError(data.error);
                    return;
                }
                window.location.reload();
            })
            .catch(function () {
                showInlineError(getI18N().errorGeneric || 'A server error occurred.');
            });
    }

    function removeCurrency(code) {
        var i18n = getI18N();
        var dataEl = document.getElementById('currency-menu-data');
        if (!dataEl) return;
        window.confirm(
            code + ': ' + (i18n.removeConfirm || 'Remove this currency? Its chip will disappear; the data is kept.'),
            i18n.confirmTitle || 'Confirm Action'
        ).then(function (confirmed) {
            if (!confirmed) return;
            ajaxPost(dataEl.dataset.urlRemove, { code: code })
                .then(function (data) {
                    if (data.error) {
                        window.GenericModal.alert(data.error);
                        return;
                    }
                    window.location.reload();
                })
                .catch(function () {
                    window.GenericModal.alert(i18n.errorGeneric || 'A server error occurred.');
                });
        });
    }

    function handleAction(action, target) {
        if (action === 'toggle-currency-menu') {
            if (isOpen()) {
                closeSubmenu(false);
            } else {
                openSubmenu();
            }
            return true;
        }
        if (action === 'select-currency') {
            // Collapse immediately; the link navigation then re-renders the
            // toggle icon with the selected currency's identity.
            closeSubmenu(true);
            return false;
        }
        if (action === 'add-currency' && canManage()) {
            openAddModal();
            return true;
        }
        if (action === 'remove-currency' && canManage()) {
            removeCurrency(target.getAttribute('data-currency'));
            return true;
        }
        return false;
    }

    document.addEventListener('click', function (event) {
        var target = event.target.closest('[data-action]');
        if (!target) return;
        handleAction(target.getAttribute('data-action'), target);
    });

    document.addEventListener('DOMContentLoaded', function () {
        bindOutsideClose();
    });

    // Real-time: keep chips in sync when another member changes currencies
    document.addEventListener('DOMContentLoaded', function () {
        if (window.wsManager && window.wsManager.registerHandler) {
            window.wsManager.registerHandler('family_currency_changed', function () {
                window.location.reload();
            });
        }
    });
})();
