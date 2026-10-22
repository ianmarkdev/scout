# Security and privacy

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Temporary access to the tab you are on, granted only when you click the extension icon. There is no access to any site otherwise. |
| `scripting` | Runs `snapshotPage()` in that tab after your click. |
| `storage` | Settings in `chrome.storage.local`, unsaved popup edits in `chrome.storage.session`. |
| `optional_host_permissions: http://*/*, https://*/*` | Declared so the extension can **ask** for access to your Career Engine address. Only that one origin is requested (`<origin>/*`) when you save Settings, and access to a previous address is removed. No site is granted at install. |

There are no content scripts declared in the manifest, no background service worker, no remote code, no `eval`, and no third-party runtime libraries. The extension pages' CSP is `script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`.

## What is read from a page

`src/content/snapshot.js` is the only code that runs in a web page, and only after your click. It returns:

- the page URL and title
- the page's current HTML (up to 5 MB)
- any text you have selected

It doesn't read cookies, local storage, form input values, credentials, or other tabs. It doesn't make network requests or change the page.

The HTML is parsed in the popup with `DOMParser`, which creates an inert document: scripts don't run and resources don't load. Values are written to the popup with `textContent` and form `value`, never as HTML. Links back to Career Engine are shown only when they point at the configured origin.

## What is sent, and when

**Only when you press Save** (or "Save a copy anyway", or "Test connection" in Settings), the extension sends one request to `{your Career Engine address}/api/extension/applications`. It sends the fields shown in the popup plus the capture metadata (method, site, listing ID, posted date, workplace type, structured salary, capture time).

**Never sent:** the page HTML, cookies, the selected text (unless you put it in the description), or anything to any other server. Requests use `credentials: 'omit'`, so your browser cookies for the Career Engine site are never attached, and `redirect: 'error'`, so the token can't be forwarded through a redirect.

## Credential handling

- The API token is stored in `chrome.storage.local`. Other extensions and web pages can't read it, but **anyone or any program with access to your browser profile on disk can**. Treat it like a password.
- The token is deliberately narrow:
  - It has one ability (`applications:capture`): it can create applications, and can't read, list, edit or delete anything.
  - It expires after 90 days by default.
  - It can be revoked: `php artisan app:extension-token you@example.com --revoke`.
  - It is stored hashed on the server.
- Session cookies and website login credentials are never stored. The API accepts bearer tokens only (Sanctum `guard` and `stateful` are empty).
- Plain `http://` is accepted only for local development hosts (`localhost`, `127.x.x.x`, `*.test`, `*.localhost`). Use HTTPS for any remote Career Engine, or the token travels unencrypted.
- "Remove token" in Settings deletes the local copy. Revoke it on the server too if it may have leaked.

## Server-side protections (Career Engine)

The extension's checks are only for convenience. The server validates on its own:

- Every field is validated and normalised by `CaptureJobApplicationRequest`, with the same limits as the web form. Unknown `capture` keys are rejected. Security-sensitive fields (workspace, owner, stage, notes) are never read from the request.
- The model is write-guarded (`$guarded = ['*']`) and created only through `JobApplicationService`.
- Tenant isolation comes from the token owner's membership (`SetTenantContext` + `WorkspaceScope`). Duplicate lookups are workspace-scoped.
- Deactivated accounts, accounts without a membership, and candidates without 2FA are refused (403).
- Requests are rate limited to 30 per minute per user. Text limits (50,000 characters for descriptions) bound the request size, on top of PHP's `post_max_size`.
- Descriptions are stored as plain text, and Career Engine renders them as text.

## Privacy

- Job data goes only to your own Career Engine instance.
- Unsaved edits live in `chrome.storage.session` (memory only) until you save, re-extract, or close the browser.
- No analytics, telemetry or logging to external services.
- Raw page text isn't stored or transmitted for troubleshooting. The popup shows which layer each field came from, along with any extraction warnings.

## Known limitations

- A token stored in the browser can be copied by local malware or by anyone using your profile. Keep expiry short and revoke when in doubt.
- With the default `abilities` check, any token with `applications:capture` works for the account it belongs to. Tokens can't be scoped to a single browser.
- Page HTML can contain hidden content such as the site's own CSRF tokens. It stays inside the popup's memory and isn't sent, but it is read.
