/**
 * Layer 3: microdata and common job-page markup (class/id/data-testid naming used by ATS
 * platforms and job boards). Generic on purpose; site-specific rules belong in adapters/.
 */

import { employmentTypeFrom, workplaceTypeFrom } from '../lib/fields.js';
import { parseSalaryText } from '../lib/salary.js';
import { cleanLine, elementToText } from '../lib/text.js';
import { dropEmpty } from './jsonld.js';

const TITLE_SELECTORS = [
    '[itemprop="title"]',
    '[data-testid*="job-title" i]', '[data-testid*="jobtitle" i]',
    '[class*="job-title" i]', '[class*="jobtitle" i]', '[class*="posting-headline" i] h2',
    '[class*="job-header" i] h1', 'main h1', 'h1',
];

const COMPANY_SELECTORS = [
    '[itemprop="hiringOrganization"] [itemprop="name"]', '[itemprop="hiringOrganization"]',
    '[data-testid*="company-name" i]', '[data-testid*="companyname" i]', '[data-company-name]',
    '[class*="company-name" i]', '[class*="companyname" i]', '[class*="employer-name" i]',
    '[class*="hiring-company" i]', '[class*="company" i] a', '[class*="company" i]',
];

const LOCATION_SELECTORS = [
    '[itemprop="jobLocation"] [itemprop="addressLocality"]', '[itemprop="jobLocation"]',
    '[data-testid*="job-location" i]', '[data-testid*="location" i]',
    '[class*="job-location" i]', '[class*="joblocation" i]', '[class*="location" i]',
];

const DESCRIPTION_SELECTORS = [
    '[itemprop="description"]', '#job-description', '#jobDescriptionText', '#job-details',
    '[data-testid*="description" i]', '[data-automation*="description" i]',
    '[class*="job-description" i]', '[class*="jobdescription" i]', '[class*="job-details" i]',
    '[class*="posting-description" i]', '[class*="description" i]', 'article', '[role="main"]', 'main',
];

const SALARY_SELECTORS = ['[itemprop="baseSalary"]', '[data-testid*="salary" i]', '[class*="salary" i]', '[class*="compensation" i]', '[class*="pay-range" i]'];

const EMPLOYMENT_SELECTORS = ['[itemprop="employmentType"]', '[data-testid*="employment-type" i]', '[data-testid*="job-type" i]', '[class*="employment-type" i]', '[class*="job-type" i]'];

/** A description shorter than this is probably a teaser or a label, not the listing. */
export const MIN_DESCRIPTION_LENGTH = 200;

/**
 * First matching element whose text looks like a one-line value.
 * @param {ParentNode} root
 * @param {string[]} selectors
 * @param {number} [maxLength]
 */
export function firstLine(root, selectors, maxLength = 200) {
    for (const selector of selectors) {
        let elements;

        try {
            elements = Array.from(root.querySelectorAll(selector));
        } catch {
            continue; // a selector this engine does not support
        }

        for (const element of elements) {
            const text = cleanLine(element.getAttribute('content') || elementToText(element).split('\n')[0]);

            if (text.length >= 2 && text.length <= maxLength) {
                return text;
            }
        }
    }

    return '';
}

/**
 * The first description-like container with real content, else the longest one found.
 * @param {ParentNode} root
 */
export function findDescription(root) {
    let longest = '';

    for (const selector of DESCRIPTION_SELECTORS) {
        let elements;

        try {
            elements = Array.from(root.querySelectorAll(selector));
        } catch {
            continue;
        }

        for (const element of elements) {
            const text = elementToText(element);

            if (text.length >= MIN_DESCRIPTION_LENGTH) {
                return text;
            }

            if (text.length > longest.length) {
                longest = text;
            }
        }
    }

    return longest;
}

/**
 * @param {Document} doc
 */
export function extractDom(doc) {
    const location = firstLine(doc, LOCATION_SELECTORS, 120);
    const salaryLine = firstLine(doc, SALARY_SELECTORS, 120);

    return {
        fields: dropEmpty({
            title: firstLine(doc, TITLE_SELECTORS),
            company: firstLine(doc, COMPANY_SELECTORS, 120),
            location,
            workplaceType: workplaceTypeFrom(location),
            employmentType: employmentTypeFrom(firstLine(doc, EMPLOYMENT_SELECTORS, 80)),
            salary: parseSalaryText(salaryLine),
            description: findDescription(doc),
        }),
    };
}
