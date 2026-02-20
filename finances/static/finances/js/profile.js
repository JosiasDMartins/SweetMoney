// Version: 20260213-001 - Added overdue days before field toggle
'use strict';

document.addEventListener('DOMContentLoaded', function() {
    // Toggle email notification types panel
    var toggle = document.getElementById('email_notifications_enabled');
    var panel = document.getElementById('email-notif-types');
    if (toggle && panel) {
        toggle.addEventListener('change', function() {
            panel.style.display = this.checked ? 'block' : 'none';
        });
    }

    // Toggle overdue days before field
    var overdueToggle = document.getElementById('email_notify_overdue');
    var overdueDaysPanel = document.getElementById('email-overdue-days-before-wrapper');
    if (overdueToggle && overdueDaysPanel) {
        overdueToggle.addEventListener('change', function() {
            overdueDaysPanel.style.display = this.checked ? 'block' : 'none';
        });
    }
});
