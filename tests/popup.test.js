import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPopup } from '../src/popup/popup.js';
import { fakeChrome, flush, jsonFetch, loadPage, snapshotOf } from './helpers.js';

const base = 'http://127.0.0.1:8000';
const created = { data: { ulid: '01J', url: `${base}/applications/01J`, company_name: 'Northwind Payments', role_title: 'Senior Backend Engineer', stage: 'saved', deleted: false } };

const $ = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (document.getElementById(id));

function type(/** @type {string} */ id, /** @type {string} */ value) {
    $(id).value = value;
    $(id).dispatchEvent(new Event('input', { bubbles: true }));
}

async function openPopup(chromeOptions = {}, fetchImpl = jsonFetch(201, created)) {
    const chromeApi = fakeChrome({ snapshot: snapshotOf('jsonld-full.html'), ...chromeOptions });
    const popup = createPopup({ doc: document, chromeApi: /** @type {any} */ (chromeApi), fetchImpl, now: () => new Date('2026-10-22T10:00:00Z') });
    await popup.ready;

    return { popup, chromeApi, fetchImpl };
}

const statusText = () => `${$('status-title').textContent} ${$('status-detail').textContent}`;

beforeEach(() => {
    loadPage('popup/popup.html');
});

describe('showing the extracted job', () => {
    test('fills the form with what was found, with sources', async () => {
        const { chromeApi } = await openPopup();

        expect($('title').value).toBe('Senior Backend Engineer');
        expect($('company').value).toBe('Northwind Payments');
        expect($('location').value).toBe('London, England, GB');
        expect($('employmentType').value).toBe('full_time');
        expect($('salaryText').value).toBe('GBP 70,000–85,000 / year');
        expect($('deadline').value).toBe('2026-11-30');
        expect($('description').value).toContain('- 5+ years of PHP');
        expect($('description-count').textContent).toContain('/ 50,000 characters');
        expect($('method-line').textContent).toContain('structured data (JSON-LD)');
        expect(document.querySelector('[data-source-for="title"]')?.textContent).toBe('JSON-LD');
        expect($('missing-line').hidden).toBe(true);
        expect(chromeApi.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 7 } }));
    });

    test('opening the popup never sends anything', async () => {
        const { fetchImpl } = await openPopup();

        expect(fetchImpl).not.toHaveBeenCalled();
    });

    test('says which fields were not found and leaves them empty', async () => {
        await openPopup({ snapshot: snapshotOf('bare.html', 'https://charity.example.org/jobs/support') });

        expect($('company').value).toBe('');
        expect($('missing-line').hidden).toBe(false);
        expect($('missing-line').textContent).toBe('Not found: company, location, employment type.');
    });

    test('an unreadable page shows an error and an empty form for manual entry', async () => {
        await openPopup({ executeError: new Error('Cannot access contents of the page') });

        expect($('status').dataset.tone).toBe('error');
        expect(statusText()).toContain('Cannot access contents of the page');
        expect($('job-form').hidden).toBe(false);
        expect($('url').value).toBe('https://jobs.example.com/northwind/123');
        expect($('title').value).toBe('');
    });

    test('an empty result from the page is handled like a failure', async () => {
        await openPopup({ snapshot: null });

        expect(statusText()).toContain('Could not read this page');
    });

    test('browser pages cannot be captured', async () => {
        const { chromeApi } = await openPopup({ tabUrl: 'chrome://extensions/' });

        expect(statusText()).toContain('Open a job listing first');
        expect($('job-form').hidden).toBe(true);
        expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled();
    });

    test('offers the selected text as the description', async () => {
        const selection = 'The full description the user selected on the page, longer than twenty characters.';
        await openPopup({ snapshot: snapshotOf('meta-only.html', 'https://www.linkedin.example/jobs/view/987654', { selection }) });

        expect($('use-selection').hidden).toBe(false);
        $('use-selection').click();
        expect($('description').value).toBe(selection);
    });
});

