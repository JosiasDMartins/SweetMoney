/**
 * Bank Reconciliation JavaScript
 * External JavaScript file (CSP compliant - no inline scripts)
 * Handles: Money mask, CRUD operations, real-time updates
 * Version: 20260114-001 - Fixed column order and total sync
 */

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
    'use strict';
    initBankReconciliation();
});

function initBankReconciliation() {
    // Read configuration from data attributes
    const config = document.getElementById('bank-recon-config');
    if (!config) {
        console.error('[BankReconciliation] Configuration element not found!');
        return;
    }

    // Extract configuration
    window.BANK_RECON_CONFIG = {
        decimalSeparator: config.dataset.decimalSeparator,
        thousandSeparator: config.dataset.thousandSeparator,
        currencySymbol: config.dataset.currencySymbol,
        startDate: config.dataset.startDate,
        discrepancyPercentageTolerance: config.dataset.discrepancyPercentageTolerance,
        urls: {
            saveBankBalance: config.dataset.urlSaveBankBalance,
            deleteBankBalance: config.dataset.urlDeleteBankBalance,
            getReconciliationSummary: config.dataset.urlGetReconciliationSummary,
            toggleReconciliationMode: config.dataset.urlToggleReconciliationMode
        },
        i18n: {
            pleaseEnterDescription: config.dataset.i18nPleaseEnterDescription,
            errorSavingBalance: config.dataset.i18nErrorSavingBalance,
            networkErrorOccurred: config.dataset.i18nNetworkErrorOccurred,
            deleteConfirm: config.dataset.i18nDeleteConfirm,
            errorDeletingBalance: config.dataset.i18nErrorDeletingBalance,
            warningDiscrepancyDetected: config.dataset.i18nWarningDiscrepancyDetected,
            warningDiscrepancyMessage: config.dataset.i18nWarningDiscrepancyMessage,
            reconciliationOk: config.dataset.i18nReconciliationOk,
            reconciliationOkMessage: config.dataset.i18nReconciliationOkMessage,
            discrepancyExceedsMember: config.dataset.i18nDiscrepancyExceedsMember
        },
        csrfToken: getCookie('csrftoken')
    };

    // Shortcuts
    window.decimalSeparator = window.BANK_RECON_CONFIG.decimalSeparator;
    window.thousandSeparator = window.BANK_RECON_CONFIG.thousandSeparator;
    window.currencySymbol = window.BANK_RECON_CONFIG.currencySymbol;
    window.csrftoken = window.BANK_RECON_CONFIG.csrfToken;

    console.log('[BankReconciliation] Configuration loaded');
    console.log('[BankReconciliation] CONFIG DUMP:', window.BANK_RECON_CONFIG);
    console.log('[BankReconciliation] Global Separators:', { 
        decimalSeparator: window.decimalSeparator, 
        thousandSeparator: window.thousandSeparator, 
        currencySymbol: window.currencySymbol 
    });

    // Initialize money mask
    initMoneyMask();

    // Initialize real-time listeners
    initRealtimeListeners();
}

// ===== UTILITY FUNCTIONS =====

// getCookie, applyMoneyMask, getRawValue, formatCurrency - using utils.js

function initMoneyMask() {
    // Input event listener
    document.addEventListener('input', function(event) {
        if (event.target.matches('.cell-amount-edit')) {
            applyMoneyMask(event, window.thousandSeparator, window.decimalSeparator);
        }
    });

    // Focus event listener
    document.addEventListener('focus', function(event) {
        if (event.target.matches('.cell-amount-edit')) {
            if (!event.target.hasAttribute('data-first-focus-done')) {
                event.target.setAttribute('data-first-focus-done', 'true');
                setTimeout(function() {
                    event.target.setSelectionRange(event.target.value.length, event.target.value.length);
                }, 0);
            }
        }
    }, true);

    // Blur event listener
    document.addEventListener('blur', function(event) {
        if (event.target.matches('.cell-amount-edit')) {
            event.target.removeAttribute('data-first-focus-done');
        }
    }, true);

    // Initialize existing inputs
    // Template renders values - use getRawValue to properly parse regardless of format
    // This follows the same pattern as dashboard.js initInputMasks()
    document.querySelectorAll('.cell-amount-edit').forEach(function(input) {
        if (input.value && input.value.trim() !== '') {
            console.log('[initMoneyMask] Processing input:', input);
            console.log('[initMoneyMask] Raw Value from DOM:', input.value);

            // Use getRawValue to properly sanitize the value (handles both locale formats)
            // This is the same pattern used in dashboard.js and FlowGroup.js
            let raw = getRawValue(input.value, thousandSeparator, decimalSeparator);

            if (!isNaN(raw) && raw !== null) {
                // Format according to user's locale settings
                const formatted = formatAmountForInput(raw, thousandSeparator, decimalSeparator);
                console.log('[initMoneyMask] Formatted Value:', formatted);
                input.value = formatted;
            } else {
                input.value = '0' + decimalSeparator + '00';
            }
        } else {
            input.value = '0' + decimalSeparator + '00';
        }
    });
}

