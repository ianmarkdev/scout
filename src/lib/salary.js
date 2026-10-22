/**
 * Salary parsing. Extraction never guesses: a salary is only reported when a currency marker
 * and an amount are both present, and every part that cannot be identified stays empty.
 *
 * @typedef {{ min: number | null, max: number | null, currency: string, period: string }} Salary
 */

export const PAY_PERIODS = ['hour', 'day', 'week', 'month', 'year'];

/** Longest symbols first, so "US$" wins over "$". "$" alone is assumed to be USD. */
const SYMBOLS = [
    ['US$', 'USD'], ['CA$', 'CAD'], ['AU$', 'AUD'], ['NZ$', 'NZD'], ['HK$', 'HKD'],
    ['C$', 'CAD'], ['A$', 'AUD'], ['S$', 'SGD'], ['R$', 'BRL'],
    ['£', 'GBP'], ['€', 'EUR'], ['₹', 'INR'], ['¥', 'JPY'], ['$', 'USD'],
];

const CODES = [
    'GBP', 'USD', 'EUR', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'INR',
    'JPY', 'SGD', 'HKD', 'ZAR', 'BRL', 'MXN', 'AED', 'ILS',
];

const escape = (/** @type {string} */ s) => s.replace(/[$]/g, '\\$');
const CURRENCY = `(${[...SYMBOLS.map(([symbol]) => escape(symbol)), ...CODES.map((code) => `\\b${code}\\b`)].join('|')})`;
const AMOUNT = String.raw`(\d{1,3}(?:[,.  ]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d+)?)\s*([kKmM](?![a-zA-Z]))?`;
const SEPARATOR = String.raw`\s*(?:-|–|—|to|and)\s*`;

/** "£70,000 - £85,000", "$120k–150k", "EUR 50.000 to 60.000" */
const LEADING = new RegExp(`${CURRENCY}\\s?${AMOUNT}(?:${SEPARATOR}${CURRENCY}?\\s?${AMOUNT})?`, 'i');
/** "70,000 - 85,000 GBP" */
const TRAILING = new RegExp(`${AMOUNT}(?:${SEPARATOR}${AMOUNT})?\\s?${CURRENCY}`, 'i');

/**
 * @param {unknown} text
 * @returns {string} one of PAY_PERIODS, or ''
 */
export function periodFrom(text) {
    const t = String(text ?? '').toLowerCase();

    if (/\b(hour|hours|hourly|hr|p\/h|ph)\b/.test(t)) return 'hour';
    if (/\b(day|daily|per diem|p\/d|pd)\b/.test(t)) return 'day';
    if (/\b(week|weekly|wk|pw)\b/.test(t)) return 'week';
    if (/\b(month|monthly|pcm|mo)\b/.test(t)) return 'month';
    if (/\b(year|yearly|annum|annual|annually|yr|pa|p\.a)\b/.test(t)) return 'year';

    return '';
}

/**
 * @param {string} symbolOrCode
 */
function currencyCode(symbolOrCode) {
    const upper = symbolOrCode.toUpperCase();

    return SYMBOLS.find(([symbol]) => symbol === upper)?.[1] ?? (CODES.includes(upper) ? upper : '');
}

/**
 * "85,000" → 85000, "85.000" (European thousands) → 85000, "85.5" → 85.5, with k/m suffixes.
 * @param {string} digits
 * @param {string | undefined} suffix
 */
function amount(digits, suffix) {
    const grouped = /^\d{1,3}(?:[,.  ]\d{3})+(?:\.\d{1,2})?$/.test(digits);
    let value = grouped ? Number(digits.replace(/[,.  ](?=\d{3}\b)/g, '').replace(/,/g, '')) : Number(digits);
    const multiplier = /k/i.test(suffix ?? '') ? 1_000 : /m/i.test(suffix ?? '') ? 1_000_000 : 1;
    value *= multiplier;

    return Number.isFinite(value) ? value : null;
}

/**
 * The first salary mentioned in free text, or null.
 * @param {unknown} text
 * @returns {Salary | null}
 */
export function parseSalaryText(text) {
    const source = String(text ?? '');
    let match = LEADING.exec(source);
    /** @type {string} */ let currency;
    /** @type {number | null} */ let min;
    /** @type {number | null} */ let max = null;
    let end;

    if (match) {
        const [, cur, lowDigits, lowSuffix, , highDigits, highSuffix] = match;
        currency = currencyCode(cur);
        min = amount(lowDigits, lowSuffix ?? (highDigits && Number(lowDigits) < 1000 ? highSuffix : undefined));
        max = highDigits ? amount(highDigits, highSuffix) : null;
        end = match.index + match[0].length;
    } else {
        match = TRAILING.exec(source);

        if (!match) {
            return null;
        }

        const [, lowDigits, lowSuffix, highDigits, highSuffix, cur] = match;
        currency = currencyCode(cur);
        min = amount(lowDigits, lowSuffix ?? (highDigits && Number(lowDigits) < 1000 ? highSuffix : undefined));
        max = highDigits ? amount(highDigits, highSuffix) : null;
        end = match.index + match[0].length;
    }

    if (min === null || min <= 0) {
        return null;
    }

    if (max !== null && max < min) {
        max = null;
    }

    return { min, max, currency, period: periodFrom(source.slice(end, end + 40)) };
}

/**
 * schema.org MonetaryAmount (`baseSalary` / `estimatedSalary`).
 * @param {any} value
 * @returns {Salary | null}
 */
export function salaryFromJsonLd(value) {
    const node = Array.isArray(value) ? value[0] : value;

    if (node === null || node === undefined) {
        return null;
    }

    if (typeof node === 'string' || typeof node === 'number') {
        return parseSalaryText(String(node));
    }

    if (typeof node !== 'object') {
        return null;
    }

    const quantity = node.value ?? {};
    const toNumber = (/** @type {unknown} */ v) => {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/[,\s]/g, '')) : NaN;

        return Number.isFinite(n) && n > 0 ? n : null;
    };

    let min = typeof quantity === 'object' ? toNumber(quantity.minValue) : null;
    let max = typeof quantity === 'object' ? toNumber(quantity.maxValue) : null;
    const single = typeof quantity === 'object' ? toNumber(quantity.value) : toNumber(quantity);

    if (min === null && max === null && single !== null) {
        min = single;
    }

    if (min === null && max === null) {
        return null;
    }

    if (min !== null && max !== null && max < min) {
        [min, max] = [max, min];
    }

    const currency = typeof node.currency === 'string' && /^[A-Za-z]{3}$/.test(node.currency.trim()) ? node.currency.trim().toUpperCase() : '';
    const unit = (typeof quantity === 'object' ? quantity.unitText : null) ?? node.unitText;

    return { min, max: max === min ? null : max, currency, period: periodFrom(unit) };
}

const NUMBER = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

/**
 * "GBP 70,000–85,000 / year". Empty when there is no amount.
 * @param {Partial<Salary> | null | undefined} salary
 */
export function formatSalary(salary) {
    const min = typeof salary?.min === 'number' ? salary.min : null;
    const max = typeof salary?.max === 'number' ? salary.max : null;

    if (min === null && max === null) {
        return '';
    }

    const range = min !== null && max !== null && max !== min
        ? `${NUMBER.format(min)}–${NUMBER.format(max)}`
        : NUMBER.format(/** @type {number} */ (min ?? max));
    const prefix = min === null && max !== null ? 'up to ' : '';

    return `${salary?.currency ? `${salary.currency} ` : ''}${prefix}${range}${salary?.period ? ` / ${salary.period}` : ''}`;
}
