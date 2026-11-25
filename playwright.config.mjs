// E2E: the HopeMeals branch build and the Giving Planner, served the way Cloudflare
// Pages would serve them, on two host names (127.0.0.1 and localhost) so the runtime's
// key cookie never crosses between them. Every LLM call is mocked (e2e/mock-llm.mjs).
//
// Before running: build the HM branch (`npm run build` in HM/frontend) and set HM_DIST if
// it is not at ../../HM/frontend/dist.
import { defineConfig } from "@playwright/test";

const HM_DIST = process.env.HM_DIST || "../../HM/frontend/dist";
// A build of HopeMeals' main branch, for the regression comparison (a git worktree of main).
const HM_MAIN_DIST = process.env.HM_MAIN_DIST || "../_vendor/hm-main/dist";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    viewport: { width: 1360, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: [
    { command: `node tools/serve-pages.mjs "${HM_DIST}" --port 8788 --host 127.0.0.1`, url: "http://127.0.0.1:8788/assistant", reuseExistingServer: true },
    { command: `node tools/serve-pages.mjs "${HM_MAIN_DIST}" --port 8790 --host 127.0.0.1`, url: "http://127.0.0.1:8790/", reuseExistingServer: true },
    { command: "node tools/serve-pages.mjs sites/giving-planner --port 8081 --host 127.0.0.1", url: "http://127.0.0.1:8081/", reuseExistingServer: true },
  ],
});
