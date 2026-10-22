/**
 * URL helpers. Career Engine does the duplicate matching (it drops tracking parameters
 * server-side), so the extension only picks the best listing URL and removes the fragment.
 */

/**
 * @param {unknown} value
 * @param {string} [base]
 * @returns {URL | null} only http(s) URLs
 */
export function httpUrl(value, base) {
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }

    try {
        const url = new URL(value.trim(), base);

        return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch {
        return null;
    }
}

const bareHost = (/** @type {URL} */ url) => url.hostname.replace(/^www\./, '');

/**
 * The page's host without "www." ("jobs.example.com"), or ''.
 * @param {unknown} url
 */
export function siteOf(url) {
    const parsed = httpUrl(url);

    return parsed ? bareHost(parsed) : '';
}

/**
 * The URL to save for a listing: a canonical/structured-data URL when it points at a page on
 * the same site (it usually drops session and tracking noise), otherwise the page address.
 * The fragment is always removed.
 * @param {string} pageUrl
 * @param {unknown[]} candidates canonical, og:url, JSON-LD url — best first
 */
export function listingUrl(pageUrl, candidates = []) {
    const page = httpUrl(pageUrl);

    if (!page) {
        return '';
    }

    for (const candidate of candidates) {
        const url = httpUrl(candidate, page.href);

        if (url && bareHost(url) === bareHost(page) && url.pathname.length > 1) {
            url.hash = '';

            return url.href;
        }
    }

    page.hash = '';

    return page.href;
}

/**
 * Validate and tidy the Career Engine base URL from the settings form.
 * Plain http is accepted only for local development hosts: the API token would otherwise
 * travel unencrypted.
 * @param {unknown} input
 * @returns {{ ok: true, url: string, origin: string } | { ok: false, error: string }}
 */
export function normalizeBaseUrl(input) {
    const raw = typeof input === 'string' ? input.trim() : '';

    if (raw === '') {
        return { ok: false, error: 'Enter the address of your Career Engine app, e.g. http://127.0.0.1:8000.' };
    }

    let url;

    try {
        url = new URL(raw);
    } catch {
        return { ok: false, error: 'That is not a valid address. Include http:// or https://.' };
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, error: 'The address must start with http:// or https://.' };
    }

    if (url.username || url.password) {
        return { ok: false, error: 'Do not put a username or password in the address.' };
    }

    if (url.protocol === 'http:' && !isLocalHost(url.hostname)) {
        return { ok: false, error: 'Use https:// for a server that is not on this computer, so the token is not sent unencrypted.' };
    }

    return { ok: true, url: `${url.origin}${url.pathname}`.replace(/\/+$/, ''), origin: url.origin };
}

/**
 * localhost, loopback addresses, and Herd/Valet style *.test / *.localhost domains.
 * @param {string} hostname
 */
export function isLocalHost(hostname) {
    return hostname === 'localhost'
        || hostname === '[::1]'
        || /^127(\.\d{1,3}){3}$/.test(hostname)
        || hostname.endsWith('.test')
        || hostname.endsWith('.localhost');
}
