import { test } from "node:test";
import assert from "node:assert/strict";
import { NanoClient, NanoRouter, NanoDetector, installNano, validateArgs, constraintFrom, NANO_MODEL } from "../src/index.js";

/**
 * A stand-in for Chrome's LanguageModel global. `answer(prompt, schema)` decides what
 * Nano "says"; every prompt is recorded.
 */
function mockLM({ availability = "available", answer }) {
  const calls = [];
  let created = 0;
  let destroyed = 0;
  const session = {
    async prompt(input, opts) {
      const system = input.find((m) => m.role === "system").content;
      const user = input.find((m) => m.role === "user").content;
      calls.push({ system, user, schema: opts.responseConstraint });
      const out = await answer({ system, user, schema: opts.responseConstraint });
      return typeof out === "string" ? out : JSON.stringify(out);
    },
    async clone() { return { ...session, destroy() { destroyed++; } }; },
  };
  return {
    calls,
    get created() { return created; },
    get destroyed() { return destroyed; },
    LanguageModel: {
      async availability() { return availability; },
      async create(opts) {
        created++;
        opts.monitor?.({ addEventListener() {} });
        return session;
      },
    },
  };
}

const TOOLS = [
  { type: "function", function: { name: "website_get_site_facts", description: "Read HopeMeals facts.", parameters: { type: "object", properties: { topic: { type: "string", enum: ["impact", "eligibility", "80g"] } }, required: ["topic"], additionalProperties: false } } },
  { type: "function", function: { name: "website_start_donation", description: "Open checkout.", parameters: { type: "object", properties: { amount: { type: "integer", minimum: 1 } }, required: ["amount"], additionalProperties: false } } },
  { type: "function", function: { name: "render_cruse", description: "UI", parameters: { type: "object", properties: {} } } },
];

test("availability is 'unavailable' without the Prompt API", async () => {
  assert.equal(await new NanoClient({ LanguageModel: undefined }).availability(), "unavailable");
  const m = mockLM({ availability: "downloadable", answer: () => ({}) });
  assert.equal(await new NanoClient({ LanguageModel: m.LanguageModel }).ready(), false);
});

test("classifyIntent uses an enum constraint and clamps confidence", async () => {
  const m = mockLM({ answer: ({ schema }) => ({ intent: schema.properties.intent.enum[1], confidence: 7 }) });
  const nano = new NanoClient({ LanguageModel: m.LanguageModel });
  const r = await nano.classifyIntent("can I apply?", [
    { name: "donate", description: "giving money" },
    { name: "apply", description: "student support" },
    { name: "other", description: "anything else" },
  ]);
  assert.deepEqual(r, { intent: "apply", confidence: 1 });
  assert.deepEqual(m.calls[0].schema.properties.intent.enum, ["donate", "apply", "other"]);
  assert.equal(m.destroyed, 1, "each prompt runs in a clone that is destroyed");
});

test("extractFields drops invented values and keeps stated ones", async () => {
  const m = mockLM({ answer: () => ({ college: "B.J. Medical College", year: "Second Year", familyIncome: 999999, city: "Mumbai" }) });
  const nano = new NanoClient({ LanguageModel: m.LanguageModel });
  const r = await nano.extractFields("I'm in second year at BJ Medical College, Pune", {
    college: { type: "string", description: "college name" },
    year: { type: "string", description: "year", enum: ["First Year", "Second Year"] },
    familyIncome: { type: "number", description: "income" },
    city: { type: "string", description: "city" },
  });
  // "Mumbai" and the income are not in the text, so they are dropped.
  assert.equal(r.familyIncome, null);
  assert.equal(r.college, "B.J. Medical College");
  assert.equal(r.year, "Second Year");
  assert.equal(r.city, null);
});

test("too-long prompts are refused before Nano is called", async () => {
  const m = mockLM({ answer: () => ({ text: "x" }) });
  const nano = new NanoClient({ LanguageModel: m.LanguageModel, maxInputChars: 50 });
  await assert.rejects(nano.json("s", "x".repeat(100), {}), /Too long/);
  assert.equal(m.calls.length, 0);
});

function routerWith(answer, opts = {}) {
  const m = mockLM({ answer });
  const nano = new NanoClient({ LanguageModel: m.LanguageModel });
  const routes = [];
  const router = new NanoRouter({ nano, nanoTools: ["website_get_site_facts"], onRoute: (r) => routes.push(r), ...opts });
  return { m, router, routes };
}

const remoteResult = { content: "remote", toolCalls: [], finishReason: "stop", usage: null, model: "big" };

test("shim: chooses an allowed tool, fills its arguments, returns an OpenAI tool call", async () => {
  const { m, router, routes } = routerWith(({ schema }) => (schema.properties.kind
    ? { kind: "tool", tool: "website_get_site_facts" }
    : { topic: "80g" }));
  const r = await router.chat({ messages: [{ role: "system", content: "You help." }, { role: "user", content: "How does 80G work?" }], tools: TOOLS }, async () => remoteResult);
  assert.equal(r.model, NANO_MODEL);
  assert.equal(r.finishReason, "tool_calls");
  assert.equal(r.toolCalls[0].function.name, "website_get_site_facts");
  assert.deepEqual(JSON.parse(r.toolCalls[0].function.arguments), { topic: "80g" });
  // Only the allowed tool is offered; render_cruse and the irreversible action are not.
  assert.deepEqual(m.calls[0].schema.properties.tool.enum, ["website_get_site_facts"]);
  assert.equal(routes[0].route, "nano");
});

