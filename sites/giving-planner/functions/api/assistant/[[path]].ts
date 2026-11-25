// The assistant's AI proxy, so visitors never need their own key.
//
// The site's assistant calls POST /api/assistant/chat/completions in the OpenAI
// format. This function adds the site's Google AI Studio key from the Pages secret
// ASSISTANT_GEMINI_KEY and streams Gemini's reply back. The key never reaches the browser.
//
// Built-in limits (no outside service): same-origin callers only, a size cap on every
// request, a forced model and max_tokens, and per-visitor and site-wide rate limits counted
// here (Cache API per Cloudflare location, plus memory). Visitor IPs are hashed before use.
// Nothing in a request is logged.
//
// It is self-contained on purpose (no imports), so the same file also runs in local tests.

interface Env {
  ASSISTANT_GEMINI_KEY?: string;
}

const UPSTREAM = 'https://generativelanguage.googleapis.com/v1beta/openai';
// Lightest model first; the others are tried only when Google says it is busy.
const MODELS = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

export const LIMITS = {
  perMinute: 24, // model calls per visitor per minute (one chat turn makes 2 to 6; the page allows 18)
  perDay: 300, // model calls per visitor per day
  sitePerDay: 4000, // model calls for the whole site per day (Google's free tier)
  maxBodyBytes: 120_000,
  maxMessages: 80,
  maxTools: 30,
  maxTokens: 1500,
};

const BUSY = 'The assistant is taking a short break because many people are using it. Please try again in a minute, or use the forms on this site directly.';
const DAY_DONE = "Today's assistant allowance is used up. Please come back tomorrow, or use the forms on this site directly. They work without the assistant.";

type Store = { get(key: string): Promise<number>; put(key: string, value: number, ttlSeconds: number): Promise<void> };

const memory = new Map<string, { value: number; until: number }>();

/** Counters: the Workers Cache API where it exists (shared within a Cloudflare location), else memory. */
export function defaultStore(now: () => number = Date.now): Store {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const url = (key: string) => `https://assistant-rate.invalid/${encodeURIComponent(key)}`;
  return {
    async get(key) {
      const m = memory.get(key);
      let value = m && m.until > now() ? m.value : 0;
      if (cache) {
        const hit = await cache.match(url(key));
        if (hit) value = Math.max(value, Number(await hit.text()) || 0);
      }
      return value;
    },
    async put(key, value, ttlSeconds) {
      memory.set(key, { value, until: now() + ttlSeconds * 1000 });
      if (memory.size > 5000) {
        for (const [k, v] of memory) if (v.until <= now()) memory.delete(k);
      }
      if (cache) {
        await cache.put(url(key), new Response(String(value), { headers: { 'Cache-Control': `max-age=${ttlSeconds}` } }));
      }
    },
  };
}

async function hash(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`assistant-rate:${text}`)));
  return Array.from(bytes.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

function isLoopback(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

/** Only this site's own pages may call it (and loopback pages while testing). */
export function originAllowed(request: Request): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  let o: URL;
  try { o = new URL(origin); } catch { return null; }
  const self = new URL(request.url);
  if (o.origin === self.origin) return origin;
  if (isLoopback(o.host) && isLoopback(self.host)) return origin;
  return null;
}

function cors(origin: string | null): Record<string, string> {
  return origin
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
    : {};
}

function text(status: number, body: string, origin: string | null, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...cors(origin), ...extra } });
}

/** Count one model call. Returns a refusal message, or '' when it may go ahead. */
export async function rateLimit(store: Store, visitor: string, now: number): Promise<string> {
  const minute = Math.floor(now / 60_000);
  const day = Math.floor(now / 86_400_000);
  const keys = { m: `v:${visitor}:m:${minute}`, d: `v:${visitor}:d:${day}`, s: `site:d:${day}` };
  const [m, d, s] = await Promise.all([store.get(keys.m), store.get(keys.d), store.get(keys.s)]);
  if (s >= LIMITS.sitePerDay || d >= LIMITS.perDay) return DAY_DONE;
  if (m >= LIMITS.perMinute) return BUSY;
  await Promise.all([store.put(keys.m, m + 1, 90), store.put(keys.d, d + 1, 90_000), store.put(keys.s, s + 1, 90_000)]);
  return '';
}

