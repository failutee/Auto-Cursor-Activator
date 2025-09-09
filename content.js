'use strict';

const SELECTORS = {
    CARD_NUMBER: '#cardNumber',
    CARD_EXPIRY: '#cardExpiry',
    CARD_CVC: '#cardCvc',
    SUBMIT_BUTTON: 'button[type="submit"]',
    CARD_SECTION_TOGGLE: '[data-testid="card-accordion-item-button"], [data-test="card-accordion-item-button"]',
};

const PANEL_IDS = {
    PANEL: 'auto-cursor-activation-panel',
    COUNT: 'auto-cursor-activation-count',
    FILL: 'auto-cursor-activation-bar-fill',
    STATUS: 'auto-cursor-activation-status',
    CONTINUE: 'auto-cursor-activation-continue'
};

const state = {
    isRunning: false,
    cards: [],
    total: 0,
    processed: 0,
    gatedFirstSubmit: false
};

function ensurePanel() {
    let panel = document.getElementById(PANEL_IDS.PANEL);

    if (panel) {
        return panel;
    }

    panel = document.createElement('div');
    panel.id = PANEL_IDS.PANEL;
    panel.className = 'auto-cursor-activation-panel';
    panel.innerHTML = `
        <div class="auto-cursor-activation-header">
            <span>Activation</span>
            <button class="auto-cursor-activation-close" aria-label="Close">×</button>
        </div>
        <div class="auto-cursor-activation-body">
            <div id="${PANEL_IDS.COUNT}" class="auto-cursor-activation-count">Checked: 0 / 0</div>
            <div class="auto-cursor-activation-bar">
                <div id="${PANEL_IDS.FILL}" class="auto-cursor-activation-bar-fill"></div>
            </div>
            <div id="${PANEL_IDS.STATUS}" class="auto-cursor-activation-status">Waiting...</div>
            <div style="display:flex;justify-content:flex-end;">
                <button id="${PANEL_IDS.CONTINUE}" style="display:none;margin-top:6px;padding:6px 10px;border-radius:8px;border:1px solid #2a2a2a;background:#1a1a1a;color:#eaeaea;cursor:pointer;">Continue</button>
            </div>
        </div>
    `;

    document.body.appendChild(panel);

    panel.querySelector('.auto-cursor-activation-close').addEventListener('click', () => {
        panel.remove();
    });

    const continueBtn = panel.querySelector(`#${PANEL_IDS.CONTINUE}`);
    continueBtn.addEventListener('click', async () => {
        continueBtn.disabled = true;
        await onContinueClicked();
        continueBtn.disabled = false;
    });

    return panel;
}

function updatePanel(nextProcessed, nextTotal, statusText) {
    state.processed = Math.max(0, nextProcessed | 0);
    state.total = Math.max(0, nextTotal | 0);

    const panel = ensurePanel();
    const countEl = panel.querySelector(`#${PANEL_IDS.COUNT}`);
    const fillEl = panel.querySelector(`#${PANEL_IDS.FILL}`);
    const statusEl = panel.querySelector(`#${PANEL_IDS.STATUS}`);

    if (countEl) {
        const displayCount = Math.min(state.processed + 1, state.total || 0);
        countEl.textContent = `Checked: ${displayCount} / ${state.total}`;
    }

    const percent = state.total > 0 ?
        Math.min(100, Math.round(((state.processed + 1) / state.total) * 100)) : 0;

    if (fillEl) {
        fillEl.style.width = `${percent}%`;
    }

    if (statusEl && typeof statusText === 'string') {
        statusEl.textContent = statusText;
    }
}

function setContinueVisible(visible) {
    const panel = ensurePanel();
    const btn = panel.querySelector(`#${PANEL_IDS.CONTINUE}`);

    if (btn) {
        btn.style.display = visible ? 'inline-block' : 'none';
    }
}

function showIncompleteFieldsPrompt() {
    updatePanel(state.processed, state.total, 'Please complete all fields. Then press Continue.');
    setContinueVisible(true);
}

