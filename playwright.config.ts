import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

const systemChrome = '/etc/profiles/per-user/banou/bin/google-chrome-stable'
const executablePath = process.env.CHROMIUM_EXECUTABLE || (existsSync(systemChrome) ? systemChrome : undefined)

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  workers: 1,
  timeout: 60_000,
  use: {
    headless: true,
    baseURL: 'http://127.0.0.1:47831',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--mute-audio', '--ozone-platform=headless'],
    },
  },
  webServer: { command: 'node tests/server.mjs', url: 'http://127.0.0.1:47831', reuseExistingServer: false },
})
