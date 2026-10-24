/**
 * Normalisers from whatever a page says to the values Career Engine accepts.
 * Each returns '' when the value cannot be identified, never a guess.
 */

import { cleanLine } from './text.js';

/** Career Engine's EmploymentType enum. */
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'freelance', 'internship', 'other'];

export const WORKPLACE_TYPES = ['remote', 'hybrid', 'on_site'];

export const WORKPLACE_LABELS = { remote: 'Remote', hybrid: 'Hybrid', on_site: 'On-site' };

/** What a listing asks for on top of the application itself. */
export const APPLY_REQUIREMENTS = ['video', 'test', 'video_and_test'];

/** First match wins; schema.org values (FULL_TIME, CONTRACTOR…) and common wording. */
const EMPLOYMENT_PATTERNS = [
    [/\bfull[\s_-]?time\b/i, 'full_time'],
    [/\bpart[\s_-]?time\b/i, 'part_time'],
    [/\bfreelance(r)?\b/i, 'freelance'],
    [/\b(contract(or)?|temporary|temp|fixed[\s_-]term)\b/i, 'contract'],
    [/\b(intern|internship|graduate placement)\b/i, 'internship'],
    [/\b(volunteer|per[\s_]diem|seasonal|other)\b/i, 'other'],
];

/**
 * @param {unknown} value a string, or an array of them (schema.org allows both)
 * @returns {string}
 */
export function employmentTypeFrom(value) {
    const values = (Array.isArray(value) ? value : [value]).filter((v) => typeof v === 'string');

    for (const v of values) {
        for (const [pattern, type] of EMPLOYMENT_PATTERNS) {
            if (/** @type {RegExp} */ (pattern).test(v)) {
                return /** @type {string} */ (type);
            }
        }
    }

    return '';
}

/**
 * Remote, hybrid or on-site, from short text such as a title, location line or job summary.
 * "Hybrid" wins over "remote" because hybrid listings usually mention remote days.
 * @param {unknown} text
 */
export function workplaceTypeFrom(text) {
    const t = String(text ?? '');

    if (/\bhybrid\b/i.test(t)) return 'hybrid';
    if (/\b(fully[\s-]+)?remote\b|\bwork(ing)?\s+from\s+home\b|\bwfh\b|\btelecommute\b/i.test(t)) return 'remote';
    if (/\bon[\s-]?site\b|\bin[\s-]office\b|\boffice[\s-]based\b/i.test(t)) return 'on_site';

    return '';
}

/**
 * The email subject a listing asks applicants to use, only when it is quoted
 * ('use the subject line "Backend – Ref 12"'), so the exact wording is known.
 * @param {unknown} text
 */
export function subjectLineFrom(text) {
    const match = /\bsubject(?:[\s-]+line)?\b[^"“'‘\n]{0,40}["“'‘]([^"”'’\n]{3,200})["”'’]/i.exec(String(text ?? ''));

    return match ? cleanLine(match[1]) : '';
}

/**
 * YYYY-MM-DD from an ISO date/time or another date string the browser can parse.
 * @param {unknown} value
 */
export function dateOnly(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        return '';
    }

    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());

    if (iso) {
        const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));

        return date.getUTCMonth() === Number(iso[2]) - 1 && date.getUTCDate() === Number(iso[3]) ? iso[0] : '';
    }

    const parsed = Date.parse(value);

    return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10);
}

/**
 * schema.org `jobLocation` (Place or array of Places) as "City, Region, Country".
 * @param {any} jobLocation
 */
export function locationFromJsonLd(jobLocation) {
    const places = (Array.isArray(jobLocation) ? jobLocation : [jobLocation]).filter(Boolean);
    const names = [];

    for (const place of places) {
        const address = typeof place === 'object' ? place.address ?? place : place;
        let name = '';

        if (typeof address === 'string') {
            name = cleanLine(address);
        } else if (address && typeof address === 'object') {
            const country = typeof address.addressCountry === 'object' ? address.addressCountry?.name : address.addressCountry;
            name = [address.addressLocality, address.addressRegion, country]
                .map(cleanLine)
                .filter((part, index, parts) => part !== '' && parts.indexOf(part) === index)
                .join(', ');
        }

        if (name === '' && typeof place === 'object') {
            name = cleanLine(place.name);
        }

        if (name !== '' && !names.includes(name)) {
            names.push(name);
        }
    }

    return names.length > 3 ? `${names.slice(0, 3).join('; ')} (+${names.length - 3} more)` : names.join('; ');
}

/**
 * The location as sent to Career Engine, which has no workplace column: "London (hybrid)",
 * or just "Remote". Left as is when it already says so.
 * @param {string} location
 * @param {string} workplaceType
 */
export function locationWithWorkplace(location, workplaceType) {
    const place = cleanLine(location);
    const label = WORKPLACE_LABELS[/** @type {keyof typeof WORKPLACE_LABELS} */ (workplaceType)];

    if (!label) return place;
    if (place === '') return label;
    if (workplaceTypeFrom(place) === workplaceType) return place;

    const combined = `${place} (${label.toLowerCase()})`;

    return combined.length <= 200 ? combined : place;
}