describe('editing and saving', () => {
    test('sends the edited values only after Save is pressed', async () => {
        const { fetchImpl, chromeApi } = await openPopup();

        type('title', 'Lead Backend Engineer');
        type('salaryMin', '75000');
        expect($('salaryText').value).toBe('GBP 75,000–85,000 / year');
        expect(fetchImpl).not.toHaveBeenCalled();

        $('job-form').requestSubmit();
        await flush();

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(body).toMatchObject({
            role_title: 'Lead Backend Engineer',
            company_name: 'Northwind Payments',
            salary_text: 'GBP 75,000–85,000 / year',
            capture: { method: 'json-ld', external_id: 'REQ-123', salary: { min: 75000, max: 85000, currency: 'GBP', period: 'year' }, captured_at: '2026-10-22T10:00:00.000Z' },
            allow_duplicate: false,
        });
        expect($('status').dataset.tone).toBe('success');
        expect(/** @type {HTMLAnchorElement} */ ($('status-link')).href).toBe(`${base}/applications/01J`);
        expect(chromeApi.storage.session.data).toEqual({});
    });

    test('missing required fields are flagged and nothing is sent', async () => {
        const { fetchImpl } = await openPopup({ snapshot: snapshotOf('bare.html', 'https://charity.example.org/jobs/support') });
        type('title', '');

        $('job-form').requestSubmit();
        await flush();

        expect(fetchImpl).not.toHaveBeenCalled();
        expect(document.querySelector('[data-error-for="title"]')?.textContent).toBe('Enter the job title.');
        expect($('title').getAttribute('aria-invalid')).toBe('true');
        expect($('company').getAttribute('aria-invalid')).not.toBe('true');
        expect(statusText()).toContain('Nothing was sent');
    });

    test('an over-long description blocks saving instead of being cut', async () => {
        const { fetchImpl } = await openPopup();
        type('description', 'x'.repeat(50001));

        expect($('description-count').classList.contains('over')).toBe(true);
        $('job-form').requestSubmit();
        await flush();

        expect(fetchImpl).not.toHaveBeenCalled();
        expect($('description').value).toHaveLength(50001);
    });

    test('edits survive closing the popup', async () => {
        const { chromeApi } = await openPopup();
        type('company', 'Edited Co');
        await flush();

        loadPage('popup/popup.html');
        const reopened = createPopup({ doc: document, chromeApi: /** @type {any} */ (chromeApi), fetchImpl: jsonFetch(201, created) });
        await reopened.ready;

        expect($('company').value).toBe('Edited Co');
        expect($('method-line').textContent).toContain('Restored your unsaved edits');
        expect(chromeApi.scripting.executeScript).toHaveBeenCalledTimes(1);
    });

    test('re-extracting after edits asks for confirmation first', async () => {
        const { chromeApi } = await openPopup();
        type('title', 'Mine');

        $('reextract').click();
        await flush();
        expect($('reextract').textContent).toBe('Discard edits?');
        expect($('title').value).toBe('Mine');

        $('reextract').click();
        await flush();
        await flush();
        expect($('title').value).toBe('Senior Backend Engineer');
        expect(chromeApi.scripting.executeScript).toHaveBeenCalledTimes(2);
    });
});

