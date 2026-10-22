# Career Engine API contract (browser extension)

This describes what is implemented and tested in Career Engine: `routes/api.php`, `CapturedApplicationController`, `CaptureJobApplicationRequest`, `JobApplicationService::capture()` and `tests/Feature/Api/ApplicationCaptureTest.php`.

## Endpoint

`POST {baseUrl}/api/extension/applications` (route name `api.extension.applications.store`)

Middleware, in order:

| Middleware | Effect |
|---|---|
| `auth:sanctum` | Bearer token only. Sanctum's `guard` and `stateful` are empty, so session cookies are never accepted. |
| `abilities:applications:capture` | The token must have this ability. Tokens from `app:extension-token` have only this ability. |
| `verified` | The account's email must be verified. |
| `tenant` | The workspace comes from the token owner's membership. An inactive user or a user with no membership gets 403. |
| `candidate.two-factor` | A candidate without 2FA gets 403. |
| `throttle:application-capture` | 30 requests per minute per user. |

Who can capture: the candidate and VAs (the same rule as adding an application in the web app).

## Request

Headers: `Authorization: Bearer <token>`, `Accept: application/json`, `Content-Type: application/json`.

```json
{
  "company_name": "Northwind Payments",
  "role_title": "Senior Backend Engineer",
  "source_url": "https://jobs.example.com/listing/123",
  "location": "London (hybrid)",
  "employment_type": "full_time",
  "salary_text": "GBP 70,000–85,000 / year",
  "deadline_on": "2026-11-30",
  "job_description": "Plain text…",
  "capture": {
    "method": "json-ld",
    "site": "jobs.example.com",
    "external_id": "REQ-123",
    "posted_at": "2026-10-01",
    "workplace_type": "hybrid",
    "salary": { "min": 70000, "max": 85000, "currency": "GBP", "period": "year" },
    "captured_at": "2026-10-22T10:00:00Z"
  },
  "allow_duplicate": false
}
```

| Field | Rules (validated after plain-text normalisation) |
|---|---|
| `company_name`, `role_title` | required, string, max 200 |
| `source_url` | nullable, `http`/`https` URL, max 2000 |
| `location`, `salary_text` | nullable, string, max 200 |
| `employment_type` | nullable, one of `full_time, part_time, contract, freelance, internship, other` |
| `deadline_on` | nullable, `Y-m-d` |
| `job_description` | nullable, string, max 50,000. **Rejected when longer, never truncated.** |
| `capture` | optional object. Only the keys shown above are allowed. |
| `capture.method` | `adapter, json-ld, meta, dom, fallback, manual` |
| `capture.workplace_type` | `remote, hybrid, on_site` |
| `capture.salary.min`/`max` | numeric, 0 to 100,000,000, with `max ≥ min` |
| `capture.salary.currency` | 3 uppercase letters |
| `capture.salary.period` | `hour, day, week, month, year` |
| `capture.external_id`, `capture.site` | string, max 200 and 255 |
| `capture.posted_at`, `capture.captured_at` | date |
| `allow_duplicate` | boolean, default false |

**Ignored if sent:** `notes`, `stage`, `owner_user_id`, `workspace_id`, `review_status` and any other field. The workspace, candidate profile and owner come from the token. The stage is always `saved`. Notes are left empty.

Text fields are normalised the same way as the web form: Unicode NFC, invisible and control characters stripped, and runs of spaces collapsed. The description keeps its line breaks.

Where the data goes: the `job_applications` row is created through `JobApplicationService::create()`. The description becomes a `job_postings` row with `captured_by` set to the token owner. Two audit events are recorded: `application.created`, and `application.captured` with the `capture` metadata plus `via: "browser_extension"` and `duplicate_of`.

## Responses

| Status | When | Body |
|---|---|---|
| **201** | Created | `{"data": {"ulid", "url", "company_name", "role_title", "stage": "saved", "deleted": false}}` |
| **409** | Duplicate and `allow_duplicate` is false | `{"message": "This job listing has already been saved.", "existing": {…same shape…, "deleted": true\|false}}` |
| **422** | Validation failed | `{"message": "…", "errors": {"field": ["…"]}}`. Nested fields use dot keys, e.g. `capture.salary.max`. |
| **401** | No token, unknown, revoked or expired token, or a session cookie | `{"message": "Unauthenticated."}` |
| **403** | Token lacks the ability, email unverified, account deactivated, no membership, or candidate without 2FA | `{"message": "…"}` |
| **429** | More than 30 requests in a minute | `{"message": "Too Many Attempts."}`, with a `Retry-After` header |
| **5xx** | Server error | Laravel's JSON error |

An empty body `{}` with a valid token returns **422**. The extension's "Test connection" relies on this: it creates nothing.

## Duplicates

- The listing URL is compared using `App\Domain\Applications\SourceUrl::key()`:
  - lowercase the scheme and host
  - treat `http` and `https` the same
  - drop a leading `www.`, the default port, the fragment and a trailing slash
  - drop **only** known tracking parameters: `utm_*`, `gclid`, `gclsrc`, `dclid`, `fbclid`, `msclkid`, `igshid`, `mc_cid`, `mc_eid`, `_hsenc`, `_hsmi`, `trk`, `trkInfo`, `trackingId`, `refId`, `lipi`
  - sort the remaining parameters
  - keep every other parameter (e.g. `?jk=`, `?currentJobId=`), so different listings stay different
  - keep the path's case
- The comparison is against **all** of the workspace's applications with a source URL, including deleted ones. When a URL matches more than once, a live application is reported before a deleted one, and the oldest first.
- Applications without a source URL, and captures without one, never count as duplicates.
- A duplicate is **never updated**. Notes, stage, review and the description of the existing application are not touched.
- With `allow_duplicate: true`, a new application is created, and its `application.captured` event records `duplicate_of: <existing ulid>`.
- Captures in one workspace are serialised with a Postgres advisory transaction lock, so a double submit creates one application and returns one 409.

## CORS

Not needed. The popup calls the API from the extension's own page, with host permission granted for that origin, so Chrome doesn't apply CORS. Career Engine has no CORS configuration for this, and the extension doesn't use `no-cors`.

## Tokens

The `app:extension-token {email}` options are:

| Option | Effect |
|---|---|
| `--days=90` | Days until expiry. `0` means it never expires (not recommended). |
| `--name=` | A label for the token |
| `--list` | List the account's extension tokens |
| `--revoke` | Revoke all of the account's extension tokens |

Tokens are Sanctum personal access tokens (`personal_access_tokens`, stored as SHA-256 hashes) with the single ability `applications:capture`. Issuing a token is refused for unknown or inactive accounts and for candidates without 2FA.
