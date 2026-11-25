# Upstream contribution (draft, not sent)

Target: [cognizant-ai-labs/agentic-web#32](https://github.com/cognizant-ai-labs/agentic-web/issues/32),
"Request: official hooks for safety checks on partner networks and actions". It was opened by
another challenge entrant (Agent Customs). It asks for `beforePeerRuns`, `beforePeerRequest`,
`afterPeerAnswer` and `beforeAction`. Our use case adds two points that issue does not cover: the
**model call** itself (the visitor's own text going to their own provider) and the **consent card's
contents**. So the plan is a comment on #32 first, then a PR only if the maintainers want one.

**Nothing here is posted. Safal approves each step before anything goes to cognizant-ai-labs.**

---

## 1. Comment on #32 (draft)

> Thanks for opening this. +1 from the HopeMeals entry, with one more place a check is needed.
>
> We built [airlock-gate](https://github.com/muthasafal/hopemeals-agent/tree/main/packages/airlock-gate), an
> on-device privacy gate. On a student-aid site, a student's family income, reservation category,
> phone and ID numbers must not leave their device, not even to their own LLM provider. The gate replaces
> them before anything is sent ("family income: provided, kept on this device") and shows a
> "What this agent will learn about you" card with the visitor's words next to what is sent.
>
> To do that without editing the runtime, we wrap four internals, three of which overlap with your list:
>
> | What the gate does | What it wraps today |
> | --- | --- |
> | Scrub every model call (top network and partners) | `LlmClient.prototype.chat` |
> | Scrub the request text a partner network receives | `Engine.prototype.resolveRemote`, then `session.invoke` |
> | Show the scrubbed request and a "what it will learn" block on the consent card | `engine.onConsent` |
> | Scrub arguments sent to a partner's bridge action | `ActionRegistry.prototype.execute` |
>
> The first row is the one #32 does not have: today, every word of the conversation reaches the
> model provider, and a site has no supported way to filter it. Could the hook set include something like:
>
> ```js
> engine.addCheck({
>   beforeModelCall(request, { router, network, agent }) {},  // may return a changed request; throw to stop
>   beforePeerRequest(peer, request) {},                       // may return a changed request
>   describeConsent(info) {},                                  // extra lines for the consent card
>   beforeAction(plan, turn) {},                               // "allow" | "ask" | "refuse"
> });
> ```
>
> Returning a changed request (not only allow or refuse) is what lets a privacy check abstract a value
> instead of blocking the whole message. We have property tests (fast-check) checking that no
> generated email, phone, Aadhaar, PAN or income reaches the wire through these four paths, and we would
> be glad to port them to whatever shape you pick. Happy to send a PR with the hook points and tests.

## 2. Pull request (draft, only if the maintainers say yes)

**Title:** Add check hooks for model calls, partner requests, consent and actions (#32)

**Body:**

> Adds `engine.addCheck(check)` to the agentify-website runtime, with four optional methods:
>
> - `beforeModelCall(request, ctx)`: called in `runner.js` `runAgentManual` before `llm.chat`. It may
>   return a replacement request. Applies to partner networks too, since they run on the caller's router.
> - `beforePeerRequest(peer, request)`: called in `dispatchToolCall` (`kind: "remote"`) before consent,
>   so the card shows what is actually sent. It may return replacement text.
> - `describeConsent(info)`: returns extra lines that `ui.js` renders on the consent card.
> - `beforeAction(plan, turn)`: called in `ActionRegistry.execute` before confirmation; it returns
>   `"allow"`, `"ask"` or `"refuse"`.
>
> Checks run in registration order. A throw stops the step and is reported like any tool error (fail
> closed). No behaviour changes when no check is registered.
>
> Tests: `tests/checks.test.mjs` covers each hook point with the template's scripted model, including a
> partner network, plus a property test that a check which replaces a pattern leaves no match on the wire.
>
> Motivation and two working users: #32 (Agent Customs) and airlock-gate (HopeMeals). Both currently
> wrap private methods, which a refactor could silently switch off.
>
> 🤖 Generated with [Claude Code](https://claude.com/claude-code)

## 3. Listing (optional, later)

`docs/agentic_websites.md` takes pull requests. Once hopemeals.org/assistant is live, a one-line entry:
`HopeMeals | https://hopemeals.org/agents/hopemeals_assistant | Student meal support and donations, Pune`.
This is also the owner's call.
