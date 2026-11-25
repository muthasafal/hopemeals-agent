# airlock-gate

An on-device privacy gate for the [Open Agentic Web](https://github.com/cognizant-ai-labs/agentic-web)
browser runtime. Before anything leaves the visitor's device (a model call to their own LLM
provider, a request to a partner site's agent network, the arguments of a partner's shared
action), the gate finds sensitive details and replaces them according to a policy the site
declares. The visitor sees what will be shared on an extended consent card:
**"What this agent will learn about you"**, with their own words next to what is sent.

No server, no network calls, no dependencies. Plain ES modules that a static site can serve.

## What it hides by default

| Detail | Found by | Default |
| --- | --- | --- |
| Email | pattern | withheld |
| Indian phone number (+91, 0, spaces, hyphens) | pattern | withheld |
| Aadhaar number | pattern + Verhoeff check digit | withheld |
| PAN | pattern | withheld |
| Income ("family income ₹1,80,000", "parents earn 2 lakh") | amount + income words in the same sentence | "provided, kept on this device" |
| Reservation category (SC, ST, OBC, ...) | pattern | "declared" |
| Anything the visitor typed in a local-only form panel | exact value, any formatting | by field |
| Plain amounts ("what does ₹3,000 fund?") | pattern | kept |

Replacements never contain digits or `@`, so scrubbing is idempotent and a replacement
cannot rebuild the value. Text the site itself wrote (instructions, tool results) only gets
the exact-ID patterns and vault values, so a partner's name or a list of form options is
never mangled. Values the site publishes (its own phone and email) can be allow-listed.

## Use it with the agentic-web runtime

```js
import { LlmClient } from "./runtime/llm.js";        // the site's own runtime URLs, so
import { Engine } from "./runtime/engine.js";         // these are the same module instances
import { ActionRegistry } from "./runtime/actions.js";
import { AirlockGate, Vault, definePolicy, installOnRuntime, wrapConsent,
         cardReviewer, consentRenderer } from "./lib/airlock-gate/index.js";

const vault = new Vault();                            // filled by your local-only form panel
const chat = () => document.querySelector("#ns-msgs");
const gate = new AirlockGate({
  vault,
  policy: definePolicy({ name: "my-site" }),
  publicValues: ["contact@my-site.org"],
  onReview: cardReviewer(chat),                       // shows the card, waits for the visitor
});
installOnRuntime(gate, { LlmClient, Engine, ActionRegistry });   // before boot()
const { engine } = await boot("#agent-app", { originUrl });
wrapConsent(gate, engine, { render: consentRenderer(chat) });    // after boot()
```

Link `airlock-gate.css` for the card's default look (rounded, light, themable with `--ag-*`).

`installOnRuntime` wraps four places where the runtime sends data out
(`LlmClient.prototype.chat`, `Engine.prototype.resolveRemote`'s session `invoke`,
`engine.onConsent`, `ActionRegistry.prototype.execute` for actions on another origin). It
does not edit the runtime's files. These are exactly the hooks proposed upstream in
[issue #32](https://github.com/cognizant-ai-labs/agentic-web/issues/32); see
`docs/UPSTREAM.md` in this repository.

## Policy

```js
import { definePolicy, incomeRangeAbstraction } from "./index.js";

definePolicy({
  categories: {
    // Only if your site really publishes an income limit:
    INCOME: { abstraction: incomeRangeAbstraction(250000) },  // "within the eligible range"
    FINANCIAL_AMOUNT: { action: "KEEP" },
  },
  fields: {
    familyIncome: { action: "GENERALIZE", label: "family income", abstraction: "provided, kept on this device" },
  },
});
```

Actions: `KEEP`, `BLOCK` (`[<label> withheld]`), `GENERALIZE` (`[<label>: <abstraction>]`).
Unknown categories fail closed (`BLOCK`).

## Detectors

A detector is `{ id, detect(text) => Finding[] | Promise<Finding[]> }`, where a `Finding` is
`{ start, end, text, category, detector, confidence, field? }`, the same shape as the Airlock
scrub engine's `Finding`. Built in: `RuleDetector` and `VaultDetector`. Plug in more:

- **Airlock scrub engine** (`airlock/packages/scrub-engine`, in progress): wrap it with
  `fromScrubEngine(engine)` and pass it in `detectors`. Its categories (`IFSC`, `UPI`,
  `CARD`, `BANK_ACCOUNT`, ...) then follow the policy, and unknown ones are withheld.
- **Gemini Nano**: `NanoDetector` from `@hopemeals/nano-provider` finds names and other
  contextual details on the device.

If an extra detector throws, the built-in ones still run; if a built-in one throws, the
call stops (fail closed).

## Tests

```shell
node --test "packages/airlock-gate/test/*.test.mjs"
FC_RUNS=2000 node --test "packages/airlock-gate/test/properties.test.mjs"
```

Property tests (fast-check) check that no generated email, phone, Aadhaar, PAN, income or
vault value, in any formatting, appears in a scrubbed payload, through the runtime hooks
too; and that scrubbing is deterministic and idempotent.

## Limits

- Pattern detection is for Indian formats first. Names and addresses in free text need a
  contextual detector (Nano or the scrub engine).
- The gate protects what the runtime sends. It cannot stop a visitor from pasting details
  into a partner's own window, and it does not inspect what a partner's page does.
- The approval memory and the report log live in this tab's memory only.

License: Apache-2.0
