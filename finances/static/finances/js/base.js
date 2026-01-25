/**
 * Base Template JavaScript
 * External JavaScript file (CSP compliant - no inline scripts)
 * Handles: Dark mode toggle, DPI scaling, Period management, Admin warning, Modals, PWA, WebSocket init, UI Components
 */

// ===== 1. DARK MODE INITIALIZATION =====
// NOTE: Initial dark mode setup is now handled by dark_mode_init.js (loaded in <head>)
// This prevents FOUC (Flash of Unstyled Content) on page load
// The toggle functionality below only handles user interactions after page load

// ===== 2. DPI SCALING ADJUSTMENT (MUST RUN IMMEDIATELY) =====
(function () {
    'use strict';

    // Detect and adjust for Windows DPI scaling
    function adjustForDPIScaling() {
        const dpr = window.devicePixelRatio || 1;
        const screenWidth = window.screen.width * dpr;

        // If DPI scaling is detected (devicePixelRatio > 1) on a FullHD or smaller screen
        // Apply a slight zoom reduction to prevent UI elements from being cut off
        if (dpr >= 1.5 && screenWidth <= 1920) {
            // Calculate optimal zoom level
            const optimalZoom = Math.max(0.85, 1 / (dpr * 0.85));
            document.documentElement.style.zoom = optimalZoom;

            console.log('[DPI Adjust] Detected DPI scaling:', dpr, '| Applying zoom:', optimalZoom);
        }
    }

    // Run on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', adjustForDPIScaling);
    } else {
        adjustForDPIScaling();
    }

    // Re-adjust on window resize
    window.addEventListener('resize', function () {
        adjustForDPIScaling();
    });
})();

// ===== WAIT FOR DOM BEFORE CONTINUING =====
document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    // ===== 3. LOAD CONFIGURATION FROM DATA ATTRIBUTES =====
    initializeBaseConfig();

    // ===== 4. ADMIN WARNING MODAL =====
    initializeAdminWarning();

    // ===== 5. CREATE PERIOD MODAL =====
    initializeCreatePeriodModal();

    // ===== 6. DELETE PERIOD MODAL =====
    initializeDeletePeriodModal();

    // ===== 7. DARK MODE TOGGLE =====
    initializeDarkModeToggle();

    // ===== 8. PWA SERVICE WORKER & VERSION MANAGEMENT =====
    initializePWA();

    // ===== 9. WEBSOCKET INITIALIZATION (if authenticated) =====
    initializeWebSocket();

    // ===== 10. UI COMPONENTS (Sidebar, Period Dropdown) =====
    initializeUIComponents();

    // ===== 11. IMAGE ERROR HANDLING (CSP Compliant) =====
    initializeImageErrorHandling();
});

// ===== 3. CONFIGURATION INITIALIZATION =====
function initializeBaseConfig() {
    const config = document.getElementById('base-config');
    if (!config) {
        console.warn('[Base] Configuration element not found - some features may not work');
        return;
    }

    // Translation strings for base.html JavaScript
    window.BASE_I18N = {
        errorLoadingPeriodDetails: config.dataset.i18nErrorLoadingPeriodDetails,
        errorLoadingPeriod: config.dataset.i18nErrorLoadingPeriod,
        pwaNewVersionTitle: config.dataset.i18nPwaNewVersionTitle,
        pwaInstalled: config.dataset.i18nPwaInstalled,
        pwaAvailable: config.dataset.i18nPwaAvailable,
        pwaUpdateInstructions: config.dataset.i18nPwaUpdateInstructions,
        pwaClickToDismiss: config.dataset.i18nPwaClickToDismiss,
        pwaIosInstructions: config.dataset.i18nPwaIosInstructions,
        pwaIosStep1: config.dataset.i18nPwaIosStep1,
        pwaIosStep2: config.dataset.i18nPwaIosStep2,
        pwaIosStep3: config.dataset.i18nPwaIosStep3
    };

    // Modal translations
    window.MODAL_I18N = {
        notification: config.dataset.i18nModalNotification,
        warning: config.dataset.i18nModalWarning,
        error: config.dataset.i18nModalError,
        success: config.dataset.i18nModalSuccess,
        confirm: config.dataset.i18nModalConfirm,
        ok: config.dataset.i18nModalOk,
        cancel: config.dataset.i18nModalCancel,
        continue: config.dataset.i18nModalContinue,
        yes: config.dataset.i18nModalYes,
        no: config.dataset.i18nModalNo,
        close: config.dataset.i18nModalClose
    };

    // Period management translations
    window.PERIOD_I18N = {
        creating: config.dataset.i18nPeriodCreating,
        errorCreating: config.dataset.i18nPeriodErrorCreating,
        confirmDelete: config.dataset.i18nPeriodConfirmDelete,
        deleting: config.dataset.i18nPeriodDeleting,
        errorDeleting: config.dataset.i18nPeriodErrorDeleting
    };

    // PWA config
    window.SERVER_VERSION = config.dataset.serverVersion;
    window.DB_VERSION = config.dataset.dbVersion;

    // User config (for WebSocket)
    window.USER_ID = config.dataset.userId;
    window.IS_AUTHENTICATED = config.dataset.isAuthenticated === 'true';

    // Locale settings (for realtime_ui.js)
    window.decimalSeparator = config.dataset.decimalSeparator;
    window.thousandSeparator = config.dataset.thousandSeparator;
    window.currencySymbol = config.dataset.currencySymbol;

    console.log('[Base] Configuration loaded');
}

