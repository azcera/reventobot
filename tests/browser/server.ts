import express from 'express'
import path from 'node:path'
const app = express()
app.use((_req, res, next) => {
	res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'")
	next()
})
app.get('/auth/status', (_req, res) => res.json({ configured: true }))
app.use(express.static(path.resolve('dist/browser')))
app.use('/dashboard', express.static(path.resolve('public/dashboard')))
app.use(express.static(path.resolve('public/dashboard')))
app.get('/dashboard-appearance.js', (_req, res) => res.sendFile(path.resolve('public/dashboard-appearance.js'), { dotfiles: 'allow' }))
app.get('/theme.css', (_req, res) => res.sendFile(path.resolve('public/theme.css'), { dotfiles: 'allow' }))
app.get('/revento-logo.png', (_req, res) => res.sendFile(path.resolve('public/revento-logo.png'), { dotfiles: 'allow' }))
app.listen(4173, '127.0.0.1')
