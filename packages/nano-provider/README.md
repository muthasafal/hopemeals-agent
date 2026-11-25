# nano-provider

Lets the [Open Agentic Web](https://github.com/cognizant-ai-labs/agentic-web) browser runtime
use **Gemini Nano, the model built into Chrome** ([Prompt API](https://developer.chrome.com/docs/ai/prompt-api),
the `LanguageModel` global), for small private steps. Nothing it handles leaves the device,
and it costs nobody anything. Everything else still goes to the visitor's own provider (BYOK).

Plain ES modules, no dependencies.

## What it does

| Piece | Use |
| --- | --- |
| `NanoClient` | `availability()`, `classifyIntent(text, intents)`, `extractFields(text, fields)`, `json(system, input, schema)`. Every call uses structured output (`responseConstraint`) and runs in a fresh cloned session. |
| `NanoRouter` + `installNano(LlmClient, router)` | Sits in front of the runtime's `LlmClient.chat`. Small single-step calls go to Nano, the rest to the visitor's provider. |
| The tool-choice shim | Nano cannot call tools. The shim asks it, with structured output, to pick `tool` / `answer` / `handoff` (tool names as an enum), then for that tool's arguments with the tool's own JSON Schema as the constraint, validates them, and returns an OpenAI-style `tool_calls` result: the shape the runtime expects. |
| `NanoDetector` | A contextual detector for `airlock-gate` (names, dates of birth, family situation), on the device. |

## Guard rails

- Nano may only call the tools the site lists in `nanoTools` (use read-only ones).
  `render_cruse`, writes and irreversible actions always go to the bigger model.
- A direct answer (no tool) may only greet or ask a question back, and may not contain a
  number. An answer after a tool round must use only numbers that appear in the tool
  results. Otherwise the step falls back. **No invented numbers.**
- Arguments that fail the tool's schema, a step longer than `maxStepChars`, more than one
  tool round, or Nano not being downloaded: the step falls back to the visitor's provider.
- `extractFields` drops values that are not in the visitor's text.

## Use it

```js
import { LlmClient } from "./runtime/llm.js";   // the site's own runtime URL
import { NanoClient, NanoRouter, installNano } from "./lib/nano-provider/index.js";

const nano = new NanoClient();
const router = new NanoRouter({
  nano,
  mode: "assist",                          // or "on-device-only"
  nanoTools: ["website_get_site_facts"],   // read-only tools Nano may call
  onRoute: ({ route, reason }) => console.debug(route, reason),
});
installNano(LlmClient, router);            // after airlock-gate's installOnRuntime, before boot()
```

Install the airlock gate first: remote calls then still pass through it, and Nano calls
never leave the device.

### On-device only (no key)

`mode: "on-device-only"` never calls a remote provider; anything Nano cannot do gets a
plain reply asking for a key. The runtime's chat refuses to send without a key, so a host
page that wants this mode passes a placeholder key to `boot()` that only means "on device"
(the router answers before `LlmClient` would use it). Treat that as experimental: the
settings panel may still check the placeholder against the provider's model list.

## Availability

The Prompt API ships in Chrome on desktop (Windows, macOS, Linux, ChromeOS) with enough
disk and memory; the model downloads on first use after a user gesture. Check
`await new NanoClient().availability()`: `"available"`, `"downloadable"`, `"downloading"`
or `"unavailable"`. Everywhere else the router simply sends every call to the visitor's
provider.

## Tests

```shell
node --test "packages/nano-provider/test/*.test.mjs"
```

Nano is mocked (`LanguageModel.availability/create`, `session.prompt/clone/destroy`); the
tests check the constraints sent, the fallbacks and the result shape.

License: Apache-2.0