// ===== 4. ADMIN WARNING MODAL =====
function initializeAdminWarning() {
    const modal = document.getElementById('admin-warning-modal');
    const btn = document.getElementById('btn-dismiss-admin-warning');

    if (btn && modal) {
        console.log('[Admin Warning] Button and modal found, adding event listener');
        btn.addEventListener('click', function () {
            console.log('[Admin Warning] "I Agree" button clicked');
            fetch('/mark-admin-warning-seen/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                }
            })
                .then(response => response.json())
                .then(data => {
                    console.log('[Admin Warning] Server response:', data);
                    if (data.status === 'ok') {
                        console.log('[Admin Warning] Modal dismissed successfully');
                        modal.remove();
                    } else {
                        console.warn('[Admin Warning] Unexpected response, removing modal anyway');
                        modal.remove();
                    }
                })
                .catch(error => {
                    console.error('[Admin Warning] Error marking admin warning as seen:', error);
                    modal.remove(); // Remove anyway to not block UI
                });
        });
    } else if (modal && !btn) {
        // Modal exists but button is missing - this is an error in the template
        console.warn('[Admin Warning] Modal exists but dismiss button not found!');
    }
    // If neither exist, that's normal - user has already seen the warning or is not admin
}

// ===== 5. CREATE PERIOD MODAL FUNCTIONS =====
function initializeCreatePeriodModal() {
    const form = document.getElementById('createPeriodForm');
    if (!form) return;

    const startDateInput = document.getElementById('period_start_date');
    const endDateInput = document.getElementById('period_end_date');

    if (startDateInput && endDateInput) {
        startDateInput.addEventListener('change', validatePeriodOverlap);
        endDateInput.addEventListener('change', validatePeriodOverlap);
    }

    form.addEventListener('submit', handleCreatePeriodSubmit);
}

// Exposed globally for event_delegation.js
window.openCreatePeriodModal = function () {
    document.getElementById('createPeriodModal').classList.remove('hidden');
    // Reset form
    document.getElementById('createPeriodForm').reset();
    document.getElementById('overlapWarning').classList.add('hidden');
    document.getElementById('createPeriodBtn').disabled = false;
};

window.closeCreatePeriodModal = function () {
    document.getElementById('createPeriodModal').classList.add('hidden');
};

function validatePeriodOverlap() {
    const startDate = document.getElementById('period_start_date').value;
    const endDate = document.getElementById('period_end_date').value;
    const warningDiv = document.getElementById('overlapWarning');
    const createBtn = document.getElementById('createPeriodBtn');

    if (!startDate || !endDate) {
        warningDiv.classList.add('hidden');
        createBtn.disabled = false;
        return;
    }

    fetch('/api/period/validate-overlap/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify({
            start_date: startDate,
            end_date: endDate
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.has_overlap) {
                warningDiv.classList.remove('hidden');
                document.getElementById('overlapMessage').textContent = data.message;
                createBtn.disabled = true;
                createBtn.classList.add('bg-gray-400', 'cursor-not-allowed');
                createBtn.classList.remove('bg-green-600', 'hover:bg-green-700');
            } else {
                warningDiv.classList.add('hidden');
                createBtn.disabled = false;
                createBtn.classList.remove('bg-gray-400', 'cursor-not-allowed');
                createBtn.classList.add('bg-green-600', 'hover:bg-green-700');
            }
        })
        .catch(error => {
            console.error('Error validating period:', error);
        });
}

