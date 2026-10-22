/**
 * Settings page: the Career Engine address and API token. Saving asks Chrome for access to that
 * one origin only (optional host permission), and drops access to a previous address.
 */

import { describeResult, testConnection } from '../lib/api.js';
import { loadSettings, looksLikeToken, saveSettings } from '../lib/storage.js';
import { normalizeBaseUrl } from '../lib/url.js';

/**
 * @param {{ doc?: Document, chromeApi?: typeof chrome, fetchImpl?: typeof fetch }} [options]
 */
export function createOptions({ doc = document, chromeApi = chrome, fetchImpl = (...args) => fetch(...args) } = {}) {
    const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
    const form = /** @type {HTMLFormElement} */ ($('settings-form'));
    const baseUrlInput = /** @type {HTMLInputElement} */ ($('baseUrl'));
    const tokenInput = /** @type {HTMLInputElement} */ ($('token'));

    function showStatus(/** @type {string} */ tone, /** @type {string} */ title, detail = '') {
        const status = $('status');
        status.dataset.tone = tone;
        $('status-title').textContent = title;
        $('status-detail').textContent = detail;
        status.hidden = false;
    }

    function setErrors(/** @type {Record<string, string>} */ errors) {
        for (const el of Array.from(doc.querySelectorAll('[data-error-for]'))) {
            const name = el.getAttribute('data-error-for') ?? '';
            el.textContent = errors[name] ?? '';
            const input = name === 'baseUrl' ? baseUrlInput : tokenInput;

            if (errors[name]) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
        }
    }

    /** @param {string} origin */
    const pattern = (origin) => `${origin}/*`;

    async function save() {
        const normalized = normalizeBaseUrl(baseUrlInput.value);
        const token = tokenInput.value.trim();
        /** @type {Record<string, string>} */
        const errors = {};

        if (!normalized.ok) errors.baseUrl = normalized.error;
        if (token !== '' && !looksLikeToken(token)) errors.token = 'That does not look like a Career Engine token (it should look like 12|abc…, as printed by app:extension-token).';

        setErrors(errors);

        if (!normalized.ok || errors.token) {
            return false;
        }

        // Ask first: Chrome only shows the permission prompt during the click that asked for it.
        const granted = await chromeApi.permissions.request({ origins: [pattern(normalized.origin)] }).catch(() => false);
        const previous = await loadSettings(chromeApi.storage.local);

        await saveSettings(chromeApi.storage.local, { baseUrl: normalized.url, token });
        baseUrlInput.value = normalized.url;

        if (previous.baseUrl !== '') {
            const previousOrigin = new URL(previous.baseUrl).origin;

            if (previousOrigin !== normalized.origin) {
                await chromeApi.permissions.remove({ origins: [pattern(previousOrigin)] }).catch(() => false);
            }
        }

        if (!granted) {
            showStatus('error', 'Saved, but access was not granted.', `Career Clipper needs permission to contact ${normalized.origin}. Press “Save and allow access” again and choose Allow.`);

            return false;
        }

        showStatus('success', 'Saved.', token === '' ? 'Add an API token before saving jobs.' : 'Use “Test connection” to check the token.');

        return true;
    }

    async function test() {
        const settings = await loadSettings(chromeApi.storage.local);

        if (settings.baseUrl === '' || settings.token === '') {
            showStatus('error', 'Save the address and token first.');

            return null;
        }

        const origin = new URL(settings.baseUrl).origin;

        if (!(await chromeApi.permissions.contains({ origins: [pattern(origin)] }))) {
            showStatus('error', `No access to ${origin} yet.`, 'Press “Save and allow access” and choose Allow.');

            return null;
        }

        showStatus('info', 'Testing…');
        const result = await testConnection({ baseUrl: settings.baseUrl, token: settings.token, fetchImpl });

        // An empty request that reaches validation (422) has passed authentication.
        if (result.kind === 'validation') {
            showStatus('success', 'Connected.', `The address and token work. Nothing was saved.`);
        } else {
            const message = describeResult(result, settings.baseUrl);
            showStatus(message.tone, message.title, message.detail);
        }

        return result;
    }

    async function forget() {
        const settings = await loadSettings(chromeApi.storage.local);
        await saveSettings(chromeApi.storage.local, { baseUrl: settings.baseUrl, token: '' });
        tokenInput.value = '';
        showStatus('success', 'Token removed from this browser.', 'To make it unusable everywhere, also revoke it: php artisan app:extension-token you@example.com --revoke');
    }

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        void save();
    });
    $('test').addEventListener('click', () => void test());
    $('forget').addEventListener('click', () => void forget());
    $('show-token').addEventListener('change', (event) => {
        tokenInput.type = /** @type {HTMLInputElement} */ (event.target).checked ? 'text' : 'password';
    });

    const ready = loadSettings(chromeApi.storage.local).then((settings) => {
        baseUrlInput.value = settings.baseUrl;
        tokenInput.value = settings.token;
    });

    return { ready, save, test, forget };
}
