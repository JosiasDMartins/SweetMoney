/**
 * ShopLists.js - Shopping List detail page functionality.
 * CSP Compliance: All config from #shoplist-config div.
 */

document.addEventListener('DOMContentLoaded', function() {
    const configEl = document.getElementById('shoplist-config');
    if (!configEl) return;

    // Read config
    window.SHOPLIST_CONFIG = {
        shopListId: configEl.dataset.shopListId,
        csrfToken: configEl.dataset.csrfToken,
        currencySymbol: configEl.dataset.currencySymbol || '$',
        decimalSeparator: configEl.dataset.decimalSeparator || ',',
        thousandSeparator: configEl.dataset.thousandSeparator || '.',
        isJustCloned: configEl.dataset.isJustCloned === 'true',
        urls: {
            saveItem: configEl.dataset.urlSaveItem,
            deleteItem: configEl.dataset.urlDeleteItem,
            reorderItems: configEl.dataset.urlReorderItems,
            deleteList: configEl.dataset.urlDeleteList,
            cloneList: configEl.dataset.urlCloneList,
            shopLists: configEl.dataset.urlShopLists
        },
        i18n: {
            confirmDeleteItem: configEl.dataset.i18nConfirmDeleteItem,
            confirmDeleteList: configEl.dataset.i18nConfirmDeleteList,
            descriptionRequired: configEl.dataset.i18nDescriptionRequired,
            networkError: configEl.dataset.i18nNetworkError,
            listCloned: configEl.dataset.i18nListCloned,
            listDeleted: configEl.dataset.i18nListDeleted,
            unsavedChanges: configEl.dataset.i18nUnsavedChanges,
            unsavedChangesTitle: configEl.dataset.i18nUnsavedChangesTitle,
            ok: configEl.dataset.i18nOk
        }
    };

    const CSRF = window.SHOPLIST_CONFIG.csrfToken || getCookie('csrftoken');

    // Form submit handler - named function to avoid arguments.callee
    const shopListForm = document.getElementById('shop-list-form');
    if (shopListForm) {
        shopListForm.addEventListener('submit', function handleFormSubmit(event) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            const submitButton = event.submitter;
            if (submitButton && submitButton.getAttribute('type') === 'submit') {
                shopListForm.removeEventListener('submit', handleFormSubmit);
                shopListForm.submit();
            }
            return false;
        }, true);
    }

    // Initialize
    initCheckboxHandlers();
    initEventDelegation();
    initializeDragAndDrop();
    initializeMobileSwipe();

    // --- Checkbox Handlers ---
    function initCheckboxHandlers() {
        const sharedCheckbox = document.getElementById('id_is_shared');
        if (sharedCheckbox) {
            sharedCheckbox.addEventListener('change', function() {
                const container = document.getElementById('members-selection-container');
                if (container) {
                    container.style.display = this.checked ? 'flex' : 'none';
                }
            });
        }
    }

    // --- Event Delegation for item actions ---
    function initEventDelegation() {
        const tbody = document.getElementById('list-items-body');
        if (!tbody) return;

        tbody.addEventListener('click', function(e) {
            // Handle realized toggle
            const toggleBtn = e.target.closest('[data-toggle="realized"]');
            if (toggleBtn) {
                e.preventDefault();
                e.stopPropagation();
                var toggleRowId = toggleBtn.dataset.itemId;
                var currentState = toggleBtn.dataset.currentState === 'true';
                toggleRealized(toggleRowId, currentState);
                return;
            }

            const btn = e.target.closest('[data-action]');
            if (!btn) return;

            const action = btn.dataset.action;
            const rowId = btn.dataset.rowId || btn.dataset.itemId;

            switch (action) {
                case 'edit':
                    editRow(rowId);
                    break;
                case 'save':
                    saveRow(rowId);
                    break;
                case 'cancel':
                    cancelEdit(rowId);
                    break;
                case 'cancel-new-row':
                    cancelNewRow(rowId);
                    break;
                case 'delete':
                    deleteRow(rowId);
                    break;
                case 'add-new-row':
                    addNewRow();
                    break;
            }
        });

        // Add new item button
        const addBtn = document.querySelector('[data-action="add-new-row"]');
        if (addBtn) {
            addBtn.addEventListener('click', addNewRow);
        }
    }

    // --- Toggle Realized ---
    function toggleRealized(rowId, currentStatus) {
        var row = document.getElementById(rowId);
        if (!row) return;
        var itemId = row.getAttribute('data-item-id');
        if (!itemId || itemId === 'NEW') return;

        var newStatus = !currentStatus;

        // Get current field values from display
        var description = row.querySelector('.cell-description-display')
            ? row.querySelector('.cell-description-display').textContent.trim() : '';

        var amountInput = row.querySelector('input[data-field="amount"]');
        var amountText = amountInput ? amountInput.value : '0';

        // Read amount from data attribute if not in edit mode
        if (row.getAttribute('data-mode') !== 'edit') {
            amountText = row.getAttribute('data-amount') || '0';
        }

        var linkInput = row.querySelector('input[data-field="link"]');
        var link = linkInput ? linkInput.value.trim() : '';
        // Get link from display if not in edit mode
        if (row.getAttribute('data-mode') !== 'edit') {
            var linkEl = row.querySelector('.cell-link-display a');
            link = linkEl ? linkEl.getAttribute('href') : '';
        }

        var data = {
            shop_list_id: window.SHOPLIST_CONFIG.shopListId,
            item_id: itemId,
            description: description,
            amount: amountText,
            link: link,
            realized: newStatus
        };

        fetch(window.SHOPLIST_CONFIG.urls.saveItem, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': CSRF,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify(data)
        })
        .then(function(response) { return response.json(); })
        .then(function(resp) {
            if (resp.status === 'success') {
                row.setAttribute('data-realized', resp.realized ? 'true' : 'false');

                var toggleBtnEl = row.querySelector('.realized-toggle');
                if (toggleBtnEl) {
                    var circle = toggleBtnEl.querySelector('span');
                    if (resp.realized) {
                        toggleBtnEl.classList.remove('bg-gray-300', 'dark:bg-gray-600');
                        toggleBtnEl.classList.add('bg-green-500');
                        if (circle) circle.classList.add('translate-x-4');
                        row.classList.remove('row-not-realized');
                        row.classList.add('row-realized');
                    } else {
                        toggleBtnEl.classList.remove('bg-green-500');
                        toggleBtnEl.classList.add('bg-gray-300', 'dark:bg-gray-600');
                        if (circle) circle.classList.remove('translate-x-4');
                        row.classList.remove('row-realized');
                        row.classList.add('row-not-realized');
                    }
                    toggleBtnEl.setAttribute('data-current-state', resp.realized ? 'true' : 'false');
                }

                row.style.transform = 'translateX(0)';
                row.classList.remove('actions-revealed');
                updateTotals();
            } else {
                window.GenericModal.alert(resp.error || window.SHOPLIST_CONFIG.i18n.networkError);
            }
        })
        .catch(function() {
            window.GenericModal.alert(window.SHOPLIST_CONFIG.i18n.networkError);
        });
    }

    // --- Edit Row ---
    function editRow(rowId) {
        var row = document.getElementById(rowId);
        if (!row) return;

        row.setAttribute('data-mode', 'edit');
        row.querySelectorAll('.cell-description-display, .cell-link-display, .cell-budget-display').forEach(function(el) {
            el.classList.add('hidden');
        });
        row.querySelectorAll('.cell-description-edit, .cell-link-edit, .cell-budget-edit').forEach(function(el) {
            el.classList.remove('hidden');
        });
        row.querySelector('.actions-display').classList.add('hidden');
        row.querySelector('.actions-edit').classList.remove('hidden');

        var dragHandle = row.querySelector('.drag-handle');
        var saveIcon = row.querySelector('.edit-save-icon');
        if (dragHandle) dragHandle.style.display = 'none';
        if (saveIcon) saveIcon.style.display = 'inline-block';

        row.setAttribute('draggable', 'false');
    }

    // --- Save Row ---
    function saveRow(rowId) {
        var row = document.getElementById(rowId);
        if (!row) return;

        var isNew = row.getAttribute('data-item-id') === 'NEW';
        var itemId = isNew ? null : row.getAttribute('data-item-id');

        var descInput = row.querySelector('[data-field="description"]');
        var amountInput = row.querySelector('[data-field="amount"]');
        var linkInput = row.querySelector('[data-field="link"]');

        var description = descInput ? descInput.value.trim() : '';
        var amount = amountInput ? amountInput.value : '0';
        var link = linkInput ? linkInput.value.trim() : '';

        if (!description) {
            window.GenericModal.alert(window.SHOPLIST_CONFIG.i18n.descriptionRequired);
            return;
        }

        // Get realized state from toggle
        var realized = false;
        if (isNew) {
            var toggleNew = row.querySelector('.realized-toggle-new');
            realized = toggleNew ? toggleNew.classList.contains('bg-green-500') : false;
        } else {
            realized = row.getAttribute('data-realized') === 'true';
        }

        var data = {
            shop_list_id: window.SHOPLIST_CONFIG.shopListId,
            item_id: itemId,
            description: description,
            amount: amount,
            link: link,
            realized: realized
        };

        fetch(window.SHOPLIST_CONFIG.urls.saveItem, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': CSRF,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify(data)
        })
        .then(function(response) { return response.json(); })
        .then(function(data) {
            if (data.status === 'success') {
                if (isNew) {
                    replaceNewRowWithSaved(row, data);
                } else {
                    updateRowDisplay(row, data);
                }
                updateTotals();
            } else {
                window.GenericModal.alert(data.error || window.SHOPLIST_CONFIG.i18n.networkError);
            }
        })
        .catch(function() {
            window.GenericModal.alert(window.SHOPLIST_CONFIG.i18n.networkError);
        });
    }

    function replaceNewRowWithSaved(templateRow, data) {
        var newRow = templateRow.cloneNode(true);
        newRow.id = 'item-' + data.item_id;
        newRow.setAttribute('data-item-id', data.item_id);
        newRow.setAttribute('data-mode', 'display');
        newRow.setAttribute('data-amount', data.amount);
        newRow.setAttribute('data-realized', data.realized ? 'true' : 'false');
        newRow.setAttribute('draggable', 'true');

        // Set realized class
        newRow.classList.remove('row-realized', 'row-not-realized');
        newRow.classList.add(data.realized ? 'row-realized' : 'row-not-realized');

        // Update description
        newRow.querySelector('.cell-description-edit').classList.add('hidden');
        var descDisplay = newRow.querySelector('.cell-description-display');
        descDisplay.classList.remove('hidden');
        descDisplay.textContent = data.description;

        // Update link
        newRow.querySelector('.cell-link-edit').classList.add('hidden');
        var linkDisplay = newRow.querySelector('.cell-link-display');
        linkDisplay.classList.remove('hidden');
        if (data.link) {
            linkDisplay.innerHTML = '<a href="' + escapeHtml(data.link) + '" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline">' + escapeHtml(data.link_domain) + '</a>';
        } else {
            linkDisplay.innerHTML = '<span class="text-gray-400 dark:text-gray-500">-</span>';
        }

        // Update realized toggle - replace new-style toggle with full toggle button
        var realizedCell = newRow.querySelector('.mobile-hide-column');
        // Find the cell that contains realized-toggle-new
        var realizedCells = newRow.querySelectorAll('td');
        for (var rc = 0; rc < realizedCells.length; rc++) {
            if (realizedCells[rc].querySelector('.realized-toggle-new')) {
                realizedCell = realizedCells[rc];
                break;
            }
        }
        if (realizedCell) {
            var bgClass = data.realized ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600';
            var translateClass = data.realized ? ' translate-x-4' : '';
            realizedCell.innerHTML =
                '<div class="flex items-center justify-center w-full">' +
                '<button type="button" data-toggle="realized" data-item-id="item-' + data.item_id + '" data-current-state="' + (data.realized ? 'true' : 'false') + '" ' +
                'class="realized-toggle relative inline-block w-10 h-6 transition duration-200 ease-in-out rounded-full cursor-pointer ' + bgClass + '">' +
                '<span class="absolute left-1 top-1 inline-block w-4 h-4 transition-transform duration-200 ease-in-out transform bg-white rounded-full' + translateClass + '"></span>' +
                '</button>' +
                '</div>';
        }

        // Update amount
        newRow.querySelector('.cell-budget-edit').classList.add('hidden');
        var budgetDisplay = newRow.querySelector('.cell-budget-display');
        budgetDisplay.classList.remove('hidden');
        budgetDisplay.childNodes.forEach(function(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                node.textContent = '';
            }
        });
        var amountText = document.createTextNode(
            window.SHOPLIST_CONFIG.currencySymbol + ' ' + formatAmount(data.amount)
        );
        budgetDisplay.insertBefore(amountText, budgetDisplay.firstChild);

        // Update action button data attributes
        newRow.querySelectorAll('[data-row-id="new-item-template"]').forEach(function(btn) {
            btn.setAttribute('data-row-id', 'item-' + data.item_id);
        });
        newRow.querySelectorAll('[data-item-id="new-item-template"]').forEach(function(btn) {
            btn.setAttribute('data-item-id', 'item-' + data.item_id);
        });

        // Populate actions-display with proper edit/delete buttons
        var actionsDisplay = newRow.querySelector('.actions-display');
        if (actionsDisplay) {
            actionsDisplay.classList.remove('hidden');
            actionsDisplay.innerHTML =
                '<button type="button" data-action="edit" data-row-id="item-' + data.item_id + '" class="p-1 text-slate-500 hover:text-primary"><span class="material-symbols-outlined text-lg">edit</span></button>' +
                '<button type="button" data-action="delete" data-row-id="item-' + data.item_id + '" class="p-1 text-slate-500 hover:text-red-500"><span class="material-symbols-outlined text-lg">delete</span></button>';
        }
        var actionsEdit = newRow.querySelector('.actions-edit');
        if (actionsEdit) actionsEdit.classList.add('hidden');

        // Add drag handle span
        var dragCell = newRow.querySelector('.drag-handle-cell');
        if (dragCell) {
            // Keep the save icon button (hidden in display mode)
            var saveIconBtn = dragCell.querySelector('.edit-save-icon');
            if (saveIconBtn) saveIconBtn.style.display = 'none';
            // Add drag handle span if missing
            if (!dragCell.querySelector('.drag-handle')) {
                var handleSpan = document.createElement('span');
                handleSpan.className = 'material-symbols-outlined text-gray-400 dark:text-gray-500 drag-handle cursor-grab active:cursor-grabbing';
                handleSpan.textContent = 'drag_indicator';
                dragCell.appendChild(handleSpan);
            } else {
                var dragHandle = dragCell.querySelector('.drag-handle');
                dragHandle.style.display = '';
            }
        }

        // Add mobile action buttons in amount cell
        var budgetCell = newRow.querySelector('.cell-budget-display');
        if (budgetCell && !budgetCell.querySelector('.mobile-actions-btns')) {
            var mobileActions = document.createElement('div');
            mobileActions.className = 'mobile-actions-btns';
            mobileActions.innerHTML =
                '<button type="button" data-action="edit" data-row-id="item-' + data.item_id + '" class="mobile-action-btn edit-btn">' +
                '<span class="material-symbols-outlined">edit</span></button>' +
                '<button type="button" data-action="delete" data-row-id="item-' + data.item_id + '" class="mobile-action-btn delete-btn">' +
                '<span class="material-symbols-outlined">delete</span></button>';
            budgetCell.appendChild(mobileActions);
        }

        // Add swipeable-row class
        newRow.classList.add('swipeable-row');

        // Insert before template
        templateRow.parentNode.insertBefore(newRow, templateRow);

        // Reset template
        templateRow.classList.add('hidden');
        var templateDesc = templateRow.querySelector('[data-field="description"]');
        if (templateDesc) templateDesc.value = '';
        var templateLink = templateRow.querySelector('[data-field="link"]');
        if (templateLink) templateLink.value = '';
        var templateAmount = templateRow.querySelector('[data-field="amount"]');
        if (templateAmount) templateAmount.value = '0' + window.SHOPLIST_CONFIG.decimalSeparator + '00';

        // Reset realized toggle on template
        var templateToggle = templateRow.querySelector('.realized-toggle-new');
        if (templateToggle) {
            templateToggle.classList.remove('bg-green-500');
            templateToggle.classList.add('bg-gray-300', 'dark:bg-gray-600');
            var templateCircle = templateToggle.querySelector('span');
            if (templateCircle) templateCircle.classList.remove('translate-x-4');
        }

        // Remove empty state row if present
        var emptyRow = document.getElementById('empty-state-row');
        if (emptyRow) emptyRow.remove();

        // Re-initialize mobile swipe for the new row
        initializeMobileSwipeForRow(newRow);
    }

    function updateRowDisplay(row, data) {
        row.setAttribute('data-mode', 'display');
        row.setAttribute('data-amount', data.amount);
        row.setAttribute('data-realized', data.realized ? 'true' : 'false');
        row.setAttribute('draggable', 'true');

        // Update realized class
        row.classList.remove('row-realized', 'row-not-realized');
        row.classList.add(data.realized ? 'row-realized' : 'row-not-realized');

        // Description
        var descDisplay = row.querySelector('.cell-description-display');
        descDisplay.textContent = data.description;
        descDisplay.classList.remove('hidden');
        row.querySelector('.cell-description-edit').classList.add('hidden');

        // Link
        var linkDisplay = row.querySelector('.cell-link-display');
        linkDisplay.classList.remove('hidden');
        row.querySelector('.cell-link-edit').classList.add('hidden');
        if (data.link) {
            linkDisplay.innerHTML = '<a href="' + escapeHtml(data.link) + '" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline">' + escapeHtml(data.link_domain) + '</a>';
        } else {
            linkDisplay.innerHTML = '<span class="text-gray-400 dark:text-gray-500">-</span>';
        }

        // Amount
        row.querySelector('.cell-budget-display').classList.remove('hidden');
        row.querySelector('.cell-budget-edit').classList.add('hidden');
        var budgetDisplay = row.querySelector('.cell-budget-display');
        budgetDisplay.childNodes.forEach(function(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                node.textContent = '';
            }
        });
        var amountText = document.createTextNode(
            window.SHOPLIST_CONFIG.currencySymbol + ' ' + formatAmount(data.amount)
        );
        budgetDisplay.insertBefore(amountText, budgetDisplay.firstChild);

        // Update realized toggle visual
        var toggleBtn = row.querySelector('.realized-toggle');
        if (toggleBtn) {
            var toggleCircle = toggleBtn.querySelector('span');
            if (data.realized) {
                toggleBtn.classList.remove('bg-gray-300', 'dark:bg-gray-600');
                toggleBtn.classList.add('bg-green-500');
                if (toggleCircle) toggleCircle.classList.add('translate-x-4');
            } else {
                toggleBtn.classList.remove('bg-green-500');
                toggleBtn.classList.add('bg-gray-300', 'dark:bg-gray-600');
                if (toggleCircle) toggleCircle.classList.remove('translate-x-4');
            }
            toggleBtn.setAttribute('data-current-state', data.realized ? 'true' : 'false');
        }

        // Actions
        row.querySelector('.actions-display').classList.remove('hidden');
        row.querySelector('.actions-edit').classList.add('hidden');

        var dragHandle = row.querySelector('.drag-handle');
        var saveIcon = row.querySelector('.edit-save-icon');
        if (dragHandle) dragHandle.style.display = '';
        if (saveIcon) saveIcon.style.display = 'none';
    }

    // --- Cancel Edit ---
    function cancelEdit(rowId) {
        var row = document.getElementById(rowId);
        if (!row) return;

        row.setAttribute('data-mode', 'display');
        row.setAttribute('draggable', 'true');

        row.querySelectorAll('.cell-description-display, .cell-link-display, .cell-budget-display').forEach(function(el) {
            el.classList.remove('hidden');
        });
        row.querySelectorAll('.cell-description-edit, .cell-link-edit, .cell-budget-edit').forEach(function(el) {
            el.classList.add('hidden');
        });
        row.querySelector('.actions-display').classList.remove('hidden');
        row.querySelector('.actions-edit').classList.add('hidden');

        var dragHandle = row.querySelector('.drag-handle');
        var saveIcon = row.querySelector('.edit-save-icon');
        if (dragHandle) dragHandle.style.display = '';
        if (saveIcon) saveIcon.style.display = 'none';

        // Reset input values to original
        var origDesc = row.querySelector('.cell-description-display').textContent;
        var descInput = row.querySelector('[data-field="description"]');
        if (descInput) descInput.value = origDesc;
    }

    // --- Cancel New Row ---
    function cancelNewRow(rowId) {
        var template = document.getElementById('new-item-template');
        if (template) {
            template.classList.add('hidden');
        }
    }

    // --- Delete Row ---
    function deleteRow(rowId) {
        window.GenericModal.confirm(window.SHOPLIST_CONFIG.i18n.confirmDeleteItem).then(function(confirmed) {
            if (!confirmed) return;

            var row = document.getElementById(rowId);
            if (!row) return;

            var itemId = row.getAttribute('data-item-id');
            if (!itemId || itemId === 'NEW') {
                row.remove();
                return;
            }

            fetch(window.SHOPLIST_CONFIG.urls.deleteItem, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': CSRF,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({ item_id: itemId })
            })
            .then(function(response) { return response.json(); })
            .then(function(data) {
                if (data.status === 'success') {
                    row.remove();
                    updateTotals();
                } else {
                    window.GenericModal.alert(data.error || window.SHOPLIST_CONFIG.i18n.networkError);
                }
            })
            .catch(function() {
                window.GenericModal.alert(window.SHOPLIST_CONFIG.i18n.networkError);
            });
        });
    }

    // --- Add New Row ---
    function addNewRow() {
        var template = document.getElementById('new-item-template');
        if (!template) return;
        template.classList.remove('hidden');
        template.setAttribute('data-mode', 'edit');

        // Focus description input
        var descInput = template.querySelector('[data-field="description"]');
        if (descInput) descInput.focus();

        // Scroll into view
        template.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // --- Update Totals ---
    function updateTotals() {
        var total = 0;
        var rows = document.querySelectorAll('#list-items-body tr[data-item-id]:not(#new-item-template):not(#empty-state-row)');
        rows.forEach(function(row) {
            var amount = parseFloat(row.getAttribute('data-amount')) || 0;
            total += amount;
        });

        var formattedTotal = window.SHOPLIST_CONFIG.currencySymbol + ' ' + formatAmount(total.toFixed(2));

        var desktopTotal = document.getElementById('total-amount-desktop');
        if (desktopTotal) desktopTotal.textContent = formattedTotal;

        var mobileTotal = document.getElementById('total-amount-mobile');
        if (mobileTotal) mobileTotal.textContent = formattedTotal;

        var desktopExpense = document.getElementById('total-expenses-desktop');
        if (desktopExpense) desktopExpense.textContent = formattedTotal;

        var mobileExpense = document.getElementById('total-expenses-mobile');
        if (mobileExpense) mobileExpense.textContent = formattedTotal;
    }

    // --- Drag and Drop ---
    function initializeDragAndDrop() {
        var tbody = document.getElementById('list-items-body');
        if (!tbody) return;

        var draggedRow = null;

        tbody.addEventListener('dragstart', function(e) {
            var row = e.target.closest('.draggable-row');
            if (!row || row.getAttribute('data-mode') === 'edit') {
                e.preventDefault();
                return;
            }
            draggedRow = row;
            row.classList.add('opacity-50');
            e.dataTransfer.effectAllowed = 'move';
        });

        tbody.addEventListener('dragend', function(e) {
            if (draggedRow) {
                draggedRow.classList.remove('opacity-50');
                draggedRow = null;
            }
        });

        tbody.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            var target = e.target.closest('.draggable-row');
            if (target && target !== draggedRow) {
                var rect = target.getBoundingClientRect();
                var midY = rect.top + rect.height / 2;
                if (e.clientY < midY) {
                    target.parentNode.insertBefore(draggedRow, target);
                } else {
                    target.parentNode.insertBefore(draggedRow, target.nextSibling);
                }
            }
        });

        tbody.addEventListener('drop', function(e) {
            e.preventDefault();
            saveReorder();
        });
    }

    function saveReorder() {
        var items = [];
        var rows = document.querySelectorAll('#list-items-body tr[data-item-id]:not(#new-item-template):not(#empty-state-row)');
        rows.forEach(function(row, index) {
            var itemId = row.getAttribute('data-item-id');
            if (itemId && itemId !== 'NEW') {
                items.push({ id: parseInt(itemId), order: index + 1 });
            }
        });

        if (!items.length) return;

        fetch(window.SHOPLIST_CONFIG.urls.reorderItems, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': CSRF,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({ items: items })
        })
        .then(function(response) { return response.json(); })
        .catch(function() {
            console.error('Error saving order');
        });
    }

    // --- Mobile Swipe ---
    var currentRevealedRow = null;

    function initializeMobileSwipe() {
        var rows = document.querySelectorAll('#list-items-body .swipeable-row');
        rows.forEach(function(row) {
            initializeMobileSwipeForRow(row);
        });

        document.addEventListener('touchstart', function(e) {
            if (currentRevealedRow && !currentRevealedRow.contains(e.target)) {
                currentRevealedRow.classList.remove('actions-revealed');
                currentRevealedRow.style.transform = '';
                currentRevealedRow = null;
            }
        }, { passive: true });
    }

    function initializeMobileSwipeForRow(row) {
        var startX = 0;
        var currentX = 0;
        var isDragging = false;

        row.addEventListener('touchstart', function(e) {
            if (row.getAttribute('data-mode') === 'edit') return;
            startX = e.touches[0].clientX;
            isDragging = true;
            if (currentRevealedRow && currentRevealedRow !== row) {
                currentRevealedRow.classList.remove('actions-revealed');
                currentRevealedRow.style.transform = '';
                currentRevealedRow = null;
            }
        }, { passive: true });

        row.addEventListener('touchmove', function(e) {
            if (!isDragging) return;
            currentX = e.touches[0].clientX;
            var diff = currentX - startX;
            if (diff < 0) {
                var translateX = Math.max(diff, -120);
                row.style.transform = 'translateX(' + translateX + 'px)';
            }
        }, { passive: true });

        row.addEventListener('touchend', function() {
            if (!isDragging) return;
            isDragging = false;
            var diff = currentX - startX;
            if (diff < -60) {
                row.classList.add('actions-revealed');
                row.style.transform = 'translateX(-120px)';
                currentRevealedRow = row;
            } else {
                row.classList.remove('actions-revealed');
                row.style.transform = '';
                if (currentRevealedRow === row) currentRevealedRow = null;
            }
            startX = 0;
            currentX = 0;
        });
    }

    // --- Clone and Delete List buttons ---
    var cloneBtn = document.querySelector('[data-action="clone-shop-list"]');
    if (cloneBtn) {
        cloneBtn.addEventListener('click', function() {
            var listId = this.dataset.listId;
            fetch(window.SHOPLIST_CONFIG.urls.cloneList, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': CSRF,
                    'X-Requested-With': 'XMLHttpRequest'
                }
            })
            .then(function(r) { 
                if (!r.ok) {
                    return r.text().then(function(text) { throw new Error(text); });
                }
                return r.json(); 
            })
            .then(function(data) {
                if (data.status === 'success') {
                    window.location.href = data.redirect_url;
                } else {
                    window.GenericModal.alert(data.error || window.SHOPLIST_CONFIG.i18n.networkError);
                }
            })
            .catch(function(err) {
                window.GenericModal.alert(err.message || window.SHOPLIST_CONFIG.i18n.networkError);
            });
        });
    }

    var deleteBtn = document.querySelector('[data-action="delete-shop-list"]');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', function() {
            var listId = this.dataset.listId;
            window.GenericModal.confirm(window.SHOPLIST_CONFIG.i18n.confirmDeleteList).then(function(confirmed) {
                if (!confirmed) return;

                fetch(window.SHOPLIST_CONFIG.urls.deleteList, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': CSRF,
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                })
                .then(function(r) {
                    if (!r.ok) {
                        return r.text().then(function(text) { throw new Error(text); });
                    }
                    return r.json();
                })
                .then(function(data) {
                    if (data.status === 'success') {
                        window.location.href = data.redirect_url || window.SHOPLIST_CONFIG.urls.shopLists;
                    } else {
                        window.GenericModal.alert(data.error || window.SHOPLIST_CONFIG.i18n.networkError);
                    }
                })
                .catch(function(err) {
                    window.GenericModal.alert(err.message || window.SHOPLIST_CONFIG.i18n.networkError);
                });
            });
        });
    }

    // --- Dirty state tracking ---
    var isDirty = false;
    var initialFormData = {};

    function getInputKey(input) {
        if (input.id) return input.id;
        if (input.name) {
            return input.type === 'checkbox' ? input.name + '|' + input.value : input.name;
        }
        return null;
    }

    function captureInitialFormState() {
        var form = document.getElementById('shop-list-form');
        if (!form) return;
        var inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), select, textarea');
        inputs.forEach(function(input) {
            var key = getInputKey(input);
            if (!key) return;
            if (input.type === 'checkbox') {
                initialFormData[key] = input.checked;
            } else {
                initialFormData[key] = input.value;
            }
        });
    }

    function checkFormDirty() {
        var form = document.getElementById('shop-list-form');
        if (!form) return false;
        var inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), select, textarea');
        var dirty = false;
        inputs.forEach(function(input) {
            var key = getInputKey(input);
            if (!key || !(key in initialFormData)) return;
            if (input.type === 'checkbox') {
                if (input.checked !== initialFormData[key]) dirty = true;
            } else {
                if (input.value !== initialFormData[key]) dirty = true;
            }
        });
        return dirty;
    }

    captureInitialFormState();

    // --- Back button ---
    function navigateToLists() {
        if (window.SHOPLIST_CONFIG.isJustCloned && window.SHOPLIST_CONFIG.shopListId !== 'NEW') {
            fetch(window.SHOPLIST_CONFIG.urls.deleteList, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': CSRF,
                    'X-Requested-With': 'XMLHttpRequest'
                }
            }).catch(function() {}).finally(function() {
                window.location.href = window.SHOPLIST_CONFIG.urls.shopLists;
            });
        } else {
            window.location.href = window.SHOPLIST_CONFIG.urls.shopLists;
        }
    }

    var backBtn = document.querySelector('[data-action="back-to-lists"]');
    if (backBtn) {
        backBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();

            var hasUnsaved = checkFormDirty() || window.SHOPLIST_CONFIG.isJustCloned;
            if (hasUnsaved) {
                window.GenericModal.confirm(
                    window.SHOPLIST_CONFIG.i18n.unsavedChanges,
                    window.SHOPLIST_CONFIG.i18n.unsavedChangesTitle
                ).then(function(confirmed) {
                    if (confirmed) navigateToLists();
                });
            } else {
                navigateToLists();
            }
        });
    }

    // --- Utility functions ---
    function formatAmount(value) {
        var num = parseFloat(value);
        if (isNaN(num)) num = 0;
        var fixed = num.toFixed(2);
        var parts = fixed.split('.');
        var intPart = parts[0];
        var decPart = parts[1];
        var formatted = '';
        var count = 0;
        for (var i = intPart.length - 1; i >= 0; i--) {
            if (count > 0 && count % 3 === 0) {
                formatted = window.SHOPLIST_CONFIG.thousandSeparator + formatted;
            }
            formatted = intPart[i] + formatted;
            count++;
        }
        return formatted + window.SHOPLIST_CONFIG.decimalSeparator + decPart;
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }
});
