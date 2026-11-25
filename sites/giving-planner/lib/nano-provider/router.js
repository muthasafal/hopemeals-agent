// Route the runtime's model calls: small, single-step ones to Gemini Nano on the device,
// everything else to the visitor's own provider (BYOK).
//
// Nano cannot call tools. The shim asks it, with structured output, which tool to call
// (an enum of the tool names) and then for that tool's arguments (the tool's own JSON
// Schema as the constraint), checks them, and returns an OpenAI-style tool call: the
// same result shape as the runtime's LlmClient.chat.

import { NanoTooLong } from "./nano.js";
import { constraintFrom, validateArgs } from "./schema.js";

export const NANO_MODEL = "gemini-nano (on-device)";

/** The shim gave up; the router falls back to the visitor's provider. */
export class ShimFailed extends Error {
  constructor(reason) {
    super(`On-device step not used: ${reason}`);
    this.name = "ShimFailed";
  }
}

const textOf = (c) => (typeof c === "string" ? c : c == null ? "" : JSON.stringify(c));
const numbersIn = (s) => (String(s).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, ""));

/**
 * The messages that belong to the current step: the last user turn and any tool results
 * after it (one round at most).
 */
export function currentStep(messages) {
  let u = -1;
  for (let i = 0; i < messages.length; i++) if (messages[i]?.role === "user") u = i;
  const user = u >= 0 ? textOf(messages[u].content) : "";
  const after = u >= 0 ? messages.slice(u + 1) : [];
  const rounds = after.filter((m) => m.role === "assistant").length;
  const results = after.filter((m) => m.role === "tool").map((m) => ({ name: m.name, content: textOf(m.content) }));
  const system = messages.find((m) => m.role === "system");
  return { user, results, rounds, system: system ? textOf(system.content) : "" };
}

export class NanoRouter {
  /**
   * @param {object} options
   * @param {import("./nano.js").NanoClient} options.nano
   * @param {"assist"|"on-device-only"|"off"} [options.mode] assist: Nano for small steps, the
   *   visitor's provider for the rest. on-device-only: never call a remote provider.
   * @param {string[]} [options.nanoTools] Tools Nano may call. Others always go remote. Default: none,
   *   so Nano only greets and answers from tool results unless the site opts tools in.
   * @param {number} [options.maxStepChars] Largest user turn plus tool results Nano gets.
   * @param {number} [options.systemChars] How much of the agent's instructions Nano sees.
   * @param {(info: {route: "nano"|"remote", reason: string}) => void} [options.onRoute]
   * @param {string} [options.offlineMessage] What on-device-only mode says when Nano cannot do it.
   */
  constructor({ nano, mode = "assist", nanoTools = [], maxStepChars = 3000, systemChars = 1600, onRoute,
    offlineMessage = "This needs a larger AI model than the one built into your browser. Add your own key in AI model settings to continue." } = {}) {
    this.nano = nano;
    this.mode = mode;
    this.nanoTools = new Set(nanoTools);
    this.maxStepChars = maxStepChars;
    this.systemChars = systemChars;
    this.onRoute = onRoute;
    this.offlineMessage = offlineMessage;
  }

  /**
   * Why Nano should not take this call, or "" when it may.
   *
   * @param {{messages: any[], tools?: any[]}} req
   */
  refusal(req) {
    if (this.mode === "off") return "off";
    const step = currentStep(req.messages || []);
    if (!step.user) return "no visitor message";
    if (step.rounds > 1) return "more than one tool round";
    const size = step.user.length + step.results.reduce((n, r) => n + r.content.length, 0);
    if (size > this.maxStepChars) return "too long";
    return "";
  }

  /**
   * The router's chat: same arguments and result as LlmClient.chat.
   *
   * @param {any} req
   * @param {(req: any) => Promise<any>} remote The original chat, bound to its client.
   */
  async chat(req, remote) {
    const offline = this.mode === "on-device-only";
    const goRemote = (reason) => {
      this.onRoute?.({ route: "remote", reason });
      if (offline) return this.reply(req, this.offlineMessage);
      return remote(req);
    };
    const why = this.refusal(req);
    if (why) return goRemote(why);
    if (!(await this.nano.ready())) return goRemote("Nano not available");
    try {
      const result = await this.step(req);
      this.onRoute?.({ route: "nano", reason: result.toolCalls.length ? `tool ${result.toolCalls[0].function.name}` : "answer" });
      return result;
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      const reason = err instanceof ShimFailed || err instanceof NanoTooLong ? err.message : `Nano error: ${err?.message || err}`;
      return goRemote(reason);
    }
  }

