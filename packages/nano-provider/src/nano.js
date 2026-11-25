// A thin, testable wrapper over Chrome's built-in Prompt API (Gemini Nano).
// https://developer.chrome.com/docs/ai/prompt-api
//
// Everything runs on the device. Every call uses structured output (responseConstraint)
// so the result is JSON we can check, not free text we have to trust.

/**
 * @typedef {"unavailable"|"downloadable"|"downloading"|"available"} Availability
 */

const LANG_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

export class NanoClient {
  /**
   * @param {object} [options]
   * @param {any} [options.LanguageModel] The Prompt API global. Defaults to globalThis.LanguageModel.
   * @param {(progress: number) => void} [options.onDownload] Model download progress, 0 to 1.
   * @param {number} [options.maxInputChars] Refuse prompts longer than this (Nano's window is small).
   */
  constructor({ LanguageModel = globalThis.LanguageModel, onDownload, maxInputChars = 6000 } = {}) {
    this.LM = LanguageModel;
    this.onDownload = onDownload;
    this.maxInputChars = maxInputChars;
    /** @type {Promise<any>|null} */
    this.base = null;
  }

  /** @returns {Promise<Availability>} */
  async availability() {
    if (!this.LM?.availability) return "unavailable";
    try {
      return await this.LM.availability(LANG_OPTIONS);
    } catch {
      return "unavailable";
    }
  }

  /** True when a prompt can run now without a download. */
  async ready() {
    return (await this.availability()) === "available";
  }

  /**
   * A base session to clone from, created once. Creating it may start the model
   * download, which the browser only allows after a user gesture.
   */
  async session() {
    if (!this.LM?.create) throw new Error("Gemini Nano is not available in this browser.");
    this.base ||= this.LM.create({
      ...LANG_OPTIONS,
      monitor: (m) => {
        m?.addEventListener?.("downloadprogress", (e) => this.onDownload?.(e.loaded));
      },
    }).catch((err) => { this.base = null; throw err; });
    return this.base;
  }

  /**
   * One structured prompt in a fresh session (a clone, so prompts never share context).
   *
   * @param {string} system Instructions.
   * @param {string} input The text to work on.
   * @param {object} schema JSON Schema for the answer.
   * @param {{signal?: AbortSignal}} [options]
   * @returns {Promise<any>} The parsed JSON.
   */
  async json(system, input, schema, { signal } = {}) {
    if (system.length + input.length > this.maxInputChars) {
      throw new NanoTooLong();
    }
    const base = await this.session();
    const s = base.clone ? await base.clone({ signal }) : base;
    try {
      const raw = await s.prompt(
        [
          { role: "system", content: system },
          { role: "user", content: input },
        ],
        { responseConstraint: schema, omitResponseConstraintInput: false, signal },
      );
      return JSON.parse(raw);
    } finally {
      if (s !== base) s.destroy?.();
    }
  }

  /**
   * Pick one intent from a fixed list.
   *
   * @param {string} text What the visitor wrote.
   * @param {Array<{name: string, description: string}>} intents
   * @returns {Promise<{intent: string, confidence: number}>}
   */
  async classifyIntent(text, intents) {
    const names = intents.map((i) => i.name);
    const system = "Classify the visitor's message into exactly one intent from the list. "
      + "If none fits, use the last one.\n"
      + intents.map((i) => `- ${i.name}: ${i.description}`).join("\n");
    const out = await this.json(system, text, {
      type: "object",
      properties: {
        intent: { type: "string", enum: names },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["intent", "confidence"],
      additionalProperties: false,
    });
    if (!names.includes(out.intent)) return { intent: names[names.length - 1], confidence: 0 };
    return { intent: out.intent, confidence: clamp01(out.confidence) };
  }

  /**
   * Pull named fields out of free text. Fields the text does not state come back as null,
   * never guessed.
   *
   * @param {string} text
   * @param {Record<string, {type: "string"|"number"|"boolean", description: string, enum?: string[]}>} fields
   * @returns {Promise<Record<string, any>>}
   */
  async extractFields(text, fields) {
    const properties = {};
    for (const [name, f] of Object.entries(fields)) {
      const base = f.enum ? { type: "string", enum: f.enum } : { type: f.type };
      properties[name] = { anyOf: [base, { type: "null" }], description: f.description };
    }
    const system = "Extract the fields below from the visitor's text. Copy values exactly as written. "
      + "Use null for any field the text does not clearly state. Never guess.\n"
      + Object.entries(fields).map(([n, f]) => `- ${n}: ${f.description}${f.enum ? ` (one of: ${f.enum.join(", ")})` : ""}`).join("\n");
    const out = await this.json(system, text, {
      type: "object", properties, required: Object.keys(fields), additionalProperties: false,
    });
    const clean = {};
    for (const [name, f] of Object.entries(fields)) {
      const v = out?.[name];
      if (v === null || v === undefined) { clean[name] = null; continue; }
      if (f.enum && !f.enum.includes(v)) { clean[name] = null; continue; }
      if (f.type === "number" && typeof v !== "number") { clean[name] = null; continue; }
      if (f.type === "string" && typeof v !== "string") { clean[name] = null; continue; }
      if (f.type === "boolean" && typeof v !== "boolean") { clean[name] = null; continue; }
      // A value that is not in the text was invented: drop it.
      if (!f.enum && typeof v === "string" && !looselyIn(v, text)) { clean[name] = null; continue; }
      if (typeof v === "number" && !looselyIn(String(v), text)) { clean[name] = null; continue; }
      clean[name] = v;
    }
    return clean;
  }
}

/** Thrown when a prompt is too long for the on-device model. Callers fall back. */
export class NanoTooLong extends Error {
  constructor() {
    super("Too long for the on-device model.");
    this.name = "NanoTooLong";
  }
}

function clamp01(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function looselyIn(value, text) {
  const norm = (s) => s.toLowerCase().replace(/[\s,.\-]/g, "");
  return norm(text).includes(norm(value));
}
