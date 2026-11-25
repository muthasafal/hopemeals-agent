# HopeMeals Agent: Product and Technical Brief

This brief is for the **Cognizant Open Agentic Web Challenge**: deadline **Jan 11, 2027, 16:00 UTC**; build Dec 23 to Jan 10.

---

## 1. One line
**HopeMeals gets its own AI agent that helps students apply for meal support and helps donors give, while keeping students' sensitive details on their own device. Other websites' agents can ask it questions too.**

## 2. What HopeMeals is (facts only; read `HM/CLAUDE.md` in the HopeMeals repo before touching anything)
- A student-led non-profit in Pune, working with A.S. Foundation, which issues 80G receipts. It pays canteens for underprivileged students' meals.
- **Two real jobs:** collecting donations (Razorpay) and collecting student applications.
- **Site:** a prerendered React SPA on Cloudflare Pages, with Pages Functions:
  - `POST /api/completeDonation`
  - `POST /api/submitApplication`
  - contact, volunteer and unsubscribe.
  - Data lives in Firebase RTDB (server writes only) and R2. A separate staff dashboard exists.
- **The application form is a 4-step signup** collecting: name, date of birth, email, phone, college, year, **family income, reservation category**, reason, **ID image, income proof**, and consent.
- **Voice rules:** protect student dignity (no pity or guilt language); Indian conventions (₹, 80G, canteen, mess, tiffin); **truth only: no invented numbers, ever.**

## 3. Ground rules (protect live operations; non-negotiable)
1. **Additive only.** No changes to:
   - the backend, Pages Functions or Firebase rules
   - Razorpay, receipts or emails
   - the dashboard or existing page logic.
2. **The agent never submits and never pays.** It may only:
   - read public site content
   - **pre-fill** existing forms on the page
   - open the existing donation checkout with an amount set.
   **A human always presses the final submit or pay button.**
3. It lives first on a new route, **`/assistant`**, so the main pages are untouched. Embedding it elsewhere later is the owner's decision.
4. **Answers come only from confirmed content:** `siteContent`, published pages, and the FAQ the owner approves. If unsure, it says so and links to the contact page.
5. **The owner deploys.** Work happens on a branch; check it on a Cloudflare Pages preview deployment. Never deploy production, set secrets, or touch the dashboard.
6. **Cost to HopeMeals is ₹0.** The AI runs on the visitor's device (Gemini Nano) or on the visitor's own key (bring-your-own-key, per the spec).

## 4. The Open Agentic Web spec (what we must conform to)
Source: `github.com/cognizant-ai-labs/agentic-web`, `docs/worldwide_agentic_web_mvp_spec.md` and `skills/agentify-website/`. **Re-read them at build time, because they change often.**

**Required public files (CORS on these only):**
- **`agent-manifest.json`:**
  - `networks[]`: `name`, `front_man`, `hocon: "./<network>.network.json"`, `description`, `sample_queries`
  - `llm_router` (`base_url`, `byok_router`, `mock`, `publisher_funded: false`)
  - `peer_policy` (`mode: closed` + `allowed_peers` origins)
  - `actions` (`version: 1`, `module`, `bridge: "./bridge/action-bridge.html"`, `agentTools`)
  - `linking` (`protocol`, `exports[].aliases`)
  - `agent_mcp` (`available: false` on static hosting)
  - `brand`, `theme.primary`, `deployment.mode: "static"`
- **`<network>.network.json`:**
  - generated from HOCON with `scripts/build_network.mjs`; **do not hand-edit**
  - top level `metadata` and `tools`, where agents are entries in `tools`, each with `name`, `function` (`description`, JSON Schema `parameters`), `instructions` and `tools`
- **Also:** `links.json`, `agent-mcp.json`, `bridge/action-bridge.html` (must not send `X-Frame-Options` or `frame-ancestors`), and the runtime files (`runtime/*`, including `sandbox-worker.js`, which has its own CSP).

**Runtime behaviour to rely on:**
- Site actions are exposed as `website_<name>` tools, with effects `read | write | irreversible`; irreversible ones go through a confirmation dialog.
- CRUSE forms and choices render in chat.
- Partner calls: a consent card (label, host, the first 140 characters of the request; Allow / Always allow / Decline); limits of 4 partner calls and 24 agent calls per message.
- A partner's shared reads run in a hidden frame; shared writes open the partner's own window for 3 minutes.
- **The LLM must support tool calls.** The reference runtime speaks OpenAI-compatible `/chat/completions` (Otari, OpenRouter, a custom endpoint).

