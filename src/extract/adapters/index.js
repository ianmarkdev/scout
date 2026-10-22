/**
 * Site-specific adapters. None are needed yet: the generic layers cover pages with JSON-LD
 * and common markup. Add one only for a site the generic layers get wrong, e.g.
 *
 *   export const ADAPTERS = [{
 *       name: 'example-board',
 *       matches: (url) => url.hostname.endsWith('example-board.com'),
 *       extract: (doc, url) => ({ title: doc.querySelector('.posting h1')?.textContent ?? '' }),
 *   }];
 *
 * An adapter returns any subset of the extracted fields (see FIELDS in ../index.js). Its values
 * win over the generic layers; empty values are ignored. Keep adapters read-only: they get a
 * detached copy of the page and must not fetch anything.
 *
 * @typedef {{ name: string, matches: (url: URL) => boolean, extract: (doc: Document, url: URL) => Record<string, unknown> }} Adapter
 */

/** @type {Adapter[]} */
export const ADAPTERS = [];
