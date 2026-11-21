import express from 'express'
import type { ErrorRequestHandler, Express } from 'express'
import type { Pool } from 'pg'
import sharp from 'sharp'
import type { MapInfo } from '../../../shared/tactics'
import { store } from '../../dashboard/store'
import { uuid } from './board'
import { mapUploadLimit, tacticsRepository } from './repository'

export type MapChanged = (guildId: string, change?: { id: string; map: MapInfo | null; imageChanged?: boolean } | { mapId: string }) => void

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
	router.get('/catalog', async (req, res) => {
		res.json(await repository.catalog(req.guild.id))
	})
	router.post('/categories/create', async (req, res) => {
		const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
		if (!name || name.length > 100)
			return res.status(400).json({ error: 'Укажите название категории до 100 символов.' })
		await store.audit(req.dashboardUser, 'tactics.category.create.request', name)
		const category = await repository.createCategory(req.guild.id, name)
		if (!category) return res.status(409).json({ error: 'Категория с таким названием уже существует.' })
		changed?.(req.guild.id)
		res.json(category)
	})
	const upload = express.raw({ limit: mapUploadLimit, type: 'application/octet-stream', inflate: false })
	router.post('/maps/upload', upload, async (req, res) => {
		const name = typeof req.query.name === 'string' ? req.query.name.trim() : ''
		const categoryId = req.query.categoryId
		if (!name || name.length > 100 || !uuid(categoryId))
			return res.status(400).json({ error: 'Выберите категорию, изображение и название до 100 символов.' })
		const { data, info } = await decodeMap(req.body)
		await store.audit(req.dashboardUser, 'tactics.map.upload.request', name)
		const map = await repository.createMap(req.guild.id, categoryId, name, info.width, info.height, data)
		if (!map) return res.status(404).json({ error: 'Категория не найдена.' })
		changed?.(req.guild.id, { id: map.id, map })
		res.json(map)
	})
	router.post('/maps/edit', upload, async (req, res) => {
		const hasImage = !!req.is('application/octet-stream')
		const { id, name: rawName, categoryId } = (hasImage ? req.query : req.body) ?? {}
		const name = typeof rawName === 'string' ? rawName.trim() : ''
		if (!uuid(id) || !uuid(categoryId) || !name || name.length > 100)
			return res.status(400).json({ error: 'Укажите название до 100 символов и выберите категорию.' })
		const image = hasImage ? await decodeMap(req.body) : undefined
		await store.audit(req.dashboardUser, 'tactics.map.edit.request', id, { name, categoryId, image: hasImage })
		const map = await repository.update(req.guild.id, id, name, categoryId, image)
		if (!map) return res.status(404).json({ error: 'Карта или категория не найдена.' })
		changed?.(req.guild.id, { id, map, imageChanged: hasImage })
		res.json(map)
	})
	router.post('/maps/delete', async (req, res) => {
		const { id } = req.body ?? {}
		if (!uuid(id)) return res.status(400).json({ error: 'Некорректная карта.' })
		await store.audit(req.dashboardUser, 'tactics.map.delete.request', id)
		if (!await repository.delete(req.guild.id, id))
			return res.status(404).json({ error: 'Карта не найдена.' })
		changed?.(req.guild.id, { id, map: null })
		res.json({ success: true })
	})
	router.post('/maps/reorder', async (req, res) => {
		const { id, categoryId, targetId, after } = req.body ?? {}
		if (!uuid(id) || !uuid(categoryId) || !uuid(targetId) || targetId === id || typeof after !== 'boolean')
			return res.status(400).json({ error: 'Выберите две разные карты одной категории.' })
		await store.audit(req.dashboardUser, 'tactics.map.reorder.request', id, { categoryId, targetId, after })
		if (!await repository.reorder(req.guild.id, categoryId, id, targetId, after))
			return res.status(409).json({ error: 'Состав категории изменился. Обновите каталог.' })
		changed?.(req.guild.id)
		res.json({ success: true })
	})
	router.post('/presets/delete', async (req, res) => {
		const { id, mapId } = req.body ?? {}
		if (!uuid(id) || !uuid(mapId)) return res.status(400).json({ error: 'Некорректная тактика.' })
		await store.audit(req.dashboardUser, 'tactics.preset.delete.request', id, { mapId })
		if (!await repository.deletePreset(req.guild.id, mapId, id))
			return res.status(404).json({ error: 'Тактика не найдена.' })
		changed?.(req.guild.id, { mapId })
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
