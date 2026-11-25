// Property tests: no sensitive value ever appears in an outbound payload, and the
// abstractions are deterministic and idempotent.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { AirlockGate, Vault, verhoeffDigit, installOnRuntime } from "../src/index.js";

const RUNS = Number(process.env.FC_RUNS || 400);

// Filler words with no digits and no "@", so a digit or email in the output can only
// come from a value that leaked.
const word = fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGH"), { minLength: 1, maxLength: 9 });
const punct = fc.constantFrom(" ", " ", " ", ", ", ". ", "! ", "? ", ": ", "\n");
const filler = fc.array(fc.tuple(word, punct).map(([w, p]) => w + p), { maxLength: 12 }).map((a) => a.join(""));

const digit = fc.integer({ min: 0, max: 9 }).map(String);
const digits = (n) => fc.array(digit, { minLength: n, maxLength: n }).map((a) => a.join(""));

const sep = fc.constantFrom("", " ", "-");
const phone = fc.tuple(fc.integer({ min: 6, max: 9 }), digits(9), fc.constantFrom("", "+91 ", "+91-", "0", "91 ", "0091 "), fc.constantFrom("5-5", "plain", "3-3-4"), sep)
  .map(([first, rest, prefix, shape, s]) => {
    const n = `${first}${rest}`;
    const body = shape === "5-5" ? `${n.slice(0, 5)}${s}${n.slice(5)}` : shape === "3-3-4" ? `${n.slice(0, 3)}${s}${n.slice(3, 6)}${s}${n.slice(6)}` : n;
    return { kind: "phone", text: prefix + body, digits: n };
  });

const aadhaar = fc.tuple(fc.integer({ min: 2, max: 9 }), digits(10), sep).map(([first, rest, s]) => {
  const eleven = `${first}${rest}`;
  const n = eleven + verhoeffDigit(eleven);
  return { kind: "aadhaar", text: `${n.slice(0, 4)}${s}${n.slice(4, 8)}${s}${n.slice(8)}`, digits: n };
});

const upper = fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ");
const pan = fc.tuple(fc.array(upper, { minLength: 5, maxLength: 5 }), digits(4), upper, fc.boolean())
  .map(([a, d, z, lower]) => {
    const t = `${a.join("")}${d}${z}`;
    return { kind: "pan", text: lower ? t.toLowerCase() : t };
  });

const local = fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789._+-"), { minLength: 1, maxLength: 12 })
  .filter((s) => /^[a-z0-9]/.test(s));
const domain = fc.tuple(fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-"), { minLength: 1, maxLength: 10 }).filter((s) => /^[a-z0-9]/.test(s)), fc.constantFrom("com", "in", "co.in", "org", "ac.in", "edu"));
const email = fc.tuple(local, domain).map(([l, [d, tld]]) => ({ kind: "email", text: `${l}@${d}.${tld}` }));

const income = fc.tuple(fc.integer({ min: 10000, max: 9900000 }), fc.constantFrom("₹", "Rs ", "Rs. ", "INR "), fc.constantFrom("family income is", "my parents earn", "we earn", "annual income", "salary of"), fc.boolean())
  .map(([n, cur, lead, grouped]) => {
    const s = grouped ? n.toLocaleString("en-IN") : String(n);
    return { kind: "income", text: `${lead} ${cur}${s}`, digits: String(n), valueText: `${cur}${s}` };
  });

const sensitive = fc.oneof(phone, aadhaar, pan, email, income);

function leaked(out, v) {
  if (v.kind === "pan") return out.toUpperCase().includes(v.text.toUpperCase());
  if (v.kind === "email") return out.includes(v.text) || out.includes("@");
  // Numbers: any run of the value's digits with separators counts as a leak.
  const flat = out.replace(/[\s,.\-]/g, "");
  return flat.includes(v.digits);
}

function embed(parts) {
  return parts.map(([f, v]) => `${f} ${v.text} `).join("");
}

test("property: no detected value appears in scrubbed text", async () => {
  const gate = new AirlockGate();
  await fc.assert(fc.asyncProperty(fc.array(fc.tuple(filler, sensitive), { minLength: 1, maxLength: 4 }), filler, async (parts, tail) => {
    const text = embed(parts) + tail;
    const out = (await gate.scrubText(text)).text;
    for (const [, v] of parts) assert.ok(!leaked(out, v), `leaked ${v.kind} "${v.text}" in: ${out}`);
  }), { numRuns: RUNS });
});

test("property: scrubbing is deterministic and idempotent", async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.tuple(filler, sensitive), { maxLength: 4 }), filler, async (parts, tail) => {
    const text = embed(parts) + tail;
    const a = new AirlockGate();
    const b = new AirlockGate();
    const once = (await a.scrubText(text)).text;
    assert.equal((await b.scrubText(text)).text, once);
    assert.equal((await a.scrubText(once)).text, once);
    assert.equal(a.scrubTextSync(text).text, once);
  }), { numRuns: RUNS });
});