/** Keep only what the runtime sends, with the server's own model and limits. */
export function cleanBody(raw: unknown): { ok: true; body: Record<string, unknown> } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'Bad request.' };
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.messages) || r.messages.length === 0 || r.messages.length > LIMITS.maxMessages) return { ok: false, reason: 'Bad request.' };
  for (const m of r.messages) {
    if (!m || typeof m !== 'object' || !['system', 'user', 'assistant', 'tool'].includes(String((m as { role?: unknown }).role))) return { ok: false, reason: 'Bad request.' };
  }
  const body: Record<string, unknown> = { messages: r.messages, stream: true, max_tokens: LIMITS.maxTokens };
  if (r.tools !== undefined) {
    if (!Array.isArray(r.tools) || r.tools.length > LIMITS.maxTools) return { ok: false, reason: 'Bad request.' };
    if (r.tools.length) {
      body.tools = r.tools;
      body.tool_choice = 'auto';
    }
  }
  return { ok: true, body };
}

export async function handle(
  request: Request,
  env: Env,
  deps: { fetch?: typeof fetch; store?: Store; now?: () => number } = {},
): Promise<Response> {
  const doFetch = deps.fetch || fetch;
  const now = deps.now || Date.now;
  const origin = originAllowed(request);
  const path = new URL(request.url).pathname.replace(/^\/api\/assistant/, '');

  if (request.method === 'OPTIONS') return origin ? new Response(null, { status: 204, headers: cors(origin) }) : text(403, 'Not allowed.', null);
  if (!origin) return text(403, 'Not allowed.', null);

  if (request.method === 'GET' && path === '/models') {
    return new Response(JSON.stringify({ object: 'list', data: MODELS.map((id) => ({ id, object: 'model' })) }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin) },
    });
  }
  if (request.method !== 'POST' || path !== '/chat/completions') return text(404, 'Not found.', origin);
  if (!env.ASSISTANT_GEMINI_KEY) return text(503, 'The assistant is not switched on yet. The forms on this site work without it.', origin);

  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > LIMITS.maxBodyBytes) return text(413, 'That conversation is too long. Please start a new chat.', origin);
  const raw = await request.text();
  if (raw.length > LIMITS.maxBodyBytes) return text(413, 'That conversation is too long. Please start a new chat.', origin);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return text(400, 'Bad request.', origin); }
  const cleaned = cleanBody(parsed);
  if (!cleaned.ok) return text(400, cleaned.reason, origin);

  const visitor = await hash(request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'local');
  const refused = await rateLimit(deps.store || defaultStore(now), visitor, now());
  if (refused) return text(429, refused, origin, { 'Retry-After': '60' });

  let lastStatus = 0;
  for (const model of MODELS) {
    let upstream: Response;
    try {
      upstream = await doFetch(`${UPSTREAM}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.ASSISTANT_GEMINI_KEY}` },
        body: JSON.stringify({ ...cleaned.body, model }),
      });
    } catch {
      continue;
    }
    if (upstream.ok && upstream.body) {
      return new Response(upstream.body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Assistant-Model': model, ...cors(origin) },
      });
    }
    lastStatus = upstream.status;
    // Busy, unavailable or retired: try the next model. Anything else is a real error.
    if (![404, 429, 500, 503].includes(upstream.status)) break;
  }
  if (lastStatus && ![404, 429, 500, 503].includes(lastStatus)) {
    return text(502, 'The assistant could not answer that one. Please try again, or start a new chat.', origin);
  }
  return text(503, BUSY, origin, { 'Retry-After': '30' });
}

export const onRequest: PagesFunction<Env> = (context) => handle(context.request, context.env);
