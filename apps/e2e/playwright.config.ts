import { defineConfig, devices } from '@playwright/test'

// E2E_PORT lets several checkouts run their tests at the same time.
const PORT = Number(process.env.E2E_PORT ?? 4173)
const CI = !!process.env.CI

// End-to-end tests of the production web build (roadmap 24), in the three browser engines:
// Chromium, WebKit (the engine of the macOS desktop app's webview) and Firefox.
export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  // The production build, served as it is deployed (no dev-only plugins such as source_data).
  webServer: {
    command: `pnpm --filter @ps/web build && pnpm --filter @ps/web preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 180_000,
    stdout: 'ignore',
  },
})
