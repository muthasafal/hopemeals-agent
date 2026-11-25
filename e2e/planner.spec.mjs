// A donor on the Giving Planner asks what ₹50,000 funds at HopeMeals. The planner's
// assistant asks HopeMeals' own network (after a consent card), HopeMeals answers from
// its own site through its bridge, and "donate" opens HopeMeals' own window.
import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { mockLLM, seedKey, say } from "./mock-llm.mjs";

const PLANNER = "http://localhost:8081";
const PAN = "ABCDE1234F";

function script(step) {
  const s = step.system;
  // The planner's front agent.
  if (s.startsWith("You are the assistant on the Pune Giving Planner")) {
    const partner = step.tools.find((t) => t.includes("hopemeals"));
    if (!step.results.length) {
      return /donate/i.test(step.user)
        ? { tool: partner, args: { request: "Please open your donation page for ₹50,000." } }
        : { tool: partner, args: { request: "What does ₹50,000 fund?" } };
    }
    return { text: `HopeMeals says: ${step.results[0].content}` };
  }
  // HopeMeals' front agent, running in the planner's page.
  if (s.startsWith("You are the assistant on the HopeMeals website")) {
    if (!step.results.length) return { tool: "donor_helper", args: { request: step.user } };
    return { text: step.results[0].content };
  }
  // HopeMeals' donor helper: uses the reads and the write HopeMeals' bridge shares.
  if (s.startsWith("You help the HopeMeals assistant with donors")) {
    if (!step.results.length) {
      return /donation page/i.test(step.user)
        ? { tool: "website_open_donation", args: { amount: 50000 } }
        : { tool: "website_impact_facts", args: { amount: 50000 } };
    }
    const receipt = JSON.parse(step.results[0].content);
    const r = receipt.result;
    if (r.amountFunds) return { text: `${r.amountFunds.amount} funds ${r.amountFunds.days} days of meals, ${r.amountFunds.meals.toLocaleString("en-IN")} meals: ${r.amountFunds.meaning}. ${r.amountFunds.paidTo}` };
    return { text: r.ok ? `Opened the ${r.opened}.` : `Not opened: ${r.reason}` };
  }
  return { text: "ok" };
}

test("the planner asks HopeMeals by URL, and donating opens HopeMeals' own page", async ({ context, page }) => {
  await seedKey(context);
  const llm = await mockLLM(context, script);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(PLANNER);
  await expect(page.locator("#assistant-status")).toHaveText("Assistant ready.");
  await page.screenshot({ path: "test-results/planner-top.png" });

  // The donor slips their PAN into the question: the gate holds it back.
  await say(page, `What does ₹50,000 fund at HopeMeals? My PAN is ${PAN}.`);
  const card = page.locator("#ns-msgs .ag-card").first();
  await expect(card).toContainText("PAN: not shared");
  await card.getByRole("button", { name: "Send without these details" }).click();

  // The runtime's consent card names HopeMeals before any contact.
  const consent = page.locator("#ns-msgs .ns-consent").last();
  await expect(consent).toContainText("HopeMeals");
  await expect(consent).toContainText("127.0.0.1:8788");
  await page.screenshot({ path: "test-results/planner-consent.png" });
  await consent.getByRole("button", { name: "Allow", exact: true }).click();

  const answer = page.locator("#ns-msgs .ns-msg.bot:not(.ns-turn-status)").last();
  await expect(answer).toContainText("500 days of meals");
  await expect(answer).toContainText("1,500 meals");
  await expect(answer).toContainText("16 months and 20 days");

  // Donate: HopeMeals' own window, then HopeMeals' own donation page.
  await say(page, "Great, I want to donate it.");
  await page.locator("#ns-msgs .ns-consent").last().getByRole("button", { name: "Allow", exact: true }).click();
  const open = page.locator("#ns-msgs button[data-d='open']").last();
  await expect(open).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await open.click();
  const popup = await popupPromise;
  await expect(popup.locator("h1")).toHaveText("Donate ₹50,000 to HopeMeals");
  await expect(popup.locator(".hm-from")).toContainText("localhost:8081");
  await popup.screenshot({ path: "test-results/planner-handoff-window.png" });
  const donatePromise = context.waitForEvent("page", (p) => p !== popup && p !== page);
  await popup.getByRole("button", { name: "Open the donation page" }).click();
  const donate = await donatePromise;
  await donate.waitForLoadState();
  expect(new URL(donate.url()).pathname + new URL(donate.url()).search).toBe("/donate?amount=50000");
  await expect(answer).toContainText("Opened the HopeMeals donation page");

  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/planner-llm-bodies.json", JSON.stringify(llm.bodies.map((b) => JSON.parse(b)), null, 1));
  // The PAN never reached the provider, including inside HopeMeals' agents' calls.
  for (const b of llm.bodies) expect(b.toUpperCase()).not.toContain(PAN);
  // HopeMeals' agents ran here, on the planner's router.
  expect(llm.bodies.some((b) => b.includes("You help the HopeMeals assistant with donors"))).toBe(true);
  expect(errors).toEqual([]);
});
