const express = require('express')
const path = require('node:path')

const app = express()
const root = path.resolve(__dirname, '../..')
app.use((req, res, next) => {
	res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'")
	next()
})
app.get('/auth/status', (req, res) => res.json({ configured: true }))
app.get('/', (req, res) => res.sendFile(path.join(root, 'public/dashboard/index.html')))
app.get('/builder.html', (req, res) => res.redirect('/#builder'))
app.get('/template-images/:name', (req, res) => {
	if (!['invites.png', 'revento.png', 'rules.png', 'capt.png'].includes(req.params.name)) return res.sendStatus(404)
	res.sendFile(path.join(root, 'src/images', req.params.name))
})
app.use(express.static(path.join(root, 'public')))
app.listen(4173, '127.0.0.1')
