// finances/static/finances/js/notifications.js
// Version: 20260216-002 - Fixed event listener timing, added comprehensive debugging

(function() {
    'use strict';

    // State
    let isDropdownOpen = false;
    let pollTimer = null;  // For backward compatibility with stopPolling()

    // Elements
    const notificationBell = document.getElementById('notification-bell');
    const notificationDropdown = document.getElementById('notification-dropdown');
    const notificationBadge = document.getElementById('notification-badge');
    const notificationList = document.getElementById('notification-list');
    const acknowledgeAllBtn = document.getElementById('acknowledge-all-btn');

    console.log('[NOTIF JS] ========================================');
    console.log('[NOTIF JS] Notification system initializing...');
    console.log('[NOTIF JS] Elements found:', {
        bell: !!notificationBell,
        dropdown: !!notificationDropdown,
        badge: !!notificationBadge,
        list: !!notificationList,
        ackAll: !!acknowledgeAllBtn
    });

    // Utility: Get CSRF token from cookies
    // getCookie - using utils.js (window.getCookie)

    const csrftoken = window.getCookie('csrftoken');
    console.log('[NOTIF JS] CSRF token:', csrftoken ? 'Found' : 'NOT FOUND');

    // Get translation strings from base-config
    function getTranslation(key) {
        const baseConfig = document.getElementById('base-config');
        if (!baseConfig) return key;
        return baseConfig.getAttribute(`data-i18n-${key}`) || key;
    }

    // Toggle dropdown
    function toggleDropdown(e) {
        e.preventDefault();
        e.stopPropagation();

        console.log('[NOTIF JS] Toggle dropdown clicked');

        if (isDropdownOpen) {
            closeDropdown();
        } else {
            openDropdown();
        }
    }

    function openDropdown() {
        console.log('[NOTIF JS] Opening dropdown...');
        loadNotifications();
        notificationDropdown.classList.remove('hidden');
        isDropdownOpen = true;
    }

    function closeDropdown() {
        console.log('[NOTIF JS] Closing dropdown...');
        notificationDropdown.classList.add('hidden');
        isDropdownOpen = false;
    }

    // Close dropdown when clicking outside
    function handleClickOutside(e) {
        if (isDropdownOpen &&
            !notificationDropdown.contains(e.target) &&
            !notificationBell.contains(e.target)) {
            closeDropdown();
        }
    }

    // Load notifications from API
    function loadNotifications() {
        return fetch('/api/notifications/')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    renderNotifications(data.notifications);
                    updateBadge(data.count);
                } else {
                    console.error('[NOTIF JS] API returned success=false:', data.error);
                    notificationList.innerHTML = '<div class="px-4 py-3 text-sm text-red-600 dark:text-red-400">Error: ' + data.error + '</div>';
                }
            })
            .catch(error => {
                console.error('[NOTIF JS] Error loading notifications:', error);
                notificationList.innerHTML = '<div class="px-4 py-3 text-sm text-red-600 dark:text-red-400">Error loading notifications: ' + error.message + '</div>';
            });
    }

    // Render notifications list
    function renderNotifications(notifications) {
        if (notifications.length === 0) {
            notificationList.innerHTML = '<div class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">No notifications</div>';
            return;
        }

        let html = '';
        notifications.forEach(notif => {
            const iconClass = getNotificationIcon(notif.type);
            const colorClass = getNotificationColor(notif.type);

            html += `
                <div class="notification-item relative border-b border-gray-100 dark:border-gray-700"
                     data-notification-id="${notif.id}"
                     data-target-url="${escapeHtml(notif.target_url)}">

                    <div class="notification-wrapper relative">
                        <!-- Notification content (clickable on mobile to navigate) -->
                        <div class="notification-content block px-4 py-3 cursor-pointer transition-backdrop-filter duration-200">
                            <div class="flex items-start">
                                <span class="material-symbols-outlined ${colorClass} mr-3 mt-0.5 flex-shrink-0">${iconClass}</span>
                                <div class="flex-1 min-w-0">
                                    <p class="text-sm text-gray-800 dark:text-gray-200">${escapeHtml(notif.message)}</p>
                                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${notif.created_at}</p>
                                </div>
                            </div>
                        </div>

                        <!-- Desktop hover actions (translucent background on top) -->
                        <div class="notification-actions hidden absolute inset-0 z-10 bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm items-center justify-center gap-3">
                            <button class="notification-acknowledge-pointer bg-primary hover:bg-primary/90 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg transition-all transform hover:scale-105"
                                    data-notification-id="${notif.id}">
                                ${getTranslation('notif-acknowledge')}
                            </button>
                            <button class="notification-view-pointer bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 text-sm font-medium px-4 py-2 rounded-lg shadow-lg transition-all transform hover:scale-105"
                                    data-target-url="${escapeHtml(notif.target_url)}">
                                ${getTranslation('notif-view-item')}
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });

        notificationList.innerHTML = html;

        // Add event handlers for desktop and mobile interactions
        attachNotificationHandlers();
    }

    // Attach all notification event handlers (CSP-safe event delegation)
    function attachNotificationHandlers() {
        const items = notificationList.querySelectorAll('.notification-item');

        items.forEach(item => {
            // Desktop hover handlers
            item.addEventListener('mouseenter', handleNotificationHover);
            item.addEventListener('mouseleave', handleNotificationLeave);

            // Click handlers for action buttons
            const acknowledgeBtn = item.querySelector('.notification-acknowledge-pointer');
            const viewBtn = item.querySelector('.notification-view-pointer');

            if (acknowledgeBtn) {
                acknowledgeBtn.addEventListener('click', handleAcknowledgeClick);
            }

            if (viewBtn) {
                viewBtn.addEventListener('click', handleViewClick);
            }

            // Mobile tap handler (for navigating to item)
            const content = item.querySelector('.notification-content');
            if (content) {
                content.addEventListener('click', handleContentClick);
            }

            // Mobile swipe handlers
            setupSwipeHandlers(item);
        });
    }

    // Desktop: Show actions on hover with translucent overlay
    function handleNotificationHover(event) {
        const actions = event.currentTarget.querySelector('.notification-actions');

        if (actions) {
            actions.classList.remove('hidden');
            actions.classList.add('flex');
        }
    }

    // Desktop: Hide actions when leaving
    function handleNotificationLeave(event) {
        const actions = event.currentTarget.querySelector('.notification-actions');

        if (actions) {
            actions.classList.add('hidden');
            actions.classList.remove('flex');
        }
    }

    // Handle acknowledge button click (desktop)
    function handleAcknowledgeClick(event) {
        event.preventDefault();
        event.stopPropagation();

        const notificationId = event.currentTarget.getAttribute('data-notification-id');
        acknowledgeNotificationOnly(notificationId);
    }

    // Handle view button click (desktop)
    function handleViewClick(event) {
        event.preventDefault();
        event.stopPropagation();

        const targetUrl = event.currentTarget.getAttribute('data-target-url');
        const item = event.currentTarget.closest('.notification-item');
        const notificationId = item.getAttribute('data-notification-id');

        acknowledgeAndNavigate(notificationId, targetUrl);
    }

    // Handle content click (mobile tap to navigate)
    function handleContentClick(event) {
        // Only navigate on mobile (touch devices)
        if (!isTouchDevice()) {
            return;
        }

        event.preventDefault();

        const item = event.currentTarget.closest('.notification-item');
        const notificationId = item.getAttribute('data-notification-id');
        const targetUrl = item.getAttribute('data-target-url');

        acknowledgeAndNavigate(notificationId, targetUrl);
    }

    // Setup mobile swipe handlers
    function setupSwipeHandlers(item) {
        if (!isTouchDevice()) {
            return;
        }

        let startX = 0;
        let startY = 0;
        let startTime = 0;

        item.addEventListener('touchstart', function(event) {
            const touch = event.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            startTime = Date.now();
        }, { passive: true });

        item.addEventListener('touchmove', function(event) {
            const touch = event.touches[0];
            const deltaX = touch.clientX - startX;
            const deltaY = touch.clientY - startY;

            // Only trigger if horizontal swipe (not vertical scroll)
            // Check if event is cancelable before preventing default
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
                if (event.cancelable) {
                    event.preventDefault();
                }

                // Visual feedback during swipe
                const opacity = Math.max(0.3, 1 - Math.abs(deltaX) / 200);
                item.style.opacity = opacity.toString();
            }
        }, { passive: false });

        item.addEventListener('touchend', function(event) {
            const touch = event.changedTouches[0];
            const deltaX = touch.clientX - startX;
            const deltaY = touch.clientY - startY;
            const deltaTime = Date.now() - startTime;

            // Reset opacity
            item.style.opacity = '';

            // Check if it was a valid horizontal swipe
            const minSwipeDistance = 50;
            const maxSwipeTime = 500;
            const maxVerticalDistance = 50;

            if (Math.abs(deltaX) > minSwipeDistance &&
                Math.abs(deltaY) < maxVerticalDistance &&
                deltaTime < maxSwipeTime) {

                // It's a valid swipe - acknowledge notification
                event.preventDefault();
                const notificationId = item.getAttribute('data-notification-id');
                acknowledgeNotificationOnly(notificationId);

                // Animate removal
                item.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
                item.style.transform = `translateX(${deltaX > 0 ? 100 : -100}%)`;
                item.style.opacity = '0';
            }
        }, { passive: false });
    }

    // Detect if device supports touch
    function isTouchDevice() {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    }

    // Acknowledge notification without navigation
    function acknowledgeNotificationOnly(notificationId) {
        const formData = new FormData();
        formData.append('notification_id', notificationId);

        fetch('/api/notifications/acknowledge/', {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrftoken
            },
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Remove notification from list with animation
                const notifElement = document.querySelector(`.notification-item[data-notification-id="${notificationId}"]`);
                if (notifElement) {
                    notifElement.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
                    notifElement.style.opacity = '0';
                    notifElement.style.transform = 'translateX(100%)';

                    setTimeout(() => {
                        notifElement.remove();

                        // Update badge
                        updateBadge(data.remaining_count);

                        // Check if list is now empty
                        const remainingItems = document.querySelectorAll('.notification-item');
                        if (remainingItems.length === 0) {
                            notificationList.innerHTML = '<div class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">No notifications</div>';
                        }
                    }, 300);
                }
            }
        })
        .catch(error => {
            console.error('[NOTIF JS] Error acknowledging notification:', error);
        });
    }

    // Get icon based on notification type
    function getNotificationIcon(type) {
        switch(type) {
            case 'OVERDUE':
                return 'schedule';
            case 'OVERBUDGET':
                return 'warning';
            case 'NEW_TRANSACTION':
                return 'receipt';
            default:
                return 'notifications';
        }
    }

    // Get color based on notification type
    function getNotificationColor(type) {
        switch(type) {
            case 'OVERDUE':
                return 'text-red-500';
            case 'OVERBUDGET':
                return 'text-orange-500';
            case 'NEW_TRANSACTION':
                return 'text-blue-500';
            default:
                return 'text-gray-500';
        }
    }

    // Update badge count
    function updateBadge(count) {
        if (count > 0) {
            notificationBadge.textContent = count > 99 ? '99+' : count;
            notificationBadge.classList.remove('hidden');
        } else {
            notificationBadge.classList.add('hidden');
        }
    }

    // Escape HTML to prevent XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Acknowledge notification and navigate
    function acknowledgeAndNavigate(notificationId, targetUrl) {
        const formData = new FormData();
        formData.append('notification_id', notificationId);

        fetch('/api/notifications/acknowledge/', {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrftoken
            },
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Remove notification from list
                const notifElement = document.querySelector(`.notification-item[data-notification-id="${notificationId}"]`);
                if (notifElement) {
                    notifElement.remove();
                }

                // Update badge
                updateBadge(data.remaining_count);

                // Check if list is now empty
                const remainingItems = document.querySelectorAll('.notification-item');
                if (remainingItems.length === 0) {
                    notificationList.innerHTML = '<div class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">No notifications</div>';
                }

                // Navigate to target URL
                window.location.href = targetUrl;
            }
        })
        .catch(error => {
            console.error('[NOTIF JS] Error acknowledging notification:', error);
            // Navigate anyway
            window.location.href = targetUrl;
        });
    }

    // Acknowledge all notifications
    function acknowledgeAllNotifications(e) {
        e.preventDefault();

        fetch('/api/notifications/acknowledge-all/', {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrftoken
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                updateBadge(0);
                notificationList.innerHTML = '<div class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">No notifications</div>';
            }
        })
        .catch(error => {
            console.error('[NOTIF JS] Error acknowledging all notifications:', error);
        });
    }

    // Start polling for new notifications (DEPRECATED - now using WebSocket)
    function startPolling() {
        // Polling is no longer used - WebSocket handles real-time notification updates
        // Badge is already rendered server-side via notifications_processor
        // No need for initial fetch - WebSocket will keep badge updated
        console.log('[NOTIF JS] Badge initialized with server-side value:', notificationBadge.textContent);
    }

    // Stop polling (for cleanup if needed)
    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    // Handle notification received via WebSocket
    function handleWebSocketNotification(event) {
        console.log('[NOTIF JS] ========================================');
        console.log('[NOTIF JS] handleWebSocketNotification called!', event);
        console.log('[NOTIF JS] Event detail:', event?.detail);
        console.log('[NOTIF JS] ========================================');

        // Extract notification type from WebSocket event
        // Event structure: { detail: { type: 'created'|'removed', data: {...} } }
        const eventType = event?.detail?.type;
        console.log('[NOTIF JS] Event type:', eventType);

        if (eventType === 'created') {
            // New notification - increment badge
            const currentCount = parseInt(notificationBadge.textContent) || 0;
            console.log('[NOTIF JS] Incrementing badge from', currentCount, 'to', currentCount + 1);
            updateBadge(currentCount + 1);
        } else if (eventType === 'removed') {
            // Notification removed - decrement badge
            const currentCount = parseInt(notificationBadge.textContent) || 0;
            console.log('[NOTIF JS] Decrementing badge from', currentCount, 'to', Math.max(0, currentCount - 1));
            updateBadge(Math.max(0, currentCount - 1)); // Don't go below 0
        } else {
            console.warn('[NOTIF JS] Unknown event type:', eventType);
        }

        // If dropdown is open, reload notifications list to show changes
        // Use a flag to prevent multiple concurrent requests
        if (isDropdownOpen && !window.isLoadingNotifications) {
            console.log('[NOTIF JS] Dropdown is open, reloading notifications list...');
            window.isLoadingNotifications = true;
            loadNotifications().finally(() => {
                window.isLoadingNotifications = false;
                console.log('[NOTIF JS] Notifications list reloaded');
            });
        } else {
            console.log('[NOTIF JS] Dropdown closed or already loading, skipping reload');
        }
        console.log('[NOTIF JS] ========================================');
    }

    // CRITICAL: Register event listener IMMEDIATELY (before DOMContentLoaded)
    // This ensures we catch ALL WebSocket events, including those that arrive
    // before the page is fully loaded or before init() runs
    console.log('[NOTIF JS] Registering realtime:notification event listener IMMEDIATELY');
    document.addEventListener('realtime:notification', handleWebSocketNotification, { passive: true });
    console.log('[NOTIF JS] Event listener registered successfully');

    // Initialize
    function init() {
        if (!notificationBell) {
            console.warn('[NOTIF JS] Notification bell element not found - aborting initialization');
            return;
        }

        console.log('[NOTIF JS] init() called - setting up UI handlers');

        // Event listeners
        notificationBell.addEventListener('click', toggleDropdown);
        document.addEventListener('click', handleClickOutside);

        if (acknowledgeAllBtn) {
            acknowledgeAllBtn.addEventListener('click', acknowledgeAllNotifications);
        }

        // Start polling (only does initial badge update now)
        startPolling();

        // Note: realtime:notification event listener is already registered above
        // We do NOT register it again here to avoid duplicate handlers

        // Expose functions for debugging
        window.stopNotificationPolling = stopPolling;
        window.forceNotificationLoad = loadNotifications;
        window.handleWebSocketNotification = handleWebSocketNotification;

        console.log('[NOTIF JS] Notification system initialized successfully (WebSocket mode)');
        console.log('[NOTIF JS] ========================================');
    }

    // Wait for DOM
    if (document.readyState === 'loading') {
        console.log('[NOTIF JS] DOM is loading, waiting for DOMContentLoaded');
        document.addEventListener('DOMContentLoaded', init);
    } else {
        console.log('[NOTIF JS] DOM already loaded, calling init() immediately');
        init();
    }
})();
