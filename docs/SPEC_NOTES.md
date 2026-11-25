# Spec notes (Open Agentic Web, MVP Profile 0.3)

Read from `cognizant-ai-labs/agentic-web` at commit `0a2298b` (24 Nov 2026), cloned to
`../_vendor/agentic-web`. The spec changes often: re-check before submission.

Sources: `docs/worldwide_agentic_web_mvp_spec.md`, `skills/agentify-website/SKILL.md`,
`skills/agentify-website/references/*.md`, `skills/agentify-website/runtime/*`
(nsdeploy runtime at nsdeploy `53a787c`, patched by agentic-web), and the guesthouse,
harbor tours and Marrow Point pizza examples.

## 1. Files a site publishes

All live in one folder, the **site base**. The network URL is `<site base>/<network name>`
(spec 3.2). For HopeMeals: `https://hopemeals.org/agents/hopemeals_assistant`.

| File | Format | Who writes it | CORS |
| --- | --- | --- | --- |
| `agent-manifest.json` | JSON, see 1.1 | us, from `templates/agent-manifest.json` | `Access-Control-Allow-Origin: *` |
| `<network>.hocon` | HOCON subset (comments, bare or quoted keys, `"""` strings, no includes, no substitutions) | us, from `templates/network.hocon` | not published |
| `<network>.network.json` | resolved JSON, see 1.2 | `build_network.mjs`, never by hand | `*` |
| `links.json` | `{"version":1,"networks":{"<network>":{ "<symbol>": "<peer network URL>" }}}` | us | `*` |
| `agent-mcp.json` | copy of manifest `agent_mcp` | build | `*` |
| `.well-known/nsdeploy.json`, `.well-known/nsdeploy-agent.json` | copies of `linking` / `agent_mcp` | build | `*` (only useful at a domain root) |
| `bridge/action-bridge.html`, `bridge/agent-manifest.json` | fixed page + bridge manifest naming `bridge-actions.js` | build | none, but **no `X-Frame-Options` and no `frame-ancestors`** |
| `bridge/bridge-actions.js` | ES module exporting `registerActions(actions)`; actions with `availability: "bridge"` and `callerOrigins` | us | none |
| `runtime/*` | the patched nsdeploy runtime, copied unchanged | copy | none; `runtime/sandbox-worker.js` gets `Content-Security-Policy: default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'` |
| actions module (`actions.module`) | ES module exporting `registerActions(actions)` | us | none (same origin only) |

### 1.1 `agent-manifest.json`

```json
{
  "brand": "<Site> Assistant",
  "networks": [{ "name": "<network>", "front_man": "<front agent>", "hocon": "./<network>.network.json",
                 "description": "<one sentence the visitor reads>", "tags": ["agentified-website"],
                 "sample_queries": ["... must equal metadata.sample_queries in the HOCON ..."] }],
  "llm_router": { "base_url": "https://api.otari.ai/api/v1", "mock": false,
                  "byok_router": "https://api.otari.ai/api/v1", "publisher_funded": false },
  "allowed_peers": ["<partner origins, with port>"],
  "peer_policy": { "mode": "closed", "deny_origins": [], "note": "..." },
  "agent_mcp": { "protocol": "nsdeploy-agent-mcp/v1", "network": "...", "front_man": "...",
                 "available": false, "reason": "static bundle" },
  "theme": { "primary": "#2D7341" },
  "linking": { "protocol": "nsdeploy-link/v1",
               "exports": [{ "network": "...", "front_man": "...", "aliases": ["..."], "url": "<network>" }],
               "imports": [], "link_updates": { "mode": "browser-local" } },
  "deployment": { "mode": "static", "self_contained_runtime": true, "browser_mock": false,
                  "direct_byok": true, "direct_mcp_requires_cors": true, "public_mcp_facade": false },
  "actions": { "version": 1, "module": "./site-actions.js", "bridge": "./bridge/action-bridge.html",
               "agentTools": ["<action names, become website_<name> tools>"] }
}
```

- Protocol name is `nsdeploy` (`runtime/README.md`).
- `publisher_funded: true` means `base_url` is a site-paid proxy called with no key. HopeMeals
  must stay `false` (cost to HopeMeals is ₹0).
