# Status (25 Nov 2026)

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
| Donation, signup and contact flows clicked through in a browser on the branch build | **NOT DONE** (left for the next session) |
| `npm run test:functions` | NOT RUN (the functions are unchanged) |

Note: `npm run build` refreshes `src/content/siteContent.json` from live Firebase. I reverted it so it isn't committed.

## Left to do
1. Playwright E2E with a mocked LLM: route `https://api.otari.ai/api/v1/**` to scripted SSE replies, and seed a BYOK profile in localStorage `nsweb-byok-profiles-v1` (`{version:1, selectedId, profiles:[{id,name,key,model,router}]}`). Flows: (a) a student's eligibility check where the request body never contains the income; (b) a donor on the Planner asking HopeMeals what ₹50,000 funds, then "Donate" opening the HopeMeals window. Serve with `node tools/serve-pages.mjs ../../HM/frontend/dist --port 8788` and `node tools/serve-pages.mjs sites/giving-planner --port 8081`, then open the Planner as `http://localhost:8081`. Chromium for Playwright 1.65 still needs installing.
2. A browser check of `/assistant` itself: boot, the private panel → vault, the iframe prefill on `/signup`, the start_donation dialog, and the styling against DESIGN.md. None of this has been run in a browser yet.
3. The browser regression row above.
4. Write the README and `docs/UPSTREAM.md` (issue #32 hooks proposal and PR text). **Ask the user before opening anything on cognizant-ai-labs.**
5. Owner decisions: whether HopeMeals has a published income limit (until then income shows as "provided, kept on this device"), the hosted Planner origin for `bridge/handoff-window.js` CALLERS, `index: false` on /assistant, and pushing the HM branch.
6. Clean-up: the `../_vendor/hm-main` git worktree (`git worktree remove`) once regression testing is done.
