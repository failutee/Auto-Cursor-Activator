async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs.length ? tabs[0] : null;
}

function isAllowedTab(tab) {
    if (!tab) return false;
    const url = tab.url || '';
    const title = (tab.title || '').trim();
    const urlOk = /^https?:\/\/checkout\.stripe\.com/.test(url);
    const titleOk = title === 'Cursor';
    return urlOk && titleOk;
}

async function startActivation() {
    const textarea = document.getElementById('activationText');
    const text = textarea ? textarea.value.trim() : '';
    const statusEl = document.getElementById('activationStatus');

    function showStatus(message, isError = false) {
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.style.color = isError ? '#ff9f9f' : '#a0ffa0';
            statusEl.style.whiteSpace = 'pre-line';
            statusEl.style.display = 'block';
        }
    }

    function validateAndNormalize(raw) {
        const lines = String(raw || '')
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(Boolean);

        if (!lines.length) {
            return { ok: false, errors: ['No input provided.'] };
        }

        const errors = [];
        const normalized = [];

        lines.forEach((line, idx) => {
            const n = idx + 1;
            const parts = line.split('|').map(p => (p || '').trim());
            if (parts.length !== 4) {
                errors.push(`Line ${n}: expected format "NUMBER|MM|YYYY|CVC".`);
                return;
            }

            let [num, mm, yyyy, cvc] = parts;

            num = (num || '').replace(/\s+/g, '');

            if (!/^\d{16}$/.test(num)) {
                errors.push(`Line ${n}: card number must be exactly 16 digits.`);
            }

            if (!/^\d{2}$/.test(mm) || Number(mm) < 1 || Number(mm) > 12) {
                errors.push(`Line ${n}: month must be in 01–12.`);
            }

            if (!/^\d{4}$/.test(yyyy)) {
                errors.push(`Line ${n}: year must be 4 digits (e.g., 2030).`);
            }

            if (!/^\d{3}$/.test(cvc)) {
                errors.push(`Line ${n}: CVC must be exactly 3 digits.`);
            }

            normalized.push([num, mm, yyyy, cvc].join('|'));
        });

        if (errors.length) {
            return { ok: false, errors };
        }

        return { ok: true, text: normalized.join('\n') };
    }

    try {
        const activeTab = await getActiveTab();
        if (!isAllowedTab(activeTab)) {
            showStatus('This is not Cursor checkout page.', true);
            return;
        }

        const status = await chrome.tabs.sendMessage(activeTab.id, { type: 'activation-status' });

        if (status && status.ok && status.running) {
            showStatus('Activation already started in this tab.');
            return;
        }

        const result = validateAndNormalize(text);

        if (!result.ok) {
            showStatus(result.errors.join('\n'), true);
            return;
        }

        const response = await chrome.tabs.sendMessage(activeTab.id, { type: 'activation-begin', payload: { text: result.text } });

        if (response && response.ok) {
            showStatus('Activation started in this tab.');
        } else {
            showStatus('Failed to start activation. Is the page ready?', true);
        }
    } catch (e) {
        console.error('Activation error:', e);
        showStatus('An error occurred. Check the console and reload the page.', true);
    }
}

document.getElementById('startActivation').addEventListener('click', startActivation);

document.addEventListener('DOMContentLoaded', async () => {
    const startBtn = document.getElementById('startActivation');
    const statusEl = document.getElementById('activationStatus');
    try {
        const activeTab = await getActiveTab();
        const allowed = isAllowedTab(activeTab);
        if (startBtn) startBtn.disabled = !allowed;
        if (!allowed && statusEl) {
            statusEl.textContent = 'You cannot start activation on this page. Go to Cursor Checkout Page.';
            statusEl.style.color = '#ff9f9f';
            statusEl.style.display = 'block';
        }
    } catch (_) { /* ignore */ }

    const animatedText = document.querySelector('.animated-text');

    if (animatedText) {
        const text = animatedText.textContent;
        animatedText.textContent = '';

        text.split('').forEach((char, index) => {
            const span = document.createElement('span');
            span.textContent = char === ' ' ? '\u00A0' : char;
            span.style.transitionDelay = `${index * 50}ms`;
            animatedText.appendChild(span);
        });

        setTimeout(() => {
            const spans = animatedText.querySelectorAll('span');
            spans.forEach(span => {
                span.style.opacity = '1';
                span.style.transform = 'translateY(0) scale(1)';
            });
        }, 100);
    }
});