- `actions.bridge` must be exactly `./bridge/action-bridge.html` or the build fails.
- `agentTools` also lists names that only the bridge shares (partners get only those).

### 1.2 Network JSON (Neuro SAN data model)

Top level: `metadata` (`description`, `sample_queries`), `llm_config.model_name` (a hint;
the caller's model wins), `max_steps` (default 12), `cruse: {version: 1}` (adds the
`render_cruse` tool), `link_labels` (`{"<partner URL>": "<label on the consent card>"}`),
`commondefs.replacement_strings` (expanded once in the browser; no nested placeholders),
and `tools`: the agents. Each agent:

```json
{ "name": "student_helper",
  "function": { "description": "...", "parameters": { "type": "object",
     "properties": { "request": { "type": "string", "description": "..." } }, "required": ["request"] } },
  "instructions": "...",
  "tools": ["other_agent", "https://peer.example/agents/peer_network", {"url": "https://mcp", "tools": ["x"]}] }
```

- The first entry is the front man (manifest `front_man` must match).
- Use a `request` parameter: the runner passes `request` / `input` / `input_string` as
  plain text and anything else as raw JSON (`runner.js`, `argsToText`).
- Only the top front agent sees chat history; specialists see only `request`.
- Every agent is offered **every** `website_*` tool (`runner.js`, `buildToolTable`); scope
  them by instructions.
- Keep expanded instructions under ~5,000 chars; one model call under 16,000 chars of
  system prompt plus tool definitions.
- Build: `node <skill>/scripts/build_network.mjs <site>/<net>.hocon --manifest <site>/agent-manifest.json [--check]`.
  It fails on `<...>`/`TODO` leftovers, `demo_mode`, AAOSA, unlisted `website_*` names,
  sample query mismatch, a bad bridge, partner URLs it would refuse, partners missing
  from `allowed_peers` or `link_labels`.

### 1.3 Site actions

`registerActions(actions)` calls `actions.register({name, description, effect, inputSchema, execute, timeoutMs?, availability?, callerOrigins?, confirmsInWindow?})`.

- `effect`: `read` and `write` run **with no dialog**; `irreversible` goes through
  `engine.onActionConfirm(items)` first (spec 3.1 wants writes shown too: known gap).
- `inputSchema` keywords allowed: `type, properties, required, additionalProperties:false,
  items, enum, minimum, maximum, minLength, maxLength, minItems, maxItems, format (date|email),
  title, description, default, x-*`. No `pattern`. Extra keys are rejected.
- `execute(args, {requestId, signal})` returns JSON (≤64 KB). Refuse with
  `{ok:false, reason, field}`; a throw becomes receipt status `unknown` (never retried).
- Receipts the model sees: `{status: "succeeded", result}`, `{status: "cancelled"}`,
  `{status: "unknown", error}`; schema failure is a plain `Error from tool '...'` string.

## 2. The LLM client interface

`runtime/llm.js` exports `class LlmClient`:

```js
new LlmClient({ baseUrl, apiKey, trace, mock, publisherFunded })
await client.chat({ model, messages, tools, origin, parentSpan, onContentDelta, signal })
// messages: [{role: "system"|"user"|"assistant"|"tool", content, tool_calls?, tool_call_id?, name?}]
// tools:    [{type: "function", function: {name, description, parameters}}]
// returns:  { content: string, toolCalls: [{id, type: "function", function: {name, arguments: string}}],
//             finishReason, usage, model }
```

- Wire format: OpenAI-compatible `POST <baseUrl>/chat/completions`, `stream: true`,
  `tool_choice: "auto"` when tools exist, SSE parsed in `_readSse`.
- Key goes only in `Authorization: Bearer` to the selected router; never in URLs,
  prompts, traces, peer requests.
- Without a real key (and not mock or publisher-funded) `chat` throws a setup error,
  and the UI (`ui.js`, `validateConfiguredModel`) refuses to send.