// ===== BALANCE MANAGEMENT FUNCTIONS =====
// These functions are exposed globally for event_delegation.js

window.addNewBalance = function() {
    const template = document.getElementById('new-balance-template');
    const emptyRow = document.getElementById('balance-empty-row');
    if (emptyRow) emptyRow.style.display = 'none';
    template.style.display = '';
    template.querySelector('.cell-description-edit').focus();
};

window.cancelNewBalance = function() {
    const template = document.getElementById('new-balance-template');
    const tbody = document.getElementById('bank-balance-tbody');
    const emptyRow = document.getElementById('balance-empty-row');

    template.style.display = 'none';

    template.querySelector('.cell-description-edit').value = '';
    template.querySelector('.cell-amount-edit').value = '0' + decimalSeparator + '00';
    template.querySelector('.cell-date-edit').value = window.BANK_RECON_CONFIG.startDate;
    const memberSelect = template.querySelector('.cell-member-edit');
    if (memberSelect) memberSelect.value = '';

    const dataRows = tbody.querySelectorAll('tr[data-balance-id]:not(#new-balance-template)');
    if (dataRows.length === 0 && emptyRow) {
        emptyRow.style.display = '';
    }
};

window.toggleEditBalance = function(rowId, edit) {
    const row = document.getElementById(rowId);
    row.setAttribute('data-mode', edit ? 'edit' : 'display');

    const displayElements = row.querySelectorAll('.cell-description-display, .cell-amount-display, .cell-date-display, .cell-member-display, .actions-display');
    const editElements = row.querySelectorAll('.cell-description-edit, .cell-amount-edit, .cell-date-edit, .cell-member-edit, .actions-edit');

    displayElements.forEach(el => el.classList.toggle('hidden', edit));
    editElements.forEach(el => el.classList.toggle('hidden', !edit));

    if (edit) {
        const amountInput = row.querySelector('.cell-amount-edit');
        if (amountInput) {
            // Use standard utils functions to safely sanitize and format
            const rawValue = getRawValue(amountInput.value, window.thousandSeparator, window.decimalSeparator);
            amountInput.value = formatAmountForInput(rawValue, window.thousandSeparator, window.decimalSeparator);
        }
    }
};

window.saveBalance = function(rowId) {
    const row = document.getElementById(rowId);
    const balanceId = row.getAttribute('data-balance-id');
    const isNew = balanceId === 'new';

    const description = row.querySelector('.cell-description-edit').value.trim();
    const amount = getRawValue(row.querySelector('.cell-amount-edit').value, thousandSeparator, decimalSeparator);
    const date = row.querySelector('.cell-date-edit').value;
    const memberSelect = row.querySelector('.cell-member-edit');
    const memberId = memberSelect ? memberSelect.value : null;

    if (!description) {
        alert(window.BANK_RECON_CONFIG.i18n.pleaseEnterDescription);
        return;
    }

    const data = {
        id: isNew ? null : balanceId,
        description: description,
        amount: amount,
        date: date,
        member_id: memberId,
        period_start_date: window.BANK_RECON_CONFIG.startDate
    };

    fetch(window.BANK_RECON_CONFIG.urls.saveBankBalance, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrftoken,
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            if (isNew) {
                // Hide template and let WebSocket broadcast add the row for all users
                window.cancelNewBalance();
            } else {
                updateRow(row, data);
                window.toggleEditBalance(rowId, false);
            }
            // Always update the reconciliation summary after save
            updateReconciliationSummary();
        } else {
            alert(window.BANK_RECON_CONFIG.i18n.errorSavingBalance + ' ' + data.error);
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert(window.BANK_RECON_CONFIG.i18n.networkErrorOccurred);
    });
};

