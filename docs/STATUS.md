# Status (25 Nov 2026, third pass)

## Done
- `docs/SPEC_NOTES.md`: file formats, the LLM client interface, the four outbound hook points, how partner calls work.
- `packages/airlock-gate`: rule and vault detectors (email, Indian phone, Aadhaar with Verhoeff, PAN, income in context, reservation category), site policy, the "What this agent will learn about you" card, and runtime hooks that don't edit the runtime. 20 tests, including fast-check properties (run at 1,500 cases).
- `packages/nano-provider`: a Gemini Nano client, a router with a structured-output tool-choice shim, and a NanoDetector. 14 tests, with Nano mocked.
- `sites/giving-planner`: the partner site. Its network builds cleanly, and `check_partner.mjs` passes against the local HopeMeals build (`OK: ... can be called from http://localhost:8081`).
- HM `frontend`, branch `agentic-assistant` (commit `4165712`, **local only, not pushed**): `/assistant` route, `public/agents/*` (manifest, network, links, bridge, runtime, lib), actions, `_headers` rules. `npm run build` passes and `/assistant` prerenders with no inline scripts.
- Tools: `tools/sync-hm.mjs`, `tools/serve-pages.mjs` (Pages-like local server that applies `_headers`), `tools/compare-builds.mjs`.

## Regression checklist (HM)
| Check | Result |
| --- | --- |
| Every existing page in `dist` (index, about, impact, donate, signup, contact, get-involved, terms, privacy, refunds, unsubscribe, 404) byte-identical to a `main` build, with hashes normalised | PASS (`node tools/compare-builds.mjs ../_vendor/hm-main/dist ../../HM/frontend/dist`) |
| sitemap.xml, llms.txt, robots.txt, _redirects unchanged | PASS |
| `_headers`: lines only added at the end | PASS |
| Only new files: `assistant.html` plus `agents/*` | PASS |
| No changes to functions/, backend, Firebase rules, Razorpay, emails, dashboard | PASS (diff touches only `_headers`, `AppShell.tsx` +2 lines, `routes.ts` +9 lines, new files) |
| Bridge gets no X-Frame-Options; CORS only on the public agent JSON; CSP on /assistant | PASS (checked with serve-pages) |
| Same visitor steps in Chromium on `main` and branch builds (11 pages, donate order request, contact, volunteer, application steps 1 to 3) | PASS: titles equal, no page errors, `/api/*` request bodies byte-identical (`e2e/regression.spec.mjs`) |
| `npm run test:functions` | NOT RUN (the functions are unchanged) |

Note: `npm run build` refreshes `src/content/siteContent.json` from live Firebase. I reverted it so it isn't committed.

## E2E (Playwright, LLM mocked)
- `student.spec.mjs` PASS: the learn card shows before anything is sent; no request body contains the income, name or reservation category; HopeMeals' own form is then filled with them on the device.
- `planner.spec.mjs` PASS: the consent card names HopeMeals; HopeMeals' network runs in the Planner page and reads facts through its bridge (₹50,000 = 500 days, 1,500 meals); "Donate" opens HopeMeals' window, then `/donate?amount=50000`; the PAN never reaches the provider.
- `regression.spec.mjs` PASS (above).

Fixed during the browser check: the prefill now waits for React to hydrate the prerendered form (before, college was lost); the donation fallback link no longer shows early; the Planner's jar labels and amount field have more padding; the Planner ground is now pale sky with deep ink (no cream).

## Left to do
1. Owner decisions: whether HopeMeals has a published income limit (until then income shows as "provided, kept on this device"); the hosted Planner origin for `bridge/handoff-window.js` CALLERS and the Planner's partner URL; `index: false` on /assistant; pushing the HM branch (commits `4165712`, `1a733c8`, `e0891c4`, `fad0859`, local only).
2. Done: the runtime's settings panel no longer shows OpenAI, Anthropic or Groq on either site (hidden with CSS, since the CSP blocks them). To offer them, add their API hosts to `connect-src` and remove the CSS rule.
3. Live check with a real key and real Gemini Nano (everything so far is mocked). On a Cloudflare preview deployment: check `_headers` behave as `tools/serve-pages.mjs` simulates.
4. Upstream: post the #32 comment in `docs/UPSTREAM.md`, then a PR if the maintainers want one. **Only after Safal approves.**
5. Not exercised: the application's final submit and uploads (`/api/uploads`, `/api/submitApplication`): the branch does not touch them, and the static and browser comparisons cover the page itself.
6. Remove the `../_vendor/hm-main` worktree when done (`git worktree remove`, from HM/frontend).

## safaldev pre-ship checklist (third pass)

| Group | Giving Planner | HopeMeals /assistant (branch) |
| --- | --- | --- |
| Honesty and content | Pass. No figures of its own: every charity fact comes from the partner. No placeholders, no emoji icons, no em dashes in our files, no purple. | Pass. Facts come from the site's own data at build time; no invented numbers; no em dashes in added files. |
| Legal | Fixed: added `/terms` (Indian law, Pune courts, no tax advice) and `/privacy` (DPDP Act 2023, a full retention table: plan, messages, key, partner requests, donations, logs). | Fixed: added "The HopeMeals assistant" to `/privacy` (date updated to 25 Nov 2026), linked from `/assistant`. Owner please review the wording. |
| Security | Fixed: `_headers` with an enforcing CSP, HSTS, nosniff, `X-Frame-Options: DENY`, COOP, Permissions-Policy; CORS only on public agent files; bridge frameable. No secrets in git history; `npm audit` 0 vulnerabilities. No server, so rate limits, auth and database rules are not applicable. | Pass: CSP on /assistant (no inline scripts), CORS only on agent files, bridge headers detached; backend and functions untouched. |
| SEO and polish | Fixed: canonical tags, OG/Twitter with a 1200x630 image rendered from code, favicon set (SVG, ICO, 32, 180, 192, 512, maskable, webmanifest), JSON-LD (WebSite, WebApplication, FAQPage matching a visible FAQ, BreadcrumbList on inner pages), robots.txt, sitemap.xml, llms.txt, a playable 404 (fill "month 13") with a true 404 status, breadcrumbs, one h1 per page, zero console errors under the CSP. LocalBusiness: not applicable (no premises). | Pass: route in `routes.ts` (title, description, `index: false` until the owner decides), PageHero breadcrumbs, prerendered, zero console errors in tests. |
| Design taste | Fixed: pale sky ground with deep ink (no cream), a hero jar with falling coins and sloshing fill (the signature "year of jars"), FAQ toggles, sentence-case runtime labels, roomier padding; PRODUCT.md and DESIGN.md written. One design-hook finding suppressed narrowly: `dark-glow` on `index.html` flagged the ink-tinted soft elevation shadow, which the house rules call for. | Pass: HM DESIGN.md tokens, one solid orange action in the dialog. |

Needs the owner: the Planner's hosted address (`site.config.json`, then `scripts/build-site.mjs` and `npm run build:planner`), HopeMeals' production partner URL, approval of the privacy wording, and the HM push and deploy. The vendored runtime (`runtime/`) is copied unchanged by the spec's rule, so its own comments and UI strings were not edited.
