import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
const systemChrome = '/etc/profiles/per-user/banou/bin/google-chrome-stable'
export default defineConfig({
  testDir: './tests', workers: 1, timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4321', headless: true, launchOptions: {
    executablePath: process.env.CHROMIUM_EXECUTABLE || (existsSync(systemChrome) ? systemChrome : undefined),
    args: ['--mute-audio', '--ozone-platform=headless'],
  } },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4321', url: 'http://127.0.0.1:4321', reuseExistingServer: !process.env.CI },
})
