# HopeMeals agent

HopeMeals is a student-led non-profit in Pune that pays canteens for underprivileged students'
meals. This repository is its entry for the **Cognizant Open Agentic Web Challenge**: an agent that
helps students apply for meal support and helps donors give, while **keeping students' sensitive
details on their own device**. Other websites' agents can ask it questions too.

It follows the [Open Agentic Web MVP spec](https://github.com/cognizant-ai-labs/agentic-web) (profile 0.3):
a published agent network, a browser runtime, the visitor's own AI key, and partner sites that call
each other by URL after the visitor agrees.

## What's here

| Folder | What it is |
| --- | --- |
| [`packages/airlock-gate`](packages/airlock-gate) | An on-device privacy gate for every outgoing agent message. It withholds phone numbers, emails, Aadhaar and PAN, and abstracts income and reservation category, before anything reaches the visitor's LLM provider or a partner site. It adds a **"What this agent will learn about you"** card. |
| [`packages/nano-provider`](packages/nano-provider) | Lets the runtime use **Gemini Nano, built into Chrome**, for small private steps, with a structured-output tool-choice shim. Everything else goes to the visitor's own key. |
| [`sites/giving-planner`](sites/giving-planner) | **Pune Giving Planner**, a small partner agentic site. A donor plans a year of giving; its agent asks the HopeMeals network what an amount funds and how 80G works, and opens HopeMeals' own window to donate. |
| [`e2e`](e2e) | Playwright tests with a mocked LLM (see below). |
| [`tools`](tools) | A Pages-like local server, a build comparison, and the sync into the HopeMeals site. |
| [`docs`](docs) | The brief, the spec notes, the status, and the upstream contribution draft. |

The HopeMeals site integration (the `/assistant` route, `public/agents/*`) lives on the
`agentic-assistant` branch of the HopeMeals site repository. It is additive only, and the owner deploys it.

## How privacy works

1. The student types income, reservation category, name and contact details into a **private panel**
   beside the chat. Those values live only in this tab's memory.
2. Every outgoing payload passes through `airlock-gate` on the device. The model sees
   `[family income: provided, kept on this device]`, never the number. The same applies if the
   student types it into the chat.
3. When the student asks, the agent calls `website_prefill_application`. That action fills HopeMeals'
   own, unchanged form from the private panel, on the device. Nobody but the student presses Submit.
4. Partner calls show the runtime's consent card plus what the partner will learn. HopeMeals answers
   partners only from facts its own site publishes, through its action bridge.

Cost to HopeMeals is ₹0: the AI runs on the visitor's own key, or on Gemini Nano in their browser.

## Run it

Requires Node 22+.

```shell
npm install
npm test                       # unit and property tests for both packages
npm run build:planner          # build the Planner's network (needs ../_vendor/agentic-web)
npx playwright install chromium
npx playwright test            # E2E; build the HopeMeals branch first (see playwright.config.mjs)
```

Serve the two sites on different host names, so the runtime's key cookie never crosses between them:

```shell
node tools/serve-pages.mjs ../../HM/frontend/dist --port 8788      # HopeMeals: http://127.0.0.1:8788/assistant
node tools/serve-pages.mjs sites/giving-planner --port 8081        # Planner:   http://localhost:8081/
```

The assistant sends the visitor's messages, with private details replaced, to the AI provider they
pick in AI model settings. To try it with a real key, use one with a low spending limit. Afterwards,
delete the saved setup under AI model settings and close the tab.

## Tests

- **Unit and property tests** (`npm test`, 34 tests). The fast-check properties check that no
  generated email, phone, Aadhaar, PAN, income or vault value appears in any outbound payload, through
  the runtime hooks too, and that scrubbing is deterministic and idempotent.
- **E2E** (`npx playwright test`, LLM mocked, nothing leaves the machine):
  - `student.spec.mjs`: a student asks if they can apply. The learn card appears before anything is
    sent; no request body contains the income, name or category; the form is then filled with them on the device.
  - `planner.spec.mjs`: a donor on the Planner asks what ₹50,000 funds. HopeMeals' network runs in
    the Planner's page after the consent card, and reads HopeMeals' facts through its bridge (500 days,
    1,500 meals). "Donate" opens HopeMeals' window, then `/donate?amount=50000`. The donor's PAN never
    reaches the provider.
  - `regression.spec.mjs`: every existing HopeMeals page and the donate, contact and volunteer requests
    are identical on `main` and the branch (`/api/*` intercepted; no real payment, record or email).

## Network URLs

- HopeMeals: `https://hopemeals.org/agents/hopemeals_assistant` (locally `http://127.0.0.1:8788/agents/hopemeals_assistant`)
- Giving Planner: `<host>/pune_giving_planner`

Status and what's left: [`docs/STATUS.md`](docs/STATUS.md). Upstream draft: [`docs/UPSTREAM.md`](docs/UPSTREAM.md).

License: Apache-2.0. The `runtime/` folders are the agentic-web runtime, copied unchanged (Apache-2.0).
