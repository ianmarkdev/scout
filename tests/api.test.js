import { describe, expect, test, vi } from 'vitest';
import { describeResult, safeAppLink, saveApplication, testConnection } from '../src/lib/api.js';
import { jsonFetch } from './helpers.js';

const base = 'http://127.0.0.1:8000';
const token = `3|${'t'.repeat(40)}`;
const summary = { ulid: '01J', url: `${base}/applications/01J`, company_name: 'Acme', role_title: 'Engineer', stage: 'saved', deleted: false };

describe('saveApplication', () => {
    test('posts JSON with the bearer token and no cookies', async () => {
        const fetchImpl = jsonFetch(201, { data: summary });

        const result = await saveApplication({ baseUrl: base, token, payload: { role_title: 'Engineer' }, fetchImpl });

        expect(result).toEqual({ kind: 'created', application: summary });
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe(`${base}/api/extension/applications`);
        expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', body: '{"role_title":"Engineer"}' });
        expect(init.headers).toMatchObject({ Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' });
    });

    test.each([
        [409, { message: 'This job listing has already been saved.', existing: summary }, { kind: 'duplicate', existing: summary }],
        [422, { message: 'Invalid', errors: { role_title: ['Required.'] } }, { kind: 'validation', errors: { role_title: ['Required.'] } }],
        [401, { message: 'Unauthenticated.' }, { kind: 'unauthenticated', status: 401 }],
        [403, { message: 'Set up two-factor authentication to continue.' }, { kind: 'forbidden', message: 'Set up two-factor authentication to continue.' }],
        [404, { message: 'Not Found' }, { kind: 'not_found' }],
        [413, '', { kind: 'too_large' }],
        [500, '<html>Server Error</html>', { kind: 'server', status: 500, message: '' }],
        [302, '', { kind: 'unexpected', status: 302 }],
    ])('maps HTTP %i to a typed result', async (status, body, expected) => {
        const result = await saveApplication({ baseUrl: base, token, payload: {}, fetchImpl: jsonFetch(status, body) });

        expect(result).toMatchObject(expected);
    });

    test('reads Retry-After on 429', async () => {
        const result = await saveApplication({ baseUrl: base, token, payload: {}, fetchImpl: jsonFetch(429, { message: 'Too Many Attempts.' }, { 'Retry-After': '42' }) });

        expect(result).toMatchObject({ kind: 'rate_limited', retryAfter: 42 });
    });

    test('network failures and timeouts are results, not exceptions', async () => {
        const offline = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
        expect(await saveApplication({ baseUrl: base, token, payload: {}, fetchImpl: offline })).toEqual({ kind: 'network', message: 'Failed to fetch' });

        const hanging = vi.fn((_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
        expect(await saveApplication({ baseUrl: base, token, payload: {}, fetchImpl: hanging, timeoutMs: 10 })).toMatchObject({ kind: 'timeout' });
    });

    test('a 201 without data is not reported as saved', async () => {
        expect(await saveApplication({ baseUrl: base, token, payload: {}, fetchImpl: jsonFetch(201, {}) })).toMatchObject({ kind: 'unexpected' });
    });

    test('testConnection sends an empty body (a 422 means the token works)', async () => {
        const fetchImpl = jsonFetch(422, { errors: {} });

        expect(await testConnection({ baseUrl: base, token, fetchImpl })).toMatchObject({ kind: 'validation' });
        expect(fetchImpl.mock.calls[0][1].body).toBe('{}');
    });
});

describe('messages and links', () => {
    test('every result has a user-facing message', () => {
        const kinds = ['created', 'duplicate', 'validation', 'unauthenticated', 'forbidden', 'not_found', 'too_large', 'rate_limited', 'server', 'timeout', 'network', 'unexpected'];

        for (const kind of kinds) {
            const message = describeResult(/** @type {any} */ ({ kind, status: 0, message: '', application: summary, existing: summary, errors: {} }), base);

            expect(message.title.length, kind).toBeGreaterThan(0);
            expect(['success', 'warning', 'error']).toContain(message.tone);
        }
    });

    test('links back into Career Engine must point at the configured origin', () => {
        expect(safeAppLink(`${base}/applications/01J`, base)).toBe(`${base}/applications/01J`);
        expect(safeAppLink('javascript:alert(1)', base)).toBe('');
        expect(safeAppLink('https://evil.example/phish', base)).toBe('');
        expect(safeAppLink(undefined, base)).toBe('');
    });
});