function handleCreatePeriodSubmit(e) {
    e.preventDefault();

    const startDate = document.getElementById('period_start_date').value;
    const endDate = document.getElementById('period_end_date').value;
    const createBtn = document.getElementById('createPeriodBtn');

    // Disable button during submission
    createBtn.disabled = true;
    createBtn.textContent = window.PERIOD_I18N.creating;

    fetch('/api/period/create/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify({
            start_date: startDate,
            end_date: endDate
        })
    })
        .then(response => response.json())
        .then(data => {
            console.log('[CreatePeriod] Response:', data);
            // Backend returns message field with success text, not success: true
            const isSuccess = data.message && data.message.includes('successfully');
            
            if (isSuccess || data.success) {
                // Close the creation modal
                window.closeCreatePeriodModal();
                
                // Show success message using GenericModal
                if (window.GenericModal) {
                    window.GenericModal.show({
                        title: window.MODAL_I18N.success || 'Success',
                        message: data.message || 'Period created successfully',
                        type: 'success',
                        buttons: [{
                            text: window.MODAL_I18N.ok || 'OK',
                            primary: true,
                            onClick: function() {
                                // Reload page to refresh period selector
                                window.location.reload();
                            }
                        }]
                    });
                } else {
                    alert(data.message || 'Period created successfully');
                    window.location.reload();
                }
            } else {
                const errorMsg = data.error || data.message || 'Unknown error';
                console.error('[CreatePeriod] Error response:', data);
                alert(window.PERIOD_I18N.errorCreating + ': ' + errorMsg);
                createBtn.disabled = false;
                createBtn.textContent = window.MODAL_I18N.continue;
            }
        })
        .catch(error => {
            console.error('Error creating period:', error);
            alert(window.PERIOD_I18N.errorCreating + ': ' + (error.message || 'Network error'));
            createBtn.disabled = false;
            createBtn.textContent = window.MODAL_I18N.continue;
        });
}

// ===== 6. DELETE PERIOD MODAL FUNCTIONS =====
function initializeDeletePeriodModal() {
    // Modal functions are called by event_delegation.js
    // Nothing to initialize here
}

// Exposed globally for event_delegation.js
window.openDeletePeriodModal = function () {
    const modal = document.getElementById('deletePeriodModal');
    const loadingDiv = document.getElementById('deletePeriodLoading');
    const detailsDiv = document.getElementById('deletePeriodDetails');
    
    // Skip loading, show details directly (period details fetch not implemented in backend)
    if (loadingDiv) loadingDiv.classList.add('hidden');
    if (detailsDiv) detailsDiv.classList.remove('hidden');
    
    // Get current period from URL or page
    const urlParams = new URLSearchParams(window.location.search);
    const currentPeriod = urlParams.get('period') || 'current';
    
    // Set basic info (actual deletion will be handled by backend)
    const periodLabel = document.getElementById('deletePeriodLabel');
    if (periodLabel) {
        periodLabel.textContent = currentPeriod;
    }
    
    modal.classList.remove('hidden');
};

window.closeDeletePeriodModal = function () {
    const modal = document.getElementById('deletePeriodModal');
    modal.classList.add('hidden');
    delete modal.dataset.periodId;
};

window.confirmDeletePeriod = function () {
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    const deleteButtonText = document.getElementById('deleteButtonText');
    
    if (!confirmBtn) {
        console.error('[DeletePeriod] Confirm button not found');
        return;
    }

    // Get current period start date from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const periodStart = urlParams.get('period');
    
    if (!periodStart) {
        console.error('[DeletePeriod] No period parameter in URL - cannot determine which period to delete');
        alert(window.PERIOD_I18N.errorDeleting + ': ' + 'No period selected. Please select a period from the dropdown first.');
        confirmBtn.disabled = false;
        return;
    }

    console.log('[DeletePeriod] Deleting period:', periodStart);

    // Disable button and show loading state
    const originalText = deleteButtonText ? deleteButtonText.textContent : 'Delete Period';
    confirmBtn.disabled = true;
    confirmBtn.style.cursor = 'wait';
    if (deleteButtonText) {
        deleteButtonText.textContent = window.PERIOD_I18N.deleting || 'Deleting...';
    }

    fetch('/api/period/delete/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify({
            period_start: periodStart
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                // Redirect to home/dashboard
                window.location.href = data.redirect || '/';
            } else {
                alert(window.PERIOD_I18N.errorDeleting + ': ' + (data.error || 'Unknown error'));
                confirmBtn.disabled = false;
                if (deleteButtonText) {
                    deleteButtonText.textContent = originalText;
                }
                confirmBtn.style.cursor = 'pointer';
            }
        })
        .catch(error => {
            console.error('Error deleting period:', error);
            alert(window.PERIOD_I18N.errorDeleting + ': ' + (error.message || 'Network error'));
            confirmBtn.disabled = false;
            if (deleteButtonText) {
                deleteButtonText.textContent = originalText;
            }
            confirmBtn.style.cursor = 'pointer';
        });
};

