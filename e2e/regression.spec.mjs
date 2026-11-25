// Browser regression for the HopeMeals branch: the same visitor steps on the `main`
// build (port 8790) and the agentic-assistant build (port 8788) must load cleanly and
// send byte-identical requests to /api/*. Nothing reaches a real backend: /api/* is
// intercepted and answered with a 503, so no payment, record or email ever happens.
import { test, expect } from "@playwright/test";

const BUILDS = { main: "http://127.0.0.1:8790", branch: "http://127.0.0.1:8788" };
const PAGES = ["/", "/about", "/impact", "/donate", "/signup", "/contact", "/get-involved", "/terms", "/privacy", "/refunds", "/unsubscribe"];

const FILL = { email: "donor@example.com", tel: "9876543210", date: "2005-04-12" };
const BY_ID = { panNumber: "ABCDE1234F", pincode: "411014", phone: "9876543210", pno: "9876543210", familyIncome: "₹2,00,000" };

async function capture(page) {
  const sent = [];
  await page.route("**/api/**", async (route) => {
    const r = route.request();
    sent.push({ method: r.method(), path: new URL(r.url()).pathname, body: r.postData() || "" });
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ step: "test", error: "Intercepted by the regression test." }) });
  });
  // Third-party scripts (Razorpay, analytics, Turnstile) are not part of this check.
  await page.route(/^https:\/\/(?!fonts\.)/, (route) => route.abort());
  // A stand-in for Razorpay's checkout script, so the page goes on to ask for an order.
  // It never opens a real checkout.
  await page.route("https://checkout.razorpay.com/**", (route) => route.fulfill({
    contentType: "text/javascript",
    body: "window.Razorpay = function (o) { this.open = function () { window.__rzpOpened = o; }; this.on = function () {}; };",
  }));
  return sent;
}

async function fillRequired(page, scope) {
  for (const el of await page.locator(`${scope} input[required]:visible, ${scope} textarea[required]:visible`).all()) {
    if (await el.inputValue()) continue;
    const id = await el.getAttribute("id");
    const type = await el.getAttribute("type");
    await el.fill(BY_ID[id] || FILL[type] || "Regression test");
  }
  for (const el of await page.locator(`${scope} select[required]:visible`).all()) {
    const options = await el.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    if (!(await el.inputValue())) await el.selectOption(options[0]);
  }
}

async function run(page, base) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const sent = await capture(page);
  const titles = {};
  for (const p of PAGES) {
    const res = await page.goto(base + p);
    expect(res.status(), p).toBe(200);
    titles[p] = await page.title();
  }

  // Donate: the amount from the URL is picked, and Donate asks /api/payments for an order.
  await page.goto(`${base}/donate?amount=6000`);
  await expect(page.locator("main")).toContainText("6,000");
  await fillRequired(page, "main form");
  await page.locator("main form button[type=submit]").click();
  await expect.poll(() => sent.filter((s) => s.path === "/api/payments").length).toBe(1);

  // Contact form.
  await page.goto(`${base}/contact`);
  await fillRequired(page, "main form");
  await page.locator("main form button[type=submit]").click();
  await expect.poll(() => sent.filter((s) => s.path === "/api/contact").length).toBe(1);

  // Volunteer form.
  await page.goto(`${base}/get-involved#volunteer-form`);
  await fillRequired(page, "#volunteer-form");
  await page.locator("#volunteer-form button[type=submit]").click();
  await expect.poll(() => sent.filter((s) => s.path === "/api/contact").length).toBe(2);

  // Application: step 1 refuses to move on while empty, then moves on once filled.
  await page.goto(`${base}/signup`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("#name")).toBeVisible();
  await fillRequired(page, "#application-form");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("#college")).toBeVisible();
  await fillRequired(page, "#application-form");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("#college")).toBeHidden();

  return { errors, sent, titles };
}

test("existing pages and flows behave the same on main and the branch", async ({ browser }) => {
  const results = {};
  for (const [name, base] of Object.entries(BUILDS)) {
    const context = await browser.newContext();
    const page = await context.newPage();
    results[name] = await run(page, base);
    await context.close();
  }
  expect(results.branch.titles).toEqual(results.main.titles);
  expect(results.branch.sent).toEqual(results.main.sent);
  expect(results.main.errors).toEqual([]);
  expect(results.branch.errors).toEqual([]);
  console.log(`Compared ${PAGES.length} pages and ${results.main.sent.length} API requests: identical.`);
  for (const s of results.main.sent) console.log(`  ${s.method} ${s.path} (${s.body.length} bytes)`);
});
