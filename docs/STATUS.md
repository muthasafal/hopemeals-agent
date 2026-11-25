# Status (25 Nov 2026, second pass)

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
1. Owner decisions: whether HopeMeals has a published income limit (until then income shows as "provided, kept on this device"); the hosted Planner origin for `bridge/handoff-window.js` CALLERS and the Planner's partner URL; `index: false` on /assistant; pushing the HM branch (commits `4165712`, `1a733c8`, `e0891c4`, local only).
2. The runtime's settings panel also offers OpenAI, Anthropic and Groq, but the /assistant CSP allows only Otari, OpenRouter and Google (as the brief says). Picking one of those three fails with a CSP error. Either widen `connect-src` or accept it. This is the owner's choice.
3. Live check with a real key and real Gemini Nano (everything so far is mocked). On a Cloudflare preview deployment: check `_headers` behave as `tools/serve-pages.mjs` simulates.
4. Upstream: post the #32 comment in `docs/UPSTREAM.md`, then a PR if the maintainers want one. **Only after Safal approves.**
5. Not exercised: the application's final submit and uploads (`/api/uploads`, `/api/submitApplication`): the branch does not touch them, and the static and browser comparisons cover the page itself.
6. Remove the `../_vendor/hm-main` worktree when done (`git worktree remove`, from HM/frontend).
