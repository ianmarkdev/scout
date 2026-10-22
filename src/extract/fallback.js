/**
 * Layer 4: heuristics over the page title and visible text, for pages with no structured
 * data and unfamiliar markup. Only fills fields the earlier layers left empty.
 */

import { employmentTypeFrom, workplaceTypeFrom } from '../lib/fields.js';
import { parseSalaryText } from '../lib/salary.js';
import { elementToText } from '../lib/text.js';
import { siteOf } from '../lib/url.js';
import { MIN_DESCRIPTION_LENGTH } from './dom.js';
import { dropEmpty } from './jsonld.js';
import { splitTitle } from './title.js';

const CONTAINERS = 'article, section, main, div, [role="main"]';
const CHROME = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]';

/**
 * The container with the most non-link text, ignoring navigation, headers and footers.
 * @param {Document} doc
 */
export function densestText(doc) {
    let best = null;
    let bestScore = 0;

    for (const element of Array.from(doc.querySelectorAll(CONTAINERS))) {
        if (element.closest(CHROME)) {
            continue;
        }

        const textLength = (element.textContent ?? '').replace(/\s+/g, ' ').length;
        const linkLength = Array.from(element.querySelectorAll('a')).reduce((sum, a) => sum + (a.textContent ?? '').length, 0);
        // Link-heavy blocks (menus, "similar jobs") score low; a parent only wins with more real text.
        const score = textLength - 2 * linkLength;

        if (score > bestScore * 1.1) {
            best = element;
            bestScore = score;
        }
    }

    return best ? elementToText(best) : '';
}

/**
 * @param {Document} doc
 * @param {{ pageUrl?: string, pageTitle?: string, known?: Record<string, any> }} [options]
 */
export function extractFallback(doc, { pageUrl = '', pageTitle = '', known = {} } = {}) {
    const fromTitle = splitTitle(pageTitle || doc.title, siteOf(pageUrl));
    let description = known.description ?? '';

    if (description.length < MIN_DESCRIPTION_LENGTH) {
        const dense = densestText(doc);
        description = dense.length > description.length ? dense : description;
    }

    const title = known.title ?? fromTitle.title ?? '';
    const location = known.location ?? fromTitle.location ?? '';
    const head = description.slice(0, 3000);

    return {
        fields: dropEmpty({
            title: fromTitle.title ?? '',
            company: fromTitle.company ?? '',
            location: fromTitle.location ?? '',
            description: description === (known.description ?? '') ? '' : description,
            workplaceType: workplaceTypeFrom(`${title}\n${location}\n${head.slice(0, 1500)}`),
            employmentType: employmentTypeFrom(head),
            salary: parseSalaryText(description.slice(0, 20000)),
        }),
    };
}
