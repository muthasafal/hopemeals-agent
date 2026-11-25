// A scripted stand-in for the visitor's LLM provider (hosted Otari, the router both
// manifests name). It records every request body, so tests can check exactly what left
// the device, and answers in OpenAI streaming format.

export const ROUTER = "https://api.otari.ai/api/v1";
export const MODEL = "test/model";

/** Seed a saved BYOK setup, as if the visitor had pasted a key. The key is fake. */
export async function seedKey(context) {
  await context.addInitScript(({ router, model }) => {
    const now = new Date().toISOString();
    if (!localStorage.getItem("nsweb-byok-profiles-v1")) {
      localStorage.setItem("nsweb-byok-profiles-v1", JSON.stringify({
        version: 1, selectedId: "e2e", updatedAt: now,
        profiles: [{ id: "e2e", name: "E2E", key: "e2e-fake-key", model, router, runner: false, updatedAt: now }],
      }));
    }
  }, { router: ROUTER, model: MODEL });
}

function sse(chunks) {
  return chunks.map((c) => `data: ${JSON.stringify({ model: MODEL, ...c })}\n\n`).join("") + "data: [DONE]\n\n";
}

/** The current step of one agent call: who is asking and what came back. */
export function stepOf(body) {
  const messages = body.messages || [];
  const system = String(messages.find((m) => m.role === "system")?.content || "");
  let u = -1;
  messages.forEach((m, i) => { if (m.role === "user") u = i; });
  const after = messages.slice(u + 1);
  return {
    system,
    user: String(messages[u]?.content || ""),
    results: after.filter((m) => m.role === "tool").map((m) => ({ name: m.name, content: String(m.content || "") })),
    tools: (body.tools || []).map((t) => t.function.name),
  };
}

/**
 * Route the provider. `script(step, body)` returns {text} or {tool, args}.
 *
 * @returns {{bodies: string[]}} every chat request body, as sent.
 */
export async function mockLLM(context, script) {
  const log = { bodies: [] };
  await context.route(`${ROUTER}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    if (req.url().endsWith("/models")) return route.fulfill({ status: 200, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify({ data: [{ id: MODEL }] }) });
    const raw = req.postData() || "{}";
    log.bodies.push(raw);
    const body = JSON.parse(raw);
    let out;
    try { out = await script(stepOf(body), body); } catch (err) { out = { text: `mock error: ${err.message}` }; }
    const chunks = out.tool
      ? [{ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${log.bodies.length}`, type: "function", function: { name: out.tool, arguments: JSON.stringify(out.args || {}) } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] }]
      : [{ choices: [{ delta: { content: out.text } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }];
    return route.fulfill({ status: 200, headers: { ...cors(), "Content-Type": "text/event-stream" }, body: sse(chunks) });
  });
  return log;
}

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
}

/** Send a chat message the way a visitor would. */
export async function say(page, text) {
  const input = page.locator("#ns-input");
  await input.click();
  await input.fill(text);
  await input.press("Enter");
}