test("shim: invalid arguments fall back to the visitor's provider", async () => {
  const { router, routes } = routerWith(({ schema }) => (schema.properties.kind ? { kind: "tool", tool: "website_get_site_facts" } : { topic: "tax" }));
  const r = await router.chat({ messages: [{ role: "user", content: "tax?" }], tools: TOOLS }, async () => remoteResult);
  assert.equal(r.content, "remote");
  assert.equal(routes[0].route, "remote");
  assert.match(routes[0].reason, /not an allowed value/);
});

test("shim: a direct answer with a number is not trusted", async () => {
  const { router } = routerWith(() => ({ kind: "answer", text: "₹3,000 feeds a student for a month." }));
  const r = await router.chat({ messages: [{ role: "user", content: "what does 3000 do" }], tools: TOOLS }, async () => remoteResult);
  assert.equal(r.content, "remote");
});

test("shim: a greeting is answered on the device and streamed once", async () => {
  const { router } = routerWith(() => ({ kind: "answer", text: "Hello! Are you here to give or to apply?" }));
  const deltas = [];
  const r = await router.chat({ messages: [{ role: "user", content: "hi" }], tools: TOOLS, onContentDelta: (d) => deltas.push(d) }, async () => remoteResult);
  assert.equal(r.content, "Hello! Are you here to give or to apply?");
  assert.deepEqual(deltas, [r.content]);
});

test("shim: answers from tool results only when every number is in them", async () => {
  const results = [
    { role: "user", content: "How many meals so far?" },
    { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "website_get_site_facts", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "1", name: "website_get_site_facts", content: JSON.stringify({ mealsServed: "20,000+" }) },
  ];
  const good = routerWith(() => ({ text: "HopeMeals has served 20,000+ meals." }));
  assert.equal((await good.router.chat({ messages: results, tools: TOOLS }, async () => remoteResult)).content, "HopeMeals has served 20,000+ meals.");
  const bad = routerWith(() => ({ text: "HopeMeals has served 25,000 meals." }));
  assert.equal((await bad.router.chat({ messages: results, tools: TOOLS }, async () => remoteResult)).content, "remote");
});

test("router: goes remote when Nano is unavailable, the step is long, or after two rounds", async () => {
  const off = new NanoRouter({ nano: new NanoClient({ LanguageModel: undefined }) });
  assert.equal((await off.chat({ messages: [{ role: "user", content: "hi" }] }, async () => remoteResult)).content, "remote");
  const { router } = routerWith(() => ({ kind: "answer", text: "hi" }), { maxStepChars: 10 });
  assert.equal((await router.chat({ messages: [{ role: "user", content: "a long question here" }] }, async () => remoteResult)).content, "remote");
  const two = [
    { role: "user", content: "q" },
    { role: "assistant", tool_calls: [] }, { role: "tool", name: "a", content: "1" },
    { role: "assistant", tool_calls: [] }, { role: "tool", name: "b", content: "2" },
  ];
  assert.equal(router.refusal({ messages: two }), "more than one tool round");
});

test("on-device-only mode never calls the remote provider", async () => {
  const { router } = routerWith(() => ({ kind: "handoff" }), { mode: "on-device-only" });
  let remoteCalled = false;
  const r = await router.chat({ messages: [{ role: "user", content: "fill my form" }], tools: TOOLS }, async () => { remoteCalled = true; return remoteResult; });
  assert.equal(remoteCalled, false);
  assert.match(r.content, /larger AI model/);
});

test("installNano wraps LlmClient.prototype.chat once and keeps `this` for remote", async () => {
  class LlmClient {
    constructor() { this.baseUrl = "https://router.example"; }
    async chat() { return { ...remoteResult, content: this.baseUrl }; }
  }
  const { router } = routerWith(() => ({ kind: "handoff" }));
  const undo = installNano(LlmClient, router);
  installNano(LlmClient, router);
  const r = await new LlmClient().chat({ messages: [{ role: "user", content: "x" }], tools: TOOLS });
  assert.equal(r.content, "https://router.example");
  undo();
});

test("NanoDetector returns only spans that are really in the text", async () => {
  const m = mockLM({ answer: () => ({ items: [
    { text: "Asha Kulkarni", category: "PERSON", confidence: 0.9 },
    { text: "Ravi", category: "PERSON", confidence: 0.9 },
    { text: "maybe", category: "PERSON", confidence: 0.2 },
  ] }) });
  const d = new NanoDetector(new NanoClient({ LanguageModel: m.LanguageModel }));
  const f = await d.detect("I am Asha Kulkarni, maybe call me Asha Kulkarni.");
  assert.deepEqual(f.map((x) => [x.start, x.text]), [[5, "Asha Kulkarni"], [34, "Asha Kulkarni"]]);
  assert.equal(f[0].detector, "NANO");
});

test("schema helpers: constraint keeps the safe subset, validation matches the runtime's rules", () => {
  const s = { type: "object", properties: { a: { type: "string", format: "email", "x-ui": {}, maxLength: 3 } }, required: ["a"], additionalProperties: false };
  assert.deepEqual(constraintFrom(s), { type: "object", properties: { a: { type: "string", maxLength: 3 } }, required: ["a"], additionalProperties: false });
  assert.deepEqual(validateArgs(s, { a: "abc" }), []);
  assert.equal(validateArgs(s, { a: "abcd" }).length, 1);
  assert.equal(validateArgs(s, { b: 1 }).length, 2);
  assert.equal(validateArgs({ type: "integer", minimum: 1 }, 0).length, 1);
});
