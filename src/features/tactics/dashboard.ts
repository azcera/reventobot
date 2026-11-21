import express from 'express'
import type { ErrorRequestHandler, Express } from 'express'
import type { Pool } from 'pg'
import sharp from 'sharp'
import type { MapInfo } from '../../../shared/tactics'
import { store } from '../../dashboard/store'
import { uuid } from './board'
import { mapUploadLimit, tacticsRepository } from './repository'

export type MapChanged = (guildId: string, id: string, map: MapInfo | null, imageChanged?: boolean) => void

async function decodeMap(body: unknown) {
	if (!Buffer.isBuffer(body) || !body.length)
		throw Object.assign(new Error('Выберите файл изображения.'), { status: 400 })
	const source = sharp(body, { limitInputPixels: 16_777_216 })
	try {
		const metadata = await source.metadata()
		if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1)
			throw new Error()
		return await source.autoOrient().webp({ quality: 92 }).toBuffer({ resolveWithObject: true })
	} catch {
		throw Object.assign(new Error('Загрузите статичный PNG, JPEG или WebP размером до 16 млн пикселей.'), { status: 400 })
	}
}

export function registerTacticsDashboard(app: Express, pool: Pool, changed?: MapChanged) {
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
		if (!name || name.length > 100)
			return res.status(400).json({ error: 'Укажите название до 100 символов и файл карты.' })
		const { data, info } = await decodeMap(req.body)
		await store.audit(req.dashboardUser, 'tactics.map.upload.request', name)
		const map = await repository.createMap(req.guild.id, name, info.width, info.height, data)
		changed?.(req.guild.id, map.id, map)
		res.json(map)
	})
	router.post('/maps/edit', upload, async (req, res) => {
		const hasImage = !!req.is('application/octet-stream')
		const { id, name: rawName, order: rawOrder } = (hasImage ? req.query : req.body) ?? {}
		const name = typeof rawName === 'string' ? rawName.trim() : ''
		const order = typeof rawOrder === 'string' && /^\d+$/.test(rawOrder) ? Number(rawOrder) : rawOrder
		if (!uuid(id) || !name || name.length > 100 || !Number.isInteger(order) || order < 0 || order > 999999)
			return res.status(400).json({ error: 'Укажите название до 100 символов и порядок от 0 до 999999.' })
		const image = hasImage ? await decodeMap(req.body) : undefined
		await store.audit(req.dashboardUser, 'tactics.map.edit.request', id, { name, order, image: hasImage })
		const map = await repository.update(req.guild.id, id, name, order, image)
		if (!map) return res.status(404).json({ error: 'Карта не найдена.' })
		changed?.(req.guild.id, id, map, hasImage)
		res.json(map)
	})
	router.post('/maps/delete', async (req, res) => {
		const { id } = req.body ?? {}
		if (!uuid(id)) return res.status(400).json({ error: 'Некорректная карта.' })
		await store.audit(req.dashboardUser, 'tactics.map.delete.request', id)
		try {
			if (!await repository.delete(req.guild.id, id))
				return res.status(404).json({ error: 'Карта не найдена.' })
		} catch (error) {
			if ((error as { code?: string }).code === '23503')
				return res.status(409).json({ error: 'Карта используется в сохранённых тактиках. Её можно архивировать.' })
			throw error
		}
		changed?.(req.guild.id, id, null)
		res.json({ success: true })
	})
	router.post('/maps/archive', async (req, res) => {
		const { id, archived } = req.body ?? {}
		if (!uuid(id) || typeof archived !== 'boolean')
			return res.status(400).json({ error: 'Некорректная карта.' })
		await store.audit(req.dashboardUser, archived ? 'tactics.map.archive.request' : 'tactics.map.restore.request', id)
		const map = await repository.archive(req.guild.id, id, archived)
		if (!map)
			return res.status(404).json({ error: 'Карта не найдена.' })
		changed?.(req.guild.id, id, map)
		res.json({ success: true })
	})
	const onError: ErrorRequestHandler = (error, _req, res, _next) => {
		if (error.status === 413) res.status(413).json({ error: 'Файл должен быть не больше 12 МБ.' })
		else if (error.status === 400) res.status(400).json({ error: error.message })
		else {
			console.error('[Tactics dashboard]', error.message)
			res.status(502).json({ error: 'Не удалось выполнить запрос к каталогу карт.' })
		}
	}
	router.use(onError)
	app.use('/api/tactics', router)
}
