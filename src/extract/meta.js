/**
 * Layer 2: Open Graph / Twitter / standard meta tags and the canonical link. Gives a title
 * (often "Title at Company") and a canonical URL. og:description is usually a shortened
 * teaser, so it is offered as a description only when nothing better is found (see index.js).
 */

import { cleanLine, decodeLine } from '../lib/text.js';
import { siteOf } from '../lib/url.js';
import { dropEmpty } from './jsonld.js';
import { splitTitle } from './title.js';

/**
 * @param {Document} doc
 * @param {...string} keys
 */
export function metaContent(doc, ...keys) {
    for (const key of keys) {
        const element = doc.querySelector(`meta[property="${key}"], meta[name="${key}"], meta[itemprop="${key}"]`);
        const content = cleanLine(element?.getAttribute('content'));

        if (content !== '') {
            return content;
        }
    }

    return '';
}

/**
 * @param {Document} doc
 * @param {{ pageUrl?: string, parser?: DOMParser }} [options]
 */
export function extractMeta(doc, { pageUrl = '', parser = new DOMParser() } = {}) {
    const rawTitle = decodeLine(metaContent(doc, 'og:title', 'twitter:title'), parser);
    const parts = splitTitle(rawTitle, siteOf(pageUrl));

    return {
        fields: dropEmpty({
            title: parts.title ?? '',
            company: parts.company ?? '',
            location: parts.location ?? '',
            url: doc.querySelector('link[rel="canonical" i]')?.getAttribute('href') || metaContent(doc, 'og:url'),
        }),
        teaser: decodeLine(metaContent(doc, 'og:description', 'description', 'twitter:description'), parser),
    };
}
