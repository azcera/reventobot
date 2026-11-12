import express from 'express'
import path from 'node:path'
const app = express()
app.get('/auth/status', (_req, res) => res.json({ configured: true }))
app.use(express.static(path.resolve('dist/browser')))
app.use('/dashboard', express.static(path.resolve('public/dashboard')))
app.use(express.static(path.resolve('public/dashboard')))
app.get('/theme.css', (_req, res) => res.sendFile(path.resolve('public/theme.css')))
app.get('/revento-logo.png', (_req, res) => res.sendFile(path.resolve('public/revento-logo.png')))
app.listen(4173, '127.0.0.1')