function updateRow(row, data) {
    // Date: use short month format (Jan, Feb, etc.)
    const dateObj = new Date(data.date + 'T00:00:00');
    const dateDisplay = dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

    row.querySelector('.cell-description-display').textContent = data.description;
    row.querySelector('.cell-date-display').textContent = dateDisplay;
    row.querySelector('.cell-amount-display').textContent = formatCurrency(data.amount, currencySymbol, thousandSeparator, decimalSeparator);

    if (row.querySelector('.cell-member-display')) {
        row.querySelector('.cell-member-display').textContent = data.member_name || 'Family';
        row.querySelector('.cell-member-display').setAttribute('data-member-id', data.member_id || '');
    }

    // Update edit fields as well
    row.querySelector('.cell-description-edit').value = data.description;
    row.querySelector('.cell-date-edit').value = data.date;
    row.querySelector('.cell-amount-edit').value = formatAmountForInput(data.amount, window.thousandSeparator, window.decimalSeparator);
    if (row.querySelector('.cell-member-edit')) {
        row.querySelector('.cell-member-edit').value = data.member_id || '';
    }
}

window.deleteBalance = function(balanceId) {
    console.log('[BankReconciliation] deleteBalance called with id:', balanceId);

    if (!balanceId) {
        console.error('[BankReconciliation] deleteBalance: balanceId is undefined');
        return;
    }

    // Use GenericModal.confirm (Promise-based)
    window.GenericModal.confirm(
        window.BANK_RECON_CONFIG.i18n.deleteConfirm,
        window.BANK_RECON_CONFIG.i18n.deleteConfirmTitle || 'Confirm Deletion'
    ).then(function(confirmed) {
        if (!confirmed) {
            console.log('[BankReconciliation] Delete cancelled by user');
            return;
        }

        console.log('[BankReconciliation] Delete confirmed, sending request...');
        // User confirmed - proceed with deletion
        fetch(window.BANK_RECON_CONFIG.urls.deleteBankBalance, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrftoken,
            },
            body: JSON.stringify({ id: balanceId })
        })
        .then(response => response.json())
        .then(data => {
            console.log('[BankReconciliation] Delete response:', data);
            if (data.status === 'success') {
                const row = document.getElementById('balance-row-' + balanceId);
                if (row) {
                    row.remove();
                } else {
                    console.warn('[BankReconciliation] Row not found: balance-row-' + balanceId);
                }
                updateReconciliationSummary();
            } else {
                window.GenericModal.alert(window.BANK_RECON_CONFIG.i18n.errorDeletingBalance + ' ' + data.error);
            }
        })
        .catch(error => {
            console.error('[BankReconciliation] Delete error:', error);
            window.GenericModal.alert(window.BANK_RECON_CONFIG.i18n.networkErrorOccurred);
        });
    });
};

