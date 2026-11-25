// Attach the gate to the agentic-web browser runtime without editing its files.
//
// The runtime has four ways for text to leave the device (docs/SPEC_NOTES.md, section 3):
//   1. LlmClient.prototype.chat           every model call, top network and partners
//   2. Engine.prototype.resolveRemote     the session whose invoke() carries a partner request
//   3. engine.onConsent                   the card shown before contacting a partner
//   4. ActionRegistry.prototype.execute   arguments sent to a partner's bridge action
// Issue #32 asks for official hooks for exactly these; until then we wrap them here.

const PATCHED = Symbol.for("airlock-gate.patched");

/** The destination name for a site-paid router on the page's own origin (a relative URL). */
export const SITE_AI = "this site's AI service";

function hostOf(url) {
  try { return new URL(url).host; } catch { return String(url || "?"); }
}

/**
 * Wrap the runtime's classes so every outgoing payload goes through the gate. Call it
 * before boot(), with the classes imported from the site's own runtime URLs (so they are
 * the same module instances the runtime uses). Safe to call more than once.
 *
 * @param {import("./gate.js").AirlockGate} gate
 * @param {{LlmClient: any, Engine?: any, ActionRegistry?: any, pageOrigin?: string}} runtime
 * @returns {() => void} Undo the wrapping (for tests).
 */
export function installOnRuntime(gate, { LlmClient, Engine, ActionRegistry, pageOrigin } = {}) {
  if (!LlmClient?.prototype?.chat) throw new Error("installOnRuntime needs the runtime's LlmClient class.");
  const undo = [];
  const origin = pageOrigin || (typeof location !== "undefined" ? location.origin : "");

  // 1. Model calls.
  const chat = LlmClient.prototype.chat;
  if (!chat[PATCHED]) {
    const gatedChat = async function gatedChat(request) {
      const destination = this.baseUrl === "browser://mock" ? "mock router (this browser)"
        : String(this.baseUrl).startsWith("/") ? SITE_AI : hostOf(this.baseUrl);
      const safe = await gate.gateModelCall(request, destination);
      return chat.call(this, safe);
    };
    gatedChat[PATCHED] = true;
    LlmClient.prototype.chat = gatedChat;
    undo.push(() => { LlmClient.prototype.chat = chat; });
  }

  // 2. Partner requests. The consent card (3) already showed the scrubbed text, so the
  //    request is only recorded here, unless no card ran (same-origin peers skip it).
  if (Engine?.prototype?.resolveRemote && !Engine.prototype.resolveRemote[PATCHED]) {
    const resolveRemote = Engine.prototype.resolveRemote;
    const gatedResolve = async function gatedResolve(...args) {
      const session = await resolveRemote.apply(this, args);
      if (session && typeof session.invoke === "function" && !session.invoke[PATCHED]) {
        const invoke = session.invoke;
        const destination = hostOf(session.base);
        const gatedInvoke = async function gatedInvoke(request, opts) {
          const text = request?.user_message?.text ?? "";
          const reviewed = gate.consentShown?.has?.(destination) ?? false;
          const safe = await gate.gatePartnerRequest(text, destination, { reviewed });
          return invoke.call(this, { ...request, user_message: { ...request.user_message, text: safe } }, opts);
        };
        gatedInvoke[PATCHED] = true;
        session.invoke = gatedInvoke;
      }
      return session;
    };
    gatedResolve[PATCHED] = true;
    Engine.prototype.resolveRemote = gatedResolve;
    undo.push(() => { Engine.prototype.resolveRemote = resolveRemote; });
  }

  // 4. Partner bridge actions.
  if (ActionRegistry?.prototype?.execute && !ActionRegistry.prototype.execute[PATCHED]) {
    const execute = ActionRegistry.prototype.execute;
    const gatedExecute = async function gatedExecute(plan, confirm, invocationId) {
      const safePlan = [];
      for (const step of plan || []) {
        const actionOrigin = step?.entry?.base ? new URL(step.entry.base).origin : origin;
        if (actionOrigin !== origin) {
          safePlan.push({ ...step, args: await gate.gateRemoteAction(step.args || {}, hostOf(actionOrigin)) });
        } else {
          safePlan.push(step);
        }
      }
      return execute.call(this, safePlan, confirm, invocationId);
    };
    gatedExecute[PATCHED] = true;
    ActionRegistry.prototype.execute = gatedExecute;
    undo.push(() => { ActionRegistry.prototype.execute = execute; });
  }

  return () => { for (const fn of undo.reverse()) fn(); };
}

/**
 * Wrap an engine's consent hook (3) so the partner card shows the scrubbed request and,
 * below it, what the partner will learn. Use it after boot(), the way the agentify
 * skill's site.js wraps onConsent.
 *
 * @param {import("./gate.js").AirlockGate} gate
 * @param {any} engine The booted engine.
 * @param {{render?: (report: import("./gate.js").Report, info: any) => void}} [options]
 *   render: add the "What this agent will learn about you" block to the card the runtime
 *   just drew. card.js has a default.
 */
export function wrapConsent(gate, engine, { render } = {}) {
  const original = engine.onConsent;
  gate.consentShown ||= new Set();
  engine.onConsent = async (info) => {
    if (info?.kind !== "network" || typeof info.requestText !== "string") {
      return original ? original(info) : "allow";
    }
    const r = await gate.scrubText(info.requestText);
    const report = { channel: "partner", destination: info.peerOrigin, items: r.items, before: info.requestText, after: r.text, segments: r.segments, changed: r.items.length > 0 };
    const answer = original ? original({ ...info, requestText: r.text }) : Promise.resolve("allow");
    try { render?.(report, info); } catch (err) { console.warn("airlock-gate: could not draw the card", err); }
    const decision = await answer;
    if (decision !== "decline") gate.consentShown.add(info.peerOrigin);
    return decision;
  };
  return () => { engine.onConsent = original; };
}
