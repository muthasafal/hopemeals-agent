// A small JSON Schema subset: the keywords the agentic-web runtime allows for actions
// (runtime/actions.js checkSchema), which is also what we hand Nano as a constraint.

const KEEP = new Set(["type", "properties", "required", "additionalProperties", "items", "enum",
  "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "description", "anyOf"]);

/**
 * Copy a schema keeping only keywords the Prompt API's structured output understands.
 *
 * @param {any} schema
 * @returns {any}
 */
export function constraintFrom(schema) {
  if (Array.isArray(schema)) return schema.map(constraintFrom);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (!KEEP.has(k)) continue;
    if (k === "properties") {
      out.properties = {};
      for (const [name, s] of Object.entries(v || {})) out.properties[name] = constraintFrom(s);
    } else if (k === "items" || k === "anyOf") {
      out[k] = constraintFrom(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Check a value against the subset. Returns the problems; empty means valid.
 *
 * @param {any} schema
 * @param {any} value
 * @param {string} [path]
 * @returns {string[]}
 */
export function validateArgs(schema, value, path = "arguments") {
  if (!schema || typeof schema !== "object") return [];
  const errs = [];
  if (schema.anyOf) {
    return schema.anyOf.some((s) => validateArgs(s, value, path).length === 0) ? [] : [`${path} matches no allowed shape`];
  }
  const t = schema.type;
  const typeOk = {
    object: () => value !== null && typeof value === "object" && !Array.isArray(value),
    array: () => Array.isArray(value),
    string: () => typeof value === "string",
    integer: () => Number.isInteger(value),
    number: () => typeof value === "number" && Number.isFinite(value),
    boolean: () => typeof value === "boolean",
    null: () => value === null,
  };
  if (t && typeOk[t] && !typeOk[t]()) return [`${path} should be ${t}`];
  if (schema.enum && !schema.enum.some((e) => e === value)) errs.push(`${path} is not an allowed value`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${path} is too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${path} is too long`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path} is below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path} is above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${path} has too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${path} has too many items`);
    if (schema.items) value.forEach((v, i) => errs.push(...validateArgs(schema.items, v, `${path}[${i}]`)));
  }
  if (t === "object" || (schema.properties && value && typeof value === "object")) {
    for (const r of schema.required || []) if (!Object.hasOwn(value, r)) errs.push(`${path}.${r} is required`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) errs.push(...validateArgs(schema.properties[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}.${k} is not allowed`);
    }
  }
  return errs;
}
