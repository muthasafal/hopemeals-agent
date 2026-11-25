// The gate: every outgoing payload passes through here, on the device, before it leaves.

import { RuleDetector, VaultDetector, mergeFindings } from "./detectors.js";
import { DEFAULT_POLICY, ruleFor, replacementFor } from "./policy.js";
import { Vault } from "./vault.js";

/**
 * @typedef {object} ReportItem
 * @property {string} category
 * @property {string} label Readable name, such as "income".
 * @property {"BLOCK"|"GENERALIZE"} action
 * @property {string} original What the visitor wrote. Stays on the device.
 * @property {string} replacement What the destination sees.
 * @property {string} [field]
 */

/**
 * @typedef {object} Report
 * @property {"model"|"partner"|"partner-action"} channel Where it was going.
 * @property {string} destination Host name.
 * @property {ReportItem[]} items What was changed.
 * @property {string} before The visitor's text as written (latest user turn or the request).
 * @property {string} after The same text as sent.
 * @property {Array<{kind: "same", text: string}|{kind: "swap", original: string, replacement: string, label: string}>} [segments]
 *   The visitor's text split into kept and replaced parts, for the diff on the card.
 * @property {boolean} changed True when anything was replaced.
 */

/** Thrown when the visitor chooses not to send. The runtime shows its message. */
export class GateDeclined extends Error {
  constructor(message = "You chose not to send this. Nothing left your device.") {
    super(message);
    this.name = "GateDeclined";
  }
}

// Detectors that look at text a visitor wrote. Text from the site itself (instructions,
// tool results) gets only the vault and the exact ID patterns, so site facts such as a
// partner's name are never mangled by a guess.
const STRICT_CATEGORIES = new Set(["EMAIL", "PHONE", "AADHAAR", "PAN"]);
const STRICT_VAULT = new Set(["PERSON", "DATE_OF_BIRTH", "GOVERNMENT_ID", "OTHER_SENSITIVE"]);

export class AirlockGate {
  /**
   * @param {object} [options]
   * @param {import("./policy.js").Policy} [options.policy]
   * @param {Vault} [options.vault]
   * @param {import("./detectors.js").Detector[]} [options.detectors] Extra detectors, such as the
   *   scrub engine or a Gemini Nano detector. The rule and vault detectors always run.
   * @param {string[]} [options.publicValues] Values the site publishes itself (its own phone
   *   number or email). Never replaced.
   * @param {(report: Report) => Promise<boolean>|boolean} [options.onReview] Asked when a payload
   *   carries replacements the visitor has not yet seen for this destination. Return false to stop it.
   */
  constructor({ policy = DEFAULT_POLICY, vault = new Vault(), detectors = [], publicValues = [], onReview = null } = {}) {
    this.policy = policy;
    this.vault = vault;
    this.detectors = [new RuleDetector(), new VaultDetector(vault), ...detectors];
    this.publicValues = new Set(publicValues.map(AirlockGate.norm));
    this.onReview = onReview;
    /** Signatures of replacements the visitor already saw, per destination. Memory only. */
    this.approved = new Set();
    /** @type {Report[]} The latest reports, newest last, for the page's own panel. Memory only. */
    this.log = [];
    this.listeners = new Set();
  }

  static norm(s) {
    return String(s).toLowerCase().replace(/[\s,.\-+()]/g, "");
  }

  /**
   * Scrub one string. Deterministic: the same text, policy and vault give the same result.
   *
   * @param {string} text
   * @param {{strict?: boolean}} [options] strict: only the vault and exact ID patterns.
   * @returns {Promise<{text: string, items: ReportItem[]}>}
   */
  async scrubText(text, { strict = false } = {}) {
    if (typeof text !== "string" || !text) return { text: text ?? "", items: [], segments: [] };
    const all = [];
    for (const d of this.detectors) {
      // Extra detectors (Nano, the scrub engine) only matter for the visitor's own words;
      // in site text their findings would be dropped anyway, so skip the cost.
      if (strict && d.id !== "rules" && d.id !== "vault") continue;
      try {
        all.push(...(await d.detect(text)));
      } catch (err) {
        // A detector that fails must not let text through unchecked. The rule and vault
        // detectors are synchronous and cannot fail this way; an extra one can.
        if (d.id === "rules" || d.id === "vault") throw err;
        console.warn(`airlock-gate: detector ${d.id} failed; using the others`, err);
      }
    }
    return this.applyFindings(text, all, { strict });
  }

