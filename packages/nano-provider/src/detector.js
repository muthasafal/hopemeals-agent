// A contextual detector for airlock-gate that runs on Gemini Nano: it finds details the
// patterns cannot, such as a person's name or a date of birth written in words. The text
// never leaves the device.

const DEFAULT_CATEGORIES = ["PERSON", "DATE_OF_BIRTH", "OTHER_SENSITIVE"];

export class NanoDetector {
  /**
   * @param {import("./nano.js").NanoClient} nano
   * @param {{categories?: string[], minConfidence?: number}} [options]
   */
  constructor(nano, { categories = DEFAULT_CATEGORIES, minConfidence = 0.6 } = {}) {
    this.id = "nano";
    this.nano = nano;
    this.categories = categories;
    this.minConfidence = minConfidence;
  }

  /**
   * @param {string} text
   * @returns {Promise<Array<{start: number, end: number, text: string, category: string, detector: "NANO", confidence: number}>>}
   */
  async detect(text) {
    if (!text || !(await this.nano.ready())) return [];
    const out = await this.nano.json(
      "List the private details about a real person in the text: "
        + "PERSON (a person's name), DATE_OF_BIRTH, OTHER_SENSITIVE (health, family situation, home address). "
        + "Copy each one exactly as written. Do not list organisations, colleges, cities or amounts.",
      text,
      {
        type: "object",
        properties: {
          items: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              properties: {
                text: { type: "string", maxLength: 120 },
                category: { type: "string", enum: this.categories },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["text", "category", "confidence"],
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
    );
    const findings = [];
    for (const it of out?.items || []) {
      const needle = String(it.text || "").trim();
      if (needle.length < 2 || !this.categories.includes(it.category) || !(it.confidence >= this.minConfidence)) continue;
      // Only spans really in the text count; Nano cannot add words.
      let from = 0;
      for (;;) {
        const at = text.indexOf(needle, from);
        if (at < 0) break;
        findings.push({ start: at, end: at + needle.length, text: needle, category: it.category, detector: "NANO", confidence: it.confidence });
        from = at + needle.length;
      }
    }
    return findings;
  }
}