describe('save outcomes', () => {
    test('a duplicate leaves the form as is and offers to save a copy', async () => {
        const existing = { ...created.data, ulid: '01OLD', url: `${base}/applications/01OLD`, stage: 'interviewing' };
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'This job listing has already been saved.', existing }), { status: 409 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }));
        await openPopup({}, fetchImpl);

        $('job-form').requestSubmit();
        await flush();

        expect($('status').dataset.tone).toBe('warning');
        expect(statusText()).toContain('interviewing');
        expect(/** @type {HTMLAnchorElement} */ ($('status-link')).href).toBe(`${base}/applications/01OLD`);
        expect($('save-anyway').hidden).toBe(false);
        expect($('title').value).toBe('Senior Backend Engineer');

        $('save-anyway').click();
        await flush();

        expect(JSON.parse(fetchImpl.mock.calls[1][1].body).allow_duplicate).toBe(true);
        expect($('status').dataset.tone).toBe('success');
    });

    test('server validation errors are shown on the matching fields', async () => {
        await openPopup({}, jsonFetch(422, { message: 'Invalid', errors: { role_title: ['The role title field is required.'], 'capture.salary.currency': ['Bad currency.'], capture: ['Odd capture.'] } }));

        $('job-form').requestSubmit();
        await flush();

        expect(document.querySelector('[data-error-for="title"]')?.textContent).toBe('The role title field is required.');
        expect(document.querySelector('[data-error-for="salaryCurrency"]')?.textContent).toBe('Bad currency.');
        expect($('status-list').textContent).toContain('Odd capture.');
    });

    test.each([
        [jsonFetch(401, { message: 'Unauthenticated.' }), 'The API token was not accepted.'],
        [jsonFetch(403, { message: 'This account has been deactivated.' }), 'This account has been deactivated.'],
        [jsonFetch(500, 'oops'), 'Career Engine had an error (500).'],
        [jsonFetch(429, { message: 'Too Many Attempts.' }, { 'Retry-After': '30' }), 'Wait 30 seconds'],
        [vi.fn(async () => { throw new TypeError('Failed to fetch'); }), 'Could not reach Career Engine'],
    ])('errors are explained and the edits kept (%#)', async (fetchImpl, expected) => {
        await openPopup({}, fetchImpl);
        type('title', 'Kept title');

        $('job-form').requestSubmit();
        await flush();

        expect($('status').dataset.tone).toBe('error');
        expect(statusText()).toContain(expected);
        expect($('title').value).toBe('Kept title');
        expect(/** @type {HTMLButtonElement} */ ($('save')).disabled).toBe(false);
    });

    test('without settings, saving explains how to connect and sends nothing', async () => {
        const { fetchImpl, chromeApi } = await openPopup({ settings: null });

        expect(statusText()).toContain('Not connected yet');
        $('job-form').requestSubmit();
        await flush();

        expect(fetchImpl).not.toHaveBeenCalled();
        expect(statusText()).toContain('Connect to Career Engine first');
        $('status-settings').click();
        expect(chromeApi.runtime.openOptionsPage).toHaveBeenCalled();
    });

    test('without host permission, nothing is sent', async () => {
        const { fetchImpl } = await openPopup({ granted: false });

        $('job-form').requestSubmit();
        await flush();

        expect(fetchImpl).not.toHaveBeenCalled();
        expect(statusText()).toContain('may not contact http://127.0.0.1:8000');
    });

    test('a double click sends one request', async () => {
        let resolve = (/** @type {Response} */ _) => {};
        const fetchImpl = vi.fn(() => new Promise((r) => { resolve = r; }));
        const { popup } = await openPopup({}, /** @type {any} */ (fetchImpl));

        const first = popup.save();
        await flush();
        const second = await popup.save();
        resolve(new Response(JSON.stringify(created), { status: 201 }));
        await first;

        expect(second).toBeNull();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('the click responds at once: spinner, busy notice next to Save, nothing else pressable', async () => {
        let resolve = (/** @type {Response} */ _) => {};
        const fetchImpl = vi.fn(() => new Promise((r) => { resolve = r; }));
        await openPopup({}, /** @type {any} */ (fetchImpl));

        $('job-form').requestSubmit();

        // Before any await has settled.
        expect($('save').dataset.state).toBe('saving');
        expect($('save').disabled).toBe(true);
        expect($('save').getAttribute('aria-busy')).toBe('true');
        expect($('save-label').textContent).toBe('Saving…');
        expect($('reextract').disabled).toBe(true);
        expect($('status').dataset.tone).toBe('busy');
        expect($('status').parentElement?.id).toBe('form-footer');
        expect($('status-close').hidden).toBe(true);

        await flush();
        resolve(new Response(JSON.stringify(created), { status: 201 }));
        await flush();
        await flush();

        expect($('status').dataset.tone).toBe('success');
        expect($('status').parentElement?.id).toBe('form-footer');
        expect($('reextract').disabled).toBe(false);
    });

    test('after a save the button says Saved until the form is edited', async () => {
        await openPopup();

        $('job-form').requestSubmit();
        await flush();

        expect($('save').dataset.state).toBe('saved');
        expect($('save').disabled).toBe(true);
        expect($('save-label').textContent).toBe('Saved ✓');

        type('title', 'Changed');

        expect($('save').dataset.state).toBe('ready');
        expect($('save').disabled).toBe(false);
        expect($('save-label').textContent).toBe('Save to Career Engine');
    });

    test('saving a copy after a duplicate shows its own busy notice and locks the button', async () => {
        const existing = { ...created.data, ulid: '01OLD', url: `${base}/applications/01OLD` };
        let resolve = (/** @type {Response} */ _) => {};
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'This job listing has already been saved.', existing }), { status: 409 }))
            .mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
        await openPopup({}, fetchImpl);

        $('job-form').requestSubmit();
        await flush();
        expect($('save').dataset.state).toBe('ready');

        $('save-anyway').click();

        expect($('status-title').textContent).toBe('Saving a copy to Career Engine…');
        expect($('save-anyway').hidden).toBe(true);

        await flush();
        resolve(new Response(JSON.stringify(created), { status: 201 }));
        await flush();
        await flush();

        expect($('status').dataset.tone).toBe('success');
    });

    test('errors are announced as alerts and can be dismissed', async () => {
        await openPopup({}, jsonFetch(500, 'oops'));

        $('job-form').requestSubmit();
        await flush();

        expect($('status').getAttribute('role')).toBe('alert');
        expect($('status-close').hidden).toBe(false);

        $('status-close').click();
        expect($('status').hidden).toBe(true);
    });

    test('page messages go back above the form', async () => {
        const { chromeApi } = await openPopup({}, jsonFetch(500, 'oops'));

        $('job-form').requestSubmit();
        await flush();
        expect($('status').parentElement?.id).toBe('form-footer');

        chromeApi.scripting.executeScript.mockRejectedValueOnce(new Error('The tab was closed'));
        $('reextract').click();
        await flush();
        await flush();

        expect(statusText()).toContain('The tab was closed');
        expect($('status').nextElementSibling?.id).toBe('extraction');
        expect($('save').dataset.state).toBe('ready');
    });

    test('page content is shown as text, never as HTML', async () => {
        const html = '<html><head><title>x</title><script type="application/ld+json">{"@type":"JobPosting","title":"<img src=x onerror=alert(1)>Evil","hiringOrganization":"<b>Bold</b> Co"}</script></head><body></body></html>';
        await openPopup({ snapshot: { url: 'https://jobs.example.com/1', title: 'x', html } });

        expect($('title').value).toBe('Evil');
        expect($('company').value).toBe('Bold Co');
        expect(document.querySelector('img')).toBeNull();
    });
});
