'use strict';

document.addEventListener('DOMContentLoaded', function() {
    var toggle = document.getElementById('email_notifications_enabled');
    var panel = document.getElementById('email-notif-types');
    if (toggle && panel) {
        toggle.addEventListener('change', function() {
            panel.style.display = this.checked ? 'block' : 'none';
        });
    }
});
