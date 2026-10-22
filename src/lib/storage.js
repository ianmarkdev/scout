/**
 * Extension storage. Settings (Career Engine address + API token) live in chrome.storage.local,
 * which only this extension can read, but which anyone or any program with access to this
 * browser profile can extract: hence a narrow, expiring, revocable token. Unsaved popup edits
 * are kept in chrome.storage.session (memory only, cleared when the browser closes).
 *
 * @typedef {{ baseUrl: string, token: string }} Settings
 */

const SETTINGS_KEY = 'settings';
const DRAFT_PREFIX = 'draft:';

/**
 * @param {chrome.storage.StorageArea} area
 * @returns {Promise<Settings>}
 */
export async function loadSettings(area) {
    const stored = (await area.get(SETTINGS_KEY))[SETTINGS_KEY] ?? {};

    return {
        baseUrl: typeof stored.baseUrl === 'string' ? stored.baseUrl : '',
        token: typeof stored.token === 'string' ? stored.token : '',
    };
}

/**
 * @param {chrome.storage.StorageArea} area
 * @param {Settings} settings
 */
export async function saveSettings(area, settings) {
    await area.set({ [SETTINGS_KEY]: { baseUrl: settings.baseUrl, token: settings.token } });
}

/**
 * Sanctum personal access tokens look like "12|40+ random characters".
 * @param {string} token
 */
export function looksLikeToken(token) {
    return /^\d+\|[A-Za-z0-9]{40,}$/.test(token.trim());
}

/**
 * @param {chrome.storage.StorageArea} area
 * @param {string} pageUrl
 * @returns {Promise<{ form: import('./form.js').JobForm, method: string, savedAt: string } | null>}
 */
export async function loadDraft(area, pageUrl) {
    const key = DRAFT_PREFIX + pageUrl;
    const draft = (await area.get(key))[key];

    return draft && typeof draft === 'object' && draft.form ? draft : null;
}

/**
 * @param {chrome.storage.StorageArea} area
 * @param {string} pageUrl
 * @param {{ form: import('./form.js').JobForm, method: string }} draft
 */
export async function saveDraft(area, pageUrl, draft) {
    await area.set({ [DRAFT_PREFIX + pageUrl]: { ...draft, savedAt: new Date().toISOString() } });
}

/**
 * @param {chrome.storage.StorageArea} area
 * @param {string} pageUrl
 */
export async function clearDraft(area, pageUrl) {
    await area.remove(DRAFT_PREFIX + pageUrl);
}