// ===== 7. DARK MODE TOGGLE =====
function initializeDarkModeToggle() {
    const themeToggle = document.getElementById('theme-toggle');
    const htmlElement = document.documentElement;
    const iconDark = document.getElementById('icon-dark');
    const iconLight = document.getElementById('icon-light');

    function setIcons() {
        if (!iconDark || !iconLight) return;
        if (htmlElement.classList.contains('dark')) {
            iconDark.style.display = 'none';
            iconLight.style.display = 'inline-block';
        } else {
            iconDark.style.display = 'inline-block';
            iconLight.style.display = 'none';
        }
    }

    // Apply immediately
    setIcons();

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            htmlElement.classList.toggle('dark');
            const newTheme = htmlElement.classList.contains('dark') ? 'dark' : 'light';
            localStorage.setItem('theme', newTheme);
            setIcons();
        });
    }
}

// ===== 8. GENERIC MODAL MANAGER =====
// MOVED TO: generic_modal.js (loaded separately for better organization)
// GenericModal provides alert() and confirm() methods via Promise-based API

// ===== 9. PWA SERVICE WORKER & VERSION MANAGEMENT =====
function initializePWA() {
    const SERVER_VERSION = window.SERVER_VERSION || window.DB_VERSION;

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            // Check if running as installed PWA
            const isInstalled = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

            // Register service worker
            const swUrl = document.querySelector('meta[name="service-worker-url"]')?.content || '/service-worker.js';
            navigator.serviceWorker.register(swUrl)
                .then((registration) => {
                    console.log('[PWA] Service Worker registered successfully:', registration.scope);
                    console.log('[PWA] Server version: ' + SERVER_VERSION);

                    // Check for manifest version updates (for installed apps)
                    if (isInstalled) {
                        checkManifestVersion();
                    }

                    // Check for updates periodically
                    setInterval(() => {
                        registration.update();
                        if (isInstalled) {
                            checkManifestVersion();
                        }
                    }, 60000); // Check every minute
                })
                .catch((error) => {
                    console.error('[PWA] Service Worker registration failed:', error);
                });

            // Listen for service worker updates
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                console.log('[PWA] New service worker activated - reloading page');
                window.location.reload();
            });
        });
    }

    // Check manifest version and prompt for reinstall if needed
    function checkManifestVersion() {
        try {
            // Get cached installed version
            const installedVersion = localStorage.getItem('pwa_installed_version');

            if (!installedVersion) {
                // First time running, save current version
                localStorage.setItem('pwa_installed_version', SERVER_VERSION);
                console.log('[PWA] Saved installed version: ' + SERVER_VERSION);
                return;
            }

            // Compare versions
            if (installedVersion !== SERVER_VERSION) {
                console.log('[PWA] Version mismatch! Installed: ' + installedVersion + ', Server: ' + SERVER_VERSION);

                // Show update notification
                showUpdateNotification(installedVersion, SERVER_VERSION);
            }
        } catch (error) {
            console.error('[PWA] Error checking manifest version:', error);
        }
    }

    function showUpdateNotification(oldVersion, newVersion) {
        // Only show once per version
        const notificationShown = sessionStorage.getItem('update_notification_' + newVersion);
        if (notificationShown) {
            return;
        }

        // Mark as shown
        sessionStorage.setItem('update_notification_' + newVersion, 'true');

        // Use existing modal system if available
        if (typeof window.showModal === 'function') {
            const title = '🎉 New Version Available!';
            const content = `
                <div class="space-y-4">
                    <p class="text-gray-700 dark:text-gray-300">
                        SweetMoney has been updated from <strong>v${oldVersion}</strong> to <strong>v${newVersion}</strong>!
                    </p>
                    <p class="text-gray-700 dark:text-gray-300">
                        To see the latest features and improvements, please reinstall the app:
                    </p>
                    <ol class="list-decimal list-inside space-y-2 text-gray-700 dark:text-gray-300 text-sm">
                        <li>Uninstall the current app from your device</li>
                        <li>Visit SweetMoney in your browser</li>
                        <li>Click "Install App" to reinstall with the new version</li>
                    </ol>
                    <div class="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                        <p class="text-xs text-blue-700 dark:text-blue-400">
                            💡 Your data is safe and will remain intact after reinstalling.
                        </p>
                    </div>
                </div>
            `;
            window.showModal(title, content);
        } else {
            // Fallback to alert
            alert(window.BASE_I18N.pwaNewVersionTitle + '\n\n' +
                window.BASE_I18N.pwaInstalled + ' v' + oldVersion + '\n' +
                window.BASE_I18N.pwaAvailable + ' v' + newVersion + '\n\n' +
                window.BASE_I18N.pwaUpdateInstructions + '\n' +
                window.BASE_I18N.pwaClickToDismiss);
        }
    }
}

