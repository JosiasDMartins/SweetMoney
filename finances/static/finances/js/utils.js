/**
 * utils.js - Common Utility Functions
 *
 * Centralized utility functions used across multiple templates
 * to avoid code duplication and maintain consistency.
 *
 * Version: 20260219-6
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
     * Parse a locale-formatted number string to a JS-usable numeric string.
     * Removes thousand separators and converts decimal separator to dot.
     * Used for internal JS calculations only (not for sending to backend).
     * @param {string} maskedValue - Formatted money value (e.g., "1.234,56" or "1,234.56")
     * @param {string} thousandSeparator - Thousand separator character
     * @param {string} decimalSeparator - Decimal separator character
     * @returns {string} Standard numeric value with dot as decimal separator
     */
    function parseLocaleNumber(maskedValue, thousandSeparator, decimalSeparator) {
        thousandSeparator = thousandSeparator || window.thousandSeparator || ',';
        decimalSeparator = decimalSeparator || window.decimalSeparator || '.';
        if (!maskedValue || maskedValue === '') return '0';

        const isNegative = maskedValue.startsWith('-');
        let value = maskedValue.substring(isNegative ? 1 : 0);

        // Remove currency symbols and whitespace
        value = value.replace(/[^\d.,\-]/g, '');

        // Remove thousand separators
        const escapedSep = thousandSeparator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        value = value.replace(new RegExp(escapedSep, 'g'), '');
        // Convert decimal separator to dot
        value = value.replace(decimalSeparator, '.');

        if (isNegative) {
            value = '-' + value;
        }

        return value;
    }

    /**
     * Apply money mask to input field with robust cursor positioning
     * Now supports negative values for credit card refunds
     */
    function applyMoneyMask(event, thousandSeparator, decimalSeparator) {
        // Use window globals from template config if not provided
        thousandSeparator = thousandSeparator || window.thousandSeparator || '.';
        decimalSeparator = decimalSeparator || window.decimalSeparator || ',';
        const input = event.target;
        // The current cursor position AFTER the user typed/deleted but BEFORE we reformat
        let cursorPos = input.selectionStart;
        const currentValue = input.value;

        console.log('[MoneyMask] Input value:', currentValue, 'thousandSep:', thousandSeparator, 'decimalSep:', decimalSeparator);

        // Check for negative sign at the beginning
        const hasNegativeSign = currentValue.startsWith('-');
        const valueWithoutSign = hasNegativeSign ? currentValue.substring(1) : currentValue;

        console.log('[MoneyMask] hasNegativeSign:', hasNegativeSign, 'valueWithoutSign:', valueWithoutSign);

        // Get data captured by keydown/touchstart event (BEFORE the modification happened)
        const beforeCursor = parseInt(input.getAttribute('data-before-cursor') || '-1', 10);
        const beforeValue = input.getAttribute('data-before-value') || '';
        const beforeValueLength = beforeValue.length;

        // Detect if this was a delete operation (value got shorter in digits)
        const currentDigitsRaw = valueWithoutSign.replace(/\D/g, '');
        const beforeDigitsRaw = beforeValue.replace(/\D/g, '');
        const isDelete = currentDigitsRaw.length < beforeDigitsRaw.length;

        // Was cursor at the end before the operation?
        const wasAtEnd = beforeCursor >= beforeValueLength;

        // Calculate digitsAfterCursor (adjust for negative sign)
        let digitsAfterCursor;

        if (isDelete && wasAtEnd && beforeCursor !== -1) {
            // Cursor was at the end before delete, keep it at the end
            digitsAfterCursor = 0;
        } else {
            // Normal calculation - use reported cursor position
            const textAfterCursor = valueWithoutSign.substring(cursorPos - (hasNegativeSign ? 1 : 0));
            digitsAfterCursor = (textAfterCursor.match(/\d/g) || []).length;
        }

        // 1. Get current digits (from value without sign)
        const currentDigits = valueWithoutSign.replace(/\D/g, '');

        // Ensure we handle the "empty" or minimal cases
        let digits = currentDigits;
        if (!digits) digits = '0';

        // Pad with leading zeros for cents
        // We need at least 3 digits (X,XX)
        const cleanDigits = parseInt(digits, 10).toString(); // remove leading zeros from string '0042' -> '42'
        const paddedDigits = cleanDigits.padStart(3, '0');

        // Check if we just have zeros
        const totalCents = parseInt(paddedDigits, 10);

        // Construct formatted string (without sign)
        let integerPart = Math.floor(totalCents / 100).toString();
        const decimalPart = (totalCents % 100).toString().padStart(2, '0');
        integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator);

        let formatted = integerPart + decimalSeparator + decimalPart;

        // Add negative sign if the original value had it
        // We preserve the negative sign even for zero values to allow entering negative amounts
        if (hasNegativeSign) {
            formatted = '-' + formatted;
        }

        console.log('[MoneyMask] Final formatted value:', formatted);

        // Update value
        input.value = formatted;

        console.log('[MoneyMask] Input value after update:', input.value);

        // --- CURSOR RESTORATION ---

        // Calculate new cursor position based on Digits After Cursor
        const totalNewDigits = (formatted.match(/\d/g) || []).length;

        // Target: We want 'digitsAfterCursor' digits to the right.
        // So we want 'totalNewDigits - digitsAfterCursor' digits to the left.
        let targetDigitsBeforeCursor = totalNewDigits - digitsAfterCursor;

        console.log('[MoneyMask] Cursor calculation - totalNewDigits:', totalNewDigits, 'digitsAfterCursor:', digitsAfterCursor, 'targetDigitsBeforeCursor:', targetDigitsBeforeCursor, 'hasNegativeSign:', hasNegativeSign);

        // Clamp bounds
        if (targetDigitsBeforeCursor < 0) targetDigitsBeforeCursor = 0;
        if (targetDigitsBeforeCursor > totalNewDigits) targetDigitsBeforeCursor = totalNewDigits;

        let newCursorPos = 0;
        let count = 0;

        // Scan the new formatted string to find position after N digits
        // Special case: if target is 0, we want position minimal (account for negative sign)
        if (targetDigitsBeforeCursor === 0) {
            newCursorPos = hasNegativeSign ? 1 : 0; // After negative sign if present
            console.log('[MoneyMask] Special case: targetDigitsBeforeCursor === 0, newCursorPos:', newCursorPos);
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
            console.log('[MoneyMask] Normal case: counted', count, 'digits, newCursorPos:', newCursorPos);
        }

        // Use setTimeout to set cursor AFTER browser finishes its own cursor handling
        // This is critical on Android where the browser repositions cursor after our setSelectionRange
        setTimeout(() => {
            input.setSelectionRange(newCursorPos, newCursorPos);
            console.log('[MoneyMask] Cursor position set to:', newCursorPos, 'value:', input.value);
        }, 10);
    }

    /**
     * Format amount for input field
     * @param {number|string} amount - Amount to format
     * @param {string} thousandSeparator - Thousand separator (default: '.')
     * @param {string} decimalSeparator - Decimal separator (default: ',')
     * @returns {string} Formatted amount
     */
    function formatAmountForInput(amount, thousandSeparator, decimalSeparator) {
        // Use window globals from template config if not provided
        thousandSeparator = thousandSeparator || window.thousandSeparator || '.';
        decimalSeparator = decimalSeparator || window.decimalSeparator || ',';
        if (amount === null || amount === undefined || amount === '') {
            return '0' + decimalSeparator + '00';
        }

        let num = parseFloat(amount);
        if (isNaN(num)) {
            return '0' + decimalSeparator + '00';
        }

        // Check if value is negative BEFORE using Math.abs()
        // This is critical for Credit Card refunds (negative amounts)
        const isNegative = num < 0;

        // Use absolute value to avoid issues with Math.floor and modulo for negative numbers
        let cents = Math.round(Math.abs(num) * 100);
        let integerPart = Math.floor(cents / 100).toString();
        let decimalPart = (cents % 100).toString().padStart(2, '0');

        // Add thousand separators
        integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator);

        // Format as "-5,00" for negative, "5,00" for positive
        // Negative sign goes BEFORE the number (no currency symbol in input field)
        return (isNegative ? '-' : '') + integerPart + decimalSeparator + decimalPart;
    }

    /**
     * Format currency for display
     * @param {number|string} amount - Amount to format
     * @param {string} currencySymbol - Currency symbol (default: 'R$')
     * @param {string} thousandSeparator - Thousand separator (default: '.')
     * @param {string} decimalSeparator - Decimal separator (default: ',')
     * @returns {string} Formatted currency string
     */
    function formatCurrency(amount, currencySymbol, thousandSeparator, decimalSeparator) {
        // Use window globals from template config if not provided
        currencySymbol = currencySymbol || window.currencySymbol || '$';
        thousandSeparator = thousandSeparator || window.thousandSeparator || '.';
        decimalSeparator = decimalSeparator || window.decimalSeparator || ',';
        const num = parseFloat(amount);
        if (isNaN(num)) return amount;

        // Check if value is negative BEFORE using Math.abs()
        const isNegative = num < 0;

        // Use absolute value to avoid issues with Math.floor and modulo for negative numbers
        const absCents = Math.round(Math.abs(num) * 100);
        const integerPart = Math.floor(absCents / 100).toString();
        const decimalPart = (absCents % 100).toString().padStart(2, '0');

        // Add thousand separators
        const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSeparator);

        // Format as "CA$ -5,00" for negative, "CA$ 5,00" for positive
        return currencySymbol + ' ' + (isNegative ? '-' : '') + formattedInteger + decimalSeparator + decimalPart;
    }

    // ========== INPUT FOCUS/CURSOR UTILITIES ==========

    /**
     * Initialize money input fields with proper event handling
     * Rule: First focus -> Cursor to end. Subsequent clicks -> Free movement.
     */
    function initializeMoneyInputs(selector, thousandSeparator, decimalSeparator) {
        // Use window globals from template config if not provided
        thousandSeparator = thousandSeparator || window.thousandSeparator || '.';
        decimalSeparator = decimalSeparator || window.decimalSeparator || ',';
        const initKey = 'data-money-init-' + selector.replace(/[^a-zA-Z0-9]/g, '_');
        if (document.body.hasAttribute(initKey)) return;
        document.body.setAttribute(initKey, 'true');

        // Helper to capture cursor state before any modification
        const captureBeforeState = (input) => {
            input.setAttribute('data-before-cursor', input.selectionStart.toString());
            input.setAttribute('data-before-value', input.value);
        };

        // Capture state on keydown (fires before value changes)
        document.addEventListener('keydown', function(event) {
            if (event.target.matches(selector)) {
                captureBeforeState(event.target);

                // Also handle key filtering
                // Allow: backspace, delete, tab, escape, enter, home, end, arrows
                const allowedKeys = [8, 46, 9, 27, 13, 35, 36, 37, 38, 39, 40];
                if (allowedKeys.includes(event.keyCode)) return;

                // Allow: Ctrl/Cmd combinations
                if (event.ctrlKey || event.metaKey) return;

                // Allow: Numbers
                if ((event.keyCode >= 48 && event.keyCode <= 57) ||
                    (event.keyCode >= 96 && event.keyCode <= 105)) return;

                // Allow: Negative sign at the start of field (for credit card refunds)
                if (event.key === '-') {
                    const input = event.target;
                    const cursorPos = input.selectionStart;
                    const hasNegativeSign = input.value.startsWith('-');
                    const startPos = hasNegativeSign ? 1 : 0;
                    // Allow minus if cursor is at start position
                    if (cursorPos === startPos) {
                        return; // Let the minus sign through
                    }
                }

                // Allow: Calculator operators when FinancesCalculator is available
                // This lets the calculator module handle +, -, *, /, (, )
                if (window.FinancesCalculator && ['+', '-', '*', '/', '(', ')'].includes(event.key)) {
                    return; // Let calculator handle it
                }

                event.preventDefault();
            }
        });

        // Capture state on touchstart (for mobile touch before keyboard input)
        document.addEventListener('touchstart', function(event) {
            if (event.target.matches(selector)) {
                captureBeforeState(event.target);
            }
        }, { passive: true });

        // Also capture on mousedown for desktop clicks
        document.addEventListener('mousedown', function(event) {
            if (event.target.matches(selector)) {
                captureBeforeState(event.target);
            }
        });

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
                // Capture state on focus too
                captureBeforeState(input);

                // If this is the FIRST focus (or we returned from blur), move to end.
                // We depend on 'blur' clearing the flag.
                if (!input.hasAttribute('data-has-focused')) {
                    input.setAttribute('data-has-focused', 'true');

                    // Force cursor to end on initial entry
                    // Use setTimeout to override browser default selection behavior on focus
                    setTimeout(() => {
                        const len = input.value.length;
                        input.setSelectionRange(len, len);
                        // Update before state after focus positioning
                        captureBeforeState(input);
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
        parseLocaleNumber: parseLocaleNumber,
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
    window.parseLocaleNumber = parseLocaleNumber;
    window.applyMoneyMask = applyMoneyMask;
    window.formatAmountForInput = formatAmountForInput;
    window.formatCurrency = formatCurrency;
    window.initializeMoneyInputs = initializeMoneyInputs;
    window.initializeCursorPositioning = initializeCursorPositioning;
    window.showSuccessMessage = showSuccessMessage;
    window.showErrorMessage = showErrorMessage;

    console.log('[FinancesUtils] Utility functions loaded successfully (v20260219-5)');

})();
