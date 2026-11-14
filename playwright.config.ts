import { defineConfig, devices } from '@playwright/test'

const firefox = process.env.PLAYWRIGHT_BROWSER === 'firefox'

export default defineConfig({
	testDir: './tests/browser',
	fullyParallel: true,
	workers: 2,
	use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', channel: process.env.PLAYWRIGHT_CHANNEL },
	projects: [{ name: 'desktop', use: { ...devices[firefox ? 'Desktop Firefox' : 'Desktop Chrome'], browserName: firefox ? 'firefox' : 'chromium', channel: firefox ? undefined : process.env.PLAYWRIGHT_CHANNEL, viewport: { width: 1440, height: 1000 } } }, { name: 'mobile', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } }],
	webServer: { command: 'node dist/tests/browser/server.js', url: 'http://127.0.0.1:4173/auth/status', reuseExistingServer: false }
})
