// Boots the Giving Planner's assistant, with airlock-gate in front of every outbound path:
// model calls to the visitor's provider, requests to HopeMeals' network, and the
// arguments of HopeMeals' shared actions. The planner keeps working if this fails.
import { LlmClient } from "./runtime/llm.js";
import { Engine } from "./runtime/engine.js";
import { ActionRegistry } from "./runtime/actions.js";
import { AirlockGate, definePolicy, installOnRuntime, wrapConsent, cardReviewer, consentRenderer } from "./lib/airlock-gate/index.js";
import { NanoClient, NanoRouter, NanoDetector, installNano } from "./lib/nano-provider/index.js";

const GREETING = "Hello! Tell me what you want to give this year and I will spread it across the months. I can also ask HopeMeals what an amount funds and how its 80G receipts work, and open HopeMeals' own page if you want to donate.";

export async function start() {
  const status = document.querySelector("#assistant-status");
  const chat = () => document.querySelector("#ns-msgs");
  const gate = new AirlockGate({
    policy: definePolicy({ name: "giving-planner", categories: { FINANCIAL_AMOUNT: { action: "KEEP" } } }),
    onReview: cardReviewer(chat),
  });
  globalThis.plannerGate = gate;
  try {
    installOnRuntime(gate, { LlmClient, Engine, ActionRegistry });
    const nano = new NanoClient();
    if ((await nano.availability()) === "available") {
      gate.detectors.push(new NanoDetector(nano));
      installNano(LlmClient, new NanoRouter({ nano, mode: "assist", nanoTools: ["website_get_plan"] }));
    }
    const base = new URL("./", import.meta.url).href;
    const { boot } = await import("./runtime/index.js");
    const { engine } = await boot("#agent-app", { originUrl: base, sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", base).href });
    wrapConsent(gate, engine, { render: consentRenderer(chat) });
    const needsKey = !engine.mockLLM && !engine.publisherFundedLLM && (!engine.byokKey || engine.byokKey === "demo");
    status.textContent = needsKey ? "The assistant needs your own AI provider key. Add it in AI model settings below." : "Assistant ready.";
    if (!needsKey) {
      const first = document.querySelector("#ns-msgs .ns-msg.bot");
      if (first) first.textContent = GREETING;
    }
    return engine;
  } catch (error) {
    status.textContent = "The assistant could not load. The planner above still works.";
    console.error("Assistant startup failed", error);
    return null;
  }
}

if (typeof window !== "undefined") await start();