**Known gap we fill:**
- **Issue #32** (official hooks for safety checks on partner networks and actions).
- Privacy of visitor data sent to the visitor's own cloud LLM and to partners is unaddressed.

## 5. What we build

### 5.1 Open-source components (this repo; the community contribution counts toward "Potential Impact")
1. **`airlock-gate`:**
   - wraps the runtime's outbound paths (to the visitor's LLM router, and to partner networks)
   - runs Airlock's scrub engine (from the `airlock` repo's `packages/scrub-engine`) **on-device** before anything leaves
   - abstracts sensitive fields according to a site-declared policy (for example, income → "within the eligible range"; reservation category → "declared"; phone, email and ID numbers → withheld)
   - extends the consent card with **"What this agent will learn about you"**: a diff of the original against the outbound content
   - ships with docs and an example; offered upstream as a PR addressing issue #32.
2. **`nano-provider`:**
   - an LLM-client adapter that lets the runtime use **Chrome's built-in Gemini Nano** for small private steps: intent classification, field extraction, and the privacy gate's detection
   - since Nano can't call tools, it implements a **structured-output tool-choice shim** for simple single-step intents
   - everything else routes to the visitor's BYOK model.
3. **Pune Giving Planner** (a partner agentic site, built by us, hosted separately):
   - a donor or CSR team plans giving; its agent calls the HopeMeals agent network by URL
   - **shared reads:** impact facts, what an amount funds, how 80G works
   - **shared writes:** "start a donation" opens HopeMeals' own window.

### 5.2 HopeMeals integration (a branch of the HopeMeals repo, deployed by the owner)
**Agent network `hopemeals_assistant`:**
- **Front man:** routes between the specialists; keeps the tone warm and dignified.
- **`student_helper`:**
  - explains eligibility from site content
  - walks through the 4 steps and pre-fills the form via `website_prefill_application`
  - sensitive answers are captured in a **local-only form panel** and passed through `airlock-gate`, so the cloud LLM only sees abstractions
  - ID and income-proof uploads stay manual.
- **`donor_helper`:**
  - explains what amounts fund (only confirmed figures) and how 80G receipts work
  - sets the amount and opens the existing checkout via `website_start_donation`, which is `irreversible` and confirmed through the runtime dialog. **The Razorpay window does the payment.**
- **`volunteer_helper`:** pre-fills the get-involved and contact forms.

**Site actions (`agents/actions.js`):**
| Action | Effect | What it does |
|---|---|---|
| `get_site_facts` | read | Returns confirmed facts from `siteContent` / page data |
| `prefill_application` | write | Sets the signup form's state fields (never submits) |
| `start_donation` | irreversible | Sets the slider amount and opens the existing checkout (human confirms in Razorpay) |
| `prefill_volunteer`, `prefill_contact` | write | Sets the form fields (never submits) |

**Linking exports** (what partner sites can call):
- read: `impact_facts`, `eligibility`, `how_to_donate_80g`
- write: `open_donation`, `open_application` (HopeMeals' own window).

**Files added to the HopeMeals site (additive):**
- `public/agents/`: the manifest, network JSON, `links.json`, `agent-mcp.json`, the bridge, the runtime
- `src/pages/Assistant.tsx`: the `/assistant` route, styled to the HopeMeals DESIGN.md
- the actions module
- `_headers` rules: CORS only on the public agent files; a CSP on `/assistant` that allows only the listed LLM providers (Otari, OpenRouter, Google) plus `'wasm-unsafe-eval'` if needed.

**Design:** follow `HM/DESIGN.md` exactly (rounded, joyful, light mode, no em dashes, no AI tells). The chat should feel like part of HopeMeals, not a generic widget.

## 6. Demo and submission (Jan 11)
- **Public URL:** `https://<hopemeals domain>/assistant`, with the manifest and runtime reachable.
- **Video under 2 minutes, with the owner on camera or voice, explaining (no AI voice):**
  1. a student asks if they're eligible; the agent helps; income stays on-device (show the "what it learns" card)
  2. a donor on the Giving Planner asks what ₹50,000 funds; the planner's agent asks the HopeMeals agent; the answer comes back; "Donate" opens the HopeMeals window
  3. the open-source components.
- **Also:** text description, screenshots, an Otari note if used, and links to the `airlock-gate` and `nano-provider` repos and the upstream PR.

## 7. Testing
- Property tests on `airlock-gate`: no sensitive field in any outbound payload; abstractions are deterministic.
- E2E with Playwright against a local build of the HopeMeals site (with mocked LLM responses).
- Verify on a Cloudflare preview that every existing page, the donation flow and the application flow behave **exactly** as before (a regression checklist).
