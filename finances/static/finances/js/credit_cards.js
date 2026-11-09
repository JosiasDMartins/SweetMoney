// Version: 20261105-002
/**
 * Credit Cards dashboard box (v1.7.2).
 * Handles: card list rendering helpers, simplified Add/Edit card modal,
 * bill close toggle, card deletion, slide ordering and real-time sync.
 * Rows are clickable and open the card's FlowGroup page; the info cell
 * renders the due line (closing day, past-due and closed pills) and the
 * over-budget warning.
 */
(function () {
    'use strict';

    function getConfig() {
        const el = document.getElementById('dashboard-config') ||
            document.getElementById('base-config') ||
            document.getElementById('flowgroup-config');
        return el ? el.dataset : {};
    }

    function getI18N() {
        const el = document.getElementById('credit-cards-i18n');
        if (!el) return {};
        try {
            return JSON.parse(el.textContent);
        } catch (e) {
            console.error('[CreditCards] Invalid i18n JSON', e);
            return {};
        }
    }

    function getCsrf() {
        return window.getCookie ? window.getCookie('csrftoken') : '';
    }

    function canManage() {
        return getConfig().canManageCreditCards === 'true';
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
        }).then(response => response.json());
    }

    function formatMoney(value) {
        const config = getConfig();
        return window.formatCurrency(
            value,
            config.currencySymbol || '$',
            config.thousandSeparator || ',',
            config.decimalSeparator || '.'
        );
    }

    // ---------- row rendering ----------

    function buildRow(card) {
        const tr = document.createElement('tr');
        tr.id = 'credit-card-' + card.id;
        tr.setAttribute('data-card-id', card.id);
        tr.setAttribute('data-card-name', card.name);
        tr.setAttribute('data-card-due-day', card.due_day == null ? '' : card.due_day);
        tr.setAttribute('data-card-shared', card.is_shared ? 'true' : 'false');
        tr.setAttribute('data-card-closed', card.closed ? 'true' : 'false');
        tr.setAttribute('data-card-overdue', card.bill_overdue ? 'true' : 'false');
        tr.setAttribute('data-card-over-budget', card.over_budget ? 'true' : 'false');
        tr.setAttribute('data-card-order', card.order || 0);
        tr.setAttribute('draggable', 'true');
        tr.className = 'draggable-card-row cursor-pointer' + (card.closed ? ' opacity-60' : '') +
            ' hover:bg-slate-50 dark:hover:bg-gray-700/50';
        tr.innerHTML = rowInnerHtml(card);
        return tr;
    }

    function cardFromRow(row) {
        const dueDay = row.getAttribute('data-card-due-day');
        return {
            id: row.getAttribute('data-card-id'),
            name: row.getAttribute('data-card-name') || '',
            due_day: dueDay === '' || dueDay === null ? null : Number(dueDay),
            closed: row.getAttribute('data-card-closed') === 'true',
            bill_overdue: row.getAttribute('data-card-overdue') === 'true',
            over_budget: row.getAttribute('data-card-over-budget') === 'true'
        };
    }

    function renderInfoCell(row) {
        const cell = row.querySelector('td.card-info-cell');
        if (cell) cell.innerHTML = infoCellHtml(cardFromRow(row));
    }

    function infoCellHtml(card) {
        const i18n = getI18N();
        let dueLine;
        if (card.due_day != null) {
            dueLine = '<span class="text-gray-500 dark:text-gray-400">' +
                formatDueLabel(card.due_day) + '</span>';
            if (card.bill_overdue && !card.closed) {
                dueLine += '<span class="card-overdue-badge inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium" title="' +
                    escapeHtml(i18n.billPastDueTitle || '') + '">' +
                    '<span class="material-symbols-outlined text-sm">error</span>' +
                    escapeHtml(i18n.billPastDue || 'Bill past due') + '</span>';
            }
        } else {
            dueLine = '<span class="text-amber-600 dark:text-amber-400 font-medium inline-flex items-center gap-1">' +
                '<span class="material-symbols-outlined text-sm">warning</span>' +
                escapeHtml(i18n.setClosingDate || 'Set closing date') + '</span>';
        }
        if (card.closed) {
            dueLine += '<span class="card-closed-badge inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 font-medium">' +
                '<span class="material-symbols-outlined text-sm">lock</span>' +
                escapeHtml(i18n.billClosed || 'Bill closed') + '</span>';
        }
        const overBudget = card.over_budget
            ? '<div class="overbudget-warning text-xs text-yellow-600 dark:text-yellow-400 font-medium mt-0.5">' +
              escapeHtml(i18n.overBudget || '⚠ Over budget') + '</div>'
            : '';
        return '<div class="font-medium">' + escapeHtml(card.name) + '</div>' +
            '<div class="card-due-info text-xs flex items-center gap-2 flex-wrap mt-0.5">' +
            dueLine + '</div>' + overBudget;
    }

    function rowInnerHtml(card) {
        const manage = canManage();
        const manageButtons = manage
            ? '<button type="button" data-action="edit-credit-card" data-card-id="' + card.id + '" class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-blue-600 dark:text-blue-500">' +
              '<span class="material-symbols-outlined text-lg">edit</span></button>' +
              '<button type="button" data-action="toggle-card-closed" data-card-id="' + card.id + '" data-card-closed="' + (card.closed ? 'true' : 'false') + '" class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-orange-500 dark:text-orange-400">' +
              '<span class="material-symbols-outlined text-lg">' + (card.closed ? 'lock_open' : 'lock') + '</span></button>' +
              '<button type="button" data-action="delete-credit-card" data-card-id="' + card.id + '" class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-red-600 dark:text-red-500">' +
              '<span class="material-symbols-outlined text-lg">delete</span></button>'
            : '';
        return (
            '<td class="px-2 py-4 text-center drag-handle-cell-card">' +
            '<span class="material-symbols-outlined text-gray-400 dark:text-gray-500 drag-handle-card cursor-grab active:cursor-grabbing">drag_indicator</span></td>' +
            '<td class="card-info-cell py-3 px-3 text-sm text-[#0d171b] dark:text-white">' +
            infoCellHtml(card) + '</td>' +
            '<td class="py-3 px-3 text-sm text-right text-red-600 dark:text-red-500 font-semibold" data-card-total="' + card.bill_total + '">' +
            formatMoney(card.bill_total) + '</td>' +
            '<td class="py-3 px-2 text-center whitespace-nowrap mobile-hide-column">' +
            '<div class="flex items-center justify-center gap-1">' +
            manageButtons +
            '</div></td>'
        );
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    function formatDueLabel(day) {
        const pattern = getI18N().closesOnDay || 'Closes on day %(day)s';
        return pattern.replace('%(day)s', day);
    }

    // Canonical card definition (payload level): a card is a credit-card
    // FlowGroup that is not linked to another card.
    function isCardPayload(data) {
        return !!(data && data.is_credit_card &&
            (data.linked_card_id === null || typeof data.linked_card_id === 'undefined' ||
                data.is_card === true));
    }

    function updateRowFromPayload(row, card) {
        row.setAttribute('data-card-name', card.name);
        row.setAttribute('data-card-due-day',
            card.due_day == null ? '' : card.due_day);
        if (typeof card.is_shared !== 'undefined') {
            row.setAttribute('data-card-shared', card.is_shared ? 'true' : 'false');
        }
        if (typeof card.closed !== 'undefined') {
            row.setAttribute('data-card-closed', card.closed ? 'true' : 'false');
        }
        if (typeof card.bill_overdue !== 'undefined') {
            row.setAttribute('data-card-overdue', card.bill_overdue ? 'true' : 'false');
        }
        if (typeof card.over_budget !== 'undefined') {
            row.setAttribute('data-card-over-budget', card.over_budget ? 'true' : 'false');
        }
        row.classList.toggle('opacity-60',
            row.getAttribute('data-card-closed') === 'true');
        renderInfoCell(row);
        const totalCell = row.querySelector('[data-card-total]');
        if (typeof card.bill_total !== 'undefined' && totalCell) {
            totalCell.setAttribute('data-card-total', card.bill_total);
            totalCell.textContent = formatMoney(card.bill_total);
        }
        const lockBtn = row.querySelector('[data-action="toggle-card-closed"]');
        if (lockBtn && typeof card.closed !== 'undefined') {
            lockBtn.setAttribute('data-card-closed', card.closed ? 'true' : 'false');
            const icon = lockBtn.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = card.closed ? 'lock_open' : 'lock';
        }
    }

    function upsertRow(card) {
        const tbody = document.getElementById('credit-cards-body');
        if (!tbody) return;
        const existing = document.getElementById('credit-card-' + card.id);
        const row = buildRow(card);
        if (existing) {
            existing.replaceWith(row);
        } else {
            const emptyRow = tbody.querySelector('td[colspan]');
            if (emptyRow) emptyRow.parentElement.remove();
            tbody.appendChild(row);
            bindRowDrag(row);
        }
    }

    function removeRow(cardId) {
        const row = document.getElementById('credit-card-' + cardId);
        if (row) {
            row.remove();
            ensureEmptyState();
        }
    }

    function ensureEmptyState() {
        const tbody = document.getElementById('credit-cards-body');
        if (!tbody) return;
        if (!tbody.querySelector('tr[data-card-id]')) {
            const tr = document.createElement('tr');
            tr.innerHTML = '<td colspan="4" class="py-4 px-4 text-center text-gray-500">' +
                (getI18N().noCards || 'No credit cards yet.') + '</td>';
            tbody.appendChild(tr);
        }
    }

    // ---------- totals refresh ----------

    function refreshTotals() {
        const url = getConfig().urlCreditCardList;
        if (!url) return;
        fetch(url + '?include_totals=1', {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
            .then(response => response.json())
            .then(data => {
                if (data.status !== 'success') return;
                data.credit_cards.forEach(card => {
                    const row = document.getElementById('credit-card-' + card.id);
                    if (!row) {
                        if (canManage() || card.is_shared) upsertRow(card);
                        return;
                    }
                    updateRowFromPayload(row, card);
                });
            })
            .catch(error => console.error('[CreditCards] refreshTotals failed', error));
    }

    // ---------- modal ----------

    function openCardModal(mode, row) {
        const i18n = getI18N();
        const isEdit = mode === 'edit';
        const cardId = isEdit ? row.getAttribute('data-card-id') : '';
        const name = isEdit ? row.getAttribute('data-card-name') : '';
        const dueDay = isEdit ? row.getAttribute('data-card-due-day') : '';
        const shared = isEdit ? row.getAttribute('data-card-shared') === 'true' : false;

        const formHtml =
            '<div class="space-y-4 text-left">' +
            '<div><label class="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">' + escapeHtml(i18n.cardName) + '</label>' +
            '<input type="text" id="credit-card-name" data-field="name" class="w-full border rounded-lg bg-white dark:bg-gray-700 border-slate-300 dark:border-slate-600 focus:ring-primary focus:border-primary text-slate-800 dark:text-slate-200 p-2" value="' + escapeHtml(name) + '"></div>' +
            '<div class="flex items-center"><input type="checkbox" id="credit-card-shared" class="h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded"' + (shared ? ' checked' : '') + '>' +
            '<label for="credit-card-shared" class="ml-2 text-sm font-medium text-slate-700 dark:text-slate-300">' + escapeHtml(i18n.shared) + '</label></div>' +
            '<div><label class="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">' + escapeHtml(i18n.dueDate) + '</label>' +
            '<input type="number" min="1" max="31" id="credit-card-due-day" class="w-full border rounded-lg bg-white dark:bg-gray-700 border-slate-300 dark:border-slate-600 focus:ring-primary focus:border-primary text-slate-800 dark:text-slate-200 p-2 text-right" value="' + escapeHtml(dueDay) + '">' +
            '<p class="text-xs text-gray-500 dark:text-gray-400 mt-1">' + escapeHtml(i18n.dueDayHint) + '</p></div>' +
            (isEdit ? '' :
                '<div><label class="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">' + escapeHtml(i18n.budgetedAmount) + '</label>' +
                '<input type="text" inputmode="decimal" data-field="amount" id="credit-card-budget" class="w-full border rounded-lg bg-white dark:bg-gray-700 border-slate-300 dark:border-slate-600 focus:ring-primary focus:border-primary text-slate-800 dark:text-slate-200 p-2 text-right" placeholder="0.00"></div>') +
            '</div>';

        window.GenericModal.show({
            type: 'info',
            title: isEdit ? i18n.editCard : i18n.addCard,
            message: formHtml,
            buttons: [
                {
                    text: i18n.save,
                    primary: true,
                    onClick: function () { submitCardModal(isEdit, cardId); }
                },
                { text: i18n.cancel, primary: false }
            ]
        });
    }

    function submitCardModal(isEdit, cardId) {
        const i18n = getI18N();
        const nameInput = document.getElementById('credit-card-name');
        const dueDayInput = document.getElementById('credit-card-due-day');
        if (!nameInput || !dueDayInput) return;

        const name = nameInput.value.trim();
        const dueDay = Number(dueDayInput.value);
        if (!name) {
            window.GenericModal.alert(i18n.errorNameRequired);
            return;
        }
        if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
            window.GenericModal.alert(i18n.errorInvalidDueDay);
            return;
        }

        const payload = {
            name: name,
            due_day: dueDay,
            is_shared: document.getElementById('credit-card-shared').checked
        };

        if (isEdit) {
            payload.credit_card_id = cardId;
            ajaxPost(getConfig().urlCreditCardUpdate, payload)
                .then(data => {
                    if (data.error) {
                        window.GenericModal.alert(data.error);
                        return;
                    }
                    if (data.credit_card) {
                        upsertRow(withTotalFromRow(data.credit_card));
                        refreshTotals();
                    }
                })
                .catch(() => window.GenericModal.alert(i18n.errorNetwork));
        } else {
            const budgetInput = document.getElementById('credit-card-budget');
            if (budgetInput && budgetInput.value.trim() !== '') {
                payload.budgeted_amount = budgetInput.value;
            }
            ajaxPost(getConfig().urlCreditCardCreate, payload)
                .then(data => {
                    if (data.error) {
                        window.GenericModal.alert(data.error);
                        return;
                    }
                    if (data.credit_card) {
                        upsertRow(withTotalFromRow(data.credit_card));
                        refreshTotals();
                    }
                })
                .catch(() => window.GenericModal.alert(i18n.errorNetwork));
        }
    }

    function withTotalFromRow(card) {
        // Keep the existing displayed total until the next refreshTotals.
        const row = document.getElementById('credit-card-' + card.id);
        card.bill_total = row
            ? row.querySelector('[data-card-total]').getAttribute('data-card-total')
            : '0.00';
        return card;
    }

    // ---------- actions ----------

    function toggleClosed(row) {
        const i18n = getI18N();
        const cardId = row.getAttribute('data-card-id');
        const isClosed = row.getAttribute('data-card-closed') === 'true';
        const message = isClosed ? i18n.reopenBillConfirm : i18n.closeBillConfirm;
        window.GenericModal.confirm(message).then(confirmed => {
            if (!confirmed) return;
            ajaxPost(getConfig().urlCreditCardToggleClosed, {
                flow_group_id: cardId,
                closed: !isClosed
            })
                .then(data => {
                    if (data.error) {
                        window.GenericModal.alert(data.error);
                        return;
                    }
                    row.setAttribute('data-card-closed', (!isClosed).toString());
                    applyClosedState(row, !isClosed);
                    refreshTotals();
                })
                .catch(() => window.GenericModal.alert(i18n.errorNetwork));
        });
    }

    function applyClosedState(row, closed) {
        row.setAttribute('data-card-closed', closed.toString());
        row.classList.toggle('opacity-60', closed);
        renderInfoCell(row);
        const lockBtn = row.querySelector('[data-action="toggle-card-closed"]');
        if (lockBtn) {
            lockBtn.setAttribute('data-card-closed', closed.toString());
            const icon = lockBtn.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = closed ? 'lock_open' : 'lock';
        }
    }

    function deleteCard(row) {
        const i18n = getI18N();
        const cardId = row.getAttribute('data-card-id');
        window.GenericModal.confirm(i18n.deleteCardConfirm).then(confirmed => {
            if (!confirmed) return;
            const base = getConfig().urlCreditCardDelete;
            const url = base.replace('/0/', '/' + cardId + '/');
            fetch(url, {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCsrf(),
                    'X-Requested-With': 'XMLHttpRequest'
                }
            })
                .then(response => response.json())
                .then(data => {
                    if (data.error) {
                        window.GenericModal.alert(data.error);
                        return;
                    }
                    removeRow(cardId);
                })
                .catch(() => window.GenericModal.alert(i18n.errorNetwork));
        });
    }

    // ---------- slide ordering ----------

    let draggedCardRow = null;

    function bindRowDrag(row) {
        row.addEventListener('dragstart', function (event) {
            draggedCardRow = row;
            event.dataTransfer.effectAllowed = 'move';
            try {
                event.dataTransfer.setData('text/plain', row.id);
            } catch (err) { /* IE compatibility */ }
        });
        row.addEventListener('dragover', function (event) {
            event.preventDefault();
            if (draggedCardRow && draggedCardRow !== row) {
                const rect = row.getBoundingClientRect();
                const after = event.clientY - rect.top > rect.height / 2;
                if (after) {
                    row.parentElement.insertBefore(draggedCardRow, row.nextSibling);
                } else {
                    row.parentElement.insertBefore(draggedCardRow, row);
                }
            }
        });
        row.addEventListener('dragend', persistCardOrder);
    }

    function persistCardOrder() {
        const tbody = document.getElementById('credit-cards-body');
        if (!tbody || !draggedCardRow) return;
        draggedCardRow = null;
        const rows = tbody.querySelectorAll('tr[data-card-id]');
        const groups = [];
        rows.forEach((row, index) => {
            row.setAttribute('data-card-order', index);
            groups.push({
                id: parseInt(row.getAttribute('data-card-id'), 10),
                order: index
            });
        });
        const url = getConfig().urlReorderFlowgroups;
        if (!url) return;
        ajaxPost(url, { groups: groups })
            .then(data => {
                if (data.error) console.error('[CreditCards] reorder failed', data.error);
            })
            .catch(error => console.error('[CreditCards] reorder failed', error));
    }

    function initDragAndDrop() {
        const tbody = document.getElementById('credit-cards-body');
        if (!tbody) return;
        tbody.querySelectorAll('tr[data-card-id]').forEach(bindRowDrag);
        // Dragging is only allowed from the handle (mobile/desktop parity with groups)
        tbody.addEventListener('mousedown', function (event) {
            const row = event.target.closest('tr[data-card-id]');
            if (!row) return;
            row.setAttribute('draggable',
                event.target.closest('.drag-handle-cell-card') ? 'true' : 'false');
        });
    }

    // ---------- action dispatch (CSP-safe, delegated) ----------

    document.addEventListener('click', function (event) {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const action = button.getAttribute('data-action');
        const row = button.closest('tr[data-card-id]');

        switch (action) {
            case 'add-credit-card':
                event.preventDefault();
                openCardModal('create');
                break;
            case 'edit-credit-card':
                event.preventDefault();
                if (row) openCardModal('edit', row);
                break;
            case 'toggle-card-closed':
                event.preventDefault();
                if (row) toggleClosed(row);
                break;
            case 'delete-credit-card':
                event.preventDefault();
                if (row) deleteCard(row);
                break;
            default:
                break;
        }
    });

    // Row click opens the card's FlowGroup page (actions/handle excluded)
    document.addEventListener('click', function (event) {
        if (event.target.closest('[data-action]')) return;
        if (event.target.closest('.drag-handle-cell-card')) return;
        const row = event.target.closest('#credit-cards-body tr[data-card-id]');
        if (!row) return;
        const base = getConfig().urlEditFlowGroupBase;
        if (!base) return;
        // base is '/flow-group/0/edit/' — swap only the id segment
        const cardId = row.getAttribute('data-card-id');
        window.location.href = base.replace('/0/', '/' + cardId + '/');
    });

    // ---------- real-time sync ----------

    // Keeps the FlowGroup-page "Credit card" dropdown in sync on every client.
    function refreshLinkedCardSelects() {
        const selects = document.querySelectorAll('select#id_linked_card');
        if (!selects.length) return;
        const url = getConfig().urlCreditCardList;
        if (!url) return;
        fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(response => response.json())
            .then(data => {
                if (data.status !== 'success') return;
                selects.forEach(function (select) {
                    const current = select.value;
                    select.innerHTML = '';
                    const emptyOption = document.createElement('option');
                    emptyOption.value = '';
                    emptyOption.textContent = '---------';
                    select.appendChild(emptyOption);
                    data.credit_cards.forEach(function (card) {
                        const option = document.createElement('option');
                        option.value = card.id;
                        option.textContent = card.name;
                        select.appendChild(option);
                    });
                    if (current && data.credit_cards.some(function (card) {
                        return String(card.id) === current;
                    })) {
                        select.value = current;
                    }
                });
            })
            .catch(error => console.error('[CreditCards] linked-card refresh failed', error));
    }

    function registerRealtimeHandlers() {
        if (typeof window.wsManager === 'undefined') return;

        window.wsManager.registerHandler('flowgroup_created', function (payload) {
            const data = payload && payload.data ? payload.data : payload;
            if (isCardPayload(data)) {
                refreshTotals();
                refreshLinkedCardSelects();
            }
        });

        window.wsManager.registerHandler('flowgroup_updated', function (payload) {
            const data = payload && payload.data ? payload.data : payload;
            if (!data) return;
            if (isCardPayload(data)) {
                const row = document.getElementById('credit-card-' + data.id);
                if (row) updateRowFromPayload(row, data);
                refreshTotals();
            } else if (data.linked_card_id) {
                refreshTotals();
            }
        });

        window.wsManager.registerHandler('flowgroup_deleted', function (payload) {
            const data = payload && payload.data ? payload.data : payload;
            if (data && data.id) removeRow(String(data.id));
        });

        window.wsManager.registerHandler('credit_card_updated', function (payload) {
            const data = payload && payload.data ? payload.data : payload;
            if (data && data.credit_card) {
                const row = document.getElementById('credit-card-' + data.credit_card.id);
                if (row) updateRowFromPayload(row, data.credit_card);
                refreshTotals();
                refreshLinkedCardSelects();
            }
        });

        window.wsManager.registerHandler('credit_card_deleted', function (payload) {
            const data = payload && payload.data ? payload.data : payload;
            if (data && data.id) {
                removeRow(String(data.id));
                refreshLinkedCardSelects();
            }
        });

        window.wsManager.registerHandler('transaction_created', function (payload) {
            const data = payload && payload.data ? payload.data : payload;
            const group = data && data.flow_group ? data.flow_group : null;
            if (!group) return;
            if (group.is_card || group.linked_card_id) refreshTotals();
        });

        window.wsManager.registerHandler('transaction_updated', function (payload) {
            const data = payload && payload.data ? payload.data : payload;
            const group = data && data.flow_group ? data.flow_group : null;
            if (!group) return;
            if (group.is_card || group.linked_card_id) refreshTotals();
        });

        window.wsManager.registerHandler('transaction_deleted', function (payload) {
            const data = payload && payload.data ? payload.data : payload;
            if (data && (data.flow_group_is_card || data.flow_group_linked_card_id ||
                data.is_credit_card)) {
                refreshTotals();
            }
        });
    }

    function init() {
        if (!document.getElementById('credit-cards-body') &&
            !document.getElementById('id_linked_card')) return;
        initDragAndDrop();
        registerRealtimeHandlers();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
