import { describe, expect, test } from 'vitest';
import { dateOnly, employmentTypeFrom, locationFromJsonLd, locationWithWorkplace, workplaceTypeFrom } from '../src/lib/fields.js';
import { buildPayload, emptyForm, salaryTextFromFields, validateForm } from '../src/lib/form.js';
import { formatSalary, parseSalaryText, salaryFromJsonLd } from '../src/lib/salary.js';
import { looksLikeToken } from '../src/lib/storage.js';
import { htmlToText } from '../src/lib/text.js';
import { listingUrl, normalizeBaseUrl, siteOf } from '../src/lib/url.js';

describe('salary', () => {
    test.each([
        ['£70,000 - £85,000 per annum', { min: 70000, max: 85000, currency: 'GBP', period: 'year' }],
        ['$120k–150k / year', { min: 120000, max: 150000, currency: 'USD', period: 'year' }],
        ['US$120K to $140K', { min: 120000, max: 140000, currency: 'USD', period: '' }],
        ['€50.000 bis 60.000', { min: 50000, max: null, currency: 'EUR', period: '' }],
        ['EUR 50.000 - 60.000 per year', { min: 50000, max: 60000, currency: 'EUR', period: 'year' }],
        ['£450 - £550 per day (outside IR35)', { min: 450, max: 550, currency: 'GBP', period: 'day' }],
        ['£18.50 per hour', { min: 18.5, max: null, currency: 'GBP', period: 'hour' }],
        ['70,000 - 85,000 GBP annually', { min: 70000, max: 85000, currency: 'GBP', period: 'year' }],
        ['£70-85k', { min: 70000, max: 85000, currency: 'GBP', period: '' }],
        ['CA$90,000 a year', { min: 90000, max: null, currency: 'CAD', period: 'year' }],
        ['£3,500 pcm', { min: 3500, max: null, currency: 'GBP', period: 'month' }],
    ])('parses %s', (text, expected) => {
        expect(parseSalaryText(text)).toEqual(expected);
    });

    test.each(['Competitive salary', 'Up to 25 days holiday', '', '10 years of experience', 'Salary: DOE'])('finds no salary in %s', (text) => {
        expect(parseSalaryText(text)).toBeNull();
    });

    test('a descending range keeps only the minimum', () => {
        expect(parseSalaryText('£50,000 and 20 days')).toEqual({ min: 50000, max: null, currency: 'GBP', period: '' });
    });

    test('reads schema.org MonetaryAmount variants', () => {
        expect(salaryFromJsonLd({ currency: 'usd', value: { minValue: '90000', maxValue: 80000, unitText: 'YEAR' } }))
            .toEqual({ min: 80000, max: 90000, currency: 'USD', period: 'year' });
        expect(salaryFromJsonLd([{ currency: 'GBP', value: 35, unitText: 'HOUR' }])).toEqual({ min: 35, max: null, currency: 'GBP', period: 'hour' });
        expect(salaryFromJsonLd({ currency: 'GBP', value: { value: 0 } })).toBeNull();
        expect(salaryFromJsonLd({ currency: 'bad!', value: { minValue: 1 } })).toEqual({ min: 1, max: null, currency: '', period: '' });
        expect(salaryFromJsonLd(null)).toBeNull();
    });

    test('formats ranges, single amounts and maximums', () => {
        expect(formatSalary({ min: 70000, max: 85000, currency: 'GBP', period: 'year' })).toBe('GBP 70,000–85,000 / year');
        expect(formatSalary({ min: 550, max: null, currency: '', period: 'day' })).toBe('550 / day');
        expect(formatSalary({ min: null, max: 90000, currency: 'EUR', period: '' })).toBe('EUR up to 90,000');
        expect(formatSalary(null)).toBe('');
    });
});