function updateReconciliationSummary() {
    const urlParams = new URLSearchParams(window.location.search);
    const period = urlParams.get('period') || window.BANK_RECON_CONFIG.startDate;
    const mode = urlParams.get('mode') || 'general';
    const baseUrl = window.BANK_RECON_CONFIG.urls.getReconciliationSummary;
    // Add cache-busting parameter
    const url = `${baseUrl}?period=${period}&mode=${mode}&_=${Date.now()}`;

    console.log('[BankReconciliation] Fetching reconciliation summary:', url);
    fetch(url, {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('[BankReconciliation] Summary response:', data);
        if (data.status === 'success') {
            const summary = data.reconciliation_data;
            if (summary.mode === 'general') {
                // Update all general mode fields
                const fields = {
                    'reconciliation-total-income': summary.total_income,
                    'reconciliation-total-expenses': summary.total_expenses,
                    'reconciliation-calculated-balance': summary.calculated_balance,
                    'reconciliation-calculated-balance-2': summary.calculated_balance,
                    'reconciliation-bank-balance': summary.total_bank_balance,
                    'total-bank-balance': summary.total_bank_balance,
                    'reconciliation-discrepancy': summary.discrepancy
                };

                for (const [id, value] of Object.entries(fields)) {
                    const el = document.getElementById(id);
                    if (el) {
                        el.textContent = formatCurrency(value, currencySymbol, thousandSeparator, decimalSeparator);
                    }
                }

                // Update percentage
                const percentEl = document.getElementById('reconciliation-discrepancy-percentage');
                if (percentEl) {
                    percentEl.textContent = `(${parseFloat(summary.discrepancy_percentage).toFixed(2)}%)`;
                }

                // Update discrepancy color
                const discrepancy_val = parseFloat(summary.discrepancy);
                const discrepancy_el = document.getElementById('reconciliation-discrepancy');
                if (discrepancy_el) {
                    discrepancy_el.classList.toggle('text-green-600', discrepancy_val >= 0);
                    discrepancy_el.classList.toggle('dark:text-green-500', discrepancy_val >= 0);
                    discrepancy_el.classList.toggle('text-red-600', discrepancy_val < 0);
                    discrepancy_el.classList.toggle('dark:text-red-500', discrepancy_val < 0);
                }

                // Update warning
                const warningContainer = document.getElementById('reconciliation-warning-container');
                if (warningContainer) {
                    if (summary.has_warning) {
                        warningContainer.innerHTML = `
                        <div class="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-500 p-4">
                            <div class="flex items-center">
                                <span class="material-symbols-outlined text-yellow-500 mr-3">warning</span>
                                <div>
                                    <h4 class="text-sm font-semibold text-yellow-800 dark:text-yellow-500">${window.BANK_RECON_CONFIG.i18n.warningDiscrepancyDetected}</h4>
                                    <p class="text-sm text-yellow-700 dark:text-yellow-400 mt-1">
                                        ${window.BANK_RECON_CONFIG.i18n.warningDiscrepancyMessage}
                                    </p>
                                </div>
                            </div>
                        </div>`;
                    } else {
                        warningContainer.innerHTML = `
                        <div class="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 p-4">
                            <div class="flex items-center">
                                <span class="material-symbols-outlined text-green-500 mr-3">check_circle</span>
                                <div>
                                    <h4 class="text-sm font-semibold text-green-800 dark:text-green-500">${window.BANK_RECON_CONFIG.i18n.reconciliationOk}</h4>
                                    <p class="text-sm text-green-700 dark:text-green-400 mt-1">
                                        ${window.BANK_RECON_CONFIG.i18n.reconciliationOkMessage}
                                    </p>
                                </div>
                            </div>
                        </div>`;
                    }
                }

            } else { // detailed mode
                // Update total bank balance (all accounts)
                if (summary.total_bank_balance) {
                    const totalEl = document.getElementById('total-bank-balance');
                    if (totalEl) {
                        totalEl.textContent = formatCurrency(summary.total_bank_balance, currencySymbol, thousandSeparator, decimalSeparator);
                    }
                }

                // Update per-member data
                summary.members_data.forEach(memberData => {
                    const container = document.getElementById(`member-reconciliation-${memberData.member_id}`);
                    if (container) {
                        container.querySelector('.reconciliation-member-income').textContent = formatCurrency(memberData.income, currencySymbol, thousandSeparator, decimalSeparator);
                        container.querySelector('.reconciliation-member-expenses').textContent = formatCurrency(memberData.expenses, currencySymbol, thousandSeparator, decimalSeparator);
                        container.querySelector('.reconciliation-member-calculated').textContent = formatCurrency(memberData.calculated_balance, currencySymbol, thousandSeparator, decimalSeparator);
                        container.querySelector('.reconciliation-member-calculated-2').textContent = formatCurrency(memberData.calculated_balance, currencySymbol, thousandSeparator, decimalSeparator);
                        container.querySelector('.reconciliation-member-bank').textContent = formatCurrency(memberData.bank_balance, currencySymbol, thousandSeparator, decimalSeparator);
                        container.querySelector('.reconciliation-member-discrepancy').textContent = formatCurrency(memberData.discrepancy, currencySymbol, thousandSeparator, decimalSeparator);
                        container.querySelector('.reconciliation-member-discrepancy-percentage').textContent = `(${parseFloat(memberData.discrepancy_percentage).toFixed(2)}%)`;

                        const discrepancy_val = parseFloat(memberData.discrepancy);
                        const discrepancy_el = container.querySelector('.reconciliation-member-discrepancy');
                        discrepancy_el.classList.toggle('text-green-600', discrepancy_val >= 0);
                        discrepancy_el.classList.toggle('dark:text-green-500', discrepancy_val >= 0);
                        discrepancy_el.classList.toggle('text-red-600', discrepancy_val < 0);
                        discrepancy_el.classList.toggle('dark:text-red-500', discrepancy_val < 0);

                        const warningContainer = container.querySelector('.reconciliation-member-warning-container');
                        if(memberData.has_warning) {
                             warningContainer.innerHTML = `
                            <div class="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-500 p-3 mt-4">
                                <div class="flex items-center">
                                    <span class="material-symbols-outlined text-yellow-500 mr-2 text-base">warning</span>
                                    <p class="text-xs text-yellow-700 dark:text-yellow-400">
                                        ${window.BANK_RECON_CONFIG.i18n.discrepancyExceedsMember}
                                    </p>
                                </div>
                            </div>`;
                        } else {
                            warningContainer.innerHTML = '';
                        }
                    }
                });
            }
            console.log('[BankReconciliation] Reconciliation summary updated successfully');
        } else {
            console.error('[BankReconciliation] Error in summary response:', data.error);
        }
    })
    .catch(error => {
        console.error('[BankReconciliation] Error fetching reconciliation summary:', error);
    });
}