test("property: vault values never leave, whatever the formatting", async () => {
  const name = fc.stringOf(fc.constantFrom(..."abcdefghijklmnop"), { minLength: 3, maxLength: 8 })
    .map((s) => s[0].toUpperCase() + s.slice(1));
  const fmtDigits = (d, i) => [d, d.replace(/(\d)(?=(\d{3})+$)/g, "$1,"), d.split("").join(" "), d.replace(/(\d{5})/, "$1-")][i];
  await fc.assert(fc.asyncProperty(
    fc.tuple(name, name), digits(10), fc.integer({ min: 20000, max: 990000 }).map(String), filler, filler, fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 }),
    async ([first, last], ph, inc, f1, f2, i, j) => {
      const vault = new Vault();
      vault.set("name", `${first} ${last}`, { category: "PERSON", label: "Name" });
      vault.set("phone", ph, { category: "PHONE", label: "Phone" });
      vault.set("familyIncome", inc, { category: "INCOME", label: "Family income" });
      const gate = new AirlockGate({ vault });
      const phText = fmtDigits(ph, i);
      const incText = fmtDigits(inc, j);
      const text = `${f1} I am ${first.toLowerCase()} ${last}, reach ${phText}. ${f2} total ${incText}.`;
      const out = (await gate.scrubText(text)).text;
      assert.ok(!new RegExp(`\\b${first} ${last}\\b`, "i").test(out), out);
      const flat = out.replace(/[\s,.\-]/g, "");
      assert.ok(!flat.includes(ph), out);
      assert.ok(!flat.includes(inc), out);
    }), { numRuns: RUNS });
});

test("property: nothing sensitive reaches the wire through the runtime hooks", async () => {
  const wire = [];
  class LlmClient {
    constructor() { this.baseUrl = "https://router.example/v1"; }
    async chat(req) { wire.push(JSON.stringify(req)); return { content: "", toolCalls: [] }; }
  }
  class Engine {
    async resolveRemote() { return { base: "https://partner.example", invoke: async (req) => { wire.push(JSON.stringify(req)); return ""; } }; }
  }
  class ActionRegistry {
    async execute(plan) { wire.push(JSON.stringify(plan.map((p) => p.args))); return []; }
  }
  const gate = new AirlockGate();
  const undo = installOnRuntime(gate, { LlmClient, Engine, ActionRegistry, pageOrigin: "https://hopemeals.example" });
  try {
    await fc.assert(fc.asyncProperty(fc.array(fc.tuple(filler, sensitive), { minLength: 1, maxLength: 3 }), async (parts) => {
      wire.length = 0;
      const text = embed(parts);
      await new LlmClient().chat({
        messages: [
          { role: "system", content: "rules" },
          { role: "user", content: text },
          { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "t", arguments: JSON.stringify({ request: text }) } }] },
        ],
      });
      const s = await new Engine().resolveRemote();
      await s.invoke({ user_message: { text } });
      await new ActionRegistry().execute([{ entry: { base: "https://partner.example" }, args: { note: text } }]);
      for (const payload of wire) {
        for (const [, v] of parts) {
          // Tool-call arguments and remote-action arguments get the strict set; income
          // there is a visitor's words copied by the model, which the user turn already hid.
          if (v.kind === "income") continue;
          assert.ok(!leaked(payload.replace(/\\n/g, " "), v), `leaked ${v.kind} in ${payload}`);
        }
      }
      // The user turn itself hides income too.
      const userTurn = JSON.parse(wire[0]).messages[1].content;
      for (const [, v] of parts) assert.ok(!leaked(userTurn, v), `leaked ${v.kind} in user turn`);
    }), { numRuns: Math.ceil(RUNS / 2) });
  } finally { undo(); }
});
