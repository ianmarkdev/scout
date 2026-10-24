# Career Clipper

A Chrome extension (Manifest V3, plain JavaScript modules, no build step) that saves the job listing you are looking at into your **Career Engine** app as a new application in the **Saved** stage.

- It reads a page **only when you click the extension icon**. There is no background crawling, and it needs no access to any site until you click.
- It shows what it found in an editable form. **Nothing is sent until you press Save.**
- Saving goes to one Career Engine endpoint, authenticated with a narrow API token that can only create applications.
- Saving a listing you already have is refused, and the existing application is left unchanged. You can save a separate copy if you want to.

## Prerequisites

- Chrome 110 or newer (or another Chromium browser).
- Career Engine running with the extension API. That means the `wip: browser extension work` commit or later, and its migrations run (`php artisan migrate` creates `personal_access_tokens`).
- An account that is an active workspace member. A candidate account must have two-factor authentication turned on.
- Node.js 20+ to run the tests. The extension itself has no runtime dependencies.

## Install (Load unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder (`career-cliper/`, the one with `manifest.json`).
4. Pin **Career Clipper** from the puzzle-piece menu if you want it in the toolbar.

After you change the code, press the reload icon on the extension's card, then close and reopen the side panel.

## Connect it to Career Engine

1. In the `career-engine` folder, create a token for your account:

   ```bash
   php artisan app:extension-token you@example.com            # expires in 90 days
   php artisan app:extension-token you@example.com --days=30  # shorter
   php artisan app:extension-token you@example.com --list     # see your tokens
   php artisan app:extension-token you@example.com --revoke   # revoke all extension tokens
   ```

   The token is printed once and looks like `12|AbC…`.
2. Open the extension's **Settings** (the link in the popup, or right-click the icon → Options).
3. Enter the Career Engine address, for example `http://127.0.0.1:8000` (`php artisan serve`) or `https://career-engine.test` (Herd). Plain `http://` is accepted only for this computer (`localhost`, `127.x.x.x`, `*.test`, `*.localhost`). Use `https://` for anything else.
4. Paste the token and press **Save and allow access**. Chrome asks to let the extension reach that one address. Choose **Allow**.
5. Press **Test connection**. It sends an empty request, which proves the address and token work without saving anything.

## Capture a job

1. Open a job listing.
2. Click the Career Clipper icon. It opens in the browser's side panel (Chrome 116 or later), reads the page and fills in the form. The panel stays open as you switch tabs and reads each job tab you move to; drag its edge to make it wider. Small badges show where each value came from: `JSON-LD`, `meta`, `page`, or `guess`.
3. Check and correct the details. Fields that could not be found are listed and left empty, never guessed. If only a teaser description was found, select the full description on the page, press **Re-extract**, and then **Use selected text as description**.
4. Press **Save to Career Engine**. Possible outcomes:
   - **Saved**: there's a link to the new application.
   - **Already saved**: a link to the existing application, which is unchanged. **Save a copy anyway** creates a second application.
   - **Validation, authentication, network or server errors**: these are explained in the panel, and your edits stay in the form.

Unsaved edits are kept per page until the browser closes, so switching tab or closing the panel loses nothing.

By default the panel can read only the tab you clicked the icon on. When you switch to another tab, it offers **Allow on all websites**, a one-time opt-in that lets it read whichever tab is active. Without it, click the icon again on each listing. **Re-extract** asks before throwing your edits away.

### What gets saved where

| Popup field | Career Engine |
|---|---|
| Job title, Company | `role_title` (required), `company_name` (optional) |
| Location + Workplace | `location`, e.g. "London (hybrid)" |
| Employment type | `employment_type` |
| Salary "Saved as" | `salary_text` |
| Closing date | `deadline_on` |
| Listing URL | `source_url`, also used for duplicate detection |
| Description | the application's job description (stored verbatim, up to 50,000 characters) |
| Workplace, structured salary, posted date, listing ID, extraction method, site | recorded in the `application.captured` audit event |

Notes, stage and assignment are never set by the extension.

## How extraction works

The popup injects one small function into the page (`src/content/snapshot.js`). It returns the page URL, the title, the current HTML and any selected text. Everything else happens in the popup on an inert copy of the page, through these layers in priority order. The first value found for each field wins.

1. **Site adapters** (`src/extract/adapters/`): none yet. Add one only for a site the generic layers get wrong.
2. **JSON-LD `JobPosting`**, including `@graph`, arrays, double-escaped HTML, and lenient parsing of slightly broken JSON.
3. **Meta tags**: `og:title` patterns such as "Acme hiring Designer in Bristol | Site" or "Designer at Acme", plus the canonical URL.
4. **DOM patterns**: microdata and common class, id and `data-testid` names.
5. **Text heuristics**: the page title, the densest text block, and salary, workplace and employment-type keywords.

### Known limitations

- **Embedded job boards in iframes** (for example a Greenhouse or Lever board inside a company site) are not read. Open the listing in its own tab first.
- **Shadow DOM** content and **canvas-rendered** text are not seen.
- Pages that load the description only after a click (for example "Show more") need that click before you open the popup.
- Pages behind logins are read only as you see them. The extension never logs in or gets around access controls, CAPTCHAs or paywalls.
- `$` without a country prefix is taken as USD. Ambiguous text such as "£50k and 20 days" keeps only the clear part.
- Pages over about 5 MB of HTML are read only partly, and the popup says so.
- Duplicate detection is by URL (see the API contract). The same job posted at two different URLs is not detected.

## Tests

```bash
npm install
npm test
```

Vitest with happy-dom is used for testing only. These are dev dependencies and nothing from them ships in the extension. The tests use the local HTML fixtures in `tests/fixtures/` and never touch live job sites:

- `extract.test.js`: JSON-LD (complete, `@graph`, malformed), metadata, DOM and text fallbacks, missing fields, long descriptions, odd URLs, adapters.
- `lib.test.js`: salary ranges, currencies and periods; remote, hybrid and on-site detection; employment types; dates; URLs; form validation and payload.
- `api.test.js`: every HTTP outcome, network failure and timeout, and safe links.
- `popup.test.js`: display, editing, nothing sent before Save, validation, duplicates, errors, draft restore, double-click protection, HTML-safe display.
- `options.test.js`: settings validation, permissions, test connection, removing the token.

The Laravel side is tested in Career Engine (`php artisan test tests/Feature/Api tests/Unit/Domain/Applications`).

## Files

```
manifest.json           MV3 manifest (activeTab, scripting, storage, sidePanel; host access requested at runtime)
src/background.js       opens the side panel when the icon is clicked
src/popup/              side panel UI and controller
src/options/            settings page
src/content/snapshot.js the only code that runs in the job page
src/extract/            extraction layers and adapter registry
src/lib/                text, salary, fields, URL, form, API and storage helpers
docs/                   API contract, security notes, Laravel changes
scripts/make-icons.mjs  regenerates icons/ (npm run icons)
```

See [docs/laravel-api-contract.md](docs/laravel-api-contract.md), [docs/security.md](docs/security.md) and [docs/laravel-changes.md](docs/laravel-changes.md).
