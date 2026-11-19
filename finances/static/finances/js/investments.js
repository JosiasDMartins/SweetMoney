// ============================================
// INVESTMENTS.JS - v1.8.0 investments module
// ============================================
// Grid rendering helpers, Add/Edit/Deposit/Withdraw modals (GenericModal),
// realtime updates. CSP compliant: no inline handlers, no native alert().
// Version: 20261116-001 - rate/IR inputs hard-capped at XXX.YY (issue #44
// comment 333): max 3 integer digits + 2 decimals, plus card/detail rate
// display normalized to 2 decimals
// Previous: 20261114-002 - country-fixed currency field hard-locked (disabled
// + lock icon, issue #44 comment 326); custom international keeps dropdown
// (issue #44 comment 324)
// Previous: 20261110-001
// Replaces: realtime-only stub (20251231-001)

(function () {
    'use strict';

    var config, i18n;

    function boot() {
        config = document.getElementById('investments-config');
        if (!config) return;
        i18n = window.INVESTMENTS_I18N = readI18N();
        registerRealtimeHandlers();
    }

    function readI18N() {
        var el = document.getElementById('investments-i18n');
        if (!el) return {};
        try {
            return JSON.parse(el.textContent);
        } catch (e) {
            console.error('[Investments] Invalid i18n JSON', e);
            return {};
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
        }).then(function (response) {
            return response.json().then(function (data) {
                return { ok: response.ok, status: response.status, data: data };
            });
        });
    }

    function ajaxGet(url) {
        return fetch(url, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        }).then(function (response) {
            return response.json().then(function (data) {
                return { ok: response.ok, data: data };
            });
        });
    }

    // Money inputs: RTL cents mask + raw value for the payload
    function mountMoneyField(container) {
        var input = container.querySelector('input[data-field="amount"]');
        if (input && window.initializeMoneyInputs) {
            window.initializeMoneyInputs('input[data-field="amount"]');
        }
        if (input && window.initializeCursorPositioning) {
            window.initializeCursorPositioning('input[data-field="amount"]');
        }
        capRateFields();
        return input;
    }

    function rawAmount(input) {
        if (!input) return NaN;
        if (window.parseLocaleNumber) return window.parseLocaleNumber(input.value);
        return parseFloat(String(input.value).replace(/\./g, '').replace(',', '.'));
    }

    // Rate fields are hard-capped at XXX.YY (comment 333): at most 3
    // integer digits + 2 decimals. The shared money mask stores digits as
    // cents, so the cap is 5 digits total.
    var RATE_MAX_DIGITS = 5;
    var RATE_MAX_VALUE = 999.99;

    function capRateFields() {
        var fields = document.querySelectorAll('input[data-rate-capped="true"]');
        for (var i = 0; i < fields.length; i++) {
            var input = fields[i];
            if (input.dataset.rateCapBound) continue;
            input.dataset.rateCapBound = '1';
            input.addEventListener('keydown', blockRateKeystroke);
            input.addEventListener('input', trimRateValue);
        }
    }

    function rateDigitCount(input) {
        var value = String(input.value);
        var selected = value.substring(input.selectionStart || 0, input.selectionEnd || 0);
        return value.replace(/\D/g, '').length - selected.replace(/\D/g, '').length;
    }

    function blockRateKeystroke(event) {
        if (event.key === '-' || event.key === '+' || event.key === 'e' || event.key === 'E') {
            event.preventDefault();
            return;
        }
        var isDigit = event.key >= '0' && event.key <= '9';
        if (isDigit && rateDigitCount(event.target) >= RATE_MAX_DIGITS) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    function trimRateValue(event) {
        var input = event.target;
        var digits = String(input.value).replace(/\D/g, '');
        if (digits.length > RATE_MAX_DIGITS) {
            input.value = digits.slice(0, RATE_MAX_DIGITS);
        }
    }

    function formatRate(value) {
        if (value === null || value === undefined || value === '') {
            return i18n.na || 'n/a';
        }
        var num = Number(value);
        if (isNaN(num)) return String(value);
        return String(num) + '%';
    }

    function symbols() {
        try {
            return JSON.parse(config.dataset.symbols || '{}');
        } catch (e) {
            return {};
        }
    }

    function symbolFor(code) {
        var map = symbols();
        return map[code] || code + ' ';
    }

    // ============================================================
    // Grid rendering (idempotent upsert keyed by investment id)
    // ============================================================

    function esc(value) {
        var div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML;
    }

    function cardHtml(inv) {
        var rate = formatRate(inv.annual_rate);
        var symbol = symbolFor(inv.currency);
        var maturity = inv.maturity_date
            ? '<p class="text-xs text-gray-500 dark:text-gray-400 mb-2">' + esc(i18n.maturity) + ': ' + esc(inv.maturity_date) + '</p>'
            : '';
        var periodParam = new URLSearchParams(window.location.search).get('period');
        var detailUrl = '/investments/' + inv.id + '/' + (periodParam ? '?period=' + encodeURIComponent(periodParam) : '');
        return ''
            + '<div class="flex items-start justify-between gap-2 mb-2">'
            + '<h3 class="font-semibold text-[#0d171b] dark:text-white text-sm leading-snug break-words">' + esc(inv.name) + '</h3>'
            + '<span class="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">' + esc(inv.currency) + '</span>'
            + '</div>'
            + '<p class="text-xs text-gray-500 dark:text-gray-400 mb-1">' + esc(inv.plugin_name) + '</p>'
            + '<p class="text-xs text-gray-500 dark:text-gray-400 mb-2">' + esc(i18n.rate) + ': ' + esc(rate) + '</p>'
            + maturity
            + '<p class="text-lg font-bold text-[#0d171b] dark:text-white mb-3 investment-balance" data-currency="' + esc(inv.currency) + '">'
            + esc(symbol) + ' ' + esc(formatNumber(inv.balance)) + '</p>'
            + '<div class="mt-auto grid grid-cols-2 gap-1.5 text-xs">'
            + '<button type="button" data-action="invest-deposit" data-id="' + inv.id + '" data-currency="' + esc(inv.currency) + '"'
            + ' class="px-2 py-1.5 rounded-lg font-semibold bg-green-600 text-white hover:bg-green-700">' + esc(i18n.deposit) + '</button>'
            + '<button type="button" data-action="invest-withdraw" data-id="' + inv.id + '" data-currency="' + esc(inv.currency) + '"'
            + ' class="px-2 py-1.5 rounded-lg font-semibold bg-orange-500 text-white hover:bg-orange-600">' + esc(i18n.withdraw) + '</button>'
            + '<button type="button" data-action="invest-edit" data-id="' + inv.id + '"'
            + ' class="px-2 py-1.5 rounded-lg font-semibold bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">' + esc(i18n.edit) + '</button>'
            + '<a href="' + detailUrl + '"'
            + ' class="px-2 py-1.5 rounded-lg font-semibold text-center bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 hover:brightness-95">' + esc(i18n.details) + '</a>'
            + '</div>';
    }

    function formatNumber(value) {
        var num = parseFloat(value);
        if (isNaN(num)) return value;
        return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function upsertCard(inv) {
        var grid = document.getElementById('investments-grid');
        if (!grid) return;
        var addBtn = grid.querySelector('[data-action="invest-add"]');
        var empty = document.getElementById('investments-empty');
        if (empty) empty.remove();
        var card = document.getElementById('investment-card-' + inv.id);
        if (!card) {
            card = document.createElement('div');
            card.id = 'investment-card-' + inv.id;
            card.className = 'bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 flex flex-col';
            grid.insertBefore(card, addBtn);
        }
        card.setAttribute('data-investment-id', inv.id);
        card.innerHTML = cardHtml(inv);
        refreshSummaries(inv.currency);
    }

    // ============================================================
    // Summaries: active-currency silo only
    // ============================================================

    function activeCurrency() {
        return config.dataset.activeCurrency || '';
    }

    function refreshSummaries(changedCurrency) {
        if (changedCurrency && changedCurrency !== activeCurrency()) return;
        var periodParam = new URLSearchParams(window.location.search).get('period');
        var suffix = periodParam ? '?period=' + encodeURIComponent(periodParam) : '';
        var symbol = symbolFor(activeCurrency());
        ajaxGet(config.dataset.ajaxUrl + suffix)
            .then(function (res) {
                if (!res.ok || !res.data || res.data.status !== 'success') return;
                var el = document.getElementById('available-balance');
                if (el) {
                    el.textContent = symbol + ' ' + formatNumber(res.data.available_balance);
                }
            }).catch(function () { /* realtime-only refresh */ });
        ajaxGet(config.dataset.urlList).then(function (res) {
            if (!res.ok || !res.data || res.data.status !== 'success') return;
            var el = document.getElementById('total-invested');
            if (el) {
                el.textContent = (res.data.currency_symbol || symbol) + ' '
                    + formatNumber(res.data.total_invested);
            }
        }).catch(function () { /* realtime-only refresh */ });
    }

    // ============================================================
    // Modals (GenericModal)
    // ============================================================

    function plugins() {
        try {
            return JSON.parse(config.dataset.plugins || '[]');
        } catch (e) {
            return [];
        }
    }

    // System-supported currencies (same serialization as the sidebar
    // currency menu - no duplicate payload on the page)
    function currencyChoices() {
        var el = document.getElementById('currency-menu-data');
        if (!el) return [];
        try {
            return JSON.parse(el.dataset.choices || '[]');
        } catch (e) {
            return [];
        }
    }

    function pluginByCode(code) {
        var list = plugins();
        for (var i = 0; i < list.length; i++) {
            if (list[i].code === code) return list[i];
        }
        return null;
    }

    function fieldRow(labelText, innerHtml) {
        return '<div class="mb-3 text-left">'
            + '<label class="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">' + esc(labelText) + '</label>'
            + innerHtml
            + '</div>';
    }

    function moneyInput(id, initial, capped) {
        return '<input type="text" id="' + id + '" data-field="amount" inputmode="decimal"'
            + (capped ? ' data-rate-capped="true"' : '')
            + ' class="w-full border rounded-lg bg-white dark:bg-gray-700 border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 p-2 text-right" '
            + 'value="' + esc(initial || '') + '" placeholder="0.00">';
    }

    function textInput(id, initial) {
        return '<input type="text" id="' + id + '" '
            + 'class="w-full border rounded-lg bg-white dark:bg-gray-700 border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 p-2" '
            + 'value="' + esc(initial || '') + '">';
    }

    function dateInput(id, initial) {
        return '<input type="date" id="' + id + '" '
            + 'class="w-full border rounded-lg bg-white dark:bg-gray-700 border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 p-2" '
            + 'value="' + esc(initial || '') + '">';
    }

    function pluginDropdown(selected) {
        var options = '';
        var groups = {};
        plugins().forEach(function (p) {
            var key = p.group || 'other';
            (groups[key] = groups[key] || []).push(p);
        });
        Object.keys(groups).sort().forEach(function (key) {
            options += '<optgroup label="' + esc(key) + '">';
            groups[key].forEach(function (p) {
                var sel = p.code === selected ? ' selected' : '';
                var suffix = p.currency ? ' (' + esc(p.currency) + ')' : '';
                options += '<option value="' + esc(p.code) + '"' + sel + '>'
                    + esc(p.name) + suffix + '</option>';
            });
            options += '</optgroup>';
        });
        return '<select id="invest-plugin" '
            + 'class="w-full border rounded-lg bg-white dark:bg-gray-700 border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 p-2">'
            + options + '</select>';
    }

    function inlineErrorBox() {
        return '<div id="invest-form-error" class="hidden text-sm text-red-600 dark:text-red-400 mb-2"></div>';
    }

    function showFormError(message) {
        var box = document.getElementById('invest-form-error');
        if (!box) {
            window.GenericModal.alert(message);
            return;
        }
        box.textContent = message;
        box.classList.remove('hidden');
    }

    function cancelBtn() {
        return {
            text: i18n.cancel,
            className: 'bg-white hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white ring-1 ring-inset ring-gray-300 dark:ring-gray-600',
            onClick: null
        };
    }

    function currencyLockedHtml(code) {
        // Country-locked mode (issue #44 comment 326): the field must be
        // visibly uneditable — disabled input + lock icon. The server sets
        // the currency from the plugin regardless of any client value.
        return '<div class="flex items-center gap-2">'
            + '<input type="text" id="invest-currency" disabled '
            + 'class="w-full border rounded-lg bg-gray-100 dark:bg-gray-900 border-slate-300 dark:border-slate-600 text-slate-500 dark:text-gray-400 p-2 cursor-not-allowed" '
            + 'value="' + esc(code || '') + '">'
            + '<span class="material-symbols-outlined text-base text-slate-400" aria-hidden="true">lock</span>'
            + '</div>';
    }

    function currencySelectHtml(selected) {
        var options = currencyChoices().map(function (choice) {
            var sel = choice.code === selected ? ' selected' : '';
            return '<option value="' + esc(choice.code) + '"' + sel + '>'
                + esc(choice.label || choice.code) + '</option>';
        }).join('');
        return '<select id="invest-currency" '
            + 'class="w-full border rounded-lg bg-white dark:bg-gray-700 border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 p-2">'
            + options + '</select>';
    }

    function renderCurrencyField(plugin) {
        var row = document.getElementById('invest-currency-row');
        if (!row) return;
        // Country mode (incl. country Custom): locked to the country's
        // currency. Free mode (Custom International): dropdown of the
        // system's supported currencies, default = active silo.
        var mode = plugin.currency ? 'locked-' + plugin.currency : 'free';
        if (row.dataset.mode === mode) return;
        row.dataset.mode = mode;
        row.innerHTML = plugin.currency
            ? currencyLockedHtml(plugin.currency)
            : currencySelectHtml(activeCurrency() || 'USD');
    }

    function openAddModal() {
        window.GenericModal.show({
            type: 'info',
            title: i18n.addInvestment,
            message: inlineErrorBox()
                + fieldRow(i18n.name, textInput('invest-name', ''))
                + fieldRow(i18n.type, pluginDropdown(plugins().length ? plugins()[0].code : ''))
                + fieldRow(i18n.rate, moneyInput('invest-rate', '', true))
                + '<div id="invest-gic-fields" class="hidden">'
                + fieldRow(i18n.maturity, dateInput('invest-maturity', ''))
                + '</div>'
                + '<div id="invest-ir-field" class="hidden">'
                + fieldRow(i18n.ir, moneyInput('invest-ir', '0', true))
                + '</div>'
                + '<div class="mb-3 text-left">'
                + '<label class="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">' + esc(i18n.currency) + '</label>'
                + '<div id="invest-currency-row"></div>'
                + '</div>',
            buttons: [
                {
                    text: i18n.save,
                    className: 'bg-green-600 hover:bg-green-700 text-white',
                    primary: true,
                    onClick: function () { submitAdd(); }
                },
                cancelBtn()
            ]
        });
        wirePluginDependencies(null);
        mountMoneyField(document);
    }

    function wirePluginDependencies(initialInvestment) {
        var select = document.getElementById('invest-plugin');
        if (!select) return;
        var sync = function () {
            var plugin = pluginByCode(select.value);
            if (!plugin) return;
            renderCurrencyField(plugin);
            var gic = document.getElementById('invest-gic-fields');
            if (gic) gic.classList.toggle('hidden', plugin.code !== 'gic');
            var ir = document.getElementById('invest-ir-field');
            if (ir) ir.classList.toggle('hidden', plugin.code !== 'rdb_nubank');
        };
        select.addEventListener('change', sync);
        if (initialInvestment) {
            renderCurrencyField(pluginByCode(initialInvestment.plugin_code) || { currency: initialInvestment.currency });
            var gic = document.getElementById('invest-gic-fields');
            if (gic) gic.classList.toggle('hidden', initialInvestment.plugin_code !== 'gic');
            var ir = document.getElementById('invest-ir-field');
            if (ir) ir.classList.toggle('hidden', initialInvestment.plugin_code !== 'rdb_nubank');
        } else {
            sync();
        }
    }

    function submitAdd() {
        var name = (document.getElementById('invest-name') || {}).value || '';
        var rateRaw = rawAmount(document.getElementById('invest-rate'));
        if (!isNaN(rateRaw) && rateRaw > RATE_MAX_VALUE) {
            showFormError(i18n.rateLimit);
            return;
        }
        var selectedCode = (document.getElementById('invest-plugin') || {}).value || 'cash';
        var payload = {
            name: name.trim(),
            plugin_code: selectedCode,
            annual_rate: isNaN(rateRaw) ? null : rateRaw
        };
        var selectedPlugin = pluginByCode(selectedCode);
        if (selectedPlugin && !selectedPlugin.currency) {
            // Free-currency plugin (Custom International): send the chosen
            // currency; the server re-validates it against the choices.
            payload.currency = ((document.getElementById('invest-currency') || {}).value || '').trim();
        }
        var maturity = (document.getElementById('invest-maturity') || {}).value;
        if (payload.plugin_code === 'gic' && maturity) payload.maturity_date = maturity;
        var irRaw = rawAmount(document.getElementById('invest-ir'));
        if (payload.plugin_code === 'rdb_nubank' && !isNaN(irRaw)) payload.ir_rate = irRaw;
        if (!payload.name) {
            showFormError(i18n.nameRequired);
            return;
        }
        ajaxPost(config.dataset.urlAdd, payload).then(function (res) {
            if (!res.ok) {
                showFormError((res.data && res.data.error) || i18n.networkError);
                return;
            }
            upsertCard(res.data.investment);
            window.GenericModal.close();
        }).catch(function () {
            showFormError(i18n.networkError);
        });
    }

    function findInvestment(id, done) {
        ajaxGet(config.dataset.urlList).then(function (res) {
            var list = (res.data && res.data.investments) || [];
            for (var i = 0; i < list.length; i++) {
                if (String(list[i].id) === String(id)) {
                    done(list[i]);
                    return;
                }
            }
            done(null);
        }).catch(function () { done(null); });
    }

    function openEditModal(id) {
        findInvestment(id, function (inv) {
            if (!inv) return;
            window.GenericModal.show({
                type: 'info',
                title: i18n.editInvestment,
                message: inlineErrorBox()
                    + fieldRow(i18n.name, textInput('invest-name', inv.name))
                    + '<div class="mb-3 text-left"><label class="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">'
                    + esc(i18n.type) + '</label><input type="text" readonly value="' + esc(inv.plugin_name) + ' ('
                    + esc(inv.currency) + ')" class="w-full border rounded-lg bg-gray-100 dark:bg-gray-900 border-slate-300 dark:border-slate-600 text-slate-500 dark:text-gray-400 p-2"></div>'
                    + fieldRow(i18n.rate, moneyInput('invest-rate', inv.annual_rate || '', true))
                    + '<div id="invest-gic-fields" class="' + (inv.plugin_code === 'gic' ? '' : 'hidden') + '">'
                    + fieldRow(i18n.maturity, dateInput('invest-maturity', inv.maturity_date || ''))
                    + '</div>'
                    + '<div id="invest-ir-field" class="' + (inv.plugin_code === 'rdb_nubank' ? '' : 'hidden') + '">'
                    + fieldRow(i18n.ir, moneyInput('invest-ir', inv.ir_rate || '0', true))
                    + '</div>'
                    + fieldRow(i18n.newBalance, moneyInput('invest-new-balance', inv.balance))
                    + fieldRow(i18n.adjustNote, textInput('invest-adjust-note', '')),
                buttons: [
                    {
                        text: i18n.save,
                        className: 'bg-green-600 hover:bg-green-700 text-white',
                        primary: true,
                        onClick: function () { submitEdit(inv); }
                    },
                    cancelBtn()
                ]
            });
            mountMoneyField(document);
        });
    }

    function submitEdit(inv) {
        var payload = { name: ((document.getElementById('invest-name') || {}).value || '').trim() };
        var rateRaw = rawAmount(document.getElementById('invest-rate'));
        if (!isNaN(rateRaw) && rateRaw > RATE_MAX_VALUE) {
            showFormError(i18n.rateLimit);
            return;
        }
        payload.annual_rate = isNaN(rateRaw) ? null : rateRaw;
        if (inv.plugin_code === 'gic') {
            payload.maturity_date = (document.getElementById('invest-maturity') || {}).value || null;
        }
        if (inv.plugin_code === 'rdb_nubank') {
            var irRaw = rawAmount(document.getElementById('invest-ir'));
            payload.ir_rate = isNaN(irRaw) ? 0 : irRaw;
        }
        var balanceInput = document.getElementById('invest-new-balance');
        var balanceRaw = rawAmount(balanceInput);
        if (balanceInput && !isNaN(balanceRaw) && String(balanceInput.value).trim() !== '') {
            payload.new_balance = balanceRaw;
            payload.adjust_note = (document.getElementById('invest-adjust-note') || {}).value || '';
        }
        if (!payload.name) {
            showFormError(i18n.nameRequired);
            return;
        }
        ajaxPost('/api/investments/edit/' + inv.id + '/', payload).then(function (res) {
            if (!res.ok) {
                showFormError((res.data && res.data.error) || i18n.networkError);
                return;
            }
            upsertCard(res.data.investment);
            window.GenericModal.close();
        }).catch(function () {
            showFormError(i18n.networkError);
        });
    }

    function openDepositModal(id, currency) {
        window.GenericModal.show({
            type: 'info',
            title: i18n.deposit + ' (' + currency + ')',
            message: inlineErrorBox()
                + fieldRow(i18n.amount, moneyInput('invest-amount', ''))
                + '<div class="flex items-center gap-2 text-left mb-1">'
                + '<input type="checkbox" id="invest-deduct" checked '
                + 'class="h-4 w-4 rounded border-slate-300 text-green-600 focus:ring-green-500">'
                + '<label for="invest-deduct" class="text-sm text-slate-700 dark:text-slate-200">' + esc(i18n.deduct) + '</label>'
                + '</div>',
            buttons: [
                {
                    text: i18n.confirm,
                    className: 'bg-green-600 hover:bg-green-700 text-white',
                    primary: true,
                    onClick: function () { submitDeposit(id); }
                },
                cancelBtn()
            ]
        });
        mountMoneyField(document);
    }

    function submitDeposit(id) {
        var amount = rawAmount(document.getElementById('invest-amount'));
        if (isNaN(amount) || amount <= 0) {
            showFormError(i18n.amountRequired);
            return;
        }
        var deduct = !!(document.getElementById('invest-deduct') || {}).checked;
        ajaxPost('/api/investments/deposit/' + id + '/', {
            amount: amount,
            deduct_from_available: deduct
        }).then(function (res) {
            if (!res.ok) {
                showFormError((res.data && res.data.error) || i18n.networkError);
                return;
            }
            upsertCard(res.data.investment);
            window.GenericModal.close();
        }).catch(function () {
            showFormError(i18n.networkError);
        });
    }

    function openWithdrawModal(id, currency) {
        window.GenericModal.show({
            type: 'info',
            title: i18n.withdraw + ' (' + currency + ')',
            message: inlineErrorBox()
                + fieldRow(i18n.amount, moneyInput('invest-amount', '')),
            buttons: [
                {
                    text: i18n.confirm,
                    className: 'bg-orange-500 hover:bg-orange-600 text-white',
                    primary: true,
                    onClick: function () { submitWithdraw(id); }
                },
                cancelBtn()
            ]
        });
        mountMoneyField(document);
    }

    function submitWithdraw(id) {
        var amount = rawAmount(document.getElementById('invest-amount'));
        if (isNaN(amount) || amount <= 0) {
            showFormError(i18n.amountRequired);
            return;
        }
        ajaxPost('/api/investments/withdraw/' + id + '/', { amount: amount })
            .then(function (res) {
                if (!res.ok) {
                    showFormError((res.data && res.data.error) || i18n.networkError);
                    return;
                }
                upsertCard(res.data.investment);
                window.GenericModal.close();
            }).catch(function () {
                showFormError(i18n.networkError);
            });
    }

    // ============================================================
    // Actions + realtime
    // ============================================================

    function handleAction(action, target) {
        if (action === 'invest-add') {
            openAddModal();
            return true;
        }
        if (action === 'invest-edit') {
            openEditModal(target.getAttribute('data-id'));
            return true;
        }
        if (action === 'invest-deposit') {
            openDepositModal(target.getAttribute('data-id'), target.getAttribute('data-currency'));
            return true;
        }
        if (action === 'invest-withdraw') {
            openWithdrawModal(target.getAttribute('data-id'), target.getAttribute('data-currency'));
            return true;
        }
        return false;
    }

    document.addEventListener('click', function (event) {
        var target = event.target.closest('[data-action]');
        if (!target) return;
        handleAction(target.getAttribute('data-action'), target);
    });

    function registerRealtimeHandlers() {
        if (!window.wsManager || !window.wsManager.registerHandler) return;
        window.wsManager.registerHandler('investment_updated', function (payload) {
            var inv = payload && payload.data ? payload.data : payload;
            if (!inv || !inv.id) return;
            upsertCard(inv);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
