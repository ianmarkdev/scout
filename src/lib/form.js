/**
 * The popup form: built from an extraction, validated before sending (as a convenience only,
 * Career Engine validates everything again), and turned into the API payload.
 */

import { EMPLOYMENT_TYPES, WORKPLACE_TYPES, locationWithWorkplace } from './fields.js';
import { PAY_PERIODS, formatSalary } from './salary.js';
import { httpUrl, siteOf } from './url.js';

/** Career Engine's limits (SaveJobApplicationRequest). */
export const LIMITS = { title: 200, company: 200, location: 200, salaryText: 200, url: 2000, description: 50000, externalId: 200 };

/**
 * @typedef {{
 *   title: string, company: string, location: string, workplaceType: string, employmentType: string,
 *   salaryMin: string, salaryMax: string, salaryCurrency: string, salaryPeriod: string, salaryText: string,
 *   deadline: string, postedAt: string, externalId: string, url: string, description: string,
 * }} JobForm
 */

/** @returns {JobForm} */
export function emptyForm() {
    return {
        title: '', company: '', location: '', workplaceType: '', employmentType: '',
        salaryMin: '', salaryMax: '', salaryCurrency: '', salaryPeriod: '', salaryText: '',
        deadline: '', postedAt: '', externalId: '', url: '', description: '',
    };
}

/**
 * @param {import('../extract/index.js').Extraction} extraction
 * @returns {JobForm}
 */
export function formFromExtraction({ fields }) {
    const salary = fields.salary;

    return {
        ...emptyForm(),
        title: fields.title,
        company: fields.company,
        location: fields.location,
        workplaceType: WORKPLACE_TYPES.includes(fields.workplaceType) ? fields.workplaceType : '',
        employmentType: EMPLOYMENT_TYPES.includes(fields.employmentType) ? fields.employmentType : '',
        salaryMin: salary?.min != null ? String(salary.min) : '',
        salaryMax: salary?.max != null ? String(salary.max) : '',
        salaryCurrency: salary?.currency ?? '',
        salaryPeriod: salary?.period ?? '',
        salaryText: formatSalary(salary),
        deadline: fields.deadline,
        postedAt: fields.postedAt,
        externalId: fields.externalId,
        url: fields.url,
        description: fields.description,
    };
}

/**
 * @param {string} value
 * @returns {number | null | undefined} undefined when not a valid amount
 */
function amountOf(value) {
    const trimmed = value.trim().replace(/,/g, '');

    if (trimmed === '') return null;

    const n = Number(trimmed);

    return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * The salary line implied by the structured salary fields.
 * @param {JobForm} form
 */
export function salaryTextFromFields(form) {
    return formatSalary({
        min: amountOf(form.salaryMin) ?? null,
        max: amountOf(form.salaryMax) ?? null,
        currency: form.salaryCurrency.trim().toUpperCase(),
        period: form.salaryPeriod,
    });
}

/**
 * Field errors that would make Career Engine reject the save, keyed by form field.
 * @param {JobForm} form
 * @returns {Record<string, string>}
 */
export function validateForm(form) {
    /** @type {Record<string, string>} */
    const errors = {};
    const tooLong = (/** @type {keyof typeof LIMITS} */ key, /** @type {string} */ label) => {
        if (form[key].trim().length > LIMITS[key]) {
            errors[key] = `${label} must be at most ${LIMITS[key].toLocaleString('en-GB')} characters.`;
        }
    };

    if (form.title.trim() === '') errors.title = 'Enter the job title.';

    tooLong('title', 'The job title');
    tooLong('company', 'The company name');
    tooLong('location', 'The location');
    tooLong('salaryText', 'The salary');
    tooLong('externalId', 'The listing ID');
    tooLong('url', 'The URL');

    if (form.description.trim().length > LIMITS.description) {
        errors.description = `The description is ${form.description.trim().length.toLocaleString('en-GB')} characters; Career Engine accepts up to ${LIMITS.description.toLocaleString('en-GB')}. Shorten it (for example remove the company boilerplate) before saving. Nothing is cut automatically.`;
    }

    if (form.url.trim() !== '' && !httpUrl(form.url)) {
        errors.url = 'Enter a full http(s) address, or leave it empty.';
    }

    const min = amountOf(form.salaryMin);
    const max = amountOf(form.salaryMax);

    if (min === undefined) errors.salaryMin = 'Enter a number.';
    if (max === undefined) errors.salaryMax = 'Enter a number.';
    if (typeof min === 'number' && typeof max === 'number' && max < min) errors.salaryMax = 'The maximum is lower than the minimum.';
    if (form.salaryCurrency.trim() !== '' && !/^[A-Za-z]{3}$/.test(form.salaryCurrency.trim())) errors.salaryCurrency = 'Use a 3-letter code such as GBP.';
    if (form.salaryPeriod !== '' && !PAY_PERIODS.includes(form.salaryPeriod)) errors.salaryPeriod = 'Choose a pay period.';
    if (form.deadline !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(form.deadline)) errors.deadline = 'Use a date.';

    return errors;
}

/**
 * The request body for POST /api/extension/applications (see docs/laravel-api-contract.md).
 * The description is sent whole; Career Engine stores it verbatim after normalising whitespace.
 * @param {JobForm} form
 * @param {{ method: string, capturedAt: string, allowDuplicate?: boolean }} context
 */
export function buildPayload(form, { method, capturedAt, allowDuplicate = false }) {
    const orNull = (/** @type {string} */ value) => (value.trim() === '' ? null : value.trim());
    const min = amountOf(form.salaryMin) ?? null;
    const max = amountOf(form.salaryMax) ?? null;
    const currency = orNull(form.salaryCurrency.toUpperCase());
    const period = orNull(form.salaryPeriod);
    const url = orNull(form.url);

    return {
        company_name: orNull(form.company),
        role_title: form.title.trim(),
        source_url: url,
        location: orNull(locationWithWorkplace(form.location, form.workplaceType)),
        employment_type: orNull(form.employmentType),
        salary_text: orNull(form.salaryText),
        deadline_on: orNull(form.deadline),
        job_description: form.description.trim() === '' ? null : form.description,
        capture: {
            method,
            site: url ? siteOf(url) || null : null,
            external_id: orNull(form.externalId),
            posted_at: orNull(form.postedAt),
            workplace_type: orNull(form.workplaceType),
            salary: min === null && max === null && currency === null && period === null ? null : { min, max, currency, period },
            captured_at: capturedAt,
        },
        allow_duplicate: allowDuplicate,
    };
}

/**
 * Career Engine's field names (incl. nested `capture.*`) → popup form fields.
 */
export const SERVER_FIELD_MAP = {
    role_title: 'title',
    company_name: 'company',
    source_url: 'url',
    location: 'location',
    employment_type: 'employmentType',
    salary_text: 'salaryText',
    deadline_on: 'deadline',
    job_description: 'description',
    'capture.external_id': 'externalId',
    'capture.posted_at': 'postedAt',
    'capture.workplace_type': 'workplaceType',
    'capture.salary.min': 'salaryMin',
    'capture.salary.max': 'salaryMax',
    'capture.salary.currency': 'salaryCurrency',
    'capture.salary.period': 'salaryPeriod',
};
