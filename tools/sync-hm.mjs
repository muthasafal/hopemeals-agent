// Copy the browser runtime and this repo's packages into a site's public agent folder.
//
//   node tools/sync-hm.mjs [<site agents folder>] [--skill <agentify-website skill dir>]
//
// Defaults: ../../HM/frontend/public/agents and ../_vendor/agentic-web/skills/agentify-website.
// The runtime is copied unchanged (the skill's rule). The packages go under lib/.
import { cp, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const args = process.argv.slice(2);
const skillAt = args.indexOf("--skill");
const skill = skillAt >= 0 ? path.resolve(args[skillAt + 1]) : path.resolve(repo, "../_vendor/agentic-web/skills/agentify-website");
const target = path.resolve(args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--skill") || path.resolve(repo, "../../HM/frontend/public/agents"));

await mkdir(target, { recursive: true });
await rm(path.join(target, "runtime"), { recursive: true, force: true });
await cp(path.join(skill, "runtime"), path.join(target, "runtime"), { recursive: true });
for (const pkg of ["airlock-gate", "nano-provider"]) {
  const dest = path.join(target, "lib", pkg);
  await rm(dest, { recursive: true, force: true });
  await cp(path.join(repo, "packages", pkg, "src"), dest, { recursive: true });
}
console.log(`Synced runtime and lib/ into ${target}`);
