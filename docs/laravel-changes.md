# Changes made to Career Engine

These changes are committed in `career-engine` as `cd1c313 wip: browser extension work`. They were limited to what the extension needs. The existing web routes, forms and data are unchanged.

## Dependency

- `laravel/sanctum` ^4.3 (approved). `config/sanctum.php` was published and set to **token-only**: `guard => []`, `stateful => []`.
- Migration `2026_10_21_115734_create_personal_access_tokens_table.php`: the stock Sanctum table, with timezone-aware timestamps to match the project. **It must be run: `php artisan migrate`.**

## New files

| File | Purpose |
|---|---|
| `routes/api.php` | `POST /api/extension/applications` with `auth:sanctum`, `abilities:applications:capture`, `verified`, `tenant`, `candidate.two-factor`, `throttle:application-capture` |
| `app/Http/Controllers/Api/CapturedApplicationController.php` | Returns 201 or 409 JSON |
| `app/Http/Requests/Api/CaptureJobApplicationRequest.php` | Extends `SaveJobApplicationRequest`: same rules and normalisation, minus stage, notes and lock_version, plus `capture.*` and `allow_duplicate` |
| `app/Domain/Applications/SourceUrl.php` | URL comparison key: drops tracking parameters, keeps meaningful ones |
| `app/Domain/Applications/DuplicateApplicationDetector.php` | Finds an application with the same listing URL (deleted ones included) |
| `app/Domain/Applications/DuplicateApplication.php` | Exception carrying the existing application |
| `app/Console/Commands/ExtensionToken.php` | `app:extension-token {email} [--days] [--name] [--list] [--revoke]` |
| `tests/Feature/Api/ApplicationCaptureTest.php` | Creation, validation, authentication, permissions, 2FA, rate limit, duplicates, tenant isolation, the token command |
| `tests/Unit/Domain/Applications/SourceUrlTest.php` | URL normalisation |

## Modified files

| File | Change |
|---|---|
| `app/Models/User.php` | `HasApiTokens` trait |
| `bootstrap/app.php` | Registers `routes/api.php` and the `abilities` middleware alias |
| `app/Providers/AppServiceProvider.php` | `application-capture` rate limiter (30 per minute per user) |
| `app/Domain/Applications/JobApplicationService.php` | New `capture()`: advisory lock, duplicate check, then the existing `create()` plus an `application.captured` audit event. `create()` itself is unchanged. |
| `app/Http/Middleware/SetTenantContext.php` | For requests without a session (API), a deactivated user gets 403 instead of a session logout and redirect |
| `app/Http/Middleware/EnsureCandidateHasTwoFactor.php` | For requests without a session, 403 JSON instead of an Inertia redirect |

Web requests behave as before. The full Career Engine suite passed after these changes (355 passed, 2 skipped).

## Follow-up: company name optional for captures

- Migration `2026_10_22_120000_make_job_applications_company_name_nullable.php` makes `job_applications.company_name` nullable. Its `down()` turns nulls into `''`.
- `CaptureJobApplicationRequest`: `company_name` is nullable (max 200). A blank or whitespace-only company is stored as `null`, and the 201/409 responses return `company_name: null`. **The web form still requires a company**, so editing such an application in Career Engine asks for one.
- `JobApplication::companyLabel()` returns "Unknown company" when there is none. It is used in the activity feed, the AI analysis prompt and the resume "applied from" note, because prompt rendering needs a string.
- Frontend: `JobApplication.company_name` is now `string | null`, and the pages show `companyLabel()` from `resources/js/lib/applications.ts` in the tracker, detail, analysis, questions, resume and stage select.

## Not changed

- No new job table or model. Captures use `job_applications` and `job_postings`.
- No schema change for duplicates. The comparison happens in PHP, which is fine at a few hundred applications per workspace (D1).
- No CORS configuration. It isn't needed, because the extension uses host permissions.
- No UI for tokens. Tokens are managed with the artisan command.