- Instances are made in `Engine._compile` (one for the top network, one per peer, all
  on the **caller's** router). Agents call `ctx.llm.chat(...)` in `runner.js`
  `runAgentManual`. So `LlmClient.prototype.chat` is the single egress for model text.

**Where Nano plugs in:** wrap `LlmClient.prototype.chat` (imported from the site's own
`runtime/llm.js` URL so it is the same module instance) before `boot()`. Return the same
result shape. `packages/nano-provider` does this with a router that sends small,
single-step calls to Gemini Nano and everything else to the original method.

## 3. Outbound hook points (no runtime edits)

| Path out of the device | Code | Hook we use |
| --- | --- | --- |
| Model calls to the visitor's router (top and peer networks) | `LlmClient.prototype.chat` | wrap prototype: scrub `messages` (content and `tool_calls[].function.arguments`) |
| Request text to a partner network | `runner.js dispatchToolCall` (`kind: "remote"`) → `engine.resolveRemote()` → `session.invoke({user_message:{text}})` | wrap `Engine.prototype.resolveRemote` so the returned session's `invoke` scrubs `user_message.text` |
| Consent card before partner contact | `engine.requestConsent(info)` → `engine.onConsent(info)`; `info = {kind, peerLabel, peerOrigin, requestText, est}` | wrap `engine.onConsent` (as `templates/site.js` already does) to show the scrubbed text and the "What this agent will learn" diff |
| Arguments to a partner's bridge action (postMessage to its frame or window) | `ActionRegistry.prototype.execute(plan, confirm, id)`, `plan = [{entry, args}]`, `entry.base` gives the origin | wrap prototype: scrub string args for entries whose origin is not `location.origin` |
| Page-local actions (`website_*`) | same `execute` | not scrubbed: they run on the visitor's own page, and the vault fills private fields locally |

Issue #32 asks for official safety hooks. The proposal (see `docs/UPSTREAM.md`) turns the
four rows above into `engine.hooks.beforeModelCall`, `beforePartnerRequest`,
`beforeRemoteAction` and `describeConsent`, so no prototype wrapping is needed.

## 4. How partner calls work

1. The calling agent lists the peer's full network URL in `tools`; `link_labels` names
   it; its origin is in `allowed_peers` (closed policy).
2. When the model calls it, `dispatchToolCall` asks for consent **before any fetch**:
   card shows label, host and the first 140 chars of the request; Allow / Always allow
   (that host, until reload) / Decline. Same-origin peers skip the card.
3. Budget per visitor message: 4 partner calls, 1 per partner network, 24 agent calls,
   90 s (checked at call start), depth 5.
4. After Allow: fetch peer `agent-manifest.json`, exact network name match (fail closed),
   network JSON, `links.json`; if the manifest has `actions`, load its
   `bridge/action-bridge.html` in a hidden iframe and ask for the catalog of actions it
   shares with this page's origin (`callerOrigins`).
5. The peer's front agent runs **in the caller's browser**, on the caller's router, key
   and model, with this site's step limit, given only the request text: no history, no
   `sly_data` unless allowed.
6. Shared reads run in a new hidden frame on the peer origin. Shared writes
   (`write`/`irreversible`) open the peer's own top-level window; the chat first shows a
   message with an Open button; the action has 3 minutes in total.
7. Results: `The user declined to contact <host>.`, `Skipped <label>: ...`,
   `Error from tool '<tool>': ...`, `Error from <host>: ...`, or `{"cruse":1,"text":...}`.

## 5. Hosting rules that matter for HopeMeals

- HopeMeals' `_headers` sets `X-Frame-Options: SAMEORIGIN` and a report-only CSP with
  `frame-ancestors 'self'` on `/*`. The bridge folder must **detach** both
  (`! X-Frame-Options`, `! Content-Security-Policy-Report-Only`), or partner sites can
  never run the bridge.
- CORS (`*`) only on the public agent JSON files. Never on `/api/*`.
- A CSP on `/assistant` must allow the routers in `connect-src` (Otari US and EU,
  OpenRouter, Google AI Studio, the other providers the settings panel lists only if
  we want them).
- Linked sites on one machine must use different host names (`127.0.0.1` vs
  `localhost`), or the BYOK cookie leaks to the partner.

## 6. Gaps found while reading

- `write` actions run with no confirmation (runtime README says so). We keep every
  form prefill `write` (reversible, visible, never submits) and the donation hand-off
  `irreversible`.
- Request text to partners is not filtered (`linking.md`: "the runtime does not filter
  it"). That is what `airlock-gate` adds.
- The UI refuses to send without a key, so "Nano only, no key" needs a host-page opt-in
  (see `packages/nano-provider/README.md`).
