import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

// Not `new URL(…, import.meta.url)`: under happy-dom the global URL resolves file paths differently.
const here = dirname(fileURLToPath(import.meta.url));

export const fixture = (/** @type {string} */ name) => readFileSync(join(here, 'fixtures', name), 'utf8');

export const snapshotOf = (/** @type {string} */ name, url = 'https://jobs.example.com/northwind/123', extra = {}) => {
    const html = fixture(name);
    const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';

    return { url, title, html, selection: '', truncatedHtml: false, ...extra };
};

/** An in-memory chrome.storage area. */
export function memoryArea(initial = {}) {
    /** @type {Record<string, any>} */
    const data = structuredClone(initial);

    return {
        data,
        get: vi.fn(async (/** @type {string | string[]} */ keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, structuredClone(data[k])]))),
        set: vi.fn(async (/** @type {Record<string, any>} */ items) => { Object.assign(data, structuredClone(items)); }),
        remove: vi.fn(async (/** @type {string} */ key) => { delete data[key]; }),
    };
}

/**
 * A fake `chrome` with just what the popup and options page use.
 */
export function fakeChrome({
    tabUrl = 'https://jobs.example.com/northwind/123',
    snapshot = /** @type {any} */ (null),
    executeError = /** @type {Error | null} */ (null),
    settings = /** @type {any} */ ({ baseUrl: 'http://127.0.0.1:8000', token: `1|${'a'.repeat(40)}` }),
    granted = true,
} = {}) {
    return {
        tabs: { query: vi.fn(async () => [{ id: 7, url: tabUrl }]) },
        scripting: {
            executeScript: vi.fn(async () => {
                if (executeError) throw executeError;

                return [{ result: snapshot }];
            }),
        },
        storage: { local: memoryArea(settings ? { settings } : {}), session: memoryArea() },
        permissions: {
            contains: vi.fn(async () => granted),
            request: vi.fn(async () => granted),
            remove: vi.fn(async () => true),
        },
        runtime: { openOptionsPage: vi.fn(async () => {}) },
    };
}

/**
 * A fetch stub answering with the given status and JSON body.
 */
export function jsonFetch(status, body, headers = {}) {
    return vi.fn(async () => new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    }));
}

/**
 * Load an extension page's markup into the test document (its scripts do not run).
 */
export function loadPage(/** @type {string} */ path) {
    const html = readFileSync(join(here, '..', 'src', path), 'utf8');
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '').replace(/<script[^>]*><\/script>/gi, '').replace(/<link[^>]*>/gi, '');

    return document;
}

/** Let pending promise callbacks run. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