describe('employment and workplace types', () => {
    test.each([
        ['FULL_TIME', 'full_time'], [['PART_TIME', 'FULL_TIME'], 'part_time'], ['CONTRACTOR', 'contract'],
        ['Fixed-term', 'contract'], ['TEMPORARY', 'contract'], ['INTERN', 'internship'], ['Freelance', 'freelance'],
        ['VOLUNTEER', 'other'], ['Permanent', ''], [42, ''], [null, ''],
    ])('%j → %s', (value, expected) => {
        expect(employmentTypeFrom(value)).toBe(expected);
    });

    test.each([
        ['London (Hybrid)', 'hybrid'], ['Fully remote, UK', 'remote'], ['Remote first, hybrid optional', 'hybrid'],
        ['Work from home', 'remote'], ['On-site in Leeds', 'on_site'], ['Onsite', 'on_site'], ['In-office 5 days', 'on_site'],
        ['Leeds', ''], ['Remoteness', ''],
    ])('%s → %s', (text, expected) => {
        expect(workplaceTypeFrom(text)).toBe(expected);
    });

    test('folds the workplace type into the location without repeating it', () => {
        expect(locationWithWorkplace('London', 'hybrid')).toBe('London (hybrid)');
        expect(locationWithWorkplace('London (Hybrid)', 'hybrid')).toBe('London (Hybrid)');
        expect(locationWithWorkplace('', 'remote')).toBe('Remote');
        expect(locationWithWorkplace('Leeds', '')).toBe('Leeds');
        expect(locationWithWorkplace('x'.repeat(195), 'on_site')).toBe('x'.repeat(195));
    });
});

describe('dates and locations', () => {
    test('dateOnly keeps valid dates and rejects invalid ones', () => {
        expect(dateOnly('2026-10-01T09:00:00+01:00')).toBe('2026-10-01');
        expect(dateOnly('2026-02-30')).toBe('');
        expect(dateOnly('October 5, 2026 12:00 UTC')).toBe('2026-10-05');
        expect(dateOnly('soon')).toBe('');
        expect(dateOnly(undefined)).toBe('');
    });

    test('locationFromJsonLd handles one, many and odd places', () => {
        expect(locationFromJsonLd({ address: { addressLocality: 'Paris', addressCountry: { name: 'France' } } })).toBe('Paris, France');
        expect(locationFromJsonLd([{ address: 'Berlin' }, { name: 'Munich' }, { address: 'Berlin' }])).toBe('Berlin; Munich');
        expect(locationFromJsonLd(['A', 'B', 'C', 'D', 'E'].map((city) => ({ address: { addressLocality: city } })))).toBe('A; B; C (+2 more)');
        expect(locationFromJsonLd(undefined)).toBe('');
    });
});

describe('text', () => {
    test('keeps paragraphs and list items, drops scripts and hidden content', () => {
        const text = htmlToText('<h2>Role</h2><p>Line one<br>line two</p><ul><li>A</li><li>B</li></ul><script>x()</script><p hidden>secret</p><style>p{}</style>');

        expect(text).toBe('Role\n\nLine one\nline two\n\n- A\n\n- B');
    });

    test('does not execute or keep markup from the page', () => {
        expect(htmlToText('<img src=x onerror="alert(1)">Hello <b>world</b>')).toBe('Hello world');
    });
});

