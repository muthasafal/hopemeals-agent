import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AirlockGate, Vault, RuleDetector, VaultDetector, GateDeclined, definePolicy, incomeRangeAbstraction,
  parseRupees, verhoeffDigit, verhoeffValid, installOnRuntime, wrapConsent, learnLines, fromScrubEngine,
} from "../src/index.js";

const aadhaar = (eleven) => eleven + verhoeffDigit(eleven);

test("Verhoeff: known valid and invalid numbers", () => {
  assert.equal(verhoeffValid("2363"), true); // classic example: 236 + check digit 3
  assert.equal(verhoeffDigit("236"), "3");
  const a = aadhaar("23456789012");
  assert.equal(verhoeffValid(a), true);
  const wrong = a.slice(0, 11) + ((Number(a[11]) + 1) % 10);
  assert.equal(verhoeffValid(wrong), false);
});

test("rule detector finds each kind", () => {
  const a = aadhaar("98765432101");
  const text = `Mail me at asha.k@example.co.in or call +91 98765 43210. Aadhaar ${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}, PAN abcde1234f. Family income is ₹1,80,000 a year. I want to donate ₹5,000.`;
  const found = new RuleDetector().detect(text).map((f) => [f.category, f.text]);
  assert.deepEqual(found.find((f) => f[0] === "EMAIL"), ["EMAIL", "asha.k@example.co.in"]);
  assert.deepEqual(found.find((f) => f[0] === "PHONE"), ["PHONE", "+91 98765 43210"]);
  assert.ok(found.some((f) => f[0] === "AADHAAR"));
  assert.deepEqual(found.find((f) => f[0] === "PAN"), ["PAN", "abcde1234f"]);
  assert.deepEqual(found.find((f) => f[0] === "INCOME"), ["INCOME", "₹1,80,000"]);
  assert.deepEqual(found.find((f) => f[0] === "FINANCIAL_AMOUNT"), ["FINANCIAL_AMOUNT", "₹5,000"]);
});

test("a 12-digit number that fails Verhoeff is not an Aadhaar", () => {
  const a = aadhaar("23456789012");
  const wrong = a.slice(0, 11) + ((Number(a[11]) + 1) % 10);
  assert.equal(new RuleDetector().detect(`id ${wrong}`).some((f) => f.category === "AADHAAR"), false);
});

test("default policy: contact and IDs withheld, income abstracted, donations kept", async () => {
  const gate = new AirlockGate();
  const r = await gate.scrubText("I'm asha@example.com, 9876543210. We earn 1.8 lakh per annum. What does ₹3,000 fund?");
  assert.equal(r.text, "I'm [email withheld], [phone number withheld]. We earn [income: provided, kept on this device] per annum. What does ₹3,000 fund?");
  assert.deepEqual(r.items.map((i) => i.category), ["EMAIL", "PHONE", "INCOME"]);
});

test("reservation category in the visitor's words is abstracted", async () => {
  const gate = new AirlockGate();
  const r = await gate.scrubText("I belong to the Other Backward Classes, is that okay?");
  assert.equal(r.text, "I belong to the [reservation category: declared], is that okay?");
});

test("site policy: income range abstraction only when a range is published", async () => {
  const policy = definePolicy({ categories: { INCOME: { abstraction: incomeRangeAbstraction(250000) } } });
  const gate = new AirlockGate({ policy });
  assert.equal((await gate.scrubText("family income ₹1,80,000")).text, "family income [income: within the eligible range]");
  assert.equal((await gate.scrubText("family income 3 lakh")).text, "family income [income: above the published range]");
  assert.equal(parseRupees("2 LPA"), 200000);
  assert.equal(parseRupees("Rs 90k"), 90000);
});

test("vault values are caught in any format, even with no pattern", async () => {
  const vault = new Vault();
  vault.set("familyIncome", "180000", { category: "INCOME", label: "Family income" });
  vault.set("name", "Asha Kulkarni", { category: "PERSON", label: "Name" });
  vault.set("reservation", "Scheduled Tribes", { category: "RESERVATION", label: "Reservation category" });
  const gate = new AirlockGate({ vault });
  const r = await gate.scrubText("asha kulkarni here, it is 1,80,000 total, category scheduled tribes");
  assert.equal(r.text, "[name withheld] here, it is [income: provided, kept on this device] total, category [reservation category: declared]");
});

test("site text: strict mode keeps a partner name and category options intact", async () => {
  const vault = new Vault();
  vault.set("reservation", "Scheduled Tribes", { category: "RESERVATION", label: "Reservation category" });
  const gate = new AirlockGate({ vault, publicValues: ["+91-8669900008", "contact@hopemeals.org"] });
  const site = "Partners: Bhatkya Vimukta Jati Shikshan Sanstha. Options: None, Scheduled Castes, Scheduled Tribes. Call +91-8669900008 or contact@hopemeals.org. ₹3,000 a month.";
  const r = await gate.scrubText(site, { strict: true });
  assert.equal(r.text, site);
});

test("public values are never replaced, even in visitor text", async () => {
  const gate = new AirlockGate({ publicValues: ["contact@hopemeals.org"] });
  assert.equal((await gate.scrubText("is contact@hopemeals.org right?")).text, "is contact@hopemeals.org right?");
});

