import { describe, expect, test } from 'vitest';
import { extractJob } from '../src/extract/index.js';
import { snapshotOf } from './helpers.js';

describe('JSON-LD JobPosting', () => {
    test('extracts every field from a complete posting', () => {
        const result = extractJob(snapshotOf('jsonld-full.html'));

        expect(result.method).toBe('json-ld');
        expect(result.fields).toMatchObject({
            title: 'Senior Backend Engineer',
            company: 'Northwind Payments',
            location: 'London, England, GB',
            employmentType: 'full_time',
            workplaceType: '',
            salary: { min: 70000, max: 85000, currency: 'GBP', period: 'year' },
            postedAt: '2026-10-01',
            deadline: '2026-11-30',
            externalId: 'REQ-123',
            url: 'https://jobs.example.com/northwind/123',
            site: 'jobs.example.com',
        });
        expect(result.fields.description).toBe(
            'We are hiring a backend engineer to build payment systems.\n\nRequirements\n\n- 5+ years of PHP\n\n- PostgreSQL\n\nBenefits & perks included.',
        );
        expect(result.sources).toMatchObject({ title: 'json-ld', company: 'json-ld', description: 'json-ld', salary: 'json-ld' });
        expect(result.missing).toEqual([]);
        expect(result.warnings).toEqual([]);
    });

    test('finds a posting inside @graph, with double-escaped HTML, a string organisation and remote work', () => {
        const result = extractJob(snapshotOf('jsonld-graph.html', 'https://board.example.com/jobs/pe-77'));

        expect(result.fields).toMatchObject({
            title: 'Platform Engineer (R&D)',
            company: 'Contoso Cloud',
            location: 'United Kingdom',
            workplaceType: 'remote',
            employmentType: 'contract',
            salary: { min: 550, max: null, currency: 'GBP', period: 'day' },
            externalId: 'PE-77',
            url: 'https://board.example.com/jobs/pe-77',
        });
        expect(result.fields.description).toBe('Run our Kubernetes platform.\n\n- Terraform');
    });

    test('skips malformed JSON-LD with a warning and falls back to metadata and the DOM', () => {
        const result = extractJob(snapshotOf('jsonld-malformed.html', 'https://example-jobs.com/view/555?utm_source=feed&ref=x'));

        expect(result.warnings).toContain('A structured-data block on this page is not valid JSON and was skipped.');
        expect(result.method).toBe('meta');
        expect(result.fields).toMatchObject({
            title: 'Data Analyst',
            company: 'Fabrikam',
            location: 'Manchester, UK · Hybrid',
            workplaceType: 'hybrid',
            salary: { min: 35000, max: 42000, currency: 'GBP', period: 'year' },
            employmentType: 'full_time',
            url: 'https://example-jobs.com/view/555?utm_source=feed',
        });
        expect(result.sources).toMatchObject({ title: 'meta', company: 'meta', location: 'dom', salary: 'dom', employmentType: 'fallback' });
        expect(result.fields.description).toContain('You will build dashboards, write SQL');
        expect(result.fields.description).toContain('- Python or R');
    });
});

describe('metadata', () => {
    test('splits a "Company hiring Title in Location | Site" title and uses the canonical URL', () => {
        const result = extractJob(snapshotOf('meta-only.html', 'https://www.linkedin.example/jobs/view/987654/?trk=public#top'));

        expect(result.fields).toMatchObject({
            title: 'Product Designer',
            company: 'Acme Corp',
            location: 'Bristol, England',
            url: 'https://www.linkedin.example/jobs/view/987654',
            site: 'linkedin.example',
        });
        expect(result.fields.description).toBe('Posted 3 days ago. Acme Corp is looking for a Product Designer…');
        expect(result.sources.description).toBe('meta');
        expect(result.warnings.join(' ')).toContain('Only a short summary of the description was found');
    });
});

