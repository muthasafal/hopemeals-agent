# Product: Pune Giving Planner

## Purpose
A small, free page where a donor or a company's CSR team plans a year of giving: a yearly total and the months to spread it over. Its assistant asks partner charities' own published agent networks what an amount funds, and hands off to the charity's own site to donate. It exists to show the Open Agentic Web working between two real sites, with private details kept on the visitor's device.

## Users
- Individual donors in Pune planning monthly giving, often thinking about 80G.
- CSR teams spreading a budget across a year.
- Challenge judges and developers looking at a working partner-site example.

## What it does
- Spreads a total across 1 to 12 months and draws them as jars (the signature object).
- Asks HopeMeals' network, after a consent card: what an amount funds, impact facts, how 80G works.
- Opens HopeMeals' own donation window when asked. It never takes or holds money.

## Evidence on hand, and what must not be invented
- The planner has no facts of its own about any charity. Every figure comes from the partner's answer.
- No testimonials, no users, no "trusted by" logos, no impact numbers of its own. None exist.
- Only partners that publish an agent network and agree to be called are listed (today: HopeMeals).

## Constraints
- Static site (Cloudflare Pages). No server, database, cookies or analytics.
- AI runs on the visitor's own key (Otari, OpenRouter, Google AI Studio) or Gemini Nano in Chrome.
- airlock-gate removes PAN, Aadhaar, phone and email before anything leaves the device.

## Owner decisions pending
- The hosted address (placeholder `https://pune-giving-planner.pages.dev` in `site.config.json`).
- The partner's production URL (`https://hopemeals.org/agents/hopemeals_assistant`) once HopeMeals deploys.
