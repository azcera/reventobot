import { defineConfig } from 'vite'

export default defineConfig({
	root: 'frontend/activity',
	base: './',
	publicDir: false,
	build: { outDir: '../../public/activity', emptyOutDir: true }
})
