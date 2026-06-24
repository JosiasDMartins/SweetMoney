/**
 * ShopListDashboard.js - Dashboard page for Shopping Lists.
 * Handles clone, delete, and mobile swipe actions.
 */
(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', function() {
        const config = document.getElementById('shoplists-config');
        if (!config) return;

        const CSRF_TOKEN = config.dataset.csrfToken;
        const URL_SHOP_LISTS = config.dataset.urlShopLists;
        const I18N_CONFIRM_DELETE = config.dataset.i18nConfirmDelete;
        const I18N_CONFIRM_DELETE_TITLE = config.dataset.i18nConfirmDeleteTitle;
        const I18N_CLONE_SUCCESS = config.dataset.i18nCloneSuccess;
        const I18N_ERROR = config.dataset.i18nError;
        const I18N_NETWORK_ERROR = config.dataset.i18nNetworkError;

        // Clone list
        document.querySelectorAll('[data-action="clone-list"]').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                const listId = this.dataset.listId;
                cloneList(listId);
            });
        });

        // Delete list
        document.querySelectorAll('[data-action="delete-list"]').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                const listId = this.dataset.listId;
                deleteList(listId);
            });
        });

        function cloneList(listId) {
            fetch('/list/' + listId + '/clone/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': CSRF_TOKEN,
                    'X-Requested-With': 'XMLHttpRequest'
                }
            })
            .then(function(response) { return response.json(); })
            .then(function(data) {
                if (data.status === 'success') {
                    window.location.href = data.redirect_url;
                } else {
                    window.GenericModal.alert(data.error || I18N_ERROR);
                }
            })
            .catch(function() {
                window.GenericModal.alert(I18N_NETWORK_ERROR);
            });
        }

        function deleteList(listId) {
            window.GenericModal.confirm(I18N_CONFIRM_DELETE, I18N_CONFIRM_DELETE_TITLE).then(function(confirmed) {
                if (!confirmed) return;

                fetch('/list/' + listId + '/delete/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': CSRF_TOKEN,
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                })
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (data.status === 'success') {
                        document.querySelectorAll('[data-list-id="' + listId + '"]').forEach(function(el) {
                            el.remove();
                        });
                        if (!document.querySelector('[data-list-id]')) {
                            window.location.reload();
                        }
                    } else {
                        window.GenericModal.alert(data.error || I18N_ERROR);
                    }
                })
                .catch(function() {
                    window.GenericModal.alert(I18N_NETWORK_ERROR);
                });
            });
        }

        // Mobile swipe for list rows
        initMobileSwipe();
    });

    function initMobileSwipe() {
        const rows = document.querySelectorAll('.swipeable-list-row');
        if (!rows.length) return;

        let currentRevealedRow = null;

        rows.forEach(function(row) {
            const content = row.querySelector('.list-row-content');
            if (!content) return;

            let startX = 0;
            let currentX = 0;
            let isDragging = false;

            content.addEventListener('touchstart', function(e) {
                startX = e.touches[0].clientX;
                isDragging = true;
                if (currentRevealedRow && currentRevealedRow !== row) {
                    currentRevealedRow.classList.remove('actions-revealed');
                    currentRevealedRow.style.transform = '';
                    currentRevealedRow = null;
                }
            }, { passive: true });

            content.addEventListener('touchmove', function(e) {
                if (!isDragging) return;
                currentX = e.touches[0].clientX;
                const diff = currentX - startX;
                if (diff < 0) {
                    const translateX = Math.max(diff, -168);
                    row.style.transform = 'translateX(' + translateX + 'px)';
                }
            }, { passive: true });

            content.addEventListener('touchend', function() {
                if (!isDragging) return;
                isDragging = false;
                const diff = currentX - startX;
                if (diff < -80) {
                    row.classList.add('actions-revealed');
                    row.style.transform = 'translateX(-168px)';
                    currentRevealedRow = row;
                } else {
                    row.classList.remove('actions-revealed');
                    row.style.transform = '';
                    if (currentRevealedRow === row) currentRevealedRow = null;
                }
                startX = 0;
                currentX = 0;
            });
        });

        // Tap elsewhere to close
        document.addEventListener('touchstart', function(e) {
            if (currentRevealedRow && !currentRevealedRow.contains(e.target)) {
                currentRevealedRow.classList.remove('actions-revealed');
                currentRevealedRow.style.transform = '';
                currentRevealedRow = null;
            }
        }, { passive: true });
    }
})();
