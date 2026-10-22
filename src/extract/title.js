/**
 * Job boards pack several facts into page titles: "Acme hiring Senior Engineer in London |
 * LinkedIn", "Senior Engineer at Acme", "Senior Engineer - Acme - Indeed.com". These patterns
 * split them; anything else is returned whole as the title.
 */

import { cleanLine } from '../lib/text.js';

/**
 * @param {unknown} text
 * @param {string} [site] the page's host, to recognise a trailing site name
 * @returns {{ title?: string, company?: string, location?: string }}
 */
export function splitTitle(text, site = '') {
    let value = cleanLine(text);

    if (value === '') {
        return {};
    }

    // Drop a trailing " | Site" or " - Site.com" segment naming the job board.
    const siteWord = site.split('.').filter((part) => part.length > 3 && !['www', 'jobs', 'careers'].includes(part))[0] ?? '';
    value = value.replace(/\s+[|·–—]\s+[^|·–—]+$/, (suffix) => (/\b(jobs?|careers?|hiring|recruit\w*)\b|\.\w{2,}\b/i.test(suffix) || (siteWord !== '' && suffix.toLowerCase().includes(siteWord.toLowerCase())) ? '' : suffix));

    let match = /^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+(.+))?$/i.exec(value);

    if (match) {
        return compact({ company: match[1], title: match[2], location: match[3] });
    }

    match = /^(.+?)\s+(?:at|@)\s+(.+?)(?:\s+in\s+(.+))?$/i.exec(value);

    if (match) {
        return compact({ title: match[1], company: match[2], location: match[3] });
    }

    // "Title - Company - Site": only when the last part names the site, otherwise it is ambiguous.
    const parts = value.split(/\s+[-|]\s+/);

    if (parts.length === 3 && siteWord !== '' && parts[2].toLowerCase().includes(siteWord.toLowerCase())) {
        return compact({ title: parts[0], company: parts[1] });
    }

    return compact({ title: value });
}

/**
 * @param {Record<string, string | undefined>} fields
 */
function compact(fields) {
    return Object.fromEntries(Object.entries(fields).map(([key, v]) => [key, cleanLine(v)]).filter(([, v]) => v !== ''));
}
