// @ts-check
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  // Software-WebGL boots are heavy; too many concurrent contexts cause boot-time
  // timeouts. Cap parallelism and allow one retry to absorb transient slowness.
  workers: 2,
  retries: process.env.CI ? 2 : 1,
  use: {
    baseURL: 'http://localhost:8799',
    viewport: { width: 1280, height: 800 },
    // WebGL via software rasterizer so it works headless + in CI
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'node tests/server.mjs .',
    port: 8799,
    reuseExistingServer: !process.env.CI,
  },
});