test("scrubMessages covers user text and tool-call arguments", async () => {
  const gate = new AirlockGate();
  const r = await gate.scrubMessages([
    { role: "system", content: "You help on HopeMeals." },
    { role: "user", content: "My PAN is ABCDE1234F" },
    { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "x", arguments: JSON.stringify({ note: "pan ABCDE1234F" }) } }] },
    { role: "tool", tool_call_id: "1", content: "ok" },
  ]);
  assert.ok(!JSON.stringify(r.messages).includes("ABCDE1234F"));
  assert.equal(r.before, "My PAN is ABCDE1234F");
  assert.equal(r.after, "My PAN is [PAN withheld]");
  assert.deepEqual(r.segments.map((s) => s.kind), ["same", "swap"]);
});

test("review: asks once per destination and detail, and a no stops the call", async () => {
  const asked = [];
  let answer = true;
  const gate = new AirlockGate({ onReview: (rep) => { asked.push(rep); return answer; } });
  const req = { messages: [{ role: "user", content: "call me on 9876543210" }] };
  await gate.gateModelCall(req, "api.otari.ai");
  await gate.gateModelCall(req, "api.otari.ai");
  assert.equal(asked.length, 1);
  assert.deepEqual(learnLines(asked[0]), ["Phone number: not shared"]);
  answer = false;
  await assert.rejects(gate.gateModelCall({ messages: [{ role: "user", content: "mail x@y.com" }] }, "api.otari.ai"), GateDeclined);
});

test("installOnRuntime: model calls, partner sessions and remote actions are gated", async () => {
  const sent = [];
  class LlmClient {
    constructor() { this.baseUrl = "https://api.otari.ai/api/v1"; }
    async chat(req) { sent.push(JSON.stringify(req)); return { content: "ok", toolCalls: [] }; }
  }
  const invoked = [];
  class Engine {
    async resolveRemote() { return { base: "http://localhost:8081", invoke: async (req) => { invoked.push(req.user_message.text); return "done"; } }; }
  }
  const executed = [];
  class ActionRegistry {
    async execute(plan) { executed.push(plan); return []; }
  }
  const gate = new AirlockGate();
  const undo = installOnRuntime(gate, { LlmClient, Engine, ActionRegistry, pageOrigin: "http://127.0.0.1:8080" });
  await new LlmClient().chat({ model: "m", messages: [{ role: "user", content: "PAN ABCDE1234F please" }] });
  const session = await new Engine().resolveRemote("x");
  await session.invoke({ user_message: { text: "donor phone 9876543210 wants 80G" } });
  await new ActionRegistry().execute([
    { entry: { base: "http://localhost:8081" }, args: { amount: 5000, note: "pan ABCDE1234F" } },
    { entry: { base: "http://127.0.0.1:8080" }, args: { note: "pan ABCDE1234F" } },
  ]);
  assert.ok(!sent[0].includes("ABCDE1234F"));
  assert.equal(invoked[0], "donor phone [phone number withheld] wants 80G");
  assert.deepEqual(executed[0][0].args, { amount: 5000, note: "pan [PAN withheld]" });
  // The page's own action runs on the visitor's own page and keeps its arguments.
  assert.deepEqual(executed[0][1].args, { note: "pan ABCDE1234F" });
  // Installing twice does not double-wrap.
  installOnRuntime(gate, { LlmClient, Engine, ActionRegistry });
  undo();
});

test("wrapConsent: the card gets the scrubbed request", async () => {
  const gate = new AirlockGate();
  const shown = [];
  const engine = { onConsent: async (info) => { shown.push(info.requestText); return "allow"; } };
  let rendered = null;
  wrapConsent(gate, engine, { render: (rep) => { rendered = rep; } });
  const d = await engine.onConsent({ kind: "network", peerLabel: "HopeMeals", peerOrigin: "127.0.0.1:5173", requestText: "What does ₹50,000 fund? I am a@b.in" });
  assert.equal(d, "allow");
  assert.equal(shown[0], "What does ₹50,000 fund? I am [email withheld]");
  assert.equal(rendered.items.length, 1);
  assert.ok(gate.consentShown.has("127.0.0.1:5173"));
});

test("fromScrubEngine adapts any detect(text) to the interface", async () => {
  const engine = { detect: (t) => [{ start: t.indexOf("Pune"), end: t.indexOf("Pune") + 4, text: "Pune", category: "OTHER_SENSITIVE", detector: "RULE", confidence: 0.9 }] };
  const gate = new AirlockGate({ detectors: [fromScrubEngine(engine)] });
  assert.equal((await gate.scrubText("I live in Pune")).text, "I live in [private detail withheld]");
});

test("a failing extra detector does not stop the built-in ones", async () => {
  const gate = new AirlockGate({ detectors: [{ id: "broken", detect() { throw new Error("x"); } }] });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal((await gate.scrubText("a@b.in")).text, "[email withheld]");
  } finally { console.warn = warn; }
});

test("VaultDetector ignores empty and very short values", () => {
  const v = new Vault();
  v.set("x", "", { category: "PERSON", label: "Name" });
  v.set("y", "Al", { category: "PERSON", label: "Name" });
  assert.deepEqual(new VaultDetector(v).detect("Al went home"), []);
});
