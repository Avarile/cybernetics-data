/**
 * Behaviour-parity suite for the UI-only redesign (scripts/customized/developments/current-design.md §3).
 *
 * Runs against an already running app and a signed-in session; it never starts a web server.
 *   E2E_BASE_URL       default http://localhost:3000
 *   E2E_STORAGE_STATE  Playwright storage state of a signed-in user (required)
 *   E2E_SPACE_ID       space for the temporary fixture base (default: the user's first space)
 *   E2E_CHROME_PATH    optional browser executable (e.g. /usr/bin/google-chrome)
 *   UPDATE_PARITY=1    record e2e/parity/baseline/*.json from the current app instead of comparing
 *
 *   pnpm exec playwright test -c e2e/parity/parity.config.ts
 */
import path from 'path';
import type { PlaywrightTestConfig } from '@playwright/test';

const storageState = process.env.E2E_STORAGE_STATE;
if (!storageState) {
  throw new Error('E2E_STORAGE_STATE must point at a signed-in Playwright storage state');
}

const config: PlaywrightTestConfig = {
  testDir: __dirname,
  testMatch: '**/*.parity.ts',
  globalSetup: path.join(__dirname, 'global-setup.ts'),
  globalTeardown: path.join(__dirname, 'global-teardown.ts'),
  outputDir: path.join(__dirname, '../.out/parity'),
  timeout: 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    storageState,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    launchOptions: process.env.E2E_CHROME_PATH
      ? { executablePath: process.env.E2E_CHROME_PATH }
      : undefined,
  },
};

export default config;
