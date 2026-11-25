// The vault holds the values a visitor typed into a local-only form panel. It lives in
// this tab's memory (and, if asked, this tab's sessionStorage). Nothing in it is sent
// anywhere by the gate: the page's own actions read it to fill the site's own forms.

/**
 * @typedef {object} VaultEntry
 * @property {string} field Field name, such as "familyIncome".
 * @property {string} value What the visitor typed.
 * @property {import("./detectors.js").Category} category What kind of value it is.
 * @property {string} label Readable name, such as "Family income".
 */

export class Vault {
  /**
   * @param {{storage?: Storage|null, storageKey?: string}} [options] Pass sessionStorage to keep
   *   values across reloads of this tab only. Defaults to memory only.
   */
  constructor({ storage = null, storageKey = "airlock-gate-vault-v1" } = {}) {
    /** @type {Map<string, VaultEntry>} */
    this.map = new Map();
    this.storage = storage;
    this.storageKey = storageKey;
    this.listeners = new Set();
    if (storage) {
      try {
        for (const e of JSON.parse(storage.getItem(storageKey) || "[]")) this.map.set(e.field, e);
      } catch { /* ignore a damaged copy */ }
    }
  }

  /**
   * Store one value. An empty value removes the field.
   *
   * @param {string} field
   * @param {string} value
   * @param {{category: import("./detectors.js").Category, label: string}} meta
   */
  set(field, value, { category, label }) {
    const v = String(value ?? "").trim();
    if (!v) this.map.delete(field);
    else this.map.set(field, { field, value: v, category, label });
    this.persist();
  }

  /** @param {string} field */
  get(field) {
    return this.map.get(field)?.value ?? "";
  }

  /** @param {string} field */
  has(field) {
    return this.map.has(field);
  }

  /** @returns {VaultEntry[]} */
  entries() {
    return [...this.map.values()];
  }

  /** Forget everything, here and in storage. */
  clear() {
    this.map.clear();
    this.persist();
  }

  /** @param {() => void} fn Called after each change. @returns {() => void} unsubscribe */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  persist() {
    if (this.storage) {
      try { this.storage.setItem(this.storageKey, JSON.stringify(this.entries())); } catch { /* quota */ }
    }
    for (const fn of this.listeners) fn();
  }
}