  /**
   * Synchronous variant using only the built-in rule and vault detectors.
   *
   * @param {string} text
   * @param {{strict?: boolean}} [options]
   * @returns {{text: string, items: ReportItem[]}}
   */
  scrubTextSync(text, { strict = false } = {}) {
    if (typeof text !== "string" || !text) return { text: text ?? "", items: [], segments: [] };
    const all = [...this.detectors[0].detect(text), ...this.detectors[1].detect(text)];
    return this.applyFindings(text, all, { strict });
  }

  applyFindings(text, findings, { strict }) {
    const acted = [];
    for (const f of findings) {
      // In site text, a vault match on a category name (such as a reservation category the
      // site lists as an option) would reveal the visitor's choice by elimination, so only
      // identifying values are matched there.
      if (strict && !STRICT_CATEGORIES.has(f.category) && !(f.detector === "VAULT" && STRICT_VAULT.has(f.category))) continue;
      if (this.publicValues.has(AirlockGate.norm(f.text))) continue;
      const rule = ruleFor(this.policy, f);
      if (rule.action === "KEEP") continue;
      acted.push(f);
    }
    const merged = mergeFindings(acted);
    let out = "";
    let at = 0;
    const items = [];
    const segments = [];
    for (const f of merged) {
      const original = text.slice(f.start, f.end);
      const rule = ruleFor(this.policy, f);
      const replacement = replacementFor(rule.action === "KEEP" ? { ...rule, action: "BLOCK" } : rule, original, f);
      if (f.start > at) segments.push({ kind: "same", text: text.slice(at, f.start) });
      segments.push({ kind: "swap", original, replacement, label: rule.label });
      out += text.slice(at, f.start) + replacement;
      at = f.end;
      items.push({ category: f.category, label: rule.label, action: rule.action === "GENERALIZE" ? "GENERALIZE" : "BLOCK", original, replacement, field: f.field });
    }
    if (at < text.length) segments.push({ kind: "same", text: text.slice(at) });
    out += text.slice(at);
    return { text: out, items, segments };
  }

  /**
   * Scrub every string inside a JSON value (objects, arrays), keeping keys.
   *
   * @param {any} value
   * @param {{strict?: boolean}} [options]
   * @returns {Promise<{value: any, items: ReportItem[]}>}
   */
  async scrubValue(value, options = {}) {
    const items = [];
    const walk = async (v) => {
      if (typeof v === "string") {
        const r = await this.scrubText(v, options);
        items.push(...r.items);
        return r.text;
      }
      if (Array.isArray(v)) return Promise.all(v.map(walk));
      if (v && typeof v === "object") {
        const o = {};
        for (const [k, x] of Object.entries(v)) o[k] = await walk(x);
        return o;
      }
      return v;
    };
    return { value: await walk(value), items };
  }

