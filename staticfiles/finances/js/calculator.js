/**
 * calculator.js - Modal Calculator for Money Input Fields
 *
 * Provides advanced calculation mode when user types mathematical operators
 * in money input fields. Supports +, -, *, /, parentheses, and follows
 * proper order of operations (PEMDAS).
 *
 * Version: 20260219-10 - Fix premature warning display and remove hardcoded PT-BR text
 * Created: 2026-01-27
 */

(function() {
    'use strict';

    let modal = null;
    let currentInput = null;
    let thousandSep = '.';
    let decimalSep = ',';
    let viewportHandler = null;

    /**
     * Create the calculator modal if it doesn't exist
     */
    function createModal() {
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'calculator-modal';
        modal.className = 'fixed inset-0 z-50 hidden';
        modal.innerHTML = `
            <div class="fixed inset-0 bg-black/50 backdrop-blur-sm pointer-events-none"></div>
            <div class="fixed inset-0 flex items-center justify-center p-4" id="calc-container">
                <div class="absolute inset-0" data-calc-action="cancel"></div>
                <div class="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl z-10 transition-transform duration-150" id="calc-card" style="width: 100%; max-width: 24rem;">
                    <div class="p-4 border-b border-gray-200 dark:border-gray-700">
                        <h3 class="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            <span class="material-symbols-outlined text-primary">calculate</span>
                            <span data-i18n="calculator">Calculator</span>
                        </h3>
                    </div>
                    <div class="p-4 space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" data-i18n="expression">Expression</label>
                            <input type="text"
                                   id="calc-expression"
                                   class="w-full px-3 py-2 text-lg font-mono border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-primary"
                                   placeholder="Ex: 100+50*2"
                                   autocomplete="off"
                                   inputmode="decimal">
                        </div>
                        <div class="flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-700/50 rounded-lg">
                            <span class="text-sm text-gray-600 dark:text-gray-400" data-i18n="result">Result</span>
                            <span id="calc-result" class="text-xl font-bold text-primary font-mono">0,00</span>
                        </div>
                        <div id="calc-warning" class="hidden text-xs text-red-600 dark:text-red-500 font-medium p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                            <span data-i18n="negative-not-allowed">Negative values are not allowed for this type of FlowGroup</span>
                        </div>
                        <div class="text-xs text-gray-500 dark:text-gray-400">
                            <span data-i18n="calc-hint">Use +, -, *, / and parentheses. Press Enter to confirm.</span>
                        </div>
                    </div>
                    <div class="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
                        <button type="button"
                                data-calc-action="cancel"
                                class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors">
                            <span data-i18n="cancel">Cancel</span>
                        </button>
                        <button type="button"
                                data-calc-action="confirm"
                                class="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors">
                            <span data-i18n="ok">OK</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Event listeners
        const expressionInput = modal.querySelector('#calc-expression');

        // Real-time calculation on input
        expressionInput.addEventListener('input', function() {
            updateResult();
        });

        // Validate input - only allow valid characters and control decimal separator
        expressionInput.addEventListener('keydown', function(e) {
            // Allow: backspace, delete, tab, escape, enter, arrows, home, end
            if ([8, 46, 9, 27, 13, 37, 38, 39, 40, 35, 36].includes(e.keyCode)) {
                return;
            }

            // Allow: Ctrl/Cmd + A, C, V, X
            if ((e.ctrlKey || e.metaKey) && [65, 67, 86, 88].includes(e.keyCode)) {
                return;
            }

            // Allow: numbers (0-9)
            if ((e.keyCode >= 48 && e.keyCode <= 57) || (e.keyCode >= 96 && e.keyCode <= 105)) {
                return;
            }

            // Allow: operators +, -, *, /
            // + is Shift+= (keyCode 187 or 107 on numpad)
            // - is keyCode 189 or 109 on numpad
            // * is Shift+8 (keyCode 56) or 106 on numpad
            // / is keyCode 191 or 111 on numpad
            if (e.key === '+' || e.key === '-' || e.key === '*' || e.key === '/') {
                return;
            }

            // Allow: parentheses ( and )
            if (e.key === '(' || e.key === ')') {
                return;
            }

            // Allow: locale decimal separator (only if current number doesn't have one)
            if (e.key === decimalSep || e.key === '.' || e.key === ',') {
                // Check if we should allow decimal separator
                if (canAddDecimalSeparator(expressionInput.value, expressionInput.selectionStart)) {
                    // If user typed wrong separator, we'll convert it in the input handler
                    if (e.key !== decimalSep) {
                        e.preventDefault();
                        // Insert the correct decimal separator
                        const start = expressionInput.selectionStart;
                        const end = expressionInput.selectionEnd;
                        const value = expressionInput.value;
                        expressionInput.value = value.substring(0, start) + decimalSep + value.substring(end);
                        expressionInput.setSelectionRange(start + 1, start + 1);
                        updateResult();
                    }
                    return;
                } else {
                    e.preventDefault();
                    return;
                }
            }

            // Block everything else
            e.preventDefault();
        });

        // Handle Enter and Escape keys
        expressionInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmCalculation();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeModal();
            }
        });

        // Handle button clicks
        modal.addEventListener('click', function(e) {
            const action = e.target.closest('[data-calc-action]');
            if (!action) return;

            const actionType = action.dataset.calcAction;
            if (actionType === 'cancel') {
                closeModal();
            } else if (actionType === 'confirm') {
                confirmCalculation();
            }
        });

        return modal;
    }

    /**
     * Check if we can add a decimal separator at the current position
     * Only one decimal separator per number is allowed
     */
    function canAddDecimalSeparator(expression, cursorPos) {
        // Get the text before cursor
        const textBeforeCursor = expression.substring(0, cursorPos);

        // Find the start of the current number (after the last operator or start of string)
        let numberStart = 0;
        for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
            const char = textBeforeCursor[i];
            if ('+-*/('.includes(char)) {
                numberStart = i + 1;
                break;
            }
        }

        // Get the current number being typed (before cursor)
        const currentNumberBeforeCursor = textBeforeCursor.substring(numberStart);

        // Also check after cursor until next operator
        const textAfterCursor = expression.substring(cursorPos);
        let numberEnd = textAfterCursor.length;
        for (let i = 0; i < textAfterCursor.length; i++) {
            const char = textAfterCursor[i];
            if ('+-*/)'.includes(char)) {
                numberEnd = i;
                break;
            }
        }
        const currentNumberAfterCursor = textAfterCursor.substring(0, numberEnd);

        // Combine to get full current number
        const currentNumber = currentNumberBeforeCursor + currentNumberAfterCursor;

        // Check if this number already has a decimal separator
        const hasDecimal = currentNumber.includes(decimalSep) ||
                          currentNumber.includes('.') ||
                          currentNumber.includes(',');

        return !hasDecimal;
    }

    /**
     * Parse a number string with locale-aware decimal separator
     */
    function parseLocalNumber(str) {
        if (!str || str.trim() === '') return 0;
        // Replace thousand separator and convert decimal separator to dot
        let normalized = str.toString()
            .replace(new RegExp('\\' + thousandSep, 'g'), '')
            .replace(decimalSep, '.');
        const num = parseFloat(normalized);
        return isNaN(num) ? 0 : num;
    }

    /**
     * Format a number with locale-aware separators
     */
    function formatLocalNumber(num) {
        if (isNaN(num) || !isFinite(num)) return '0' + decimalSep + '00';

        const fixed = num.toFixed(2);
        const parts = fixed.split('.');
        const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousandSep);
        const result = intPart + decimalSep + parts[1];
        return result;
    }

    /**
     * Tokenize the expression into numbers and operators
     */
    function tokenize(expr) {
        const tokens = [];
        let current = '';
        let i = 0;

        // Normalize: replace locale decimal separator with dot for parsing
        expr = expr.replace(new RegExp('\\' + thousandSep, 'g'), '');
        expr = expr.replace(new RegExp('\\' + decimalSep, 'g'), '.');

        while (i < expr.length) {
            const char = expr[i];

            if (char === ' ') {
                i++;
                continue;
            }

            if ('0123456789.'.includes(char)) {
                current += char;
            } else if ('+-*/()'.includes(char)) {
                if (current !== '') {
                    tokens.push({ type: 'number', value: parseFloat(current) });
                    current = '';
                }
                // Handle negative numbers (minus at start or after operator/open paren)
                if (char === '-' && (tokens.length === 0 ||
                    tokens[tokens.length - 1].type === 'operator' ||
                    tokens[tokens.length - 1].value === '(')) {
                    current = '-';
                } else {
                    tokens.push({ type: char === '(' || char === ')' ? 'paren' : 'operator', value: char });
                }
            }
            i++;
        }

        if (current !== '') {
            tokens.push({ type: 'number', value: parseFloat(current) });
        }

        return tokens;
    }

    /**
     * Evaluate expression using Shunting Yard algorithm for proper operator precedence
     */
    function evaluate(expr) {
        try {
            const tokens = tokenize(expr);
            if (tokens.length === 0) return 0;

            const outputQueue = [];
            const operatorStack = [];

            const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };

            for (const token of tokens) {
                if (token.type === 'number') {
                    outputQueue.push(token.value);
                } else if (token.type === 'operator') {
                    while (operatorStack.length > 0) {
                        const top = operatorStack[operatorStack.length - 1];
                        if (top.type === 'operator' && precedence[top.value] >= precedence[token.value]) {
                            outputQueue.push(operatorStack.pop().value);
                        } else {
                            break;
                        }
                    }
                    operatorStack.push(token);
                } else if (token.value === '(') {
                    operatorStack.push(token);
                } else if (token.value === ')') {
                    while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1].value !== '(') {
                        outputQueue.push(operatorStack.pop().value);
                    }
                    if (operatorStack.length > 0) {
                        operatorStack.pop(); // Remove the '('
                    }
                }
            }

            while (operatorStack.length > 0) {
                outputQueue.push(operatorStack.pop().value);
            }

            // Evaluate RPN
            const evalStack = [];
            for (const item of outputQueue) {
                if (typeof item === 'number') {
                    evalStack.push(item);
                } else {
                    const b = evalStack.pop() || 0;
                    const a = evalStack.pop() || 0;
                    switch (item) {
                        case '+': evalStack.push(a + b); break;
                        case '-': evalStack.push(a - b); break;
                        case '*': evalStack.push(a * b); break;
                        case '/': evalStack.push(b !== 0 ? a / b : 0); break;
                    }
                }
            }

            return evalStack[0] || 0;
        } catch (e) {
            console.error('[Calculator] Evaluation error:', e);
            return 0;
        }
    }

    /**
     * Check if expression is complete (doesn't end with operator)
     */
    function isExpressionComplete(expr) {
        if (!expr || expr.trim() === '') return false;

        const trimmed = expr.trim();
        const lastChar = trimmed.charAt(trimmed.length - 1);

        // Expression is incomplete if it ends with an operator or space
        return !['+', '-', '*', '/', ' '].includes(lastChar);
    }

    /**
     * Update the result display
     */
    function updateResult() {
        const expressionInput = modal.querySelector('#calc-expression');
        const resultDisplay = modal.querySelector('#calc-result');
        const warningDisplay = modal.querySelector('#calc-warning');

        const expr = expressionInput.value;
        const result = evaluate(expr);
        resultDisplay.textContent = formatLocalNumber(result);

        // Only check for negative result if expression is complete
        const isComplete = isExpressionComplete(expr);
        const isCreditCard = window.FLOWGROUP_CONFIG?.isCreditCard || false;
        const isNegative = result < 0;

        // Show warning for negative results in non-CreditCard FlowGroups
        // Only show if expression is complete (not typing "5 - " yet)
        if (isNegative && !isCreditCard && isComplete) {
            resultDisplay.classList.add('text-red-600', 'dark:text-red-500');
            resultDisplay.classList.remove('text-primary');
            if (warningDisplay) {
                warningDisplay.classList.remove('hidden');
                warningDisplay.classList.add('text-red-600', 'dark:text-red-500');
            }
        } else {
            resultDisplay.classList.remove('text-red-600', 'dark:text-red-500');
            resultDisplay.classList.add('text-primary');
            if (warningDisplay) {
                warningDisplay.classList.add('hidden');
            }
        }
    }

    /**
     * Confirm the calculation and apply result to the original input
     */
    function confirmCalculation() {
        if (!currentInput) {
            closeModal();
            return;
        }

        // Store reference before closeModal sets it to null
        const targetInput = currentInput;

        const expressionInput = modal.querySelector('#calc-expression');
        const result = evaluate(expressionInput.value);

        console.log('[Calculator] confirmCalculation - expression:', expressionInput.value, 'result:', result);

        // Check if result is negative and FlowGroup is NOT CreditCard
        const isCreditCard = window.FLOWGROUP_CONFIG?.isCreditCard || false;
        const isNegative = result < 0;

        if (isNegative && !isCreditCard) {
            console.log('[Calculator] Negative result blocked - not a Credit Card FlowGroup');
            // Show error message
            if (window.FinancesUtils && window.FinancesUtils.showErrorMessage) {
                window.FinancesUtils.showErrorMessage(
                    window.FLOWGROUP_CONFIG?.i18n?.negativeNotAllowedForThisType ||
                    'Negative values are not allowed for this type of FlowGroup',
                    3000
                );
            }
            // Don't close the modal - let user correct the expression
            return;
        }

        // Format result for the money input
        const formattedResult = formatLocalNumber(result);

        console.log('[Calculator] confirmCalculation - formattedResult:', formattedResult);

        // Clear before-state attributes to avoid cursor positioning issues
        targetInput.removeAttribute('data-before-cursor');
        targetInput.removeAttribute('data-before-value');

        // Set the value
        targetInput.value = formattedResult;

        console.log('[Calculator] confirmCalculation - targetInput.value after set:', targetInput.value);

        // Trigger input event to apply money mask
        const event = new Event('input', { bubbles: true });
        targetInput.dispatchEvent(event);

        console.log('[Calculator] confirmCalculation - targetInput.value after input event:', targetInput.value);

        closeModal();

        // Focus back on the input
        targetInput.focus();
    }

    /**
     * Open the calculator modal
     */
    function openModal(input, initialValue, operator) {
        createModal();

        currentInput = input;

        // Get locale settings from window or page-specific config
        thousandSep = window.thousandSeparator || window.FLOWGROUP_CONFIG?.thousandSeparator || window.BANK_RECON_CONFIG?.thousandSeparator || window.DASHBOARD_CONFIG?.thousandSeparator || '.';
        decimalSep = window.decimalSeparator || window.FLOWGROUP_CONFIG?.decimalSeparator || window.BANK_RECON_CONFIG?.decimalSeparator || window.DASHBOARD_CONFIG?.decimalSeparator || ',';

        const expressionInput = modal.querySelector('#calc-expression');

        // Set initial expression: current value + operator
        let expr = initialValue || '0';
        if (operator) {
            expr += operator;
        }
        expressionInput.value = expr;

        // Show modal
        modal.classList.remove('hidden');

        // Listen for viewport changes (virtual keyboard open/close)
        if (window.visualViewport) {
            viewportHandler = adjustModalPosition;
            window.visualViewport.addEventListener('resize', viewportHandler);
            window.visualViewport.addEventListener('scroll', viewportHandler);
        }

        // Focus and position cursor at end
        setTimeout(() => {
            expressionInput.focus();
            expressionInput.setSelectionRange(expressionInput.value.length, expressionInput.value.length);
            updateResult();
            adjustModalPosition();
        }, 50);
    }

    /**
     * Close the calculator modal
     */
    function closeModal() {
        if (modal) {
            modal.classList.add('hidden');
            const card = modal.querySelector('#calc-card');
            if (card) card.style.transform = '';
        }
        // Remove viewport listeners
        if (viewportHandler && window.visualViewport) {
            window.visualViewport.removeEventListener('resize', viewportHandler);
            window.visualViewport.removeEventListener('scroll', viewportHandler);
            viewportHandler = null;
        }
        currentInput = null;
    }

    /**
     * Adjust modal position based on visible viewport (virtual keyboard awareness).
     * Uses window.visualViewport to detect how much space the keyboard occupies
     * and shifts the modal card upward so it stays fully visible.
     */
    function adjustModalPosition() {
        if (!modal) return;
        const card = modal.querySelector('#calc-card');
        if (!card) return;

        const vv = window.visualViewport;
        if (!vv) return;

        // How much the keyboard is covering (from the bottom)
        const keyboardHeight = window.innerHeight - vv.height - vv.offsetTop;

        if (keyboardHeight > 50) {
            // Keyboard is open — compute where the card needs to be
            const cardRect = card.getBoundingClientRect();
            const cardBottom = cardRect.top + cardRect.height;
            const visibleBottom = vv.height + vv.offsetTop;
            const overflow = cardBottom - visibleBottom + 16; // 16px breathing room

            if (overflow > 0) {
                card.style.transform = `translateY(-${overflow}px)`;
            } else {
                card.style.transform = '';
            }
        } else {
            // No keyboard — reset to centered
            card.style.transform = '';
        }
    }

    /**
     * Check if a key is a calculator operator
     */
    function isOperatorKey(key) {
        return ['+', '-', '*', '/', '(', ')'].includes(key);
    }

    /**
     * Check if current input value represents zero or is effectively empty
     * Used to determine if we should allow negative sign without opening calculator
     */
    function isEffectivelyZeroOrEmpty(value) {
        if (!value) return true;
        // Remove thousand separators and negative sign, check if value is zero
        const escapedSeparator = thousandSep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const normalized = value.replace(new RegExp(escapedSeparator, 'g'), '')
                                .replace(decimalSep, '.')
                                .replace(/^-/, '')  // Remove negative sign for zero check
                                .trim();
        if (normalized === '' || normalized === '.') return true;
        const num = parseFloat(normalized);
        return isNaN(num) || num === 0;
    }

    /**
     * Check if we should allow negative sign without opening calculator
     * Returns true if:
     * - Operator is minus (-)
     * - Current value is zero or empty, OR cursor is at start of field (user wants to enter negative value)
     */
    function shouldAllowNegativeSign(input, key) {
        if (key !== '-') return false;

        // Allow negative sign if value is effectively zero
        if (isEffectivelyZeroOrEmpty(input.value)) return true;

        // Also allow negative sign if cursor is at the start (position 0 or 1 after existing negative sign)
        // This allows user to start typing a negative value by pressing '-' at the beginning
        const cursorPos = input.selectionStart;
        const hasNegativeSign = input.value.startsWith('-');
        const startPos = hasNegativeSign ? 1 : 0;

        return cursorPos === startPos;
    }

    /**
     * Initialize calculator for money inputs
     * Call this to enable calculator mode on money input fields
     *
     * Logic:
     * - If user types - at the START of an empty/zero input, allow it (negative value)
     * - If user types any operator AFTER a value has been entered, open calculator
     */
    function initializeCalculator(selector) {
        // Prevent multiple initialization
        const initKey = 'data-calculator-init-' + selector.replace(/[^a-zA-Z0-9]/g, '_');
        if (document.body.hasAttribute(initKey)) {
            console.log('[Calculator] Already initialized for selector:', selector);
            return;
        }
        document.body.setAttribute(initKey, 'true');

        // Desktop: keydown fires reliably with e.key for physical keyboards
        document.addEventListener('keydown', function(e) {
            const input = e.target;
            if (!input.matches || !input.matches(selector)) return;

            if (isOperatorKey(e.key)) {
                console.log('[Calculator] Operator key pressed:', e.key, 'value:', input.value);
                // Special handling for minus sign at start
                if (shouldAllowNegativeSign(input, e.key)) {
                    console.log('[Calculator] Allowing negative sign, not opening calculator');
                    // If value is not zero/empty, clear it first so user can start fresh with negative value
                    if (!isEffectivelyZeroOrEmpty(input.value)) {
                        input.value = '';
                    }
                    // Allow the minus sign - don't open calculator
                    // The minus sign will be added by the browser's default behavior
                    return;
                }
                // For other operators or minus not at start, open calculator
                console.log('[Calculator] Opening calculator with:', input.value || '0');
                e.preventDefault();
                const currentValue = input.value || '0';
                openModal(input, currentValue, e.key);
            }
        });

        // Mobile (Android): virtual keyboards often fire keydown with
        // e.key='Unidentified'. The beforeinput event reliably provides
        // the character via e.data on all mobile browsers.
        document.addEventListener('beforeinput', function(e) {
            const input = e.target;
            if (!input.matches || !input.matches(selector)) return;

            if (e.data && isOperatorKey(e.data)) {
                console.log('[Calculator] beforeinput operator:', e.data, 'value:', input.value);
                // Special handling for minus sign at start
                if (shouldAllowNegativeSign(input, e.data)) {
                    console.log('[Calculator] beforeinput: Allowing negative sign');
                    // If value is not zero/empty, clear it first so user can start fresh with negative value
                    if (!isEffectivelyZeroOrEmpty(input.value)) {
                        input.value = '';
                    }
                    // Allow the minus sign - don't open calculator
                    return;
                }
                // For other operators or minus not at start, open calculator
                console.log('[Calculator] beforeinput: Opening calculator');
                e.preventDefault();
                const currentValue = input.value || '0';
                openModal(input, currentValue, e.data);
            }
        });

        console.log('[Calculator] Initialized for selector:', selector);
    }

    // Export to window
    window.FinancesCalculator = {
        init: initializeCalculator,
        open: openModal,
        close: closeModal,
        evaluate: evaluate,
        formatNumber: formatLocalNumber,
        parseNumber: parseLocalNumber
    };

    console.log('[Calculator] Module loaded (v20260219-3)');

})();
