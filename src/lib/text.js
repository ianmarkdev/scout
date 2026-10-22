/**
 * Plain-text helpers. Career Engine stores job descriptions as plain text, so extracted HTML is
 * flattened here: block elements become line breaks, list items become "- " lines, and nothing
 * from the page is ever rendered as HTML by the extension.
 */

const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
    'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'THEAD', 'TR', 'UL',
]);

/** Never visible text, or controls whose labels would only add noise. */
const SKIPPED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA',
    'IFRAME', 'CANVAS', 'OBJECT', 'HEAD', 'META', 'LINK',
]);

/**
 * Text of an element as a reader would see it, keeping paragraphs and list items.
 * @param {Node | null | undefined} root
 * @returns {string}
 */
export function elementToText(root) {
    if (!root) {
        return '';
    }

    /** @type {string[]} */
    const out = [];

    const walk = (/** @type {Node} */ node) => {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === 3) {
                out.push((child.nodeValue ?? '').replace(/\s+/g, ' '));
                continue;
            }

            if (child.nodeType !== 1) {
                continue;
            }

            const element = /** @type {Element} */ (child);
            const tag = element.tagName.toUpperCase();

            if (SKIPPED_TAGS.has(tag) || element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
                continue;
            }

            if (tag === 'BR') {
                out.push('\n');
                continue;
            }

            const isBlock = BLOCK_TAGS.has(tag);

            if (isBlock) {
                out.push('\n');
            }

            if (tag === 'LI') {
                out.push('- ');
            }

            walk(element);

            if (isBlock) {
                out.push('\n');
            } else if (tag === 'TD' || tag === 'TH') {
                out.push(' ');
            }
        }
    };

    walk(root);

    return tidy(out.join(''));
}

/**
 * Collapse spaces, trim every line, and keep at most one blank line in a row.
 * @param {string} text
 */
export function tidy(text) {
    return String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\t  ​]+/g, ' ')
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * A one-line value (title, company, location): whitespace collapsed, trimmed.
 * @param {unknown} value
 */
export function cleanLine(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Plain text from an HTML string (e.g. a JSON-LD description). Descriptions that were
 * HTML-escaped twice ("&lt;p&gt;…") are unescaped once more.
 * @param {unknown} html
 * @param {DOMParser} [parser]
 */
export function htmlToText(html, parser = new DOMParser()) {
    if (typeof html !== 'string' || html.trim() === '') {
        return '';
    }

    let doc = parser.parseFromString(html, 'text/html');
    const asText = doc.body?.textContent ?? '';

    if (/<\/?(p|br|li|ul|ol|div|strong|b|em|h[1-6])\b[^>]*>/i.test(asText)) {
        doc = parser.parseFromString(asText, 'text/html');
    }

    return elementToText(doc.body);
}

/**
 * Decode entities in a short value ("R&amp;D Engineer" → "R&D Engineer").
 * @param {unknown} value
 * @param {DOMParser} [parser]
 */
export function decodeLine(value, parser = new DOMParser()) {
    if (typeof value !== 'string') {
        return '';
    }

    return cleanLine(/[&<]/.test(value) ? htmlToText(value, parser) : value);
}
