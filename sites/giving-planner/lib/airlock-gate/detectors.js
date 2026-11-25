// Detectors find sensitive spans in text. Everything here runs on the device.
//
// The Detector interface is deliberately the same shape as the Airlock scrub engine's
// Finding (airlock/packages/scrub-engine/src/types.ts), so the scrub engine can plug in
// later as one more detector (see fromScrubEngine below).

/**
 * @typedef {"EMAIL"|"PHONE"|"AADHAAR"|"PAN"|"FINANCIAL_AMOUNT"|"INCOME"|"RESERVATION"|"DATE_OF_BIRTH"|"PERSON"|"GOVERNMENT_ID"|"OTHER_SENSITIVE"} Category
 */

/**
 * @typedef {object} Finding
 * @property {number} start Start offset in the text.
 * @property {number} end End offset (exclusive).
 * @property {string} text The detected text.
 * @property {Category} category What it is.
 * @property {"RULE"|"VAULT"|"NANO"|"ENGINE"} detector Which detector found it.
 * @property {number} confidence 0 to 1.
 * @property {string} [field] The vault field it matches, when a vault detector found it.
 */

/**
 * @typedef {object} Detector
 * @property {string} id A short name, for reports.
 * @property {(text: string) => Finding[] | Promise<Finding[]>} detect Find spans. Must not send the text anywhere.
 */

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/**
 * True when a digit string passes the Verhoeff check (Aadhaar's check digit scheme).
 *
 * @param {string} digits Digits only.
 * @returns {boolean}
 */
export function verhoeffValid(digits) {
  let c = 0;
  const rev = digits.split("").reverse();
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(rev[i])]];
  return c === 0;
}

/**
 * The Verhoeff check digit for a digit string.
 *
 * @param {string} digits Digits only, without the check digit.
 * @returns {string} One digit.
 */
export function verhoeffDigit(digits) {
  let c = 0;
  const rev = digits.split("").reverse();
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][Number(rev[i])]];
  return String(VERHOEFF_INV[c]);
}

const digitsOnly = (s) => s.replace(/\D/g, "");

// Words that make a nearby amount a statement about income, not a donation or a price.
const INCOME_WORDS = /\b(income|incomes|earn|earns|earned|earning|earnings|salary|salaries|wage|wages|ctc|lpa|family\s+makes|parents?\s+(?:make|makes|made))\b/i;

const PATTERNS = [
  // Email: local@domain.tld
  { category: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, confidence: 0.99 },
  // PAN: AAAAA9999A, any case.
  { category: "PAN", re: /(?<![A-Za-z0-9])[A-Za-z]{5}[0-9]{4}[A-Za-z](?![A-Za-z0-9])/g, confidence: 0.95 },
  // Aadhaar: 12 digits, first 2-9, optional spaces or hyphens every 4; Verhoeff checked below.
  { category: "AADHAAR", re: /(?<![A-Za-z0-9_-])[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?![A-Za-z0-9])/g, confidence: 0.97, check: (t) => verhoeffValid(digitsOnly(t)) },
  // Indian mobile: optional +91 / 91 / 0, then 10 digits starting 6-9, any spaces or hyphens.
  { category: "PHONE", re: /(?<![A-Za-z0-9+_-])(?:(?:\+|00)91[ -]?|91[ -]|0)?[6-9](?:[ -]?\d){9}(?![A-Za-z0-9])/g, confidence: 0.9 },
  // Reservation categories: full names any case; short forms only in capitals.
  {
    category: "RESERVATION",
    re: /\b(?:[Ss]cheduled\s+[Cc]astes?|[Ss]cheduled\s+[Tt]ribes?|[Oo]ther\s+[Bb]ackward\s+[Cc]lass(?:es)?|SC|ST|OBC|SEBC|EWS|VJNT|NT-[A-D]|SBC)\b/g,
    confidence: 0.8,
  },
  // Amounts: ₹ / Rs / INR prefix, or a unit (lakh, crore, k, rupees, LPA) suffix.
  {
    category: "FINANCIAL_AMOUNT",
    re: /(?:(?:₹|\bRs\.?|\bINR)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:lakhs?|lacs?|crores?|cr|k|thousand)\b)?)|(?:\b\d[\d,]*(?:\.\d+)?\s?(?:lakhs?|lacs?|crores?|lpa|rupees|k)\b)/gi,
    confidence: 0.85,
  },
];

/**
 * A small built-in rule detector: email, Indian phone numbers, Aadhaar (Verhoeff
 * checked), PAN and rupee amounts. An amount near words about income ("earns",
 * "per annum", "family income") is reported as INCOME instead of FINANCIAL_AMOUNT.
 *
 * @implements {Detector}
 */
export class RuleDetector {
  constructor({ incomeWindow = 48 } = {}) {
    this.id = "rules";
    this.incomeWindow = incomeWindow;
  }

