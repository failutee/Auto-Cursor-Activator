'use strict';

const STRIPE_URL = 'https://api.stripe.com/v1/payment_methods';

async function sendStartToActiveTab(payload) {
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (activeTab && activeTab.id) {
            return await chrome.tabs.sendMessage(activeTab.id, { type: 'activation-begin', payload });
        }
    } catch (_) { }
}

async function forwardToActiveTab(message) {
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (activeTab && activeTab.id) {
            return await chrome.tabs.sendMessage(activeTab.id, message);
        }
    } catch (_) { }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === 'activation-begin') {
        (async () => {
            try {
                const resp = await sendStartToActiveTab(message.payload || {});
                sendResponse(resp || { ok: true });
            } catch (_) {
                sendResponse({ ok: false });
            }
        })();

        return true;
    }

    if (message.type === 'activation-status') {
        (async () => {
            try {
                const resp = await forwardToActiveTab({ type: 'activation-status' });
                sendResponse(resp || { ok: true, running: false });
            } catch (_) {
                sendResponse({ ok: false, running: false });
            }
        })();
        return true;
    }
});

chrome.webRequest.onCompleted.addListener(
    (details) => {
        const info = {
            url: details.url,
            method: details.method,
            type: details.type,
            statusCode: details.statusCode,
            tabId: details.tabId
        };

        console.log('Stripe Response Received:', info);

        if (typeof details.tabId === 'number' && details.tabId >= 0) {
            try {
                chrome.tabs.sendMessage(details.tabId, {
                    type: 'stripe-response',
                    statusCode: details.statusCode,
                    url: details.url
                });
            } catch (_) { }
        }
    },
    { urls: [STRIPE_URL] }
);

chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
        const info = {
            url: details.url,
            method: details.method,
            type: details.type,
            error: details.error,
            tabId: details.tabId
        };

        console.log('Stripe Request Error:', info);

        if (typeof details.tabId === 'number' && details.tabId >= 0) {
            try {
                chrome.tabs.sendMessage(details.tabId, {
                    type: 'stripe-response',
                    statusCode: 0,
                    error: details.error,
                    url: details.url
                });
            } catch (_) { }
        }
    },
    { urls: [STRIPE_URL] }
);


