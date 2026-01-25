/**
 * utils.js - Common Utility Functions
 *
 * Centralized utility functions used across multiple templates
 * to avoid code duplication and maintain consistency.
 *
 * Version: 20260124-003
 * Created: 2025-12-31
 */

(function() {
    'use strict';

    // ========== COOKIE MANAGEMENT ==========

    /**
     * Get cookie value by name
     * @param {string} name - Cookie name
     * @returns {string|null} Cookie value or null if not found
     */
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

    // ========== MONEY/CURRENCY UTILITIES ==========

    /**
     * Get raw numeric value from masked money input
     * Removes thousand separators and converts decimal separator to dot
     * @param {string} maskedValue - Formatted money value
     * @param {string} thousandSeparator - Thousand separator character (default: '.')
     * @param {string} decimalSeparator - Decimal separator character (default: ',')
     * @returns {string} Raw numeric value with dot as decimal separator
     */
    function getRawValue(maskedValue, thousandSeparator = '.', decimalSeparator = ',') {
        if (!maskedValue || maskedValue === '') return '0';

        // Escape special regex characters in the separator
        const escapedSeparator = thousandSeparator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let value = maskedValue.replace(new RegExp(escapedSeparator, 'g'), '');
        value = value.replace(decimalSeparator, '.');
        return value;
    }

    /**
     * Apply money mask to input field with robust cursor positioning
     */
    function applyMoneyMask(event, thousandSeparator = '.', decimalSeparator = ',') {
        const input = event.target;
        // The current cursor position AFTER the user typed/deleted but BEFORE we reformat
        let cursorPos = input.selectionStart;
        const currentValue = input.value;
        const valueLength = currentValue.length;

        // RIGHT ALIGNMENT STRATEGY:
        // We calculate how many digits are AFTER the cursor in the input.
        // We preserve this count in the formatted string.
        // This ensures stability even if leading zeros are added/removed.

        const textAfterCursor = currentValue.substring(cursorPos);
        const digitsAfterCursor = (textAfterCursor.match(/\d/g) || []).length;

        // 1. Get current digits
        const currentDigits = currentValue.replace(/\D/g, '');
        
        // Ensure we handle the "empty" or minimal cases
        let digits = currentDigits;
        if (!digits) digits = '0'; 
        
        // Pad with leading zeros for cents
        // We need at least 3 digits (X,XX)
        const cleanDigits = parseInt(digits, 10).toString(); // remove leading zeros from string '0042' -> '42'
        const paddedDigits = cleanDigits.padStart(3, '0');
        
        // Check if we just have zeros
        const totalCents = parseInt(paddedDigits, 10);
        
        // Construct formatted string
        let integerPart = Math.floor(totalCents / 100).toString();
        const decimalPart = (totalCents % 100).toString().padStart(2, '0');
        integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator);
        
        const formatted = integerPart + decimalSeparator + decimalPart;
        
        // Update value
        input.value = formatted;
        
        // --- CURSOR RESTORATION ---
        
        // Calculate new cursor position based on Digits After Cursor
        const totalNewDigits = (formatted.match(/\d/g) || []).length;
        
        // Target: We want 'digitsAfterCursor' digits to the right.
        // So we want 'totalNewDigits - digitsAfterCursor' digits to the left.
        let targetDigitsBeforeCursor = totalNewDigits - digitsAfterCursor;
        
        // Clamp bounds
        if (targetDigitsBeforeCursor < 0) targetDigitsBeforeCursor = 0;
        if (targetDigitsBeforeCursor > totalNewDigits) targetDigitsBeforeCursor = totalNewDigits;
        
        let newCursorPos = 0;
        let count = 0;
        
        // Scan the new formatted string to find position after N digits
        // Special case: if target is 0, we want position minimal (0)
        if (targetDigitsBeforeCursor === 0) {
            newCursorPos = 0; // or find first digit? Usually 0 is fine.
        } else {
            for (let i = 0; i < formatted.length; i++) {
                const char = formatted[i];
                if (/\d/.test(char)) {
                    count++;
                }
                
                if (count === targetDigitsBeforeCursor) {
                    newCursorPos = i + 1;
                    break;
                }
            }
        }
        
        // Store state for next time
        input.setAttribute('data-prev-value', formatted);
        input.setAttribute('data-prev-digits', formatted.replace(/\D/g, ''));
        
        // Set cursor
        input.setSelectionRange(newCursorPos, newCursorPos);
    }

    /**
     * Format amount for input field
     * @param {number|string} amount - Amount to format
     * @param {string} thousandSeparator - Thousand separator (default: '.')
     * @param {string} decimalSeparator - Decimal separator (default: ',')
     * @returns {string} Formatted amount
     */
    function formatAmountForInput(amount, thousandSeparator = '.', decimalSeparator = ',') {
        if (amount === null || amount === undefined || amount === '') {
            return '0' + decimalSeparator + '00';
        }

        let num = parseFloat(amount);
        if (isNaN(num)) {
            return '0' + decimalSeparator + '00';
        }

        let cents = Math.round(num * 100);
        let integerPart = Math.floor(cents / 100).toString();
        let decimalPart = (cents % 100).toString().padStart(2, '0');

        // Add thousand separators
        integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator);

        return integerPart + decimalSeparator + decimalPart;
    }

    /**
     * Format currency for display
     * @param {number|string} amount - Amount to format
     * @param {string} currencySymbol - Currency symbol (default: 'R$')
     * @param {string} thousandSeparator - Thousand separator (default: '.')
     * @param {string} decimalSeparator - Decimal separator (default: ',')
     * @returns {string} Formatted currency string
     */
    function formatCurrency(amount, currencySymbol = 'R$', thousandSeparator = '.', decimalSeparator = ',') {
        const num = parseFloat(amount);
        if (isNaN(num)) return amount;

        const cents = Math.round(num * 100);
        let integerPart = Math.floor(cents / 100).toString();
        let decimalPart = (cents % 100).toString().padStart(2, '0');

        // Add thousand separators
        integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator);

        return currencySymbol + ' ' + integerPart + decimalSeparator + decimalPart;
    }

    // ========== INPUT FOCUS/CURSOR UTILITIES ==========

    /**
     * Initialize money input fields with proper event handling
     * Rule: First focus -> Cursor to end. Subsequent clicks -> Free movement.
     */
    function initializeMoneyInputs(selector, thousandSeparator = '.', decimalSeparator = ',') {
        const initKey = 'data-money-init-' + selector.replace(/[^a-zA-Z0-9]/g, '_');
        if (document.body.hasAttribute(initKey)) return;
        document.body.setAttribute(initKey, 'true');

        // Helper to update state without reformatting
        const updateState = (input) => {
             const digits = input.value.replace(/\D/g, '');
             input.setAttribute('data-prev-value', input.value);
             input.setAttribute('data-prev-digits', digits);
        };

        // INPUT event
        document.addEventListener('input', function(event) {
            if (event.target.matches(selector)) {
                applyMoneyMask(event, thousandSeparator, decimalSeparator);
            }
        });

        // FOCUS event - distinct from click
        document.addEventListener('focus', function(event) {
            if (event.target.matches(selector)) {
                const input = event.target;
                
                // If this is the FIRST focus (or we returned from blur), move to end.
                // We depend on 'blur' clearing the flag.
                if (!input.hasAttribute('data-has-focused')) {
                    input.setAttribute('data-has-focused', 'true');
                    
                    // Force cursor to end on initial entry
                    // Use setTimeout to override browser default selection behavior on focus
                    setTimeout(() => {
                        const len = input.value.length;
                        input.setSelectionRange(len, len);
                        updateState(input);
                    }, 0);
                }
            }
        }, true); // Capture phase to catch it early

        // BLUR event
        document.addEventListener('blur', function(event) {
            if (event.target.matches(selector)) {
                event.target.removeAttribute('data-has-focused');
            }
        }, true);
        
        // CLICK / KEY/ MOUSEUP support
        document.addEventListener('keydown', function(event) {
            if (event.target.matches(selector)) {
                // Allow: backspace, delete, tab, escape, enter, home, end, arrows
                const allowedKeys = [8, 46, 9, 27, 13, 35, 36, 37, 38, 39, 40];
                if (allowedKeys.includes(event.keyCode)) return;
                
                // Allow: Ctrl/Cmd combinations
                if (event.ctrlKey || event.metaKey) return;
                
                // Allow: Numbers
                if ((event.keyCode >= 48 && event.keyCode <= 57) || 
                    (event.keyCode >= 96 && event.keyCode <= 105)) return;
                    
                event.preventDefault();
            }
        });
    }

    /**
     * Initialize cursor positioning for amount input fields (legacy/simple version)
     * Positions cursor to the right on focus
     * @param {string} selector - CSS selector for input fields (default: 'input[data-field="amount"]')
     */
    function initializeCursorPositioning(selector = 'input[data-field="amount"]') {
        document.addEventListener('focus', function(event) {
            if (event.target.matches(selector)) {
                setTimeout(function() {
                    event.target.setSelectionRange(event.target.value.length, event.target.value.length);
                }, 0);
            }
        }, true);
    }

    // ========== UI FEEDBACK ==========

    /**
     * Show success message notification
     * @param {string} message - Message to display
     * @param {number} duration - Duration in milliseconds (default: 3000)
     */
    function showSuccessMessage(message, duration = 3000) {
        // Check if there's a notification system available
        if (window.NotificationManager && typeof window.NotificationManager.show === 'function') {
            window.NotificationManager.show(message, 'success', duration);
            return;
        }

        // Fallback: Create simple toast notification
        const toast = document.createElement('div');
        toast.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 transition-opacity duration-300';
        toast.textContent = message;
        toast.style.opacity = '0';

        document.body.appendChild(toast);

        // Fade in
        setTimeout(() => {
            toast.style.opacity = '1';
        }, 10);

        // Fade out and remove
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, duration);
    }

    /**
     * Show error message notification
     * @param {string} message - Message to display
     * @param {number} duration - Duration in milliseconds (default: 5000)
     */
    function showErrorMessage(message, duration = 5000) {
        // Check if there's a notification system available
        if (window.NotificationManager && typeof window.NotificationManager.show === 'function') {
            window.NotificationManager.show(message, 'error', duration);
            return;
        }

        // Fallback: Create simple toast notification
        const toast = document.createElement('div');
        toast.className = 'fixed top-4 right-4 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 transition-opacity duration-300';
        toast.textContent = message;
        toast.style.opacity = '0';

        document.body.appendChild(toast);

        // Fade in
        setTimeout(() => {
            toast.style.opacity = '1';
        }, 10);

        // Fade out and remove
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, duration);
    }

    // ========== EXPORT TO WINDOW ==========

    // Export all utility functions to window object
    window.FinancesUtils = {
        // Cookie management
        getCookie: getCookie,

        // Money/Currency utilities
        getRawValue: getRawValue,
        applyMoneyMask: applyMoneyMask,
        formatAmountForInput: formatAmountForInput,
        formatCurrency: formatCurrency,

        // Input focus/cursor utilities
        initializeMoneyInputs: initializeMoneyInputs,
        initializeCursorPositioning: initializeCursorPositioning,

        // UI feedback
        showSuccessMessage: showSuccessMessage,
        showErrorMessage: showErrorMessage
    };

    // Also export individual functions for backward compatibility
    window.getCookie = getCookie;
    window.getRawValue = getRawValue;
    window.applyMoneyMask = applyMoneyMask;
    window.formatAmountForInput = formatAmountForInput;
    window.formatCurrency = formatCurrency;
    window.initializeMoneyInputs = initializeMoneyInputs;
    window.initializeCursorPositioning = initializeCursorPositioning;
    window.showSuccessMessage = showSuccessMessage;
    window.showErrorMessage = showErrorMessage;

    console.log('[FinancesUtils] Utility functions loaded successfully (v20260124-003)');

})();