  /**
   * Scrub an OpenAI-style message list for a model call. User turns get every detector;
   * system, assistant and tool turns get the strict set. Tool-call arguments are parsed
   * and scrubbed as JSON.
   *
   * @param {Array<{role: string, content: any, tool_calls?: any[]}>} messages
   * @returns {Promise<{messages: any[], items: ReportItem[], before: string, after: string}>}
   */
  async scrubMessages(messages) {
    const items = [];
    const out = [];
    let lastUser = -1;
    for (let i = 0; i < messages.length; i++) if (messages[i]?.role === "user") lastUser = i;
    let before = "";
    let after = "";
    let segments = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const strict = m.role !== "user";
      const next = { ...m };
      if (typeof m.content === "string") {
        const r = await this.scrubText(m.content, { strict });
        next.content = r.text;
        items.push(...r.items);
        if (i === lastUser) { before = m.content; after = r.text; segments = r.segments; }
      } else if (Array.isArray(m.content)) {
        const r = await this.scrubValue(m.content, { strict });
        next.content = r.value;
        items.push(...r.items);
      }
      if (Array.isArray(m.tool_calls)) {
        next.tool_calls = [];
        for (const tc of m.tool_calls) {
          let args = tc.function?.arguments ?? "";
          try {
            const r = await this.scrubValue(JSON.parse(args || "{}"), { strict: true });
            items.push(...r.items);
            args = JSON.stringify(r.value);
          } catch {
            const r = await this.scrubText(String(args), { strict: true });
            items.push(...r.items);
            args = r.text;
          }
          next.tool_calls.push({ ...tc, function: { ...tc.function, arguments: args } });
        }
      }
      out.push(next);
    }
    return { messages: out, items, before, after, segments };
  }

  /**
   * Ask the visitor about replacements they have not seen for this destination, then
   * record the report. Throws GateDeclined when they say no.
   *
   * @param {Report} report
   */
  async review(report) {
    const fresh = report.items.filter((it) => !this.approved.has(this.signature(report, it)));
    if (fresh.length && this.onReview) {
      const ok = await this.onReview({ ...report, items: dedupe(report.items) });
      if (!ok) {
        this.record({ ...report, declined: true });
        throw new GateDeclined();
      }
    }
    for (const it of report.items) this.approved.add(this.signature(report, it));
    this.record(report);
  }

  signature(report, item) {
    return `${report.channel}|${report.destination}|${item.category}|${AirlockGate.norm(item.original)}`;
  }

  record(report) {
    // The log is for the page's own "what left this device" panel. Keep it small.
    this.log.push({ ...report, at: Date.now() });
    if (this.log.length > 50) this.log.shift();
    for (const fn of this.listeners) fn(report);
  }

  /** @param {(report: Report) => void} fn @returns {() => void} */
  onReport(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Prepare one model call: scrub, review, record.
   *
   * @param {{messages: any[]}} request The arguments to LlmClient.chat.
   * @param {string} destination Router host.
   * @returns {Promise<any>} The request with scrubbed messages.
   */
  async gateModelCall(request, destination) {
    const r = await this.scrubMessages(request.messages || []);
    await this.review({ channel: "model", destination, items: r.items, before: r.before, after: r.after, segments: r.segments, changed: r.items.length > 0 });
    return { ...request, messages: r.messages };
  }

  /**
   * Prepare a request to a partner network.
   *
   * @param {string} text The request text.
   * @param {string} destination Partner host.
   * @param {{reviewed?: boolean}} [options] reviewed: the consent card already showed it.
   * @returns {Promise<string>}
   */
  async gatePartnerRequest(text, destination, { reviewed = false } = {}) {
    const r = await this.scrubText(text);
    const report = { channel: "partner", destination, items: r.items, before: text, after: r.text, segments: r.segments, changed: r.items.length > 0 };
    if (reviewed) {
      for (const it of r.items) this.approved.add(this.signature(report, it));
      this.record(report);
    } else {
      await this.review(report);
    }
    return r.text;
  }

  /**
   * Prepare the arguments of an action that runs on another origin (a partner's bridge).
   *
   * @param {object} args
   * @param {string} destination
   * @returns {Promise<object>}
   */
  async gateRemoteAction(args, destination) {
    const r = await this.scrubValue(args);
    const text = JSON.stringify(args);
    await this.review({ channel: "partner-action", destination, items: r.items, before: text, after: JSON.stringify(r.value), changed: r.items.length > 0 });
    return r.value;
  }
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((it) => {
    const k = `${it.category}|${AirlockGate.norm(it.original)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
