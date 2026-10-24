/**
 * The side panel: reads the active tab when opened (only because the user clicked the extension)
 * and again whenever the user switches tab or the tab moves to another page, shows what was
 * found in an editable form, and sends it to Career Engine only when the user presses Save.
 * Unsaved edits are kept per page in session storage, so switching tab or closing the panel
 * loses nothing.
 *
 * Without the opt-in "all websites" access, only the tab the icon was clicked on can be read;
 * other tabs show a button that asks for it.
 */

import { snapshotPage } from '../content/snapshot.js';
import { METHOD_LABELS, extractJob } from '../extract/index.js';
import { describeResult, safeAppLink, saveApplication } from '../lib/api.js';
import { LIMITS, SERVER_FIELD_MAP, buildPayload, emptyForm, formFromExtraction, salaryTextFromFields, validateForm } from '../lib/form.js';
import { clearDraft, loadDraft, loadSettings, saveDraft } from '../lib/storage.js';
import { httpUrl, siteOf } from '../lib/url.js';

const FIELD_LABELS = {
    title: 'job title', company: 'company', location: 'location', description: 'description',
    salary: 'salary', employmentType: 'employment type',
};

const SOURCE_LABELS = { adapter: 'site', 'json-ld': 'JSON-LD', meta: 'meta', dom: 'page', fallback: 'guess' };

/** Extraction field → form field showing its source badge. */
const SOURCE_TARGETS = {
    title: 'title', company: 'company', location: 'location', workplaceType: 'workplaceType',
    employmentType: 'employmentType', salary: 'salaryText', description: 'description',
    postedAt: 'postedAt', deadline: 'deadline', externalId: 'externalId',
};

const SALARY_FIELDS = new Set(['salaryMin', 'salaryMax', 'salaryCurrency', 'salaryPeriod']);

/** The optional host access that lets the panel read whichever tab is active. */
export const ALL_SITES = ['http://*/*', 'https://*/*'];

/**
 * @param {{ doc?: Document, chromeApi?: typeof chrome, fetchImpl?: typeof fetch, now?: () => Date }} [options]
 */
