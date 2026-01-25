/**
 * FlowGroup_realtime.js - Real-time Updates for FlowGroup Page
 * PHASE 3 CSP Compliance: All inline real-time scripts moved to external file
 * Version: 20251230-003
 * Handles WebSocket broadcasts to update the page when other users make changes
 */

(function() {
    'use strict';

    // FlowGroup Real-time Updates Namespace
    window.FlowGroupRealtime = {
        /**
         * Add new transaction to the list
         */
        addTransaction: function(transactionData, actor) {
            console.log('[FlowGroup RT] Adding new transaction:', transactionData);

            // Get current FlowGroup ID from multiple sources
            const currentFlowGroupId = 
                document.getElementById('flow-group-form')?.getAttribute('data-flow-group-id') || 
                window.FLOWGROUP_CONFIG?.flowGroupId ||
                document.getElementById('base-config')?.dataset?.flowGroupId;

            // Robust extraction of target FlowGroup ID from backend broadcast
            let transactionFlowGroupId = transactionData.flow_group_id || transactionData.flowgroup_id;
            if (!transactionFlowGroupId && transactionData.flow_group) {
                if (typeof transactionData.flow_group === 'object') {
                    transactionFlowGroupId = transactionData.flow_group.id;
                } else {
                    transactionFlowGroupId = transactionData.flow_group;
                }
            }
            
            console.log('[FlowGroup RT] ID Check -> Transaction FG:', transactionFlowGroupId, 'Current Page FG:', currentFlowGroupId);

            if (!currentFlowGroupId || !transactionFlowGroupId || String(transactionFlowGroupId) !== String(currentFlowGroupId)) {
                console.log('[FlowGroup RT] SKIPPING: Transaction not for this FlowGroup');
                return;
            }

            const transactionId = transactionData.id || transactionData.transaction_id;
            if (!transactionId) {
                console.error('[FlowGroup RT] ERROR: Transaction ID missing in broadcast data!', transactionData);
                return;
            }

            const tbody = document.getElementById('expense-items-body');
            if (!tbody) {
                console.warn('[FlowGroup RT] Items tbody not found (#expense-items-body)');
                return;
            }

            // Check if transaction already exists (avoid duplicates)
            const existingRow = document.getElementById(`item-${transactionId}`);
            if (existingRow) {
                console.log('[FlowGroup RT] Transaction already exists, updating instead');
                this.updateTransaction(transactionData, actor);
                return;
            }

            // OWN ACTION CHECK: Only skip if this is our own action and we are already handling it via AJAX
            const currentUserId = document.body.dataset.userId || window.USER_ID || document.getElementById('base-config')?.dataset?.userId;
            const actorId = actor?.id;
            
            const isOwnAction = actorId && currentUserId && String(actorId) === String(currentUserId);
            console.log('[FlowGroup RT] Own action check:', isOwnAction, 'Actor:', actorId, 'Me:', currentUserId);

            if (isOwnAction) {
                // Check if the template row is currently being submitted (AJAX in progress)
                // If it is, we skip adding via WebSocket to avoid double entries
                const templateRow = document.getElementById('new-item-template');
                const isTemplateActive = templateRow && !templateRow.classList.contains('hidden');
                
                // Also check if any other row is in edit mode and might be the current action
                const rowsInEdit = document.querySelectorAll('tr[data-mode="edit"]');
                
                if (isTemplateActive || rowsInEdit.length > 0) {
                    console.log('[FlowGroup RT] SKIPPING: Own action and local UI is in edit mode (avoiding double entry)');
                    return;
                }
            }

            console.log('[FlowGroup RT] PROCEEDING with row creation for ID:', transactionId);

            // Create new row dynamically (no reload!)
            try {
                console.log('[FlowGroup RT] Calling createTransactionRow...');
                const newRow = this.createTransactionRow(transactionData);
                if (newRow) {
                    const templateRow = document.getElementById('new-item-template');
                    if (templateRow) {
                        console.log('[FlowGroup RT] Inserting row before #new-item-template');
                        tbody.insertBefore(newRow, templateRow);
                    } else {
                        const totalsRow = document.getElementById('totals-row');
                        if (totalsRow) {
                            console.log('[FlowGroup RT] Inserting row before #totals-row');
                            tbody.insertBefore(newRow, totalsRow);
                        } else {
                            console.log('[FlowGroup RT] Appending row to end of tbody');
                            tbody.appendChild(newRow);
                        }
                    }
                    console.log('[FlowGroup RT] Row inserted successfully into DOM');

                    // Remove empty state if present
                    const emptyStateRow = document.getElementById('empty-state-row');
                    if (emptyStateRow) {
                        emptyStateRow.style.display = 'none';
                    }

                    // Highlight the new row
                    if (window.RealtimeUI?.utils?.highlightElement) {
                        window.RealtimeUI.utils.highlightElement(newRow, 2000);
                    }

                    // Update summary locally after addition
                    if (typeof window.updateSummary === 'function') {
                        window.updateSummary();
                    }
                    if (typeof window.updateBudgetWarning === 'function') {
                        window.updateBudgetWarning();
                    }
                } else {
                    console.error('[FlowGroup RT] Failed to create new transaction row');
                }
            } catch (err) {
                console.error('[FlowGroup RT] Error during row insertion:', err);
            }
        },

        /**
         * Create a new transaction row element matching FlowGroup.html exactly
         */
        createTransactionRow: function(data) {
            const tr = document.createElement('tr');
            tr.id = `item-${data.id}`;
            tr.setAttribute('data-item-id', data.id);
            tr.setAttribute('data-mode', 'display');
            tr.setAttribute('data-realized', data.realized ? 'true' : 'false');
            tr.setAttribute('data-fixed', data.is_fixed ? 'true' : 'false');
            tr.setAttribute('data-amount', data.amount);
            tr.setAttribute('draggable', 'true');
            tr.className = `draggable-row swipeable-row ${data.realized ? 'row-realized' : 'row-not-realized'} ${data.is_fixed ? 'row-fixed' : ''} hover:bg-slate-50 dark:hover:bg-gray-700/50`;

            const currencySymbol = window.FLOWGROUP_CONFIG?.currencySymbol || '$';
            const thousandSeparator = window.FLOWGROUP_CONFIG?.thousandSeparator || '.';
            const decimalSeparator = window.FLOWGROUP_CONFIG?.decimalSeparator || ',';
            const isChild = window.FLOWGROUP_CONFIG?.memberRoleForPeriod === 'CHILD';

            // Format date for display
            const dateObj = new Date(data.date + 'T00:00:00');
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const formattedDate = `${dateObj.getFullYear()}-${month}-${day}`;
            const shortDate = `${day}/${month}`;

            // Format amount - explicitly use FLOWGROUP_CONFIG like dashboard.js does
            const amountValue = parseFloat(data.amount || 0);
            const formattedAmount = typeof window.formatCurrency === 'function'
                ? window.formatCurrency(amountValue, currencySymbol, thousandSeparator, decimalSeparator)
                : amountValue.toFixed(2);
            
            const rawAmount = amountValue.toFixed(2).replace('.', decimalSeparator);
            
            // Robust member extraction
            let memberName = '-';
            let memberId = '';
            
            if (data.member_name) {
                memberName = data.member_name;
            } else if (data.member) {
                if (typeof data.member === 'object') {
                    memberName = data.member.username || data.member.name || '-';
                } else {
                    memberName = data.member;
                }
            }
            
            memberId = data.member_id || (data.member && typeof data.member === 'object' ? data.member.id : '');

            // Row Inner HTML (8 columns total - consolidating display/edit in same TD)
            tr.innerHTML = `
                <td class="px-2 py-4 text-center drag-handle-cell" data-row-id="item-${data.id}">
                    ${!isChild ? `
                    <div class="mobile-fixed-btn-container">
                        <button type="button" data-action="toggle-transaction-fixed" data-row-id="item-${data.id}"
                                class="mobile-fixed-btn ${data.is_fixed ? 'active' : ''}" title="Mark as recurring expense">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8m0-5v5h5" />
                            </svg>
                        </button>
                    </div>` : ''}
                    <span class="material-symbols-outlined text-gray-400 dark:text-gray-500 drag-handle cursor-grab active:cursor-grabbing">drag_indicator</span>
                    <button type="button" data-action="save" data-row-id="item-${data.id}" class="edit-save-icon" style="display: none;">
                        <span class="material-symbols-outlined text-green-500 text-2xl">check_circle</span>
                    </button>
                </td>
                <td class="px-6 py-4 font-medium text-[#0d171b] dark:text-white">
                    <span class="cell-description-display">${data.description}</span>
                    <div class="cell-description-edit hidden">
                        <input type="text" value="${data.description}" data-field="description" maxlength="35" size="35" class="border-b border-primary bg-transparent focus:outline-none focus:ring-0 text-sm p-1">
                    </div>
                </td>
                <td class="px-6 py-4 text-sm text-gray-500">
                    <div class="cell-date-display">
                        <span class="date-full">${formattedDate}</span>
                        <span class="date-short">${shortDate}</span>
                    </div>
                    <div class="cell-date-edit hidden">
                        <input type="date" value="${formattedDate}" data-field="date" class="w-full border-b border-primary dark:text-white dark:bg-gray-800 bg-transparent focus:outline-none focus:ring-0 text-sm p-1 date-input-field">
                    </div>
                </td>
                <td class="px-6 py-4 text-sm text-gray-500">
                    <div class="cell-member-display" data-member-id="${memberId}">
                        ${memberName}
                    </div>
                    <div class="cell-member-edit hidden py-2">
                        <select data-field="member_id" class="w-full border-b border-primary dark:text-white dark:bg-gray-800 bg-transparent focus:ring-0 focus:border-primary text-sm p-1">
                            <option value="${memberId}" selected>${memberName}</option>
                        </select>
                    </div>
                </td>
                <td class="px-6 py-4 mobile-hide-column">
                    <div class="flex items-center justify-center w-full">
                        <button type="button" data-toggle="realized" data-item-id="item-${data.id}" data-current-state="${data.realized ? 'true' : 'false'}"
                                class="realized-toggle relative inline-block w-10 h-6 transition duration-200 ease-in-out rounded-full cursor-pointer ${data.realized ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}">
                            <span class="absolute left-1 top-1 inline-block w-4 h-4 transition-transform duration-200 ease-in-out transform bg-white rounded-full ${data.realized ? 'translate-x-4' : ''}"></span>
                        </button>
                    </div>
                </td>
                <td class="px-6 py-4 mobile-hide-column">
                    <div class="flex items-center justify-center w-full">
                        ${!isChild ? `
                        <button type="button" data-action="toggle-fixed" data-item-id="item-${data.id}"
                                class="fixed-toggle-btn inline-flex items-center justify-center w-8 h-8 rounded transition-all duration-200 ${data.is_fixed ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:bg-blue-200 dark:hover:bg-blue-900/30'}"
                                title="Mark as recurring expense">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8m0-5v5h5" />
                            </svg>
                        </button>` : ''}
                    </div>
                </td>
                <td class="px-6 py-4 text-right text-primary">
                    <div class="cell-budget-display amount-cell-with-actions">
                        ${formattedAmount.replace(currencySymbol + ' ', '')}
                        <div class="mobile-actions-btns">
                            <button type="button" data-action="edit" data-row-id="item-${data.id}" class="mobile-action-btn edit-btn">
                                <span class="material-symbols-outlined">edit</span>
                            </button>
                            <button type="button" data-action="delete" data-row-id="item-${data.id}" class="mobile-action-btn delete-btn">
                                <span class="material-symbols-outlined">delete</span>
                            </button>
                        </div>
                    </div>
                    <div class="cell-budget-edit hidden">
                        <input type="text" inputmode="decimal" value="${rawAmount}" data-field="amount" class="w-full border-b border-primary bg-transparent focus:outline-none focus:ring-0 text-sm text-right p-1">
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap mobile-hide-column">
                    <div class="actions-display">
                        <button type="button" data-action="edit" data-row-id="item-${data.id}" class="p-1 text-slate-500 hover:text-primary"><span class="material-symbols-outlined text-lg">edit</span></button>
                        <button type="button" data-action="delete" data-row-id="item-${data.id}" class="p-1 text-slate-500 hover:text-red-500"><span class="material-symbols-outlined text-lg">delete</span></button>
                    </div>
                    <div class="actions-edit hidden space-x-2">
                        <button type="button" data-action="save" data-row-id="item-${data.id}" class="p-1 text-primary hover:text-primary/80"><span class="material-symbols-outlined text-lg">check</span></button>
                        <button type="button" data-action="cancel" data-row-id="item-${data.id}" class="p-1 text-slate-500 hover:text-red-500"><span class="material-symbols-outlined text-lg">close</span></button>
                    </div>
                </td>
            `;
            return tr;
        },


        /**
         * Update existing transaction
         */
        updateTransaction: function(transactionData, actor) {
            console.log('[FlowGroup RT] Updating transaction:', transactionData);

            // Robust FlowGroup ID check
            const currentFlowGroupId = 
                document.getElementById('flow-group-form')?.getAttribute('data-flow-group-id') || 
                window.FLOWGROUP_CONFIG?.flowGroupId ||
                document.getElementById('base-config')?.dataset?.flowGroupId;

            const transactionFlowGroupId = transactionData.flow_group_id || transactionData.flow_group?.id;

            if (!currentFlowGroupId || !transactionFlowGroupId || String(transactionFlowGroupId) !== String(currentFlowGroupId)) {
                return;
            }

            const row = document.getElementById(`item-${transactionData.id}`);
            if (!row) {
                console.warn('[FlowGroup RT] Transaction row not found:', `item-${transactionData.id}`);
                return;
            }

            // OWN ACTION CHECK: Skip if we are currently editing this row
            const baseConfig = document.getElementById('base-config');
            const currentUserId = baseConfig?.dataset?.userId;
            const actorId = actor?.id;
            const isOwnAction = actorId && currentUserId && String(actorId) === String(currentUserId);

            if (row.getAttribute('data-mode') === 'edit' && !isOwnAction) {
                console.log('[FlowGroup RT] Row is being edited by current user, skipping update to avoid content loss');
                return;
            }
            try {
                // Update description display
                const descDisplay = row.querySelector('.cell-description-display');
                if (descDisplay) {
                    descDisplay.textContent = transactionData.description;
                }

                // Update amount display (preserve mobile action buttons!)
                const amountDisplay = row.querySelector('.cell-budget-display');
                if (amountDisplay && transactionData.amount !== undefined) {
                    const amountValue = parseFloat(transactionData.amount || 0);
                    // Explicitly use FLOWGROUP_CONFIG like dashboard.js toggleIncomeRealized does
                    const formattedAmount = typeof window.formatCurrency === 'function'
                        ? window.formatCurrency(amountValue, window.FLOWGROUP_CONFIG?.currencySymbol || '$', window.FLOWGROUP_CONFIG?.thousandSeparator || '.', window.FLOWGROUP_CONFIG?.decimalSeparator || ',')
                        : amountValue.toFixed(2);
                    
                    // Don't use textContent as it removes mobile action buttons!
                    // Instead, find/create text node or update only the text part
                    const mobileActions = amountDisplay.querySelector('.mobile-actions-btns');

                    if (mobileActions) {
                        // Mobile buttons exist - preserve them
                        // Remove all text nodes and replace with new amount
                        Array.from(amountDisplay.childNodes).forEach(node => {
                            if (node.nodeType === Node.TEXT_NODE) {
                                node.remove();
                            }
                        });
                        // Insert formatted amount as first child (before mobile-actions-btns)
                        amountDisplay.insertBefore(document.createTextNode(formattedAmount + '\n                        '), amountDisplay.firstChild);
                    } else {
                        // No mobile buttons - safe to use textContent
                        amountDisplay.textContent = formattedAmount;
                    }
                }

                // Update date display (fix timezone issue - add T00:00:00 to force local time)
                if (transactionData.date) {
                    const dateFull = row.querySelector('.date-full');
                    const dateShort = row.querySelector('.date-short');
                    if (dateFull && dateShort) {
                        // Add T00:00:00 to prevent timezone conversion (prevents -1 day bug)
                        const dateObj = new Date(transactionData.date + 'T00:00:00');
                        const year = dateObj.getFullYear();
                        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                        const day = String(dateObj.getDate()).padStart(2, '0');
                        dateFull.textContent = `${year}-${month}-${day}`;
                        dateShort.textContent = `${day}/${month}`;
                    }
                }

                // Update member display
                if (transactionData.member !== undefined) {
                    const memberDisplay = row.querySelector('.cell-member-display');
                    if (memberDisplay) {
                        memberDisplay.textContent = transactionData.member || '-';
                        if (transactionData.member_id) {
                            memberDisplay.setAttribute('data-member-id', transactionData.member_id);
                        }
                    }
                }

                // Update data attributes
                row.setAttribute('data-amount', transactionData.amount);
                row.setAttribute('data-realized', transactionData.realized ? 'true' : 'false');
                row.setAttribute('data-fixed', transactionData.is_fixed ? 'true' : 'false');

                // Update realized toggle
                const toggleBtn = row.querySelector('.realized-toggle');
                if (toggleBtn) {
                    const toggleCircle = toggleBtn.querySelector('span');
                    if (transactionData.realized) {
                        toggleBtn.classList.remove('bg-gray-300', 'dark:bg-gray-600');
                        toggleBtn.classList.add('bg-green-500');
                        if (toggleCircle) toggleCircle.classList.add('translate-x-4');
                    } else {
                        toggleBtn.classList.remove('bg-green-500');
                        toggleBtn.classList.add('bg-gray-300', 'dark:bg-gray-600');
                        if (toggleCircle) toggleCircle.classList.remove('translate-x-4');
                    }
                }

                // Update desktop fixed toggle button
                const fixedToggleBtn = row.querySelector('.fixed-toggle-btn');
                if (fixedToggleBtn) {
                    if (transactionData.is_fixed) {
                        fixedToggleBtn.classList.remove('bg-gray-200', 'dark:bg-gray-700', 'text-gray-400', 'dark:text-gray-500', 'hover:bg-blue-200', 'dark:hover:bg-blue-900/30');
                        fixedToggleBtn.classList.add('bg-blue-600', 'text-white', 'hover:bg-blue-700');
                    } else {
                        fixedToggleBtn.classList.remove('bg-blue-600', 'text-white', 'hover:bg-blue-700');
                        fixedToggleBtn.classList.add('bg-gray-200', 'dark:bg-gray-700', 'text-gray-400', 'dark:text-gray-500', 'hover:bg-blue-200', 'dark:hover:bg-blue-900/30');
                    }
                }

                // Update mobile fixed button
                const mobileFixedBtn = row.querySelector('.mobile-fixed-btn');
                if (mobileFixedBtn) {
                    if (transactionData.is_fixed) {
                        mobileFixedBtn.classList.add('active');
                    } else {
                        mobileFixedBtn.classList.remove('active');
                    }
                }

                // Update row classes for fixed status (mobile border)
                if (transactionData.is_fixed) {
                    row.classList.add('row-fixed');
                } else {
                    row.classList.remove('row-fixed');
                }

                // Update row classes for realized status
                if (transactionData.realized) {
                    row.classList.remove('row-not-realized');
                    row.classList.add('row-realized');
                } else {
                    row.classList.remove('row-realized');
                    row.classList.add('row-not-realized');
                }

                // Highlight the updated row
                if (window.RealtimeUI && window.RealtimeUI.utils && window.RealtimeUI.utils.highlightElement) {
                    window.RealtimeUI.utils.highlightElement(row, 2000);
                }

                console.log('[FlowGroup RT] Transaction updated successfully:', transactionData.id);

                // Update summary locally after update (critical for amount changes!)
                if (typeof window.updateSummary === 'function') {
                    window.updateSummary();
                }
                if (typeof window.updateBudgetWarning === 'function') {
                    window.updateBudgetWarning();
                }
            } catch (error) {
                console.error('[FlowGroup RT] Error updating transaction:', error);
            }
        },

        /**
         * Remove transaction from the list
         */
        removeTransaction: function(transactionId) {
            console.log('[FlowGroup RT] Removing transaction:', transactionId);

            const row = document.getElementById(`item-${transactionId}`);
            if (!row) {
                console.warn('[FlowGroup RT] Transaction row not found');
                return;
            }

            // Fade out animation
            row.style.transition = 'opacity 0.3s ease';
            row.style.opacity = '0';

            setTimeout(() => {
                if (row.parentNode) {
                    row.parentNode.removeChild(row);
                    console.log('[FlowGroup RT] Transaction removed successfully');

                    // Update summary and budget warning locally after removal
                    if (typeof window.updateSummary === 'function') {
                        window.updateSummary();
                    }
                    if (typeof window.updateBudgetWarning === 'function') {
                        window.updateBudgetWarning();
                    }
                }
            }, 300);
        },

        /**
         * Update FlowGroup details (name, budget, checkboxes, etc.)
         */
        updateFlowGroup: function(flowgroupData, actor) {
            console.log('[FlowGroup RT] Updating FlowGroup:', flowgroupData);

            // Check if this is the current FlowGroup
            const currentFlowGroupId = document.getElementById('flow-group-form')?.getAttribute('data-flow-group-id');
            if (!currentFlowGroupId || flowgroupData.id != currentFlowGroupId) {
                return;
            }

            try {
                // Update name in title
                const titleElement = document.querySelector('h1.text-3xl');
                if (titleElement && flowgroupData.name) {
                    const backArrow = titleElement.querySelector('a');
                    if (backArrow) {
                        const textNode = titleElement.childNodes[titleElement.childNodes.length - 1];
                        if (textNode) {
                            textNode.textContent = ' ' + flowgroupData.name;
                        }
                    }
                }

                // Update name input
                const nameInput = document.getElementById('id_name');
                if (nameInput && flowgroupData.name) {
                    nameInput.value = flowgroupData.name;
                }

                // Update budgeted_amount input
                const budgetInput = document.getElementById('id_budgeted_amount');
                if (budgetInput && flowgroupData.budgeted_amount) {
                    budgetInput.value = flowgroupData.budgeted_amount;
                }

                // Update checkboxes
                const isSharedCheckbox = document.getElementById('id_is_shared');
                if (isSharedCheckbox) {
                    isSharedCheckbox.checked = flowgroupData.is_shared;
                }

                const isKidsGroupCheckbox = document.getElementById('id_is_kids_group');
                if (isKidsGroupCheckbox) {
                    isKidsGroupCheckbox.checked = flowgroupData.is_kids_group;
                }

                const isInvestmentCheckbox = document.getElementById('id_is_investment');
                if (isInvestmentCheckbox) {
                    isInvestmentCheckbox.checked = flowgroupData.is_investment;
                }

                const isCreditCardCheckbox = document.getElementById('id_is_credit_card');
                if (isCreditCardCheckbox) {
                    isCreditCardCheckbox.checked = flowgroupData.is_credit_card;

                    // Show/hide credit card closed button based on checkbox
                    const closedBtnContainer = document.querySelector('[data-action="toggle-creditcard-closed"]')?.closest('.flex, .inline-flex');
                    if (closedBtnContainer) {
                        if (flowgroupData.is_credit_card) {
                            closedBtnContainer.style.display = '';
                        } else {
                            closedBtnContainer.style.display = 'none';
                        }
                    }
                }

                // Update assigned members multi-select
                if (flowgroupData.assigned_members) {
                    const membersSelect = document.getElementById('id_assigned_members');
                    if (membersSelect) {
                        Array.from(membersSelect.options).forEach(option => {
                            option.selected = flowgroupData.assigned_members.includes(parseInt(option.value));
                        });
                    }
                }

                // Update assigned children multi-select
                if (flowgroupData.assigned_children) {
                    const childrenSelect = document.getElementById('id_assigned_children');
                    if (childrenSelect) {
                        Array.from(childrenSelect.options).forEach(option => {
                            option.selected = flowgroupData.assigned_children.includes(parseInt(option.value));
                        });
                    }
                }

                // Update recurring toggle button (desktop and mobile)
                // CRITICAL FIX: Update BOTH buttons (desktop and mobile)
                const recurringBtns = document.querySelectorAll('.recurring-btn');
                recurringBtns.forEach(recurringBtn => {
                    if (flowgroupData.is_recurring) {
                        recurringBtn.classList.remove('bg-blue-600/30', 'text-blue-600', 'dark:text-blue-400', 'hover:bg-blue-600/50');
                        recurringBtn.classList.add('bg-blue-600', 'text-white', 'hover:bg-blue-700');

                        // Update inner circle color
                        const innerCircle = recurringBtn.querySelector('span.flex');
                        if (innerCircle) {
                            innerCircle.classList.remove('bg-blue-700/50');
                            innerCircle.classList.add('bg-blue-800');
                        }
                    } else {
                        recurringBtn.classList.remove('bg-blue-600', 'text-white', 'hover:bg-blue-700');
                        recurringBtn.classList.add('bg-blue-600/30', 'text-blue-600', 'dark:text-blue-400', 'hover:bg-blue-600/50');

                        // Update inner circle color
                        const innerCircle = recurringBtn.querySelector('span.flex');
                        if (innerCircle) {
                            innerCircle.classList.remove('bg-blue-800');
                            innerCircle.classList.add('bg-blue-700/50');
                        }
                    }
                });

                // Update kids realized toggle button
                if (flowgroupData.is_kids_group) {
                    const kidsRealizedBtn = document.querySelector('[data-action="toggle-kids-realized"]');
                    if (kidsRealizedBtn && window.FLOWGROUP_CONFIG) {
                        const icon = kidsRealizedBtn.querySelector('span.material-symbols-outlined');
                        const text = kidsRealizedBtn.querySelector('span:not(.material-symbols-outlined)');
                        if (flowgroupData.realized) {
                            kidsRealizedBtn.classList.remove('bg-gray-200', 'dark:bg-gray-700', 'text-gray-700', 'dark:text-gray-300');
                            kidsRealizedBtn.classList.add('bg-green-500', 'text-white');
                            kidsRealizedBtn.setAttribute('data-current-state', 'true');
                            if (icon) icon.textContent = 'check_circle';
                            if (text) text.textContent = window.FLOWGROUP_CONFIG.i18n.realized || 'Realized';
                        } else {
                            kidsRealizedBtn.classList.remove('bg-green-500', 'text-white');
                            kidsRealizedBtn.classList.add('bg-gray-200', 'dark:bg-gray-700', 'text-gray-700', 'dark:text-gray-300');
                            kidsRealizedBtn.setAttribute('data-current-state', 'false');
                            if (icon) icon.textContent = 'cancel';
                            if (text) text.textContent = window.FLOWGROUP_CONFIG.i18n.notRealized || 'Not Realized';
                        }
                    }
                }

                // Update credit card closed toggle button
                if (flowgroupData.is_credit_card) {
                    const closedBtn = document.querySelector('[data-action="toggle-creditcard-closed"]');
                    if (closedBtn && window.FLOWGROUP_CONFIG) {
                        const icon = closedBtn.querySelector('span.material-symbols-outlined');
                        const text = closedBtn.querySelector('span:not(.material-symbols-outlined)');
                        if (flowgroupData.closed) {
                            closedBtn.classList.remove('bg-gray-200', 'dark:bg-gray-700', 'text-gray-700', 'dark:text-gray-300');
                            closedBtn.classList.add('bg-green-500', 'text-white');
                            closedBtn.setAttribute('data-current-state', 'true');
                            if (icon) icon.textContent = 'check_circle';
                            if (text) text.textContent = window.FLOWGROUP_CONFIG.i18n.billClosed || 'Bill Closed';
                        } else {
                            closedBtn.classList.remove('bg-green-500', 'text-white');
                            closedBtn.classList.add('bg-gray-200', 'dark:bg-gray-700', 'text-gray-700', 'dark:text-gray-300');
                            closedBtn.setAttribute('data-current-state', 'false');
                            if (icon) icon.textContent = 'cancel';
                            if (text) text.textContent = window.FLOWGROUP_CONFIG.i18n.billOpen || 'Bill Open';
                        }
                    }
                }

                // Update totals display in the totals row (both desktop and mobile)
                // Use explicit FLOWGROUP_CONFIG like dashboard.js pattern
                const currencySymbol = window.FLOWGROUP_CONFIG?.currencySymbol || '$';
                const thousandSep = window.FLOWGROUP_CONFIG?.thousandSeparator || '.';
                const decimalSep = window.FLOWGROUP_CONFIG?.decimalSeparator || ',';

                const estimatedDisplayDesktop = document.getElementById('total-expenses-desktop');
                const estimatedDisplayMobile = document.getElementById('total-expenses-mobile');
                if (flowgroupData.total_estimated) {
                    const formattedEstimated = typeof window.formatCurrency === 'function'
                        ? window.formatCurrency(flowgroupData.total_estimated, currencySymbol, thousandSep, decimalSep)
                        : flowgroupData.total_estimated;
                    if (estimatedDisplayDesktop) estimatedDisplayDesktop.textContent = formattedEstimated;
                    if (estimatedDisplayMobile) estimatedDisplayMobile.textContent = formattedEstimated;
                }

                const realizedDisplayDesktop = document.getElementById('total-realized-desktop');
                const realizedDisplayMobile = document.getElementById('total-realized-mobile');
                if (flowgroupData.total_realized) {
                    const formattedRealized = typeof window.formatCurrency === 'function'
                        ? window.formatCurrency(flowgroupData.total_realized, currencySymbol, thousandSep, decimalSep)
                        : flowgroupData.total_realized;
                    if (realizedDisplayDesktop) realizedDisplayDesktop.textContent = formattedRealized;
                    if (realizedDisplayMobile) realizedDisplayMobile.textContent = formattedRealized;
                }

                // Update overbudget warning based on backend calculation
                console.log('[FlowGroup RT] Budget warning from backend:', flowgroupData.budget_warning);
                console.log('[FlowGroup RT] Estimated:', flowgroupData.total_estimated, 'Budgeted:', flowgroupData.budgeted_amount);
                this.updateOverbudgetWarningFromBackend(flowgroupData.budget_warning || false, flowgroupData.total_estimated);

                console.log('[FlowGroup RT] FlowGroup updated successfully');
            } catch (error) {
                console.error('[FlowGroup RT] Error updating FlowGroup:', error);
            }
        },

        /**
         * Handle FlowGroup deletion
         */
        handleFlowGroupDeleted: function(data) {
            console.log('[FlowGroup RT] FlowGroup deleted event received:', data);

            // Extract FlowGroup data from WebSocket message structure
            const flowgroupData = data.data || data;
            const flowgroupId = flowgroupData.id;
            const flowgroupName = flowgroupData.name || '';

            console.log('[FlowGroup RT] Target FlowGroup ID:', flowgroupId);

            // Check if this is the current FlowGroup
            const currentFlowGroupId = document.getElementById('flow-group-form')?.getAttribute('data-flow-group-id');
            console.log('[FlowGroup RT] Current page FlowGroup ID:', currentFlowGroupId);

            if (!currentFlowGroupId || flowgroupId != currentFlowGroupId) {
                console.log('[FlowGroup RT] Deletion is for a different group, ignoring');
                return;
            }

            // Prepare message based on who deleted
            let title, message, iconColor, iconBgColor;

            // REMOVED isOwnAction check - we want the modal to appear in all tabs 
            // if they are viewing the deleted group, regardless of user ID (e.g. same user in 2 tabs)
            
            title = window.FLOWGROUP_CONFIG?.i18n?.flowGroupDeletedTitle || 'FlowGroup Deleted';
            const actorName = data.actor ? data.actor.username : (window.FLOWGROUP_CONFIG?.i18n?.anotherUser || 'another user');
            const deletedByText = window.FLOWGROUP_CONFIG?.i18n?.flowGroupDeletedByUser || 'This FlowGroup was deleted by';
            message = `${deletedByText} <strong>${actorName}</strong>.`;
            iconColor = "text-red-600 dark:text-red-400";
            iconBgColor = "bg-red-100 dark:bg-red-900/30";

            // Show modal informing user using standardized GenericModal
            if (window.GenericModal) {
                const modalType = 'warning';
                const okText = window.FLOWGROUP_CONFIG?.i18n?.ok || 'OK';
                
                window.GenericModal.show({
                    title: title,
                    message: message,
                    type: modalType,
                    buttons: [{
                        text: okText,
                        primary: true,
                        onClick: function() {
                            console.log('[FlowGroup RT] OK clicked, redirecting to dashboard');
                            window.location.href = window.FLOWGROUP_CONFIG?.urls?.dashboard || '/';
                        }
                    }]
                });
            } else {
                console.error('[FlowGroup RT] GenericModal not available, falling back to alert');
                alert(message);
                window.location.href = window.FLOWGROUP_CONFIG?.urls?.dashboard || '/';
            }
        },

        /**
         * Update overbudget warning based on backend calculation
         * NO frontend calculations - backend sends budget_warning flag and total_estimated
         */
        updateOverbudgetWarningFromBackend: function(showWarning, totalEstimated) {
            console.log('[FlowGroup RT] Updating overbudget warning, show:', showWarning, 'totalEstimated:', totalEstimated);

            // Find the budget warning container
            let warningContainer = document.getElementById('budget-warning-container');
            const warningText = document.getElementById('budget-warning-text');

            if (showWarning) {
                // Format the total estimated value using explicit FLOWGROUP_CONFIG
                let formattedTotal = '';
                if (totalEstimated) {
                    const currencySymbol = window.FLOWGROUP_CONFIG?.currencySymbol || '$';
                    const thousandSep = window.FLOWGROUP_CONFIG?.thousandSeparator || '.';
                    const decimalSep = window.FLOWGROUP_CONFIG?.decimalSeparator || ',';
                    formattedTotal = typeof window.formatCurrency === 'function'
                        ? window.formatCurrency(totalEstimated, currencySymbol, thousandSep, decimalSep)
                        : totalEstimated;
                }

                // Build the warning message
                const estimatedExpenses = window.FLOWGROUP_CONFIG?.i18n?.estimatedExpenses || 'Estimated expenses';
                const exceedBudget = window.FLOWGROUP_CONFIG?.i18n?.exceedBudget || 'exceed the budgeted amount';
                const warningMessage = formattedTotal
                    ? `${estimatedExpenses} (${formattedTotal}) ${exceedBudget}`
                    : `${estimatedExpenses} ${exceedBudget}`;

                // If it exists, just show it and update text
                if (warningContainer) {
                    warningContainer.classList.remove('hidden');
                    if (warningText) {
                        warningText.textContent = warningMessage;
                    }
                } else {
                    // Create it if it really doesn't exist (fallback)
                    const headerArea = document.querySelector('h1.text-3xl');
                    if (!headerArea) {
                        console.warn('[FlowGroup RT] Could not find header area for warning');
                        return;
                    }

                    warningContainer = document.createElement('div');
                    warningContainer.id = 'budget-warning-container';
                    warningContainer.className = 'bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 dark:border-yellow-500 p-4 mb-6 rounded';

                    const innerHtml = `
                        <div class="flex">
                            <div class="flex-shrink-0">
                                <span class="material-symbols-outlined text-yellow-400">warning</span>
                            </div>
                            <div class="ml-3">
                                <p class="text-sm text-yellow-700 dark:text-yellow-300">
                                    <strong>${window.FLOWGROUP_CONFIG?.i18n?.budgetWarning || 'Budget Warning:'}</strong> <span id="budget-warning-text">${warningMessage}</span>
                                </p>
                            </div>
                        </div>
                    `;
                    warningContainer.innerHTML = innerHtml;
                    headerArea.parentNode.insertBefore(warningContainer, headerArea.nextSibling);
                }
                console.log('[FlowGroup RT] Overbudget warning shown');
            } else {
                // Hide warning if it exists
                if (warningContainer) {
                    warningContainer.classList.add('hidden');
                    console.log('[FlowGroup RT] Overbudget warning hidden');
                }
            }
        }
    };

    // Listen for Transaction creation events
    document.addEventListener('realtime:transaction:created', function(event) {
        if (window.FlowGroupRealtime && window.FlowGroupRealtime.addTransaction) {
            window.FlowGroupRealtime.addTransaction(event.detail.data, event.detail.actor);
        }
    });

    // Listen for Transaction update events
    document.addEventListener('realtime:transaction:updated', function(event) {
        if (window.FlowGroupRealtime && window.FlowGroupRealtime.updateTransaction) {
            window.FlowGroupRealtime.updateTransaction(event.detail.data, event.detail.actor);
        }
    });

    // Listen for Transaction deletion events
    document.addEventListener('realtime:transaction:deleted', function(event) {
        if (window.FlowGroupRealtime && window.FlowGroupRealtime.removeTransaction) {
            window.FlowGroupRealtime.removeTransaction(event.detail.data.id || event.detail.data.transaction_id);
        }
    });

    // Listen for FlowGroup update events
    document.addEventListener('realtime:flowgroup:updated', function(event) {
        if (window.FlowGroupRealtime && window.FlowGroupRealtime.updateFlowGroup) {
            window.FlowGroupRealtime.updateFlowGroup(event.detail.data, event.detail.actor);
        }
    });

    // Listen for FlowGroup deletion events
    document.addEventListener('realtime:flowgroup:deleted', function(event) {
        if (window.FlowGroupRealtime && window.FlowGroupRealtime.handleFlowGroupDeleted) {
            // Pass the full event.detail which contains data and actor
            window.FlowGroupRealtime.handleFlowGroupDeleted(event.detail);
        }
    });

    console.log('[FlowGroup RT] Real-time updates initialized');
})();
