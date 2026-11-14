import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
	root: 'frontend',
	base: '/dashboard/',
	publicDir: false,
	plugins: [tailwindcss()],
	build: { outDir: '../public/dashboard', emptyOutDir: true },
	server: { proxy: Object.fromEntries(['/api', '/auth', '/template-images', '/theme.css', '/dashboard-appearance.js', '/markdown.js', '/component-markdown.js', '/revento-logo.png'].map(path => [path, 'http://localhost:3000'])) }
})
