import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Runs against the production build served by local workerd: `npm run build && npm run test:e2e`.
const PORT = 8788;
const preinstalled = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "e2e",
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions: existsSync(preinstalled) ? { executablePath: preinstalled } : {},
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx wrangler dev -c dist/liars_uno/wrangler.json --port ${PORT} --ip 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/api/lobby`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
});