// ===== RECONCILIATION MODE TOGGLE =====

window.toggleReconciliationMode = function(isDetailed) {
    const mode = isDetailed ? 'detailed' : 'general';
    console.log('[BankReconciliation] Toggling mode to:', mode);

    fetch(window.BANK_RECON_CONFIG.urls.toggleReconciliationMode, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrftoken,
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ mode: mode })
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            console.log('[BankReconciliation] Mode changed successfully to:', data.mode);
            // Reload page to show correct view for the new mode
            const urlParams = new URLSearchParams(window.location.search);
            urlParams.set('mode', data.mode);
            window.location.search = urlParams.toString();
        } else {
            console.error('[BankReconciliation] Error changing mode:', data.error);
            // Revert toggle on error
            const toggle = document.getElementById('mode-toggle');
            if (toggle) {
                toggle.checked = !isDetailed;
            }
        }
    })
    .catch(error => {
        console.error('[BankReconciliation] Fetch error:', error);
        // Revert toggle on error
        const toggle = document.getElementById('mode-toggle');
        if (toggle) {
            toggle.checked = !isDetailed;
        }
    });
};

// ===== REAL-TIME SYNCHRONIZATION =====

window.BankReconciliationRealtime = {

    /**
     * Handle bank balance created/updated from broadcast
     */
    updateBalance: function(balanceData, actor) {
        console.log('[BankRecon RT] updateBalance called with:', balanceData);

        // Check if we're on the bank reconciliation page
        const tbody = document.getElementById('bank-balance-tbody');
        if (!tbody) {
            console.log('[BankRecon RT] Not on bank reconciliation page, skipping');
            return;
        }

        const row = document.querySelector(`tr[data-balance-id="${balanceData.id}"]`);

        if (row) {
            // Update existing row
            console.log('[BankRecon RT] Updating existing row:', balanceData.id);
            updateRow(row, balanceData);

            // Highlight the updated row
            if (window.RealtimeUI && window.RealtimeUI.utils && window.RealtimeUI.utils.highlightElement) {
                window.RealtimeUI.utils.highlightElement(row, 2000);
            }
        } else {
            // New balance - create row dynamically
            console.log('[BankRecon RT] Creating new row for balance:', balanceData.id);
            this._createBalanceRow(balanceData, tbody);
        }

        // Always update reconciliation summary to get latest totals
        // Update the total bank balance display immediately from broadcast data
        if (balanceData.total_bank_balance) {
            const totalElement = document.getElementById('total-bank-balance');
            if (totalElement) {
                // Format the amount
                const currencySymbol = window.currencySymbol || '$';
                const decimalSeparator = window.decimalSeparator || ',';
                const thousandSeparator = window.thousandSeparator || '.';
                
                // Format number
                const amount = parseFloat(balanceData.total_bank_balance);
                let formattedAmount = amount.toFixed(2).replace('.', decimalSeparator);
                
                // Add thousand separators
                const parts = formattedAmount.split(decimalSeparator);
                parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator);
                formattedAmount = parts.join(decimalSeparator);
                
                totalElement.textContent = `${currencySymbol} ${formattedAmount}`;
                console.log('[BankRecon RT] Updated total bank balance to:', formattedAmount);
            }
        }

        // Always update reconciliation summary to get latest totals
        updateReconciliationSummary();
    },

    /**
     * Create a new balance row dynamically
     * Column order: Description | Date | User (if detailed) | Amount | Actions
     */
    _createBalanceRow: function(data, tbody) {
        console.log('[BankRecon RT] _createBalanceRow called with:', data);

        // Hide empty row if exists
        const emptyRow = document.getElementById('balance-empty-row');
        if (emptyRow) {
            emptyRow.style.display = 'none';
        }

        // Detect detailed mode by counting table headers
        // General: 4 columns (Desc, Date, Amount, Actions)
        // Detailed: 5 columns (Desc, Date, User, Amount, Actions)
        const table = document.getElementById('bank-balance-tbody').closest('table');
        const headerCells = table ? table.querySelectorAll('thead th') : [];
        const isDetailed = headerCells.length === 5;
        console.log('[BankRecon RT] Mode detection - headers:', headerCells.length, 'isDetailed:', isDetailed);

        // Format date with short month (Jan, Feb, etc.)
        const dateObj = new Date(data.date + 'T00:00:00');
        const dateDisplay = dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

        // Format amount
        const formattedAmount = formatCurrency(data.amount, currencySymbol, thousandSeparator, decimalSeparator);

        // Create row element
        const tr = document.createElement('tr');
        tr.id = `balance-row-${data.id}`;
        tr.dataset.balanceId = data.id;
        tr.dataset.mode = 'display';
        tr.style.backgroundColor = 'rgba(34, 197, 94, 0.1)'; // Highlight new row

        // Escape function
        const escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        };

        // Build HTML - ORDER: Description | Date | User (if detailed) | Amount | Actions
        let html = '';

        // Column 1: Description
        html += `
            <td class="px-4 py-3">
                <span class="cell-description-display text-sm text-[#0d171b] dark:text-white">${escapeHtml(data.description)}</span>
                <input type="text" class="cell-description-edit hidden w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:text-white" value="${escapeHtml(data.description)}">
            </td>`;

        // Column 2: Date
        html += `
            <td class="px-4 py-3">
                <span class="cell-date-display text-sm text-gray-600 dark:text-gray-400">${dateDisplay}</span>
                <input type="date" class="cell-date-edit hidden w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:text-white" value="${data.date}">
            </td>`;

        // Column 3 (only in detailed mode): User
        if (isDetailed) {
            const memberName = data.member_name || 'Family';
            const memberId = data.member_id || '';
            html += `
            <td class="px-4 py-3">
                <span class="cell-member-display text-sm text-gray-600 dark:text-gray-400" data-member-id="${memberId}">${escapeHtml(memberName)}</span>
                <select class="cell-member-edit hidden w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:text-white">
                    <option value="${memberId}" selected>${escapeHtml(memberName)}</option>
                </select>
            </td>`;
        }

        // Column (3 or 4): Amount
        html += `
            <td class="px-4 py-3 text-right">
                <span class="cell-amount-display text-sm text-green-600 dark:text-green-500 font-semibold">${formattedAmount}</span>
                <input type="text" inputmode="decimal" class="cell-amount-edit hidden w-full px-2 py-1 text-sm border rounded text-right dark:bg-gray-700 dark:text-white" value="${data.amount}">
            </td>`;

        // Column (4 or 5): Actions
        html += `
            <td class="px-4 py-3 text-center">
                <div class="actions-display flex justify-center space-x-2">
                    <button type="button" data-action="edit-balance" data-row-id="balance-row-${data.id}" class="p-1 text-slate-500 hover:text-primary">
                        <span class="material-symbols-outlined text-lg">edit</span>
                    </button>
                    <button type="button" data-action="delete-balance" data-item-id="${data.id}" class="p-1 text-slate-500 hover:text-red-500">
                        <span class="material-symbols-outlined text-lg">delete</span>
                    </button>
                </div>
                <div class="actions-edit hidden flex justify-center space-x-2">
                    <button type="button" data-action="save-balance" data-row-id="balance-row-${data.id}" class="p-1 text-green-500 hover:text-green-600">
                        <span class="material-symbols-outlined text-lg">check</span>
                    </button>
                    <button type="button" data-action="cancel-balance" data-row-id="balance-row-${data.id}" class="p-1 text-slate-500 hover:text-red-500">
                        <span class="material-symbols-outlined text-lg">close</span>
                    </button>
                </div>
            </td>`;

        tr.innerHTML = html;

        // Insert before template row or at end
        const templateRow = document.getElementById('new-balance-template');
        if (templateRow) {
            tbody.insertBefore(tr, templateRow);
        } else {
            tbody.appendChild(tr);
        }

        // Fade in animation
        setTimeout(() => {
            tr.style.transition = 'background-color 0.5s ease';
            tr.style.backgroundColor = '';
        }, 100);

        console.log('[BankRecon RT] New balance row created successfully:', data.id);
    },

    /**
     * Handle bank balance deleted by broadcast
     */
    deleteBalance: function(data) {
        const balanceId = data.id;
        console.log('[BankRecon RT] deleteBalance called for id:', balanceId);

        const row = document.querySelector(`tr[data-balance-id="${balanceId}"]`);
        if (row) {
            // Fade out animation
            row.style.transition = 'opacity 0.3s ease';
            row.style.opacity = '0';

            setTimeout(() => {
                if (row.parentNode) {
                    row.parentNode.removeChild(row);

                    // Check if table is empty
                    const tbody = document.getElementById('bank-balance-tbody');
                    const dataRows = tbody.querySelectorAll('tr[data-balance-id]:not(#new-balance-template)');
                    if (dataRows.length === 0) {
                        const emptyRow = document.getElementById('balance-empty-row');
                        if (emptyRow) {
                            emptyRow.style.display = '';
                        }
                    }
                }
            }, 300);
        }

        // Always update reconciliation summary
        updateReconciliationSummary();
    },

    /**
     * Handle mode change from broadcast
     */
    handleModeChange: function(data) {
        console.log('[BankRecon RT] handleModeChange called with:', data);

        const mode = data.mode || (data.data ? data.data.mode : null);
        if (!mode) {
            console.error('[BankRecon RT] No mode in data:', data);
            return;
        }

        const toggle = document.getElementById('mode-toggle');
        if (toggle) {
            const shouldBeChecked = (mode === 'detailed');
            if (toggle.checked !== shouldBeChecked) {
                toggle.checked = shouldBeChecked;
            }
        }

        // Check if we need to reload
        const urlParams = new URLSearchParams(window.location.search);
        const currentMode = urlParams.get('mode') || 'general';

        if (currentMode !== mode) {
            console.log(`[BankRecon RT] Mode mismatch (current: ${currentMode}, new: ${mode}). Reloading...`);
            urlParams.set('mode', mode);
            window.location.search = urlParams.toString();
        } else {
            console.log('[BankRecon RT] Mode already matches, no reload needed.');
        }
    }
};