  reply(req, text) {
    req.onContentDelta?.(text);
    return { content: text, toolCalls: [], finishReason: "stop", usage: null, model: NANO_MODEL };
  }

  /**
   * One on-device step.
   */
  async step(req) {
    const { messages = [], tools = [], signal } = req;
    const step = currentStep(messages);
    const system = step.system.slice(0, this.systemChars);

    // After a tool round: answer from the results only.
    if (step.results.length) {
      const facts = step.results.map((r) => `${r.name}: ${r.content}`).join("\n");
      const out = await this.nano.json(
        `${system}\n\nAnswer the visitor in two or three short sentences using only the tool results below. If they do not contain the answer, say you do not know.\nTOOL RESULTS:\n${facts}`,
        step.user,
        { type: "object", properties: { text: { type: "string", maxLength: 600 } }, required: ["text"], additionalProperties: false },
        { signal },
      );
      const text = String(out?.text || "").trim();
      if (!text) throw new ShimFailed("empty answer");
      // Never invent numbers: every number in the answer must be in the results.
      const known = new Set(numbersIn(facts));
      for (const n of numbersIn(text)) if (!known.has(n)) throw new ShimFailed(`number ${n} not in the tool results`);
      return this.reply(req, text);
    }

    // First step: choose a tool the site lets Nano call, or answer without facts.
    const offered = tools.map((t) => t.function).filter((f) => f && this.nanoTools.has(f.name));
    const names = offered.map((f) => f.name);
    const out = await this.nano.json(
      `${system}\n\nDecide the next step.\n`
        + (names.length ? `Tools you may call:\n${offered.map((f) => `- ${f.name}: ${f.description || ""}`).join("\n")}\n` : "")
        + `Choose "tool" to call one tool. Choose "answer" only to greet the visitor or ask them a short question back; never state facts or numbers in an answer. Choose "handoff" for anything else.`,
      step.user,
      {
        type: "object",
        properties: {
          kind: { type: "string", enum: names.length ? ["tool", "answer", "handoff"] : ["answer", "handoff"] },
          ...(names.length ? { tool: { type: "string", enum: names } } : {}),
          text: { type: "string", maxLength: 400 },
        },
        required: ["kind"],
        additionalProperties: false,
      },
      { signal },
    );
    if (out?.kind === "answer") {
      const text = String(out.text || "").trim();
      if (!text) throw new ShimFailed("empty answer");
      if (numbersIn(text).length) throw new ShimFailed("an answer with numbers needs a tool");
      return this.reply(req, text);
    }
    if (out?.kind !== "tool" || !names.includes(out.tool)) throw new ShimFailed("handed off");

    const fn = offered.find((f) => f.name === out.tool);
    const params = fn.parameters || { type: "object", properties: {} };
    let args = {};
    if (Object.keys(params.properties || {}).length) {
      args = await this.nano.json(
        `Fill in the arguments for the tool ${fn.name}: ${fn.description || ""}\nUse only what the visitor said. Leave out optional arguments they did not give.`,
        step.user,
        constraintFrom(params),
        { signal },
      );
    }
    const problems = validateArgs(params, args);
    if (problems.length) throw new ShimFailed(problems.join("; "));
    return {
      content: "",
      toolCalls: [{ id: `nano_${Math.random().toString(36).slice(2, 10)}`, type: "function", function: { name: fn.name, arguments: JSON.stringify(args) } }],
      finishReason: "tool_calls",
      usage: null,
      model: NANO_MODEL,
    };
  }
}

const PATCHED = Symbol.for("nano-provider.patched");

/**
 * Put the router in front of the runtime's LlmClient. Call it before boot(), with the
 * class imported from the site's own runtime/llm.js. If the airlock gate is installed
 * first, remote calls still go through it; Nano calls never leave the device.
 *
 * @param {any} LlmClient
 * @param {NanoRouter} router
 * @returns {() => void} Undo.
 */
export function installNano(LlmClient, router) {
  const chat = LlmClient.prototype.chat;
  if (chat[PATCHED]) return () => {};
  const routed = async function routedChat(req) {
    return router.chat(req, (r) => chat.call(this, r));
  };
  routed[PATCHED] = true;
  LlmClient.prototype.chat = routed;
  return () => { LlmClient.prototype.chat = chat; };
}
