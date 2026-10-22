/**
 * Runs in the job page when the user clicks the extension (chrome.scripting.executeScript with
 * `func`), so it must be self-contained: no imports, no outside variables. It only reads: the
 * page's URL and title, its current HTML (after scripts rendered it), and any text the user
 * selected. No cookies, storage, form values or network access. Parsing happens in the popup.
 */
export function snapshotPage() {
    const MAX_HTML_LENGTH = 5_000_000;
    const html = document.documentElement ? document.documentElement.outerHTML : '';
    const selection = typeof window.getSelection === 'function' ? String(window.getSelection() ?? '') : '';

    return {
        url: location.href,
        title: document.title,
        html: html.length > MAX_HTML_LENGTH ? html.slice(0, MAX_HTML_LENGTH) : html,
        truncatedHtml: html.length > MAX_HTML_LENGTH,
        selection: selection.slice(0, 100_000),
    };
}
