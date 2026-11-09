// finances/static/finances/js/update_manager.js
// Version: 20261014-001 - Local updates handled by post-update screen; admin password for OTA

class UpdateManager {
    constructor() {
        this.updateData = null;
        this.logsContent = '';
        this.i18nConfig = null;
        this.init();
    }

    init() {
        console.log('[UpdateManager] Initializing...');
        // Load i18n config from data attributes
        this.i18nConfig = document.getElementById('update-i18n-config');
        this.checkForUpdates();
        this.setupEventListeners();

        // Expose for testing
        window.forceUpdateCheck = () => this.manualCheckUpdates();
        window.updateManager = this;
        console.log('[UpdateManager] Ready');
    }

    // Helper to get translated strings from data attributes
    t(key) {
        if (!this.i18nConfig) return '';
        const dataKey = 'i18n-' + key.replace(/_/g, '-');
        return this.i18nConfig.dataset[key.replace(/-/g, '')] || this.i18nConfig.dataset[dataKey.replace(/-/g, '')] || '';
    }
    
    setupEventListeners() {
        console.log('[UpdateManager] Setting up event listeners...');

        // Manual check button in settings
        document.getElementById('manualCheckUpdates')?.addEventListener('click', () => this.manualCheckUpdates());

        // Modal buttons
        document.getElementById('btn-install-github')?.addEventListener('click', () => this.installGithubUpdate());
        document.getElementById('btn-skip')?.addEventListener('click', () => this.skipUpdate());
        document.getElementById('btn-close')?.addEventListener('click', () => this.closeAndReload());
        document.getElementById('btn-view-logs')?.addEventListener('click', () => this.showLogs());
        document.getElementById('btn-view-release')?.addEventListener('click', () => this.viewRelease());

        // Backup button - log if found
        const btnBackup = document.getElementById('btn-create-backup');

        console.log('[UpdateManager] btn-create-backup found:', !!btnBackup);

        if (btnBackup) {
            btnBackup.addEventListener('click', () => this.createBackup());
            console.log('[UpdateManager] Event listener added to btn-create-backup');
        }

        document.getElementById('close-logs')?.addEventListener('click', () => this.closeLogs());
        document.getElementById('btn-logout')?.addEventListener('click', () => this.logout());

        // Backup confirmation checkboxes
        document.getElementById('backup-confirmed')?.addEventListener('change', (e) => {
            const installBtn = document.getElementById('btn-install-github');
            if (installBtn) {
                installBtn.disabled = !e.target.checked;
            }
        });

        console.log('[UpdateManager] Event listeners setup complete');
    }
    
    async checkForUpdates(forceShow = false) {
        try {
            console.log('[UpdateManager] Checking for updates...');
            const response = await fetch('/check-updates/');
            const data = await response.json();

            console.log('[UpdateManager] Update data:', data);

            // Update sidebar indicator if updates are available
            if (data.needs_update) {
                this.showSidebarUpdateIndicator();

                // Local updates are applied by the post-update screen: the
                // middleware locks the system and redirects there on the
                // first startup with new files.
                if (data.update_type === 'local') {
                    console.log('[UpdateManager] Local update pending - redirecting to post-update screen');
                    window.location.href = '/post-update/';
                    return;
                }

                // For GitHub updates, only show modal if admin or if forceShow is true
                if (data.is_admin || forceShow) {
                    this.updateData = data;
                    this.showUpdateModal(data);
                } else {
                    console.log('[UpdateManager] GitHub update available but user is not admin - showing sidebar indicator only');
                }
            } else {
                this.hideSidebarUpdateIndicator();
                console.log('[UpdateManager] No updates needed');
            }
        } catch (error) {
            console.error('[UpdateManager] Error checking for updates:', error);
        }
    }