export function createPopup({ doc = document, chromeApi = chrome, fetchImpl = (...args) => fetch(...args), now = () => new Date() } = {}) {
    const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
    const form = /** @type {HTMLFormElement} */ ($('job-form'));
    const saveButton = /** @type {HTMLButtonElement} */ ($('save'));
    const reextractButton = /** @type {HTMLButtonElement} */ ($('reextract'));
    const saveAnywayButton = /** @type {HTMLButtonElement} */ ($('save-anyway'));
    const inputs = /** @type {Record<string, HTMLInputElement>} */ (Object.fromEntries(
        Object.keys(emptyForm()).map((name) => [name, form.elements.namedItem(name)]),
    ));

    const state = {
        windowId: /** @type {number | null} */ (null),
        tabId: /** @type {number | null} */ (null),
        pageUrl: '',
        /** Bumped on every tab change, so a slow read of the previous tab is dropped. */
        generation: 0,
        pendingTab: /** @type {chrome.tabs.Tab | null} */ (null),
        method: 'manual',
        selection: '',
        dirty: false,
        saving: false,
        confirmDiscard: false,
        lastResult: /** @type {import('../lib/api.js').SaveResult | null} */ (null),
    };

    const readForm = () => /** @type {import('../lib/form.js').JobForm} */ (Object.fromEntries(Object.entries(inputs).map(([name, el]) => [name, el.value])));

    function writeForm(/** @type {Partial<import('../lib/form.js').JobForm>} */ values) {
        for (const [name, el] of Object.entries(inputs)) {
            el.value = values[/** @type {keyof typeof values} */ (name)] ?? '';
        }

        updateCount();
        setFieldErrors({});
    }

    function updateCount() {
        const length = inputs.description.value.trim().length;
        const count = $('description-count');
        count.textContent = `${length.toLocaleString('en-GB')} / ${LIMITS.description.toLocaleString('en-GB')} characters`;
        count.classList.toggle('over', length > LIMITS.description);
    }

    /**
     * @param {Record<string, string>} errors form field → message
     */
    function setFieldErrors(errors) {
        for (const el of Array.from(doc.querySelectorAll('[data-error-for]'))) {
            const name = el.getAttribute('data-error-for') ?? '';
            el.textContent = errors[name] ?? '';

            if (errors[name]) inputs[name]?.setAttribute('aria-invalid', 'true'); else inputs[name]?.removeAttribute('aria-invalid');
        }
    }

    /**
     * Shows one message. Messages about saving appear in the sticky footer, next to the Save
     * button the user just pressed; messages about the page appear above the form.
     *
     * @param {'success' | 'warning' | 'error' | 'info' | 'busy'} tone
     * @param {string} title
     * @param {string} [detail]
     * @param {{ link?: string, linkText?: string, saveAnyway?: boolean, settings?: boolean, allowSites?: boolean, list?: string[], nearSave?: boolean }} [extras]
     */
    function showStatus(tone, title, detail = '', extras = {}) {
        const status = $('status');

        if (extras.nearSave) {
            $('form-footer').prepend(status);
        } else if (status.parentElement !== form.parentElement) {
            form.parentElement?.prepend(status);
        }

        status.dataset.tone = tone;
        // Errors interrupt (role=alert); everything else is announced politely.
        status.setAttribute('role', tone === 'error' ? 'alert' : 'status');
        $('status-close').hidden = tone === 'busy';
        $('status-title').textContent = title;
        $('status-detail').textContent = detail;

        const list = $('status-list');
        list.replaceChildren(...(extras.list ?? []).map((item) => Object.assign(doc.createElement('li'), { textContent: item })));
        list.hidden = !extras.list?.length;

        const link = /** @type {HTMLAnchorElement} */ ($('status-link'));
        link.hidden = !extras.link;
        link.textContent = extras.linkText ?? 'Open in Career Engine';

        if (extras.link) link.href = extras.link; else link.removeAttribute('href');

        saveAnywayButton.hidden = !extras.saveAnyway;
        $('status-settings').hidden = !extras.settings;
        $('allow-sites').hidden = !extras.allowSites;
        status.hidden = false;

        // Replay the entrance so the same message shown twice still visibly changes.
        status.classList.remove('appear');
        void status.offsetWidth;
        status.classList.add('appear');
        status.scrollIntoView?.({ block: 'nearest' });
    }

    function hideStatus() {
        $('status').hidden = true;
    }

    /**
     * The Save button: `ready`; `saving` (spinner, and nothing else that saves or replaces the
     * form can be pressed); or `saved` (until the form is edited again, so a second click cannot
     * save a copy by accident).
     *
     * @param {'ready' | 'saving' | 'saved'} mode
     */
    function setSaveState(mode) {
        state.saving = mode === 'saving';
        saveButton.dataset.state = mode;
        saveButton.disabled = mode !== 'ready';
        saveButton.setAttribute('aria-busy', String(state.saving));
        saveAnywayButton.disabled = state.saving;
        reextractButton.disabled = state.saving;
        $('save-label').textContent = { ready: 'Save to Career Engine', saving: 'Saving…', saved: 'Saved ✓' }[mode];
    }

    /**
     * @param {string} method
     * @param {{ missing?: string[], warnings?: string[], sources?: Record<string, string>, note?: string }} info
     */
    function showExtraction(method, { missing = [], warnings = [], sources = {}, note = '' }) {
        $('extraction').hidden = false;
        $('method-line').textContent = note || (method === 'manual'
            ? 'No job details were found on this page. Fill in the form yourself.'
            : `Found using ${METHOD_LABELS[/** @type {keyof typeof METHOD_LABELS} */ (method)]}. Check the details before saving.`);

        const missingLine = $('missing-line');
        missingLine.hidden = missing.length === 0;
        missingLine.textContent = missing.length ? `Not found: ${missing.map((key) => FIELD_LABELS[/** @type {keyof typeof FIELD_LABELS} */ (key)] ?? key).join(', ')}.` : '';

        const list = $('warnings');
        list.replaceChildren(...warnings.map((text) => Object.assign(doc.createElement('li'), { textContent: text })));
        list.hidden = warnings.length === 0;

        for (const badge of Array.from(doc.querySelectorAll('[data-source-for]'))) {
            badge.textContent = '';
        }

        for (const [field, source] of Object.entries(sources)) {
            const target = SOURCE_TARGETS[/** @type {keyof typeof SOURCE_TARGETS} */ (field)];
            const badge = target ? doc.querySelector(`[data-source-for="${target}"]`) : null;

            if (badge) badge.textContent = SOURCE_LABELS[/** @type {keyof typeof SOURCE_LABELS} */ (source)] ?? source;
        }

        $('use-selection').hidden = state.selection.length < 20;
    }

    function resetDiscardConfirmation() {
        state.confirmDiscard = false;
        reextractButton.textContent = 'Re-extract';
    }

    async function persistDraft() {
        if (state.pageUrl === '') return;

        try {
            await saveDraft(chromeApi.storage.session, state.pageUrl, { form: readForm(), method: state.method });
        } catch {
            // Losing the draft copy is not worth interrupting the user for; the form still has the edits.
        }
    }

    async function extract() {
        const generation = state.generation;
        hideStatus();
        setSaveState('ready');
        resetDiscardConfirmation();
        $('method-line').textContent = 'Reading the page…';
        $('extraction').hidden = false;

        let snapshot;

        try {
            const results = await chromeApi.scripting.executeScript({ target: { tabId: /** @type {number} */ (state.tabId) }, func: snapshotPage });
            snapshot = results?.[0]?.result;

            if (!snapshot || typeof snapshot.html !== 'string') {
                throw new Error('The page returned nothing');
            }
        } catch (error) {
            if (generation !== state.generation) return;

            if (/permission|cannot access/i.test(String(error)) && !(await hasAllSites())) {
                showNeedsAccess();

                return;
            }

            state.method = 'manual';
            state.selection = '';
            writeForm({ url: state.pageUrl, source: siteOf(state.pageUrl) });
            showExtraction('manual', { note: 'This page could not be read. You can still fill in the form by hand.' });
            showStatus('error', 'Could not read this page.', `${error instanceof Error ? error.message : String(error)}. Some pages cannot be read by extensions (the Chrome Web Store, built-in PDF viewer, other extensions' pages). Reload the page and try again.`);

            return;
        }

        if (generation !== state.generation) return;

        let extraction;

        try {
            extraction = extractJob(snapshot);
        } catch (error) {
            state.method = 'manual';
            writeForm({ url: state.pageUrl, source: siteOf(state.pageUrl) });
            showExtraction('manual', { note: 'Extraction failed. Fill in the form by hand.' });
            showStatus('error', 'Could not extract the job details.', error instanceof Error ? error.message : String(error));

            return;
        }

        state.method = extraction.method;
        state.selection = extraction.selection;
        state.dirty = false;
        writeForm(formFromExtraction(extraction));

        if (inputs.url.value === '') inputs.url.value = state.pageUrl;
        if (inputs.source.value === '') inputs.source.value = siteOf(inputs.url.value);

        showExtraction(extraction.method, extraction);
    }

    /**
     * @param {boolean} allowDuplicate
     */
    async function save(allowDuplicate = false) {
        if (state.saving) return null;

        const values = readForm();
        const errors = validateForm(values);
        setFieldErrors(errors);

        if (Object.keys(errors).length > 0) {
            showStatus('error', 'Check the highlighted fields.', 'Nothing was sent.', { nearSave: true });
            inputs[Object.keys(errors)[0]]?.focus();

            return null;
        }

        // Respond to the click at once; the checks below and the request can take a moment.
        setSaveState('saving');
        showStatus('busy', allowDuplicate ? 'Saving a copy to Career Engine…' : 'Saving to Career Engine…', 'Keep this popup open until it finishes.', { nearSave: true });

        /** @type {import('../lib/api.js').SaveResult | null} */
        let result = null;
        let settings;

        try {
            settings = await loadSettings(chromeApi.storage.local);

            if (settings.baseUrl === '' || settings.token === '') {
                showStatus('error', 'Connect to Career Engine first.', 'Add the app address and an API token in Settings. Your edits are kept.', { settings: true, nearSave: true });

                return null;
            }

            const origin = new URL(settings.baseUrl).origin;

            if (!(await chromeApi.permissions.contains({ origins: [`${origin}/*`] }))) {
                showStatus('error', `Career Clipper may not contact ${origin} yet.`, 'Open Settings and press “Save and allow access”. Your edits are kept.', { settings: true, nearSave: true });

                return null;
            }

            result = await saveApplication({
                baseUrl: settings.baseUrl,
                token: settings.token,
                payload: buildPayload(values, { method: state.method, capturedAt: now().toISOString(), allowDuplicate }),
                fetchImpl,
            });
        } catch (error) {
            showStatus('error', 'Could not save.', `${error instanceof Error ? error.message : String(error)}. Your edits are kept.`, { settings: true, nearSave: true });

            return null;
        } finally {
            setSaveState(result?.kind === 'created' ? 'saved' : 'ready');

            if (state.pendingTab) {
                const tab = state.pendingTab;
                state.pendingTab = null;
                void showTab(tab);
            }
        }

        state.lastResult = result;
        const message = describeResult(result, settings.baseUrl);

        if (result.kind === 'created') {
            state.dirty = false;
            await clearDraft(chromeApi.storage.session, state.pageUrl).catch(() => {});
            showStatus('success', message.title, message.detail, { link: safeAppLink(result.application.url, settings.baseUrl), nearSave: true });
        } else if (result.kind === 'duplicate') {
            showStatus('warning', message.title, message.detail, { link: safeAppLink(result.existing?.url, settings.baseUrl), linkText: 'Open the saved one', saveAnyway: true, nearSave: true });
        } else if (result.kind === 'validation') {
            /** @type {Record<string, string>} */
            const fieldErrors = {};
            const other = [];

            for (const [key, messages] of Object.entries(result.errors)) {
                const field = SERVER_FIELD_MAP[/** @type {keyof typeof SERVER_FIELD_MAP} */ (key)];
                const text = Array.isArray(messages) ? messages.join(' ') : String(messages);

                if (field) fieldErrors[field] = text; else other.push(text);
            }

            setFieldErrors(fieldErrors);
            showStatus('error', message.title, other.length ? '' : message.detail, { list: other, nearSave: true });
        } else {
            showStatus(message.tone, message.title, message.detail, { settings: result.kind === 'unauthenticated' || result.kind === 'not_found' || result.kind === 'network', nearSave: true });
        }

        return result;
    }

    const hasAllSites = () => chromeApi.permissions.contains({ origins: ALL_SITES }).catch(() => false);

    function showNeedsAccess() {
        form.hidden = true;
        $('extraction').hidden = true;
        showStatus('info', 'Career Clipper cannot read this tab yet.', 'It can read the tab you clicked its icon on. To read every tab you switch to, allow it on all websites. It still reads a page only while this panel is open, and sends nothing until you press Save.', { allowSites: true });
    }

    /**
     * Point the panel at a tab: restore its unsaved edits, or read it.
     * @param {chrome.tabs.Tab | undefined} tab
     */
    async function showTab(tab) {
        state.generation += 1;
        state.tabId = null;
        state.pageUrl = '';
        state.dirty = false;
        state.lastResult = null;
        setSaveState('ready');
        resetDiscardConfirmation();
        hideStatus();

        if (tab && typeof tab.id === 'number' && tab.url === undefined && !(await hasAllSites())) {
            // Chrome hides the address of a tab the extension has no access to.
            showNeedsAccess();

            return;
        }

        if (!tab || typeof tab.id !== 'number' || !httpUrl(tab.url)) {
            form.hidden = true;
            $('extraction').hidden = true;
            showStatus('error', 'Open a job listing first.', 'Career Clipper reads ordinary web pages (http or https). It cannot read browser pages, the Chrome Web Store or local files.');

            return;
        }

        const generation = state.generation;
        state.tabId = tab.id;
        state.pageUrl = /** @type {string} */ (tab.url);
        form.hidden = false;

        const draft = await loadDraft(chromeApi.storage.session, state.pageUrl).catch(() => null);

        if (generation !== state.generation) return;

        if (draft) {
            state.method = draft.method;
            state.dirty = true;
            writeForm(draft.form);
            showExtraction(draft.method, { note: 'Restored your unsaved edits for this page. Press Re-extract to start over.' });
        } else {
            await extract();
        }
    }

    /** Follow the active tab of this window; a change during a save waits for it to finish. */
    function followTab(/** @type {chrome.tabs.Tab} */ tab) {
        if (tab.windowId !== state.windowId) return;

        if (state.saving) {
            state.pendingTab = tab;
        } else {
            void showTab(tab);
        }
    }

    async function currentTab() {
        const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });

        return tab;
    }

    async function init() {
        let tab;

        try {
            tab = await currentTab();
        } catch (error) {
            showStatus('error', 'Could not find the current tab.', error instanceof Error ? error.message : String(error));

            return;
        }

        state.windowId = tab?.windowId ?? null;
        await showTab(tab);

        const settings = await loadSettings(chromeApi.storage.local);

        if (settings.baseUrl === '' || settings.token === '') {
            showStatus('info', 'Not connected yet.', 'You can review the job now. Add the Career Engine address and API token in Settings before saving.', { settings: true });
        }
    }

    chromeApi.tabs.onActivated?.addListener(({ tabId, windowId }) => {
        if (windowId !== state.windowId) return;

        chromeApi.tabs.get(tabId).then(followTab, () => {});
    });

    chromeApi.tabs.onUpdated?.addListener((tabId, changeInfo, tab) => {
        // A new page in the tab being shown, including single-page sites changing the address.
        if (!tab.active || (changeInfo.url === undefined && changeInfo.status !== 'complete')) return;
        if (tabId === state.tabId && tab.url === state.pageUrl) return;

        followTab(tab);
    });

    $('allow-sites').addEventListener('click', async () => {
        const granted = await chromeApi.permissions.request({ origins: ALL_SITES }).catch(() => false);

        if (granted) {
            await showTab(await currentTab().catch(() => undefined));
        } else {
            showStatus('info', 'Access was not given.', 'Click the Career Clipper icon while on a job listing to read just that tab.');
        }
    });

    form.addEventListener('input', (event) => {
        const name = /** @type {HTMLInputElement} */ (event.target).name;
        state.dirty = true;
        resetDiscardConfirmation();

        if (SALARY_FIELDS.has(name)) {
            inputs.salaryText.value = salaryTextFromFields(readForm());
        }

        if (name === 'description') updateCount();

        const error = doc.querySelector(`[data-error-for="${name}"]`);

        if (error) {
            error.textContent = '';
            inputs[name]?.removeAttribute('aria-invalid');
        }

        if (saveButton.dataset.state === 'saved') setSaveState('ready');

        void persistDraft();
    });

    form.addEventListener('change', () => void persistDraft());

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        void save(false);
    });

    saveAnywayButton.addEventListener('click', () => void save(true));
    $('status-close').addEventListener('click', hideStatus);

    reextractButton.addEventListener('click', async () => {
        if (state.dirty && !state.confirmDiscard) {
            state.confirmDiscard = true;
            reextractButton.textContent = 'Discard edits?';

            return;
        }

        await clearDraft(chromeApi.storage.session, state.pageUrl).catch(() => {});
        await extract();
    });

    $('use-selection').addEventListener('click', () => {
        inputs.description.value = state.selection;
        state.dirty = true;
        if (saveButton.dataset.state === 'saved') setSaveState('ready');
        updateCount();
        void persistDraft();
    });

    const openSettings = () => void chromeApi.runtime.openOptionsPage();
    $('open-settings').addEventListener('click', openSettings);
    $('status-settings').addEventListener('click', openSettings);

    return { ready: init(), state, save, extract, readForm };
}
