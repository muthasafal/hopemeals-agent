// Compare two HopeMeals builds (dist folders): main and the agentic-assistant branch.
//
//   node tools/compare-builds.mjs <main dist> <branch dist>
//
// Every file in main's dist must exist in the branch's dist with the same content, after
// replacing Vite's content hashes in asset names (the JS bundle changes because a route
// was added). Files only in the branch are listed; they must all be additive
// (/assistant and /agents/*). _headers may only gain lines at the end.
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

// --expect-changed a.html,b.html: files the branch changes on purpose (listed, not failed).
const argv = process.argv.slice(2);
const ei = argv.indexOf("--expect-changed");
const expected = new Set(ei >= 0 ? argv.splice(ei, 2)[1].split(",") : []);
const [mainDir, branchDir] = argv.map((p) => path.resolve(p));
if (!mainDir || !branchDir) {
  console.error("Usage: node tools/compare-builds.mjs <main dist> <branch dist>");
  process.exit(2);
}

async function walk(dir, base = dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = path.join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...await walk(p, base));
    else out.push(path.relative(base, p).replaceAll("\\", "/"));
  }
  return out;
}

const hashed = /^assets\//;
const normalize = (s) => s.replace(/\r/g, "").replace(/(\/assets\/[A-Za-z0-9_.-]+?)-[A-Za-z0-9_-]{8}\.(js|css)/g, "$1-HASH.$2");
const additive = (f) => f === "assistant.html" || f.startsWith("agents/");

const mainFiles = await walk(mainDir);
const branchFiles = new Set(await walk(branchDir));
let problems = 0;
const same = [];
for (const f of mainFiles) {
  if (hashed.test(f)) continue;
  if (!branchFiles.has(f)) { console.log(`MISSING in branch: ${f}`); problems++; continue; }
  const a = await readFile(path.join(mainDir, f));
  const b = await readFile(path.join(branchDir, f));
  if (f === "_headers") {
    const at = a.toString("utf8").replace(/\r\n/g, "\n").trimEnd();
    const bt = b.toString("utf8").replace(/\r\n/g, "\n");
    if (bt.startsWith(at)) { same.push(`${f} (branch only appends ${bt.slice(at.length).trim().split("\n").length} lines)`); }
    else { console.log(`CHANGED: ${f} (not append-only)`); problems++; }
    continue;
  }
  if (/\.(html|xml|txt|json|js|css)$/.test(f) || f === "_redirects") {
    if (normalize(a.toString("utf8")) === normalize(b.toString("utf8"))) same.push(f);
    else if (expected.has(f)) console.log(`CHANGED ON PURPOSE: ${f}`);
    else {
      problems++;
      const as = normalize(a.toString("utf8"));
      const bs = normalize(b.toString("utf8"));
      let i = 0;
      while (i < as.length && as[i] === bs[i]) i++;
      console.log(`CHANGED: ${f} at char ${i}\n  main:   ${JSON.stringify(as.slice(Math.max(0, i - 60), i + 80))}\n  branch: ${JSON.stringify(bs.slice(Math.max(0, i - 60), i + 80))}`);
    }
  } else if (Buffer.compare(a, b) === 0) same.push(f);
  else { console.log(`CHANGED (binary): ${f}`); problems++; }
}
const added = [...branchFiles].filter((f) => !mainFiles.includes(f) && !hashed.test(f));
const notAdditive = added.filter((f) => !additive(f));
console.log(`\nIdentical (hashes normalised): ${same.length} files`);
for (const f of same.filter((x) => x.endsWith(".html") || x.startsWith("_") || x.endsWith(".xml") || x.endsWith(".txt"))) console.log(`  = ${f}`);
console.log(`Added in branch: ${added.length} files (${added.filter((f) => f.startsWith("agents/")).length} under agents/)`);
for (const f of added.filter((x) => !x.startsWith("agents/"))) console.log(`  + ${f}`);
if (notAdditive.length) { console.log(`NOT ADDITIVE: ${notAdditive.join(", ")}`); problems++; }
console.log(problems ? `\n${problems} problem(s).` : "\nOK: every existing file is unchanged apart from any listed as changed on purpose; the branch only adds files.");
process.exit(problems ? 1 : 0);