    showSidebarUpdateIndicator() {
        const indicator = document.getElementById('sidebar-update-indicator');
        const versionSpan = document.getElementById('sidebar-version');
        if (indicator) {
            indicator.classList.remove('hidden');
        }
        if (versionSpan) {
            versionSpan.classList.add('text-orange-500', 'dark:text-orange-400');
            versionSpan.classList.remove('text-gray-500', 'dark:text-gray-600');
        }
    }

    hideSidebarUpdateIndicator() {
        const indicator = document.getElementById('sidebar-update-indicator');
        const versionSpan = document.getElementById('sidebar-version');
        if (indicator) {
            indicator.classList.add('hidden');
        }
        if (versionSpan) {
            versionSpan.classList.remove('text-orange-500', 'dark:text-orange-400');
            versionSpan.classList.add('text-gray-500', 'dark:text-gray-600');
        }
    }
    
    async manualCheckUpdates() {
        const btn = document.getElementById('manualCheckUpdates');
        const infoDiv = document.getElementById('online-update-info');
        const noUpdates = document.getElementById('no-updates-found');
        const hasUpdates = document.getElementById('updates-available');
        const githubVersion = document.getElementById('github-latest-version');
        
        if (!btn) return;
        
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> Checking...';
        
        try {
            const response = await fetch('/check-updates/manual/');
            const data = await response.json();
            
            console.log('[UpdateManager] Manual check data:', data);
            
            // Show info div
            if (infoDiv) {
                infoDiv.classList.remove('hidden');
                
                // Hide all messages first
                if (noUpdates) noUpdates.classList.add('hidden');
                if (hasUpdates) hasUpdates.classList.add('hidden');
                
                if (data.needs_update) {
                    if (data.update_type === 'local') {
                        // Local updates are finalized by the post-update screen
                        window.location.href = '/post-update/';
                        return;
                    } else {
                        // GitHub update available
                        if (hasUpdates) hasUpdates.classList.remove('hidden');
                        if (githubVersion) githubVersion.textContent = data.target_version;
                        
                        // Open modal
                        this.updateData = data;
                        this.showUpdateModal(data);
                    }
                } else {
                    // System is up to date
                    if (noUpdates) noUpdates.classList.remove('hidden');
                    if (githubVersion) githubVersion.textContent = data.current_version;
                }
            }
        } catch (error) {
            console.error('[UpdateManager] Error checking updates:', error);
            alert(this.t('failedToCheckUpdates') || 'Failed to check for updates. Please try again.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
    
    showUpdateModal(data) {
        console.log('[UpdateManager] Showing modal');
        const modal = document.getElementById('update-modal');
        if (!modal) {
            console.error('[UpdateManager] Modal not found');
            return;
        }
        
        // Hide all sections first
        this.hideAllSections();
        
        // Set versions
        document.getElementById('current-version').textContent = data.current_version;
        document.getElementById('target-version').textContent = data.target_version;
        
        this.showGithubUpdate(data);
        
        modal.classList.remove('hidden');
    }
    
    hideAllSections() {
        // Hide all possible sections
        const sections = [
            'github-info', 'container-warning',
            'backup-section', 'update-progress', 'update-results'
        ];

        sections.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });

        // Hide all buttons (including backup buttons)
        const buttons = [
            'btn-install-github', 'btn-skip',
            'btn-close', 'btn-view-logs', 'btn-view-release',
            'btn-create-backup', 'btn-logout'
        ];

        buttons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.add('hidden');
        });