// ===== 10. WEBSOCKET INITIALIZATION =====
function initializeWebSocket() {
    if (!window.IS_AUTHENTICATED) {
        console.log('[WebSocket] User not authenticated, skipping initialization');
        return;
    }

    // CRITICAL: Do NOT initialize WebSocket on configuration pages
    const currentPath = window.location.pathname;
    const isConfigPage = currentPath.includes('/configurations') || currentPath.includes('/settings');

    if (isConfigPage) {
        console.log('[WebSocket] Skipping initialization on configuration page to avoid DB locks');
        return;
    }

    // Store current user ID for comparison in RealtimeUI
    // Ensure window.USER_ID is globally available and synced to body dataset
    if (typeof window.USER_ID === 'undefined') {
        const config = document.getElementById('base-config');
        window.USER_ID = config?.dataset?.userId || '';
    }
    document.body.dataset.userId = window.USER_ID || '';

    // Create or get WebSocket manager instance
    if (typeof WebSocketManager === 'undefined') {
        console.warn('[WebSocket] WebSocketManager not loaded');
        return;
    }

    // Ensure we only have ONE instance globally
    if (!window.wsManager) {
        console.log('[WebSocket] Creating new WebSocketManager instance');
        window.wsManager = new WebSocketManager();
    } else {
        console.log('[WebSocket] Using existing WebSocketManager instance');
    }

    // Connect if not already connected
    window.wsManager.connect();

    // Show connection status indicator (optional)
    window.wsManager.onConnectionStatus(function (status) {
        const indicator = document.getElementById('ws-status-indicator');
        if (indicator) {
            indicator.className = 'ws-' + status;
            indicator.title = 'WebSocket: ' + status;
        }
    });

    // Register message handlers for real-time updates
    // Note: wsManager.registerHandler only adds if not already present or replaces
    window.wsManager.registerHandler('transaction_created', function (data) {
        if (typeof window.RealtimeUI !== 'undefined') {
            window.RealtimeUI.handleTransactionCreated(data);
        }
    });

    window.wsManager.registerHandler('transaction_updated', function (data) {
        if (typeof window.RealtimeUI !== 'undefined') {
            window.RealtimeUI.handleTransactionUpdated(data);
        }
    });

    window.wsManager.registerHandler('transaction_deleted', function (data) {
        if (typeof window.RealtimeUI !== 'undefined') {
            window.RealtimeUI.handleTransactionDeleted(data);
        }
    });

    window.wsManager.registerHandler('flowgroup_updated', function (data) {
        if (typeof window.RealtimeUI !== 'undefined') {
            window.RealtimeUI.handleFlowGroupUpdated(data);
        }
    });

    window.wsManager.registerHandler('balance_updated', function (data) {
        if (typeof window.RealtimeUI !== 'undefined') {
            window.RealtimeUI.handleBalanceUpdated(data);
        }
    });

    window.wsManager.registerHandler('bank_balance_updated', function (data) {
        if (typeof window.RealtimeUI !== 'undefined') {
            window.RealtimeUI.handleBankBalanceUpdated(data);
        }
    });

    window.wsManager.registerHandler('bank_balance_deleted', function (data) {
        if (typeof window.RealtimeUI !== 'undefined') {
            window.RealtimeUI.handleBankBalanceDeleted(data);
        }
    });

    window.wsManager.registerHandler('reconciliation_mode_changed', function (data) {
        if (typeof window.RealtimeUI !== 'undefined') {
            window.RealtimeUI.handleReconciliationModeChanged(data);
        }
    });

    // Handle both 'notification' and 'notification_created' (backend uses both interchangeably)
    const notificationHandler = function (data) {
        if (typeof window.RealtimeUI !== 'undefined') {
            window.RealtimeUI.handleNotification(data);
        } else {
            // Fallback for pages without RealtimeUI
            document.dispatchEvent(new CustomEvent('realtime:notification', {
                detail: { data: data }
            }));
        }
    };

    window.wsManager.registerHandler('notification', notificationHandler);
    window.wsManager.registerHandler('notification_created', notificationHandler);

    console.log('[WebSocket] Initialization complete');
}

