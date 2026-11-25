// A site-declared policy: for each kind of value, keep it, withhold it, or replace it
// with an abstraction. Replacements never contain digits or "@", so scrubbing is
// idempotent and a replacement can never rebuild the value it hides.

/**
 * @typedef {"KEEP"|"BLOCK"|"GENERALIZE"} Action
 * KEEP sends it as is. BLOCK replaces it with "[<label> withheld]". GENERALIZE replaces it
 * with "[<label>: <abstraction>]".
 */

/**
 * @typedef {object} CategoryRule
 * @property {Action} action
 * @property {string} label Readable name for the card and the replacement.
 * @property {string|((original: string, finding: import("./detectors.js").Finding) => string)} [abstraction]
 *   For GENERALIZE: the words the model sees instead. Must be deterministic.
 */

/**
 * @typedef {object} Policy
 * @property {string} name
 * @property {Record<string, CategoryRule>} categories Keyed by Category.
 * @property {Record<string, CategoryRule>} [fields] Overrides for vault fields, keyed by field name.
 */

/** The default: withhold contact details and ID numbers, abstract income, keep plain amounts. */
export const DEFAULT_POLICY = Object.freeze({
  name: "default",
  categories: {
    EMAIL: { action: "BLOCK", label: "email" },
    PHONE: { action: "BLOCK", label: "phone number" },
    AADHAAR: { action: "BLOCK", label: "Aadhaar number" },
    PAN: { action: "BLOCK", label: "PAN" },
    GOVERNMENT_ID: { action: "BLOCK", label: "ID number" },
    DATE_OF_BIRTH: { action: "BLOCK", label: "date of birth" },
    PERSON: { action: "BLOCK", label: "name" },
    INCOME: { action: "GENERALIZE", label: "income", abstraction: "provided, kept on this device" },
    RESERVATION: { action: "GENERALIZE", label: "reservation category", abstraction: "declared" },
    FINANCIAL_AMOUNT: { action: "KEEP", label: "amount" },
    OTHER_SENSITIVE: { action: "BLOCK", label: "private detail" },
  },
  fields: {},
});

/**
 * Build a policy from the default plus a site's overrides.
 *
 * @param {Partial<Policy>} overrides
 * @returns {Policy}
 */
export function definePolicy(overrides = {}) {
  const categories = { ...DEFAULT_POLICY.categories };
  for (const [k, v] of Object.entries(overrides.categories || {})) categories[k] = { ...categories[k], ...v };
  return { name: overrides.name || "site", categories, fields: { ...(overrides.fields || {}) } };
}

/**
 * An abstraction for an income that only says whether it is within a published range.
 * Use it only when the site really publishes that range.
 *
 * @param {number} maxRupees The top of the eligible range, in rupees per year.
 * @returns {(original: string) => string}
 */
export function incomeRangeAbstraction(maxRupees) {
  return (original) => {
    const rupees = parseRupees(original);
    if (rupees === null) return "provided, kept on this device";
    return rupees <= maxRupees ? "within the eligible range" : "above the published range";
  };
}

/**
 * Read an Indian rupee amount: "₹1,80,000", "1.8 lakh", "2 LPA", "Rs 90k".
 *
 * @param {string} text
 * @returns {number|null} Rupees, or null when it is not an amount.
 */
export function parseRupees(text) {
  const m = String(text).toLowerCase().replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|lpa|crores?|cr|k|thousand)?/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || "";
  if (/^(lakh|lac|lpa)/.test(unit)) return Math.round(n * 100000);
  if (/^(crore|cr)/.test(unit)) return Math.round(n * 10000000);
  if (unit === "k" || unit === "thousand") return Math.round(n * 1000);
  return Math.round(n);
}

/**
 * The rule for one finding: a vault field's own rule, else its category's, else BLOCK
 * (unknown kinds fail closed).
 *
 * @param {Policy} policy
 * @param {import("./detectors.js").Finding} finding
 * @returns {CategoryRule}
 */
export function ruleFor(policy, finding) {
  if (finding.field && policy.fields?.[finding.field]) return policy.fields[finding.field];
  return policy.categories[finding.category] || { action: "BLOCK", label: "private detail" };
}

/**
 * The text the outside world sees instead of the original.
 *
 * @param {CategoryRule} rule
 * @param {string} original
 * @param {import("./detectors.js").Finding} finding
 * @returns {string}
 */
export function replacementFor(rule, original, finding) {
  if (rule.action === "GENERALIZE") {
    const a = typeof rule.abstraction === "function" ? rule.abstraction(original, finding) : rule.abstraction || "provided";
    return safeToken(`[${rule.label}: ${a}]`);
  }
  return safeToken(`[${rule.label} withheld]`);
}

// Fail closed if a site's label or abstraction would carry digits or an email marker.
function safeToken(s) {
  return s.replace(/[0-9@]/g, "");
}
