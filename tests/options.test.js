import { beforeEach, describe, expect, test } from 'vitest';
import { createOptions } from '../src/options/options.js';
import { fakeChrome, jsonFetch, loadPage } from './helpers.js';

const token = `5|${'k'.repeat(40)}`;
const $ = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (document.getElementById(id));

async function openOptions(chromeOptions = {}, fetchImpl = jsonFetch(422, { message: 'Invalid', errors: {} })) {
    const chromeApi = fakeChrome({ settings: null, ...chromeOptions });
    const options = createOptions({ doc: document, chromeApi: /** @type {any} */ (chromeApi), fetchImpl });
    await options.ready;

    return { options, chromeApi, fetchImpl };
}

beforeEach(() => {
    loadPage('options/options.html');
});

describe('settings', () => {
    test('saves a normalised address and token and asks for access to that origin only', async () => {
        const { options, chromeApi } = await openOptions();
        $('baseUrl').value = 'http://127.0.0.1:8000/';
        $('token').value = ` ${token} `;

        expect(await options.save()).toBe(true);

        expect(chromeApi.permissions.request).toHaveBeenCalledWith({ origins: ['http://127.0.0.1:8000/*'] });
        expect(chromeApi.storage.local.data.settings).toEqual({ baseUrl: 'http://127.0.0.1:8000', token });
    });

    test('rejects remote plain http and malformed tokens without saving', async () => {
        const { options, chromeApi } = await openOptions();
        $('baseUrl').value = 'http://careers.example.com';
        $('token').value = 'password123';

        expect(await options.save()).toBe(false);

        expect(document.querySelector('[data-error-for="baseUrl"]')?.textContent).toContain('https://');
        expect(document.querySelector('[data-error-for="token"]')?.textContent).toContain('does not look like');
        expect(chromeApi.permissions.request).not.toHaveBeenCalled();
        expect(chromeApi.storage.local.data.settings).toBeUndefined();
    });

    test('changing the address drops access to the old one', async () => {
        const { options, chromeApi } = await openOptions({ settings: { baseUrl: 'http://127.0.0.1:8000', token } });
        $('baseUrl').value = 'https://career-engine.test';

        await options.save();

        expect(chromeApi.permissions.remove).toHaveBeenCalledWith({ origins: ['http://127.0.0.1:8000/*'] });
    });

    test('a refused permission is reported', async () => {
        const { options } = await openOptions({ granted: false });
        $('baseUrl').value = 'http://localhost:8000';
        $('token').value = token;

        expect(await options.save()).toBe(false);
        expect($('status-title').textContent).toContain('access was not granted');
    });

    test('test connection treats a validation response as success and saves nothing', async () => {
        const { options, fetchImpl } = await openOptions({ settings: { baseUrl: 'http://127.0.0.1:8000', token } });

        await options.test();

        expect(fetchImpl.mock.calls[0][1].body).toBe('{}');
        expect($('status-title').textContent).toBe('Connected.');
    });

    test('test connection explains a rejected token', async () => {
        const { options } = await openOptions({ settings: { baseUrl: 'http://127.0.0.1:8000', token } }, jsonFetch(401, { message: 'Unauthenticated.' }));

        await options.test();

        expect($('status-title').textContent).toBe('The API token was not accepted.');
    });

    test('remove token clears it from storage', async () => {
        const { options, chromeApi } = await openOptions({ settings: { baseUrl: 'http://127.0.0.1:8000', token } });
        expect($('token').value).toBe(token);

        await options.forget();

        expect(chromeApi.storage.local.data.settings).toEqual({ baseUrl: 'http://127.0.0.1:8000', token: '' });
        expect($('token').value).toBe('');
    });
});