  /**
   * @param {string} text
   * @returns {Finding[]}
   */
  detect(text) {
    const findings = [];
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      for (const m of text.matchAll(p.re)) {
        const t = m[0];
        if (p.check && !p.check(t)) continue;
        let category = p.category;
        if (category === "FINANCIAL_AMOUNT") {
          // Look only inside the same sentence, so "income is 2 lakh. I give ₹500" keeps the gift.
          let before = text.slice(Math.max(0, m.index - this.incomeWindow), m.index);
          let after = text.slice(m.index + t.length, m.index + t.length + this.incomeWindow);
          before = before.slice(Math.max(before.lastIndexOf(". "), before.lastIndexOf("? "), before.lastIndexOf("! "), before.lastIndexOf("\n")) + 1);
          const cut = after.search(/[.?!](\s|$)|\n/);
          if (cut >= 0) after = after.slice(0, cut);
          if (INCOME_WORDS.test(before) || INCOME_WORDS.test(after)) category = "INCOME";
        }
        findings.push({ start: m.index, end: m.index + t.length, text: t, category, detector: "RULE", confidence: p.confidence });
      }
    }
    return findings;
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds the exact values the visitor typed into the local-only form panel, wherever
 * they appear again, for example if the visitor also types their phone number in chat.
 * Numbers match whatever the separators ("1,80,000", "1 80 000", "180000").
 *
 * @implements {Detector}
 */
export class VaultDetector {
  /**
   * @param {import("./vault.js").Vault} vault
   */
  constructor(vault) {
    this.id = "vault";
    this.vault = vault;
  }

  /**
   * @param {string} text
   * @returns {Finding[]}
   */
  detect(text) {
    const findings = [];
    for (const { field, value, category } of this.vault.entries()) {
      const re = VaultDetector.patternFor(value);
      if (!re) continue;
      for (const m of text.matchAll(re)) {
        findings.push({ start: m.index, end: m.index + m[0].length, text: m[0], category, detector: "VAULT", confidence: 1, field });
      }
    }
    return findings;
  }

  /**
   * A regular expression that matches one stored value in running text.
   *
   * @param {string} value
   * @returns {RegExp|null}
   */
  static patternFor(value) {
    const v = String(value ?? "").trim();
    if (!v) return null;
    const digits = digitsOnly(v);
    // Mostly a number: match the digits with any separators between them.
    if (digits.length >= 4 && digits.length >= v.replace(/[\s,.\-+₹]/g, "").length - 3) {
      const core = digits.split("").join("[\\s,.\\-]*");
      return new RegExp(`(?<!\\d)${core}(?!\\d)`, "g");
    }
    // Very short words would match inside other words; require word edges.
    if (v.length < 3) return null;
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(v)}(?![\\p{L}\\p{N}])`, "giu");
  }
}

/**
 * Adapt the Airlock scrub engine (when it ships a detector) to this interface.
 * The engine's Finding already has start, end, text, category, detector and confidence.
 *
 * @param {{detect?: Function, findAll?: Function}} engine Anything with a detect(text) method.
 * @returns {Detector}
 */
export function fromScrubEngine(engine) {
  const fn = engine.detect || engine.findAll;
  if (typeof fn !== "function") throw new Error("The scrub engine has no detect(text) method.");
  return {
    id: "scrub-engine",
    async detect(text) {
      const found = await fn.call(engine, text);
      return (found || []).map((f) => ({ ...f, detector: "ENGINE" }));
    },
  };
}

/**
 * Merge overlapping findings from several detectors. Longer and surer spans win; a
 * vault match (an exact value the visitor gave) beats a pattern guess for the same span.
 *
 * @param {Finding[]} findings
 * @returns {Finding[]} Non-overlapping findings, sorted by start.
 */
export function mergeFindings(findings) {
  const rank = (f) => (f.detector === "VAULT" ? 2 : 0) + f.confidence + (f.end - f.start) / 1000;
  const sorted = [...findings].sort((a, b) => rank(b) - rank(a));
  const kept = [];
  for (const f of sorted) {
    const overlaps = kept.filter((k) => f.start < k.end && k.start < f.end);
    if (!overlaps.length) { kept.push(f); continue; }
    // A lower-ranked span that sticks out past the kept one still hides its extra
    // characters, by widening the kept span. This keeps fail-closed behaviour.
    for (const k of overlaps) {
      if (f.start < k.start || f.end > k.end) {
        k.start = Math.min(k.start, f.start);
        k.end = Math.max(k.end, f.end);
        k.widened = true;
      }
    }
  }
  // Widening can make kept spans overlap each other; join them.
  kept.sort((a, b) => a.start - b.start);
  const out = [];
  for (const f of kept) {
    const last = out[out.length - 1];
    if (last && f.start < last.end) { last.end = Math.max(last.end, f.end); continue; }
    out.push({ ...f });
  }
  return out;
}
