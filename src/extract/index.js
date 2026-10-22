/**
 * Turns a page snapshot into job fields. Layers run in priority order: site adapter, JSON-LD
 * JobPosting, meta tags, DOM patterns, text heuristics. Each field takes the first non-empty
 * value, and `sources` records which layer it came from. A failing layer is reported in
 * `warnings` and the others still run. Nothing is invented: unknown fields stay empty.
 */

import { tidy } from '../lib/text.js';
import { httpUrl, listingUrl, siteOf } from '../lib/url.js';
import { ADAPTERS } from './adapters/index.js';
import { MIN_DESCRIPTION_LENGTH, extractDom } from './dom.js';
import { extractFallback } from './fallback.js';
import { extractJsonLd } from './jsonld.js';
import { extractMeta } from './meta.js';

export const FIELDS = ['title', 'company', 'location', 'workplaceType', 'employmentType', 'salary', 'description', 'postedAt', 'deadline', 'externalId'];

/** Fields worth telling the user about when they could not be found. */
export const REPORTED_FIELDS = ['title', 'company', 'location', 'description', 'salary', 'employmentType'];

export const METHOD_LABELS = {
    adapter: 'site adapter',
    'json-ld': 'structured data (JSON-LD)',
    meta: 'page metadata',
    dom: 'page layout',
    fallback: 'page text',
    manual: 'nothing found',
};

const EMPTY_FIELDS = {
    title: '', company: '', location: '', workplaceType: '', employmentType: '', salary: null,
    description: '', postedAt: '', deadline: '', externalId: '', url: '', site: '',
};

/**
 * @typedef {{ url?: string, title?: string, html?: string, selection?: string, truncatedHtml?: boolean }} PageSnapshot
 * @typedef {typeof EMPTY_FIELDS & { salary: import('../lib/salary.js').Salary | null }} JobFields
 * @typedef {{ fields: JobFields, sources: Record<string, string>, method: string, missing: string[], warnings: string[], selection: string }} Extraction
 */

/**
 * @param {PageSnapshot} snapshot
 * @param {{ parser?: DOMParser, adapters?: import('./adapters/index.js').Adapter[] }} [options]
 * @returns {Extraction}
 */
export function extractJob(snapshot, { parser = new DOMParser(), adapters = ADAPTERS } = {}) {
    const pageUrl = httpUrl(snapshot?.url)?.href ?? '';
    /** @type {string[]} */
    const warnings = [];
    /** @type {Record<string, any>} */
    const fields = {};
    /** @type {Record<string, string>} */
    const sources = {};

    if (snapshot?.truncatedHtml) {
        warnings.push('This page is very large, so only the first part of it was read.');
    }

    const doc = parser.parseFromString(String(snapshot?.html ?? ''), 'text/html');

    const run = (/** @type {string} */ method, /** @type {() => any} */ step) => {
        try {
            return step();
        } catch (error) {
            warnings.push(`Reading the ${METHOD_LABELS[/** @type {keyof typeof METHOD_LABELS} */ (method)]} failed (${error instanceof Error ? error.message : 'unknown error'}). Other sources were still used.`);

            return null;
        }
    };

    const apply = (/** @type {string} */ method, /** @type {Record<string, any> | undefined} */ found) => {
        for (const key of FIELDS) {
            const value = found?.[key];

            if (fields[key] === undefined && value !== undefined && value !== null && value !== '') {
                fields[key] = typeof value === 'string' ? value.trim() : value;
                sources[key] = method;
            }
        }
    };

    if (pageUrl !== '') {
        const url = new URL(pageUrl);

        for (const adapter of adapters) {
            if (run('adapter', () => adapter.matches(url))) {
                apply('adapter', run('adapter', () => adapter.extract(doc, url)) ?? undefined);
            }
        }
    }

    const jsonld = run('json-ld', () => extractJsonLd(doc, { pageUrl, parser }));
    apply('json-ld', jsonld?.fields);
    warnings.push(...(jsonld?.errors ?? []));

    const meta = run('meta', () => extractMeta(doc, { pageUrl, parser }));
    apply('meta', meta?.fields);

    apply('dom', run('dom', () => extractDom(doc))?.fields);

    const fallback = run('fallback', () => extractFallback(doc, { pageUrl, pageTitle: snapshot?.title ?? '', known: { ...fields } }));
    const longerDescription = fallback?.fields?.description;

    // A teaser-length description is replaced by the page's main text block when that is longer.
    if (longerDescription && (fields.description ?? '').length < MIN_DESCRIPTION_LENGTH) {
        fields.description = longerDescription;
        sources.description = 'fallback';
    }

    apply('fallback', fallback?.fields);

    if (!fields.description && meta?.teaser) {
        fields.description = meta.teaser;
        sources.description = 'meta';
        warnings.push('Only a short summary of the description was found. Select the full description on the page and choose "Use selected text", or paste it in.');
    }

    const url = listingUrl(pageUrl, [jsonld?.fields?.url, meta?.fields?.url]);
    const method = ['adapter', 'json-ld', 'meta', 'dom', 'fallback'].find((m) => Object.values(sources).includes(m)) ?? 'manual';

    return {
        fields: /** @type {JobFields} */ ({ ...EMPTY_FIELDS, ...fields, url, site: siteOf(url || pageUrl) }),
        sources,
        method,
        missing: REPORTED_FIELDS.filter((key) => fields[key] === undefined),
        warnings,
        selection: tidy(String(snapshot?.selection ?? '')),
    };
}