describe('urls', () => {
    test('listingUrl prefers a same-site canonical URL and drops fragments', () => {
        expect(listingUrl('https://www.jobs.example.com/view?jk=1#apply', ['https://jobs.example.com/job/1'])).toBe('https://jobs.example.com/job/1');
        expect(listingUrl('https://jobs.example.com/view?jk=1', ['/'])).toBe('https://jobs.example.com/view?jk=1');
        expect(listingUrl('ftp://x.example/a', [])).toBe('');
        expect(siteOf('https://www.Example.COM/a')).toBe('example.com');
    });

    test('normalizeBaseUrl accepts local http and remote https only', () => {
        expect(normalizeBaseUrl(' http://127.0.0.1:8000/ ')).toEqual({ ok: true, url: 'http://127.0.0.1:8000', origin: 'http://127.0.0.1:8000' });
        expect(normalizeBaseUrl('http://career-engine.test')).toMatchObject({ ok: true });
        expect(normalizeBaseUrl('https://careers.example.com/app/')).toEqual({ ok: true, url: 'https://careers.example.com/app', origin: 'https://careers.example.com' });
        expect(normalizeBaseUrl('http://careers.example.com')).toMatchObject({ ok: false });
        expect(normalizeBaseUrl('https://user:pw@x.example')).toMatchObject({ ok: false });
        expect(normalizeBaseUrl('javascript:alert(1)')).toMatchObject({ ok: false });
        expect(normalizeBaseUrl('127.0.0.1:8000')).toMatchObject({ ok: false });
        expect(normalizeBaseUrl('')).toMatchObject({ ok: false });
    });

    test('looksLikeToken recognises Sanctum tokens', () => {
        expect(looksLikeToken(`12|${'a1B'.repeat(14)}`)).toBe(true);
        expect(looksLikeToken('secret')).toBe(false);
    });
});

describe('form', () => {
    const filled = () => ({ ...emptyForm(), title: 'Engineer', company: 'Acme', description: 'Build things.', url: 'https://x.example/job/1' });

    test('requires a title (company is optional) and enforces Career Engine limits', () => {
        expect(validateForm(emptyForm())).toMatchObject({ title: expect.any(String) });
        expect(validateForm(emptyForm()).company).toBeUndefined();
        expect(validateForm(filled())).toEqual({});
        expect(validateForm({ ...filled(), description: 'x'.repeat(50001) }).description).toContain('Nothing is cut automatically');
        expect(validateForm({ ...filled(), url: 'not a url' }).url).toBeDefined();
        expect(validateForm({ ...filled(), salaryMin: '90000', salaryMax: '50000' }).salaryMax).toBeDefined();
        expect(validateForm({ ...filled(), salaryMin: 'lots' }).salaryMin).toBeDefined();
        expect(validateForm({ ...filled(), salaryCurrency: 'pounds' }).salaryCurrency).toBeDefined();
    });

    test('builds the API payload without trimming the description content', () => {
        const description = 'Line one.\n\n- item';
        const payload = buildPayload(
            { ...filled(), description, location: 'London', workplaceType: 'hybrid', salaryMin: '70,000', salaryMax: '85000', salaryCurrency: 'gbp', salaryPeriod: 'year', salaryText: 'GBP 70,000–85,000 / year', employmentType: 'full_time', externalId: ' R-1 ' },
            { method: 'json-ld', capturedAt: '2026-10-22T10:00:00.000Z' },
        );

        expect(payload).toEqual({
            company_name: 'Acme',
            role_title: 'Engineer',
            source_url: 'https://x.example/job/1',
            location: 'London (hybrid)',
            employment_type: 'full_time',
            salary_text: 'GBP 70,000–85,000 / year',
            deadline_on: null,
            job_description: description,
            capture: {
                method: 'json-ld',
                site: 'x.example',
                external_id: 'R-1',
                posted_at: null,
                workplace_type: 'hybrid',
                salary: { min: 70000, max: 85000, currency: 'GBP', period: 'year' },
                captured_at: '2026-10-22T10:00:00.000Z',
            },
            allow_duplicate: false,
        });
    });

    test('empty optional fields are sent as null', () => {
        const payload = buildPayload({ ...emptyForm(), title: 'T', company: 'C' }, { method: 'manual', capturedAt: 'now', allowDuplicate: true });

        expect(payload).toMatchObject({ source_url: null, location: null, job_description: null, allow_duplicate: true });
        expect(buildPayload({ ...emptyForm(), title: 'T' }, { method: 'manual', capturedAt: 'now' }).company_name).toBeNull();
        expect(payload.capture.salary).toBeNull();
    });

    test('salary text follows the structured salary fields', () => {
        expect(salaryTextFromFields({ ...emptyForm(), salaryMin: '30000', salaryCurrency: 'eur', salaryPeriod: 'year' })).toBe('EUR 30,000 / year');
    });
});
