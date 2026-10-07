import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: { command: 'npm run build && npm run preview', port: 4173 },
	testMatch: '**/*.e2e.{ts,js}',
	projects: [
		{ name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
		{ name: 'mobile', use: { viewport: { width: 390, height: 844 } } }
	]
});
