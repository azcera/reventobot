import express from 'express'
import type { ErrorRequestHandler, Express } from 'express'
import type { Pool } from 'pg'
import sharp from 'sharp'
import { store } from '../../dashboard/store'
import { uuid } from './board'
import { mapUploadLimit, tacticsRepository } from './repository'

export function registerTacticsDashboard(app: Express, pool: Pool) {
	const repository = tacticsRepository(pool)
	const router = express.Router()
	router.get('/maps', async (req, res) => {
		const cursor = uuid(req.query.cursor) ? req.query.cursor : null
		const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : ''
		res.json(await repository.maps(req.guild.id, cursor, search, true))
	})
	const upload = express.raw({ limit: mapUploadLimit, type: 'application/octet-stream', inflate: false })
	router.post('/maps/upload', upload, async (req, res) => {
		const name = typeof req.query.name === 'string' ? req.query.name.trim() : ''
		if (!name || name.length > 100 || !Buffer.isBuffer(req.body) || !req.body.length)
			return res.status(400).json({ error: 'Укажите название до 100 символов и файл карты.' })
		const source = sharp(req.body, { limitInputPixels: 16_777_216 })
		let converted
		try {
			const metadata = await source.metadata()
			if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1)
				return res.status(400).json({ error: 'Загрузите статичное изображение PNG, JPEG или WebP.' })
			converted = await source.autoOrient().webp({ quality: 92 }).toBuffer({ resolveWithObject: true })
		} catch {
			return res.status(400).json({ error: 'Изображение повреждено или содержит больше 16 млн пикселей.' })
		}
		await store.audit(req.dashboardUser, 'tactics.map.upload.request', name)
		const { data, info } = converted
		res.json(await repository.createMap(req.guild.id, name, info.width, info.height, data))
	})
	router.post('/maps/archive', async (req, res) => {
		const { id, archived } = req.body ?? {}
		if (!uuid(id) || typeof archived !== 'boolean')
			return res.status(400).json({ error: 'Некорректная карта.' })
		await store.audit(req.dashboardUser, archived ? 'tactics.map.archive.request' : 'tactics.map.restore.request', id)
		if (!await repository.archive(req.guild.id, id, archived))
			return res.status(404).json({ error: 'Карта не найдена.' })
		res.json({ success: true })
	})
	const onError: ErrorRequestHandler = (error, _req, res, _next) => {
		if (error.status === 413) res.status(413).json({ error: 'Файл должен быть не больше 12 МБ.' })
		else {
			console.error('[Tactics dashboard]', error.message)
			res.status(502).json({ error: 'Не удалось выполнить запрос к каталогу карт.' })
		}
	}
	router.use(onError)
	app.use('/api/tactics', router)
}