        // Hide result messages
        const messages = ['success-message', 'error-message'];
        messages.forEach(id => {
            const msg = document.getElementById(id);
            if (msg) msg.classList.add('hidden');
        });
    }
    
    showGithubUpdate(data) {
        console.log('[UpdateManager] Showing GitHub update');

        const modalIcon = document.getElementById('modal-icon');
        const updateDesc = document.getElementById('update-description');
        const githubInfo = document.getElementById('github-info');
        const releaseName = document.getElementById('release-name');
        const releaseNotes = document.getElementById('release-notes');
        const releaseDate = document.getElementById('release-date');
        const readMoreLink = document.getElementById('read-more-link');
        const containerWarning = document.getElementById('container-warning');
        const backupSection = document.getElementById('backup-section');
        const btnSkip = document.getElementById('btn-skip');
        const btnInstall = document.getElementById('btn-install-github');
        const btnViewRelease = document.getElementById('btn-view-release');
        const btnCreateBackup = document.getElementById('btn-create-backup');

        if (modalIcon) {
            modalIcon.className = 'material-symbols-outlined text-4xl text-green-500';
            modalIcon.textContent = 'cloud_download';
        }

        if (updateDesc) {
            updateDesc.textContent = this.t('githubVersionAvailable') || 'A new version is available on GitHub!';
        }

        if (githubInfo) githubInfo.classList.remove('hidden');
        if (releaseName) {
            releaseName.textContent = data.github_release.name || `Version ${data.target_version}`;
        }

        // Limit release notes to 5 lines with fade effect and read more link
        if (releaseNotes) {
            const notes = data.github_release.body || 'No release notes available.';
            const lines = notes.split('\n');
            const maxLines = 5;

            if (lines.length > maxLines) {
                const limitedNotes = lines.slice(0, maxLines).join('\n');
                const formattedNotes = this.formatMarkdown(limitedNotes);

                // Create container with fade effect
                releaseNotes.innerHTML = `
                    <div class="relative max-h-32 overflow-hidden">
                        <div>${formattedNotes}</div>
                        <div class="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-green-50 dark:from-green-900/20 to-transparent"></div>
                    </div>
                `;

                // Show read more link
                if (readMoreLink) {
                    readMoreLink.href = data.github_release.html_url;
                    readMoreLink.classList.remove('hidden');
                }
            } else {
                releaseNotes.innerHTML = this.formatMarkdown(notes);
                if (readMoreLink) {
                    readMoreLink.classList.add('hidden');
                }
            }
        }

        if (releaseDate) {
            const date = new Date(data.github_release.published_at);
            releaseDate.textContent = date.toLocaleDateString();
        }

        if (btnViewRelease) btnViewRelease.classList.remove('hidden');

        // Check if user is admin
        const isAdmin = data.is_admin;

        if (data.requires_container) {
            // Container update required - manual process
            if (containerWarning) containerWarning.classList.remove('hidden');
            if (btnInstall) btnInstall.classList.add('hidden');
            if (backupSection) backupSection.classList.add('hidden');
            if (btnCreateBackup) btnCreateBackup.classList.add('hidden');

            // Show OK button for container updates (admin only)
            if (isAdmin && btnSkip) {
                btnSkip.textContent = this.t('buttonOk') || 'OK';
                btnSkip.classList.remove('hidden');
            }
        } else if (isAdmin) {
            // Show Skip button for regular updates (admin only)
            if (btnSkip) {
                btnSkip.textContent = this.t('buttonSkipUpdate') || 'Skip Update';
                btnSkip.classList.remove('hidden');
            }
            // Admin user - can install via web interface
            if (backupSection) backupSection.classList.remove('hidden');
            if (btnCreateBackup) btnCreateBackup.classList.remove('hidden');
            if (btnInstall) {
                btnInstall.classList.remove('hidden');
                btnInstall.disabled = true; // Disabled until backup confirmed
            }
        } else {
            // Non-admin user - show information only
            if (updateDesc) {
                updateDesc.textContent = this.t('githubUpdateNonAdmin') || 'A new version is available on GitHub. Only administrators can install updates. Please contact an administrator to apply this update.';
            }
            // Hide backup and install options for non-admin
            if (backupSection) backupSection.classList.add('hidden');
            if (btnCreateBackup) btnCreateBackup.classList.add('hidden');
            if (btnInstall) btnInstall.classList.add('hidden');
        }
    }
    
    formatMarkdown(text) {
        return text
            .replace(/^### (.*$)/gim, '<h3 class="font-semibold mt-3 mb-1">$1</h3>')
            .replace(/^## (.*$)/gim, '<h2 class="font-bold text-lg mt-4 mb-2">$1</h2>')
            .replace(/^# (.*$)/gim, '<h1 class="font-bold text-xl mt-4 mb-2">$1</h1>')
            .replace(/^\* (.*$)/gim, '<li class="ml-4">$1</li>')
            .replace(/^\- (.*$)/gim, '<li class="ml-4">$1</li>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }
    
    /**
     * Prompt for admin password and verify it before allowing update operations.
     * Returns a Promise that resolves to true if authorized, false otherwise.
     */
    async verifyAdminPassword() {
        const password = await this.promptAdminPassword();
        if (password === null) return false; // User cancelled

        try {
            const response = await fetch('/verify-admin-password/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.getCookie('csrftoken')
                },
                body: JSON.stringify({ password: password })
            });
            const data = await response.json();
            if (data.success) return true;
            alert(data.error || (this.t('incorrectAdminPassword') || 'Incorrect admin password.'));
            return false;
        } catch (error) {
            console.error('[UpdateManager] Admin password verification failed:', error);
            alert(this.t('networkError') || 'Network error. Please try again.');
            return false;
        }
    }

    /**
     * Show a prompt dialog for the admin password.
     * Returns the password string, or null if cancelled.
     */
    async promptAdminPassword() {
        return new Promise((resolve) => {
            const modal = document.getElementById('generic-modal');
            const modalTitle = document.getElementById('modal-title');
            const modalMessage = document.getElementById('modal-message');
            const modalButtons = document.getElementById('modal-buttons');
            const iconContainer = document.getElementById('modal-icon-container');
            const icon = document.getElementById('modal-icon');

            if (!modal) {
                // Fallback to native prompt if generic modal not available
                const pw = prompt(this.t('enterAdminPassword') || 'Enter admin password to proceed with the update:');
                resolve(pw);
                return;
            }

            // Set up warning icon
            iconContainer.className = 'mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full sm:mx-0 sm:h-10 sm:w-10 bg-amber-100 dark:bg-amber-900/20';
            icon.className = 'h-6 w-6 text-amber-600 dark:text-amber-500';
            icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />';

            modalTitle.textContent = this.t('adminPasswordRequired') || 'Admin Password Required';
            modalMessage.innerHTML =
                '<p class="text-sm text-gray-600 dark:text-gray-300 mb-3">' +
                (this.t('adminPasswordUpdateWarning') || 'Enter the admin password to proceed with the system update.') +
                '</p>' +
                '<input type="password" id="admin-update-password" ' +
                'class="w-full border rounded-lg bg-background-light dark:bg-background-dark border-slate-300 dark:border-slate-700 focus:ring-amber-500 focus:border-amber-500 text-slate-800 dark:text-slate-200 p-3" ' +
                'placeholder="' + (this.t('adminPassword') || 'Admin password') + '" autofocus>';

            modalButtons.innerHTML = '';

            var btnCancel = document.createElement('button');
            btnCancel.type = 'button';
            btnCancel.textContent = this.t('cancel') || 'Cancel';
            btnCancel.className = 'inline-flex w-full justify-center rounded-lg px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-inset bg-white hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white ring-gray-300 dark:ring-gray-600 sm:w-auto';
            btnCancel.addEventListener('click', function() {
                window.GenericModal.hide();
                resolve(null);
            });

            var btnConfirm = document.createElement('button');
            btnConfirm.type = 'button';
            btnConfirm.textContent = this.t('confirm') || 'Confirm';
            btnConfirm.className = 'inline-flex w-full justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm bg-amber-600 hover:bg-amber-700 sm:w-auto';
            btnConfirm.addEventListener('click', function() {
                var pwInput = document.getElementById('admin-update-password');
                var pw = pwInput ? pwInput.value : '';
                window.GenericModal.hide();
                resolve(pw || null);
            });

            modalButtons.appendChild(btnCancel);
            modalButtons.appendChild(btnConfirm);

            modal.classList.remove('hidden');

            setTimeout(function() {
                var pwInput = document.getElementById('admin-update-password');
                if (pwInput) pwInput.focus();
            }, 100);
        });
    }

    
    async installGithubUpdate() {
        console.log('[UpdateManager] Installing GitHub update...');
        console.log('[UpdateManager] Full updateData:', JSON.stringify(this.updateData, null, 2));

        // Verify admin password before proceeding
        const authorized = await this.verifyAdminPassword();
        if (!authorized) return;

        // Validate updateData
        if (!this.updateData) {
            console.error('[UpdateManager] No updateData available!');
            this.showError('Update data is missing. Please refresh and try again.');
            return;
        }

        if (!this.updateData.github_release) {
            console.error('[UpdateManager] No github_release in updateData!');
            this.showError('GitHub release data is missing. Please refresh and try again.');
            return;
        }

        if (!this.updateData.github_release.zipball_url) {
            console.error('[UpdateManager] No zipball_url in github_release!');
            this.showError('Download URL is missing. Please refresh and try again.');
            return;
        }

        // Get target_version from either updateData or github_release
        const targetVersion = this.updateData.target_version || this.updateData.github_release.version;

        if (!targetVersion) {
            console.error('[UpdateManager] No target_version found!');
            console.error('[UpdateManager] updateData.target_version:', this.updateData.target_version);
            console.error('[UpdateManager] github_release.version:', this.updateData.github_release.version);
            this.showError('Target version is missing. Please refresh and try again.');
            return;
        }

        console.log('[UpdateManager] Using target_version:', targetVersion);

        const backupConfirmed = document.getElementById('backup-confirmed');
        if (!backupConfirmed || !backupConfirmed.checked) {
            alert(this.t('pleaseConfirmBackup') || 'Please confirm that you have created a backup before proceeding.');
            return;
        }

        const progressSection = document.getElementById('update-progress');
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        const progressTitle = document.getElementById('progress-title');
        const btnInstall = document.getElementById('btn-install-github');
        const btnSkip = document.getElementById('btn-skip');
        const backupSection = document.getElementById('backup-section');

        if (btnInstall) btnInstall.classList.add('hidden');
        if (btnSkip) btnSkip.classList.add('hidden');
        if (backupSection) backupSection.classList.add('hidden');
        if (progressSection) progressSection.classList.remove('hidden');
        if (progressTitle) progressTitle.textContent = this.t('installingGithubUpdate') || 'Installing GitHub Update...';

        try {
            if (progressBar) progressBar.style.width = '10%';
            if (progressText) progressText.textContent = this.t('downloadingRelease') || 'Downloading release...';

            const requestBody = {
                zipball_url: this.updateData.github_release.zipball_url,
                target_version: targetVersion
            };

            console.log('[UpdateManager] Request body:', requestBody);

            const response = await fetch('/download-github-update/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.getCookie('csrftoken')
                },
                body: JSON.stringify(requestBody)
            });

            console.log('[UpdateManager] Response status:', response.status);
            console.log('[UpdateManager] Response ok:', response.ok);

            if (progressBar) progressBar.style.width = '50%';
            if (progressText) progressText.textContent = this.t('extractingFiles') || 'Extracting files...';

            const data = await response.json();
            console.log('[UpdateManager] GitHub update response:', data);

            if (progressBar) progressBar.style.width = '100%';
            if (progressText) progressText.textContent = this.t('updateComplete') || 'Update complete!';

            // Store logs regardless of success/failure
            this.logsContent = this.formatGithubLogs(data);

            if (data.success) {
                this.showSuccessWithReload(this.t('githubUpdateSuccess') || 'GitHub update installed successfully! Waiting for server to restart...');
            } else {
                this.showError(data.error || (this.t('updateFailed') || 'Update failed. Check logs for details.'));
            }
        } catch (error) {
            console.error('[UpdateManager] Error installing GitHub update:', error);

            // Store error in logs
            this.logsContent = `=== GitHub Update Error ===\n\nError: ${error.message}\n\nStack Trace:\n${error.stack || 'No stack trace available'}`;

            this.showError((this.t('failedToInstallUpdate') || 'Failed to install update') + ': ' + error.message);
        }
    }
    
    async createBackup() {
        console.log('[UpdateManager] createBackup() called');

        const btn = document.getElementById('btn-create-backup');
        if (!btn) {
            console.error('[UpdateManager] Backup button not found!');
            alert('Error: Backup button not found');
            return;
        }

        console.log('[UpdateManager] Backup button found, starting backup creation...');

        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> Creating...';

        try {
            console.log('[UpdateManager] Sending POST request to /create-backup/');
            const response = await fetch('/create-backup/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.getCookie('csrftoken')
                }
            });

            console.log('[UpdateManager] Response status:', response.status);

            const data = await response.json();
            console.log('[UpdateManager] Response data:', data);

            if (data.success) {
                console.log('[UpdateManager] Backup successful, filename:', data.filename);
                window.location.href = `/download-backup/${data.filename}/`;
                alert(this.t('backupCreatedSuccessfully') || 'Backup created successfully! File will be downloaded.');
            } else {
                console.error('[UpdateManager] Backup failed:', data.error);
                alert((this.t('failedToCreateBackup') || 'Failed to create backup: ') + data.error);
            }
        } catch (error) {
            console.error('[UpdateManager] Error creating backup:', error);
            alert((this.t('failedToCreateBackup') || 'Failed to create backup: ') + error.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }


    async skipUpdate() {
        if (!confirm(this.t('confirmSkipUpdate') || 'Are you sure you want to skip this update? You won\'t be notified about this version again until a newer version is released.')) {
            return;
        }

        try {
            const response = await fetch('/skip-updates/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.getCookie('csrftoken')
                },
                body: JSON.stringify({
                    update_type: this.updateData.update_type,
                    version: this.updateData.target_version
                })
            });

            const data = await response.json();

            if (data.success) {
                document.getElementById('update-modal').classList.add('hidden');
            } else {
                alert((this.t('failedToSkipUpdate2') || 'Failed to skip update: ') + (data.error || this.t('unknownError') || 'Unknown error'));
            }
        } catch (error) {
            console.error('[UpdateManager] Error skipping update:', error);
            alert(this.t('failedToSkipUpdate') || 'Failed to skip update. Please try again.');
        }
    }
    
    showSuccess(message) {
        const progressSection = document.getElementById('update-progress');
        const resultsSection = document.getElementById('update-results');
        const successMsg = document.getElementById('success-message');
        const successDetails = document.getElementById('success-details');
        const btnClose = document.getElementById('btn-close');

        if (progressSection) progressSection.classList.add('hidden');
        if (resultsSection) resultsSection.classList.remove('hidden');
        if (successMsg) successMsg.classList.remove('hidden');
        if (successDetails) successDetails.textContent = message;
        if (btnClose) btnClose.classList.remove('hidden');
    }

    showSuccessWithReload(message) {
        const progressSection = document.getElementById('update-progress');
        const resultsSection = document.getElementById('update-results');
        const successMsg = document.getElementById('success-message');
        const successDetails = document.getElementById('success-details');

        if (progressSection) progressSection.classList.add('hidden');
        if (resultsSection) resultsSection.classList.remove('hidden');
        if (successMsg) successMsg.classList.remove('hidden');

        // Add spinner and message
        if (successDetails) {
            successDetails.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-green-600"></div>
                    <span>${message}</span>
                </div>
            `;
        }

        // Start checking if server is back up
        this.waitForServerAndReload();
    }

    async waitForServerAndReload() {
        const maxAttempts = 120; // Try for up to 2 minutes (doubled from 60s)
        const delayBetweenAttempts = 1000; // 1 second
        let consecutiveSuccess = 0;
        const requiredConsecutiveSuccess = 2; // Require 2 successful checks to ensure stability

        console.log('[UpdateManager] Starting health check polling...');

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Try to fetch a lightweight endpoint with timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

                const response = await fetch('/api/health-check/', {
                    method: 'GET',
                    cache: 'no-store',
                    signal: controller.signal,
                    headers: {
                        'Cache-Control': 'no-cache, no-store, must-revalidate',
                        'Pragma': 'no-cache',
                        'Expires': '0'
                    }
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                    const data = await response.json();
                    consecutiveSuccess++;
                    console.log(`[UpdateManager] Server responded OK (${consecutiveSuccess}/${requiredConsecutiveSuccess}) - attempt ${attempt}/${maxAttempts}`, data);

                    // Require multiple consecutive successful responses to ensure server is stable
                    if (consecutiveSuccess >= requiredConsecutiveSuccess) {
                        console.log(`[UpdateManager] Server is stable and ready after ${attempt} attempts`);
                        // Wait 1 more second for good measure
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        // Server is back and stable, reload the page
                        location.reload();
                        return;
                    }
                } else {
                    consecutiveSuccess = 0; // Reset counter on failure
                    console.log(`[UpdateManager] Server responded with status ${response.status}, waiting... attempt ${attempt}/${maxAttempts}`);
                }
            } catch (error) {
                consecutiveSuccess = 0; // Reset counter on error
                // Server not ready yet, continue waiting
                if (error.name === 'AbortError') {
                    console.log(`[UpdateManager] Health check timeout, server still starting... attempt ${attempt}/${maxAttempts}`);
                } else {
                    console.log(`[UpdateManager] Waiting for server... attempt ${attempt}/${maxAttempts}`, error.message);
                }
            }

            // Wait before next attempt
            await new Promise(resolve => setTimeout(resolve, delayBetweenAttempts));
        }

        // If we get here, server didn't come back up in time
        const successDetails = document.getElementById('success-details');
        if (successDetails) {
            const takingLongerMsg = this.t('serverRestartTakingLonger') || 'Server is taking longer than expected to restart.';
            const waitMsg = this.t('waitAndClickToReload') || 'Please wait a moment and then';
            const clickMsg = this.t('clickHereToReload') || 'click here to reload';

            successDetails.innerHTML = `
                <div>
                    <p class="text-yellow-600 dark:text-yellow-400 mb-2">${takingLongerMsg}</p>
                    <p class="text-sm">${waitMsg} <button onclick="location.reload()" class="text-green-600 hover:text-green-700 underline font-medium">${clickMsg}</button>.</p>
                </div>
            `;
        }
    }

    showError(message) {
        const progressSection = document.getElementById('update-progress');
        const resultsSection = document.getElementById('update-results');
        const errorMsg = document.getElementById('error-message');
        const errorDetails = document.getElementById('error-details');
        const btnViewLogs = document.getElementById('btn-view-logs');
        
        if (progressSection) progressSection.classList.add('hidden');
        if (resultsSection) resultsSection.classList.remove('hidden');
        if (errorMsg) errorMsg.classList.remove('hidden');
        if (errorDetails) errorDetails.textContent = message;
        if (btnViewLogs) btnViewLogs.classList.remove('hidden');
    }
    
    formatLogs(data) {
        let logs = '=== Update Process Logs ===\n\n';

        if (data.results) {
            data.results.forEach(result => {
                // Use 'filename' instead of 'script' (backend sends 'filename')
                const scriptName = result.filename || result.script || 'Unknown Script';
                logs += `\n=== ${scriptName} ===\n`;
                logs += `Status: ${result.status}\n`;
                if (result.output) {
                    logs += `Output:\n${result.output}\n`;
                }
                if (result.error) {
                    logs += `Error: ${result.error}\n`;
                    if (result.traceback) {
                        logs += `\nTraceback:\n${result.traceback}\n`;
                    }
                }
            });
        }
        if (data.traceback) {
            logs += `\n=== Full Traceback ===\n${data.traceback}`;
        }
        return logs || 'No detailed logs available';
    }

    formatGithubLogs(data) {
        let logs = '=== GitHub Update Process Logs ===\n\n';

        if (data.success) {
            logs += 'Status: SUCCESS\n';
            logs += `Message: ${data.message || 'Update completed successfully'}\n`;
            if (data.new_version) {
                logs += `New Version: ${data.new_version}\n`;
            }
            logs += '\n=== Update Process Details ===\n';
            if (data.logs) {
                logs += data.logs;
            } else {
                logs += 'No detailed logs available';
            }
        } else {
            logs += 'Status: FAILED\n';
            logs += `Error: ${data.error || 'Unknown error'}\n`;

            logs += '\n=== Update Process Details ===\n';
            if (data.logs) {
                logs += data.logs;
            } else if (data.traceback) {
                logs += `Server Traceback:\n${data.traceback}`;
            } else {
                logs += 'No detailed logs available';
            }
        }

        return logs;
    }
    
    showLogs() {
        console.log('[UpdateManager] showLogs called');
        console.log('[UpdateManager] logsContent:', this.logsContent);
        console.log('[UpdateManager] logsContent length:', this.logsContent.length);

        const logsModal = document.getElementById('logs-modal');
        const logsContent = document.getElementById('logs-content');

        if (!logsModal) {
            console.error('[UpdateManager] logs-modal element not found!');
            alert(this.t('logsModalNotFound') || 'Logs modal element not found in the page.');
            return;
        }

        if (!logsContent) {
            console.error('[UpdateManager] logs-content element not found!');
            alert(this.t('logsContentNotFound') || 'Logs content element not found in the page.');
            return;
        }

        if (!this.logsContent || this.logsContent.length === 0) {
            console.warn('[UpdateManager] No logs available');
            logsContent.textContent = this.t('noLogsAvailable') || 'No logs available yet. Please apply an update first.';
        } else {
            logsContent.textContent = this.logsContent;
        }

        logsModal.classList.remove('hidden');
        console.log('[UpdateManager] Logs modal shown');
    }
    
    closeLogs() {
        document.getElementById('logs-modal').classList.add('hidden');
    }
    
    viewRelease() {
        if (this.updateData && this.updateData.github_release) {
            window.open(this.updateData.github_release.html_url, '_blank');
        }
    }
    
    closeAndReload() {
        location.reload();
    }

    async logout() {
        console.log('[UpdateManager] Logging out user');

        try {
            // Create form and submit POST request
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = '/auth/logout/';

            // Add CSRF token
            const csrfToken = this.getCookie('csrftoken');
            if (csrfToken) {
                const csrfInput = document.createElement('input');
                csrfInput.type = 'hidden';
                csrfInput.name = 'csrfmiddlewaretoken';
                csrfInput.value = csrfToken;
                form.appendChild(csrfInput);
            }

            // Add form to document and submit
            document.body.appendChild(form);
            form.submit();
        } catch (error) {
            console.error('[UpdateManager] Error during logout:', error);
            // Fallback: try direct navigation
            window.location.href = '/auth/logout/';
        }
    }

    getCookie(name) {
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
}

// Initialize when DOM is ready, but only if admin modal is not present
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const adminModal = document.getElementById('admin-warning-modal');
        if (!adminModal) {
            window.updateManager = new UpdateManager();
        }
    });
} else {
    const adminModal = document.getElementById('admin-warning-modal');
    if (!adminModal) {
        window.updateManager = new UpdateManager();
    }
}