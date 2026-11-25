// A small local stand-in for Cloudflare Pages static hosting, for tests.
//
//   node tools/serve-pages.mjs <dist> [--port 8788] [--host 127.0.0.1]
//
// It does what the HopeMeals build relies on: "/about" serves about.html, "/about.html"
// redirects to "/about", unknown paths get 404.html with status 404, and the rules in
// <dist>/_headers apply (path patterns with * and :placeholders, "! Name" detaches a
// header set by an earlier rule). /api/* is not run here: it answers 501, and tests
// intercept it in the browser. Host-based rules (https://...) are skipped.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const root = path.resolve(args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) || "dist");
const port = Number(opt("port", 8788));
const host = opt("host", "127.0.0.1");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".pdf": "application/pdf", ".woff2": "font/woff2", ".hocon": "text/plain; charset=utf-8",
};

export function parseHeaders(text) {
  const rules = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) { cur = { pattern: raw.trim(), set: [], detach: [] }; rules.push(cur); continue; }
    if (!cur) continue;
    const line = raw.trim();
    if (line.startsWith("!")) cur.detach.push(line.slice(1).trim().toLowerCase());
    else { const i = line.indexOf(":"); cur.set.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]); }
  }
  return rules.filter((r) => r.pattern.startsWith("/"));
}

function matches(pattern, pathname) {
  const re = "^" + pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z]\w*/g, "[^/]+")).join(".*") + "$";
  return new RegExp(re).test(pathname);
}

export function headersFor(rules, pathname) {
  const out = new Map();
  for (const r of rules) {
    if (!matches(r.pattern, pathname)) continue;
    for (const d of r.detach) out.delete(d);
    for (const [k, v] of r.set) {
      const key = k.toLowerCase();
      const prev = out.get(key);
      out.set(key, { name: k, value: prev ? `${prev.value}, ${v}` : v });
    }
  }
  return [...out.values()].map((h) => [h.name, h.value]);
}

async function exists(p) {
  try { return (await stat(p)).isFile(); } catch { return false; }
}

async function resolveFile(pathname) {
  const clean = decodeURIComponent(pathname);
  const abs = path.join(root, clean);
  if (!abs.startsWith(root)) return null;
  if (await exists(abs)) return abs;
  if (await exists(`${abs}.html`)) return `${abs}.html`;
  if (await exists(path.join(abs, "index.html"))) return path.join(abs, "index.html");
  return null;
}

let rules = [];
try { rules = parseHeaders(await readFile(path.join(root, "_headers"), "utf8")); } catch { /* no _headers */ }

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;
  if (pathname.startsWith("/api/")) {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ step: "local", error: "Pages Functions do not run in this local server." }));
    return;
  }
  if (pathname.endsWith(".html") && pathname !== "/404.html") {
    const to = pathname === "/index.html" ? "/" : pathname.slice(0, -5);
    res.writeHead(308, { Location: to + url.search });
    res.end();
    return;
  }
  let file = await resolveFile(pathname);
  let status = 200;
  if (!file) { file = path.join(root, "404.html"); status = 404; }
  const body = await readFile(file);
  const headers = { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" };
  for (const [k, v] of headersFor(rules, pathname)) headers[k] = v;
  res.writeHead(status, headers);
  res.end(req.method === "HEAD" ? undefined : body);
});

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  server.listen(port, host, () => console.log(`Serving ${root} at http://${host === "::1" ? "[::1]" : host}:${port}/`));
}
