// A student asks if they can apply. Their family income is typed in the private panel
// and in the chat; it must never reach the AI provider, but it must reach HopeMeals' own
// form, filled on this device.
import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { mockLLM, seedKey, say } from "./mock-llm.mjs";

const HM = "http://127.0.0.1:8788";
const INCOME = "1,80,000";
const INCOME_DIGITS = "180000";

function script(step) {
  // HopeMeals front agent.
  if (step.system.startsWith("You are the assistant on the HopeMeals website")) {
    if (/fill/i.test(step.user)) {
      if (!step.results.length) return { tool: "website_prefill_application", args: { college: "B.J. Medical College", year: "Second Year", reason: "My family cannot pay the mess fees this year." } };
      const r = JSON.parse(step.results[0].content);
      return { text: `I filled in ${r.result.filled.join(", ")} and, from your private panel, ${r.result.filledFromPrivatePanel.join(", ")}. Please upload your ID card and income proof, tick the consent box and press Submit yourself.` };
    }
    if (!step.results.length) return { tool: "website_get_site_facts", args: { topic: "eligibility" } };
    const facts = JSON.parse(step.results[0].content).result;
    return { text: `${facts.eligibility[0].answer} The team verifies every application, so I cannot say yes or no myself.` };
  }
  return { text: "ok" };
}

test("income stays on the device, and still reaches HopeMeals' own form", async ({ context, page }) => {
  await seedKey(context);
  const llm = await mockLLM(context, script);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const dump = () => { mkdirSync("test-results", { recursive: true }); writeFileSync("test-results/student-llm-bodies.json", JSON.stringify(llm.bodies.map((b) => JSON.parse(b)), null, 1)); };
  test.info().annotations.push({ type: "bodies", description: "test-results/student-llm-bodies.json" });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${HM}/assistant`);
  await expect(page.locator("#assistant-status")).toHaveText("Assistant ready.");

  // Private details in the local-only panel.
  await page.fill("#private-familyIncome", INCOME);
  await page.selectOption("#private-reservation", "Other Backward Classes");
  await page.fill("#private-name", "Asha Kulkarni");

  // The student also mentions their income in the chat.
  await say(page, `My family income is ${INCOME} a year and I am OBC. Can I apply?`);

  // The extended consent card appears before anything is sent.
  const card = page.locator("#ns-msgs .ag-card").first();
  await expect(card).toContainText("What this agent will learn about you");
  await expect(card.locator(".ag-removed").first()).toHaveText(INCOME);
  await expect(card).toContainText("[family income: provided, kept on this device]");
  expect(llm.bodies.length, "nothing is sent while the card waits").toBe(0);
  await page.screenshot({ path: "test-results/student-learn-card.png", fullPage: false });
  await card.getByRole("button", { name: "Send without these details" }).click();

  await expect(page.locator("#ns-msgs .ns-msg.bot:not(.ns-turn-status)").last()).toContainText("verifies every application");
  await expect(page.locator("main")).toContainText("Sent to your AI provider (api.otari.ai) without your");

  // The student asks for the form to be filled.
  await say(page, "Please fill in the application for me. I study at B.J. Medical College, second year.");
  await expect(page.locator("#ns-msgs .ns-msg.bot:not(.ns-turn-status)").last()).toContainText("from your private panel");
  const form = page.frameLocator("#hm-workspace-frame");
  await expect(form.locator("#familyIncome")).toHaveValue(INCOME);
  await expect(form.locator("#reservation")).toHaveValue("Other Backward Classes");
  await expect(form.locator("#name")).toHaveValue("Asha Kulkarni");
  await expect(form.locator("#college")).toHaveValue("B.J. Medical College");
  await expect(form.locator("#year")).toHaveValue("Second Year");
  await page.locator("#hm-workspace").screenshot({ path: "test-results/student-prefilled-form.png" });

  dump();
  // What actually left the device.
  expect(llm.bodies.length).toBeGreaterThanOrEqual(4);
  for (const b of llm.bodies) {
    expect(b).not.toContain(INCOME);
    expect(b.replace(/[,\s]/g, "")).not.toContain(INCOME_DIGITS);
    expect(b).not.toContain("Asha Kulkarni");
    expect(b).not.toContain("Other Backward Classes");
  }
  expect(llm.bodies[0]).toContain("[family income: provided, kept on this device]");
  expect(errors).toEqual([]);
});