function initRealtimeListeners() {
    // Listen for real-time bank balance events
    document.addEventListener('realtime:bankbalance:updated', function(event) {
        console.log('[BankRecon RT] Event received: realtime:bankbalance:updated', event.detail);
        if (window.BankReconciliationRealtime && window.BankReconciliationRealtime.updateBalance) {
            window.BankReconciliationRealtime.updateBalance(event.detail.data, event.detail.actor);
        }
    });

    document.addEventListener('realtime:bankbalance:deleted', function(event) {
        console.log('[BankRecon RT] Event received: realtime:bankbalance:deleted', event.detail);
        if (window.BankReconciliationRealtime && window.BankReconciliationRealtime.deleteBalance) {
            window.BankReconciliationRealtime.deleteBalance(event.detail.data);
        }
    });

    document.addEventListener('realtime:reconciliation:mode_changed', function(event) {
        console.log('[BankRecon RT] Event received: realtime:reconciliation:mode_changed', event.detail);
        if (window.BankReconciliationRealtime && window.BankReconciliationRealtime.handleModeChange) {
            window.BankReconciliationRealtime.handleModeChange(event.detail.data);
        }
    });

    console.log('[BankReconciliation] Real-time listeners initialized');
}

console.log('[BankReconciliation.js] Loaded successfully');