function showWaitingForStripe() {
    updatePanel(state.processed, state.total, 'Waiting for Stripe...');
    setContinueVisible(false);
}

async function handlePostSubmitValidation() {
    const valid = await checkFormValidity();
    if (!valid) {
        showIncompleteFieldsPrompt();
        return false;
    }
    showWaitingForStripe();
    return true;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function pad2(value) {
    const stringValue = String(value || '').trim();

    if (stringValue.length === 1) {
        return `0${stringValue}`;
    }

    return stringValue.slice(-2);
}

function yy(year) {
    const stringValue = String(year || '').trim();

    if (stringValue.length >= 2) {
        return stringValue.slice(-2);
    }

    return pad2(stringValue);
}

function parseCards(rawText) {
    if (!rawText) {
        return [];
    }

    const lines = String(rawText).split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    return lines.map(line => {
        const parts = line.split('|').map(part => (part || '').trim());

        if (parts.length < 4) {
            return null;
        }

        const [number, month, year, cvc] = parts;

        return {
            number: (number || '').replace(/\s+/g, ''),
            month: pad2(month),
            year: yy(year),
            cvc: cvc || ''
        };
    }).filter(Boolean);
}

function setValue(input, value) {
    if (!input) {
        return;
    }

    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function waitForElement(selector, timeout = 3000) {
    return new Promise(resolve => {
        const interval = 100;
        let elapsed = 0;

        const timer = setInterval(() => {
            const el = document.querySelector(selector);

            if (el) {
                clearInterval(timer);
                resolve(el);
                return;
            }

            elapsed += interval;

            if (elapsed >= timeout) {
                clearInterval(timer);
                resolve(null);
            }
        }, interval);
    });
}

async function ensureInputsPresent() {
    const has = () => {
        return document.querySelector(SELECTORS.CARD_NUMBER) &&
            document.querySelector(SELECTORS.CARD_EXPIRY) &&
            document.querySelector(SELECTORS.CARD_CVC);
    };

    if (has()) {
        return true;
    }

    const openBtn = document.querySelector(SELECTORS.CARD_SECTION_TOGGLE);

    if (openBtn) {
        try {
            openBtn.click();
            updatePanel(state.processed, state.total, 'Clicked to open card section');
        } catch (_) { }
    }

    for (let i = 0; i < 40; i++) {
        if (has()) {
            return true;
        }

        await sleep(100);
    }

    return has();
}

function fillCard(card) {
    if (!card) {
        return false;
    }

    updatePanel(state.processed, state.total, 'Filling card fields...');

    setValue(document.querySelector(SELECTORS.CARD_NUMBER), card.number);
    setValue(document.querySelector(SELECTORS.CARD_EXPIRY), `${card.month} / ${card.year}`);
    setValue(document.querySelector(SELECTORS.CARD_CVC), card.cvc);

    return true;
}

async function clickSubmit() {
    updatePanel(state.processed, state.total, 'Submitting...');

    await sleep(150);

    let submitButton = document.querySelector(SELECTORS.SUBMIT_BUTTON);

    for (let i = 0; i < 20; i++) {
        if (submitButton &&
            !submitButton.disabled &&
            submitButton.getAttribute('aria-disabled') !== 'true') {
            break;
        }

        await sleep(100);
        submitButton = document.querySelector(SELECTORS.SUBMIT_BUTTON);
    }

    if (submitButton &&
        !submitButton.disabled &&
        submitButton.getAttribute('aria-disabled') !== 'true') {
        try {
            submitButton.click();
            return true;
        } catch (error) {
            console.error('[Extension] Submit button click failed:', error);
        }
    }

    return false;
}

async function checkFormValidity() {
    const requiredSelectors = [
        '#billingName',
        '#billingAddressLine1',
        '#billingPostalCode',
        '#billingLocality'
    ];

    await waitForElement(requiredSelectors[requiredSelectors.length - 1]);

    for (const selector of requiredSelectors) {
        const element = document.querySelector(selector);

        if (!element) {
            console.warn(`[Extension] Validity check failed: selector not found: ${selector}`);
            return false;
        }

        if (element.getAttribute('aria-invalid') === 'true') {
            console.log(`[Extension] Validity check failed: ${selector} is invalid.`);
            return false;
        }
    }

    return true;
}

async function onContinueClicked() {
    let valid = await checkFormValidity();

    if (!valid) {
        showIncompleteFieldsPrompt();
        return;
    }

    setContinueVisible(false);
    await clickSubmit();

    valid = await checkFormValidity();

    if (!valid) {
        showIncompleteFieldsPrompt();
        return;
    }

    showWaitingForStripe();
}

async function startActivation(text) {
    if (state.isRunning) {
        return {
            ok: true,
            alreadyStarted: true,
            total: state.total
        };
    }

    state.cards = parseCards(text);
    state.total = state.cards.length;
    state.processed = 0;

    ensurePanel();
    updatePanel(state.processed, state.total, state.total ? 'Starting...' : 'No cards found');

    if (state.total === 0) {
        return { ok: true, total: 0 };
    }

    const inputsArePresent = await ensureInputsPresent();

    if (!inputsArePresent) {
        updatePanel(state.processed, state.total, 'Card inputs not found');
        return { ok: false, reason: 'inputs-missing' };
    }

    if (fillCard(state.cards[0])) {
        state.isRunning = true;
        await clickSubmit();

        const valid = await checkFormValidity();

        if (!valid) {
            showIncompleteFieldsPrompt();
            return { ok: true, total: state.total, filled: true };
        }

        showWaitingForStripe();
        return { ok: true, total: state.total, filled: true };
    }

    updatePanel(state.processed, state.total, 'First card fill failed');
    return { ok: false, filled: false };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) {
        return true;
    }

    switch (msg.type) {
        case 'activation-begin':
            (async () => {
                if (state.isRunning) {
                    sendResponse({
                        ok: true,
                        alreadyStarted: true,
                        total: state.total
                    });
                    return;
                }

                state.cards = parseCards(msg.payload && msg.payload.text);
                state.total = state.cards.length;
                state.processed = 0;

                ensurePanel();
                updatePanel(state.processed, state.total, state.total ? 'Starting...' : 'No cards found');

                if (!state.total) {
                    sendResponse({ ok: true, total: 0 });
                    return;
                }

                const inputsOk = await ensureInputsPresent();

                if (!inputsOk) {
                    updatePanel(0, state.total, 'Card inputs not found');
                    sendResponse({ ok: false });
                    return;
                }

                const filled = fillCard(state.cards[0]);
                state.isRunning = filled;
                updatePanel(0, state.total, filled ? 'First card filled' : 'Fill failed');

                if (filled) {
                    await clickSubmit();
                    await handlePostSubmitValidation();
                    sendResponse({ ok: true, total: state.total, filled: true });
                }
                else {
                    sendResponse({ ok: false, filled: false });
                }
            })();
            return true;

        case 'activation-status':
            sendResponse({
                ok: true,
                running: state.isRunning,
                total: state.total,
                processed: state.processed
            });
            return true;

        case 'stripe-response':
            if (!state.isRunning) {
                return true;
            }

            const status = Number(msg.statusCode || 0);

            if (status === 200) {
                updatePanel(state.processed, state.total, 'Stripe OK - activation success');
                state.isRunning = false;
                return true;
            }

            updatePanel(state.processed, state.total, `Stripe failed (${status || 'error'})`);

            (async () => {
                await sleep(400);

                if (state.processed + 1 >= state.total) {
                    updatePanel(state.processed, state.total, 'All cards tried and failed.');
                    state.isRunning = false;
                    return;
                }

                state.processed += 1;
                updatePanel(state.processed, state.total, `Loading card ${state.processed + 1}...`);

                if (fillCard(state.cards[state.processed])) {
                    await clickSubmit();
                }
                else {
                    updatePanel(state.processed, state.total, 'Failed to load next card');
                    state.isRunning = false;
                }
            })();

            return true;
    }

    return true;
});