// ===== 11. UI COMPONENTS (Sidebar, Period Dropdown) - Phase 4 =====
function initializeUIComponents() {
    /**
     * UI Components Manager - Replaces Alpine.js
     * Handles sidebar toggle and period dropdown
     */
    class UIComponents {
        constructor() {
            this.sidebarOpen = false;
            this.periodDropdownOpen = false;
            this.init();
        }

        init() {
            // Sidebar toggle buttons
            document.querySelector('[data-action="open-sidebar"]')?.addEventListener('click', () => {
                this.openSidebar();
            });

            document.querySelector('[data-action="close-sidebar"]')?.addEventListener('click', () => {
                this.closeSidebar();
            });

            // Period dropdown
            const dropdownBtn = document.querySelector('[data-action="toggle-period-dropdown"]');
            if (dropdownBtn) {
                dropdownBtn.addEventListener('click', () => this.togglePeriodDropdown());

                // Click outside to close
                document.addEventListener('click', (e) => {
                    const container = e.target.closest('[data-dropdown-container="period"]');
                    if (!container && this.periodDropdownOpen) {
                        this.closePeriodDropdown();
                    }
                });
            }

            console.log('[UIComponents] Initialized (Phase 4)');
        }

        openSidebar() {
            this.sidebarOpen = true;
            const sidebar = document.getElementById('mobile-sidebar');
            if (sidebar) {
                sidebar.classList.remove('-translate-x-full');
                sidebar.classList.add('translate-x-0');
            }
        }

        closeSidebar() {
            this.sidebarOpen = false;
            const sidebar = document.getElementById('mobile-sidebar');
            if (sidebar) {
                sidebar.classList.remove('translate-x-0');
                sidebar.classList.add('-translate-x-full');
            }
        }

        togglePeriodDropdown() {
            this.periodDropdownOpen = !this.periodDropdownOpen;
            const dropdown = document.getElementById('period-dropdown-menu');
            if (dropdown) {
                dropdown.classList.toggle('hidden', !this.periodDropdownOpen);
            }
        }

        closePeriodDropdown() {
            this.periodDropdownOpen = false;
            const dropdown = document.getElementById('period-dropdown-menu');
            if (dropdown) {
                dropdown.classList.add('hidden');
            }
        }
    }

    // Initialize and expose globally
    window.uiComponents = new UIComponents();
}

// ===== 12. IMAGE ERROR HANDLING (CSP Compliant) =====
/**
 * Handles image load errors via event delegation
 * Replaces inline onerror= handlers for CSP compliance
 * Uses data-hide-on-error and data-logo-fallback attributes
 */
function initializeImageErrorHandling() {
    // Use capture phase to catch error events before they bubble
    document.addEventListener('error', function (event) {
        // Only handle image errors
        if (event.target.tagName !== 'IMG') return;

        const img = event.target;

        // Check if this image should be hidden on error
        if (img.hasAttribute('data-hide-on-error')) {
            img.style.display = 'none';
            console.log('[ImageError] Hidden image due to load error:', img.src);

            // Check if we should show a fallback element
            if (img.hasAttribute('data-show-fallback')) {
                const fallback = img.nextElementSibling;
                if (fallback && fallback.hasAttribute('data-logo-fallback')) {
                    // Determine display type based on element
                    const displayType = fallback.tagName === 'DIV' ? 'flex' : 'block';
                    fallback.style.display = displayType;
                    console.log('[ImageError] Showing fallback element');
                }
            }
        }
    }, true); // Use capture phase

    console.log('[ImageError] Handler initialized (CSP compliant)');
}

// ===== UTILITY FUNCTIONS =====
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

console.log('[Base.js] Loaded successfully');