describe('DOM fallback', () => {
    test('reads common job-page markup when there is no structured data', () => {
        const result = extractJob(snapshotOf('dom-only.html', 'https://careers.tailspin.example/jobs/qa'));

        expect(result.method).toBe('dom');
        expect(result.fields).toMatchObject({
            title: 'QA Engineer',
            company: 'Tailspin Toys',
            location: 'Leeds',
            employmentType: 'part_time',
            salary: { min: 45000, max: 60000, currency: 'USD', period: 'year' },
        });
        expect(result.fields.description).toContain('About the role');
        expect(result.fields.description).toContain('- Playwright or Cypress');
        expect(result.fields.description).not.toContain('ignore me');
        expect(result.fields.description).not.toContain('Apply now');
    });

    test('uses the page title and main text block as a last resort', () => {
        const result = extractJob(snapshotOf('bare.html', 'https://charity.example.org/jobs/support'));

        expect(result.fields.title).toBe('Support Specialist');
        expect(result.fields.company).toBe('');
        expect(result.fields.workplaceType).toBe('hybrid');
        expect(result.fields.salary).toEqual({ min: 28000, max: 31000, currency: 'GBP', period: 'year' });
        expect(result.fields.description).toContain('two days a week in our Glasgow office');
        expect(result.fields.description).not.toContain('Privacy');
        expect(result.missing).toEqual(['company', 'location', 'employmentType']);
    });
});

describe('missing and unusual input', () => {
    test('an empty page yields empty fields, not guesses', () => {
        const result = extractJob({ url: 'https://example.com/', title: '', html: '<html><body></body></html>' });

        expect(result.method).toBe('manual');
        expect(result.fields).toMatchObject({ title: '', company: '', location: '', description: '', salary: null, employmentType: '', workplaceType: '' });
        expect(result.missing).toEqual(['title', 'company', 'location', 'description', 'salary', 'employmentType']);
    });

    test('a missing title or company is reported as missing', () => {
        const html = '<html><head><script type="application/ld+json">{"@type":"JobPosting","description":"<p>Only a description that is long enough to count as the full job description for this listing, with more words to pass the threshold of two hundred characters easily.</p>"}</script></head><body></body></html>';
        const result = extractJob({ url: 'https://x.example/job', html });

        expect(result.fields.description).toContain('Only a description');
        expect(result.missing).toContain('title');
        expect(result.missing).toContain('company');
    });

    test('a long description is kept in full', () => {
        const paragraphs = Array.from({ length: 2500 }, (_, i) => `<p>Paragraph ${i} about the role.</p>`).join('');
        const html = `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Engineer', description: paragraphs })}</script></head><body></body></html>`;
        const result = extractJob({ url: 'https://x.example/job', html });

        expect(result.fields.description.length).toBeGreaterThan(60000);
        expect(result.fields.description.endsWith('Paragraph 2499 about the role.')).toBe(true);
    });

    test('malformed or non-web page URLs do not break extraction', () => {
        for (const url of ['not a url', 'chrome://extensions', '', 'javascript:alert(1)']) {
            const result = extractJob({ url, html: '<html><head><title>Engineer at Acme</title></head><body></body></html>' });

            expect(result.fields.url).toBe('');
            expect(result.fields.title).toBe('Engineer');
            expect(result.fields.company).toBe('Acme');
        }
    });

    test('a canonical URL on another site is ignored in favour of the page address', () => {
        const html = '<html><head><link rel="canonical" href="https://elsewhere.example/job/1"></head><body></body></html>';

        expect(extractJob({ url: 'https://jobs.example.com/a/1?jk=9#x', html }).fields.url).toBe('https://jobs.example.com/a/1?jk=9');
    });

    test('a failing site adapter is reported and the generic layers still run', () => {
        const adapter = { name: 'broken', matches: () => true, extract: () => { throw new Error('boom'); } };
        const result = extractJob(snapshotOf('jsonld-full.html'), { adapters: [adapter] });

        expect(result.fields.title).toBe('Senior Backend Engineer');
        expect(result.warnings.join(' ')).toContain('boom');
    });

    test('a site adapter wins over the generic layers', () => {
        const adapter = { name: 'example', matches: (url) => url.hostname === 'jobs.example.com', extract: () => ({ title: 'Adapter title', company: '' }) };
        const result = extractJob(snapshotOf('jsonld-full.html'), { adapters: [adapter] });

        expect(result.method).toBe('adapter');
        expect(result.fields.title).toBe('Adapter title');
        expect(result.fields.company).toBe('Northwind Payments');
    });

    test('a truncated snapshot and the user selection are passed on', () => {
        const result = extractJob({ url: 'https://x.example/', html: '<p>x</p>', truncatedHtml: true, selection: '  Selected\n\n\n\ntext  ' });

        expect(result.warnings[0]).toContain('very large');
        expect(result.selection).toBe('Selected\n\ntext');
    });
});
