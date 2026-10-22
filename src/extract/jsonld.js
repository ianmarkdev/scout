/**
 * Layer 1: schema.org JobPosting in <script type="application/ld+json">. The most reliable
 * source when present (Google for Jobs requires it, so most ATS pages include it).
 */

import { dateOnly, employmentTypeFrom, locationFromJsonLd } from '../lib/fields.js';
import { salaryFromJsonLd } from '../lib/salary.js';
import { cleanLine, decodeLine, htmlToText } from '../lib/text.js';

/**
 * Every JobPosting object on the page, including ones nested in @graph, arrays or mainEntity.
 * Scripts with invalid JSON are skipped (after one lenient retry) and reported in `errors`.
 * @param {Document} doc
 * @returns {{ postings: any[], errors: string[] }}
 */
export function findJobPostings(doc) {
    const postings = [];
    const errors = [];

    for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json" i]'))) {
        const data = parseLenient(script.textContent ?? '');

        if (data === undefined) {
            errors.push('A structured-data block on this page is not valid JSON and was skipped.');
            continue;
        }

        collect(data, postings, 0);
    }

    return { postings, errors };
}

/**
 * @param {string} text
 */
function parseLenient(text) {
    try {
        return JSON.parse(text);
    } catch {
        // Common breakage: HTML comment/CDATA wrappers and raw line breaks inside strings.
        const cleaned = text
            .replace(/^\s*(<!--|<!\[CDATA\[)/, '')
            .replace(/(-->|\]\]>)\s*$/, '')
            .replace(/[\u0000-\u001f]+/g, ' ');

        try {
            return JSON.parse(cleaned);
        } catch {
            return undefined;
        }
    }
}

/**
 * @param {any} node
 * @param {any[]} out
 * @param {number} depth
 */
function collect(node, out, depth) {
    if (depth > 8 || node === null || typeof node !== 'object') {
        return;
    }

    if (Array.isArray(node)) {
        node.forEach((item) => collect(item, out, depth + 1));
        return;
    }

    const types = [].concat(node['@type'] ?? []).map((type) => String(type).replace(/^.*[/:#]/, ''));

    if (types.includes('JobPosting')) {
        out.push(node);
    }

    for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
        if (node[key] !== undefined) {
            collect(node[key], out, depth + 1);
        }
    }
}

/**
 * @param {any} value string, {"@value": …}, or the first of an array
 */
function textOf(value) {
    const first = Array.isArray(value) ? value[0] : value;

    if (first && typeof first === 'object') {
        return typeof first['@value'] === 'string' ? first['@value'] : typeof first.name === 'string' ? first.name : '';
    }

    return typeof first === 'string' || typeof first === 'number' ? String(first) : '';
}

/**
 * @param {any} identifier PropertyValue, string or number
 */
function identifierOf(identifier) {
    const first = Array.isArray(identifier) ? identifier[0] : identifier;

    if (first && typeof first === 'object') {
        return cleanLine(String(first.value ?? first['@value'] ?? ''));
    }

    return cleanLine(first === undefined || first === null ? '' : String(first));
}

/**
 * The page's job posting as extracted fields (only the ones found).
 * @param {Document} doc
 * @param {{ pageUrl?: string, parser?: DOMParser }} [options]
 */
export function extractJsonLd(doc, { pageUrl = '', parser = new DOMParser() } = {}) {
    const { postings, errors } = findJobPostings(doc);
    // Several postings (e.g. "similar jobs"): prefer the one for this URL, then the first with a title.
    const posting = postings.find((p) => typeof p.url === 'string' && pageUrl !== '' && stripHash(p.url) === stripHash(pageUrl))
        ?? postings.find((p) => textOf(p.title ?? p.name) !== '')
        ?? postings[0];

    if (!posting) {
        return { fields: {}, errors };
    }

    const locationTypes = [].concat(posting.jobLocationType ?? []).map(String);
    const remote = locationTypes.some((type) => /telecommute|remote/i.test(type));
    const salary = salaryFromJsonLd(posting.baseSalary ?? posting.estimatedSalary);
    const applicantLocation = locationFromJsonLd(posting.applicantLocationRequirements);

    const fields = {
        title: decodeLine(textOf(posting.title ?? posting.name), parser),
        company: decodeLine(textOf(posting.hiringOrganization), parser),
        description: htmlToText(textOf(posting.description), parser),
        location: locationFromJsonLd(posting.jobLocation) || (remote ? applicantLocation : ''),
        employmentType: employmentTypeFrom(posting.employmentType),
        workplaceType: remote ? 'remote' : '',
        salary,
        postedAt: dateOnly(textOf(posting.datePosted)),
        deadline: dateOnly(textOf(posting.validThrough)),
        externalId: identifierOf(posting.identifier),
        url: textOf(posting.url),
    };

    return { fields: dropEmpty(fields), errors };
}

/**
 * @param {string} url
 */
function stripHash(url) {
    return url.split('#')[0].replace(/\/+$/, '');
}

/**
 * @template {Record<string, unknown>} T
 * @param {T} fields
 * @returns {Partial<T>}
 */
export function dropEmpty(fields) {
    return /** @type {Partial<T>} */ (Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== '' && value !== null && value !== undefined)));
}
