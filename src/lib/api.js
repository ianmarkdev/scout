/**
 * The Career Engine API client. One endpoint: POST /api/extension/applications.
 * Every outcome is returned as a typed result (never thrown), so the popup can always say
 * what happened and keep the user's edits.
 *
 * @typedef {{ ulid: string, url: string, company_name: string, role_title: string, stage: string, deleted: boolean }} ApplicationSummary
 * @typedef {(
 *   | { kind: 'created', application: ApplicationSummary }
 *   | { kind: 'duplicate', message: string, existing: ApplicationSummary }
 *   | { kind: 'validation', message: string, errors: Record<string, string[]> }
 *   | { kind: 'unauthenticated' | 'forbidden' | 'not_found' | 'too_large' | 'rate_limited' | 'server' | 'unexpected', status: number, message: string, retryAfter?: number }
 *   | { kind: 'network' | 'timeout', message: string }
 * )} SaveResult
 */

export const CAPTURE_PATH = '/api/extension/applications';

/**
 * @param {{ baseUrl: string, token: string, payload: unknown, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<SaveResult>}
 */
export async function saveApplication({ baseUrl, token, payload, fetchImpl = fetch, timeoutMs = 20_000 }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;

    try {
        response = await fetchImpl(`${baseUrl}${CAPTURE_PATH}`, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
            credentials: 'omit', // never send the site's cookies: the token is the only credential
            redirect: 'error',
            cache: 'no-store',
            signal: controller.signal,
        });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            return { kind: 'timeout', message: `Career Engine did not answer within ${Math.round(timeoutMs / 1000)} seconds.` };
        }

        return { kind: 'network', message: error instanceof Error ? error.message : String(error) };
    } finally {
        clearTimeout(timer);
    }

    const body = await readJson(response);
    const message = typeof body?.message === 'string' ? body.message : '';

    switch (response.status) {
        case 201:
            return body?.data ? { kind: 'created', application: body.data } : { kind: 'unexpected', status: 201, message: 'Saved, but the response was not understood.' };
        case 409:
            return { kind: 'duplicate', message, existing: body?.existing };
        case 422:
            return { kind: 'validation', message, errors: body?.errors && typeof body.errors === 'object' ? body.errors : {} };
        case 401:
            return { kind: 'unauthenticated', status: 401, message };
        case 403:
            return { kind: 'forbidden', status: 403, message };
        case 404:
        case 405:
            return { kind: 'not_found', status: response.status, message };
        case 413:
            return { kind: 'too_large', status: 413, message };
        case 429:
            return { kind: 'rate_limited', status: 429, message, retryAfter: Number(response.headers.get('Retry-After')) || undefined };
        default:
            return response.status >= 500
                ? { kind: 'server', status: response.status, message }
                : { kind: 'unexpected', status: response.status, message };
    }
}

/**
 * Check the address and token without saving anything: an empty body passes authentication
 * and then fails validation (422), which proves both work.
 * @param {{ baseUrl: string, token: string, fetchImpl?: typeof fetch }} options
 * @returns {Promise<SaveResult>}
 */
export function testConnection({ baseUrl, token, fetchImpl = fetch }) {
    return saveApplication({ baseUrl, token, payload: {}, fetchImpl, timeoutMs: 10_000 });
}

/**
 * @param {Response} response
 * @returns {Promise<any>}
 */
async function readJson(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

/**
 * A link back into Career Engine, only if it really points there (never a javascript: URL or
 * another site, even if the server response were tampered with).
 * @param {unknown} url
 * @param {string} baseUrl
 * @returns {string}
 */
export function safeAppLink(url, baseUrl) {
    try {
        const link = new URL(String(url));
        const base = new URL(baseUrl);

        return (link.protocol === 'https:' || link.protocol === 'http:') && link.origin === base.origin ? link.href : '';
    } catch {
        return '';
    }
}

/**
 * What to tell the user about a result.
 * @param {SaveResult} result
 * @param {string} baseUrl
 * @returns {{ tone: 'success' | 'warning' | 'error', title: string, detail: string }}
 */
export function describeResult(result, baseUrl) {
    switch (result.kind) {
        case 'created':
            return { tone: 'success', title: 'Saved to Career Engine.', detail: `“${result.application.role_title}” at ${result.application.company_name} is in your Saved applications.` };
        case 'duplicate':
            return {
                tone: 'warning',
                title: 'You already saved this listing.',
                detail: `“${result.existing?.role_title ?? 'Untitled'}” at ${result.existing?.company_name ?? 'unknown company'} (${result.existing?.deleted ? 'deleted' : result.existing?.stage ?? 'saved'}). Nothing was changed. Open it, or save a separate copy anyway.`,
            };
        case 'validation':
            return { tone: 'error', title: 'Career Engine did not accept some fields.', detail: 'Correct the highlighted fields and save again.' };
        case 'unauthenticated':
            return { tone: 'error', title: 'The API token was not accepted.', detail: 'It may be wrong, expired or revoked. Create a new one with `php artisan app:extension-token you@example.com` and paste it in Settings.' };
        case 'forbidden':
            return { tone: 'error', title: 'Career Engine refused the request.', detail: result.message || 'This token or account is not allowed to save jobs.' };
        case 'not_found':
            return { tone: 'error', title: 'The save endpoint was not found.', detail: `Check the address in Settings (${baseUrl}) and that Career Engine is up to date.` };
        case 'too_large':
            return { tone: 'error', title: 'The request was too large for the server.', detail: 'Shorten the description and try again.' };
        case 'rate_limited':
            return { tone: 'error', title: 'Too many saves in a short time.', detail: `Wait ${result.retryAfter ? `${result.retryAfter} seconds` : 'a minute'} and try again. Your edits are kept.` };
        case 'server':
            return { tone: 'error', title: `Career Engine had an error (${result.status}).`, detail: 'Your edits are kept. Check the Laravel log, then try again.' };
        case 'timeout':
            return { tone: 'error', title: 'Career Engine did not respond.', detail: `${result.message} Your edits are kept.` };
        case 'network':
            return { tone: 'error', title: `Could not reach Career Engine at ${baseUrl}.`, detail: 'Is the app running, and is the address in Settings right? Redirects (e.g. http → https) are not followed: use the final address.' };
        default:
            return { tone: 'error', title: `Unexpected response (${result.status}).`, detail: result.message || 'Your edits are kept.' };
    }
}
