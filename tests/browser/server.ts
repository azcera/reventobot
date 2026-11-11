export {}
import express = require('express')
import path = require('node:path')
import { ROOT_PATH } from '../../src/config/path'

const app = express()
const root = ROOT_PATH
app.use((req, res, next) => {
	res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'")
	next()
})
app.get('/auth/status', (req, res) => res.json({ configured: true }))
app.get('/', (req, res) => res.sendFile(path.join(root, 'public/dashboard/index.html')))
app.get('/builder.html', (req, res) => res.redirect('/#builder'))
app.use(express.static(path.join(root, 'dist/browser')))
app.use(express.static(path.join(root, 'public')))
app.listen(4173, '127.0.0.1')
