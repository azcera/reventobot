import { readFileSync } from 'node:fs'
import { writeFile, rename, unlink } from 'node:fs/promises'
import path = require('node:path')
import { ROOT_PATH } from '../config/path'
import { readConfig, fetchMembers } from './majesticClient'
import type { Pool } from 'pg'

const sessionPath = path.join(ROOT_PATH, '.majestic-session')

async function loadSavedMajesticSession(pool: Pool, env = process.env, savedPath = sessionPath) {
	await pool.query(`CREATE TABLE IF NOT EXISTS majestic_session (
		id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id), value TEXT NOT NULL
	)`)
	const result = await pool.query<{ value: string }>('SELECT value FROM majestic_session WHERE id = TRUE')
	if (result.rows[0]?.value) {
		env.MAJESTIC_SESSION_ID = result.rows[0].value
		return
	}
	let value
	try {
		value = readFileSync(savedPath, 'utf8').trim()
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[Majestic] Не удалось прочитать сохранённую сессию.')
	}
	if (value && !/[;\s\x00-\x1f\x7f]/.test(value)) {
		await pool.query('INSERT INTO majestic_session (id, value) VALUES (TRUE, $1) ON CONFLICT (id) DO NOTHING', [value])
		const saved = await pool.query<{ value: string }>('SELECT value FROM majestic_session WHERE id = TRUE')
		env.MAJESTIC_SESSION_ID = saved.rows[0]?.value || value
	}
}

function createTelegramMajesticSession({ send, pool, env = process.env, validate = fetchMembers,
	save = async (value: string) => {
		if (pool) {
			await pool.query(`CREATE TABLE IF NOT EXISTS majestic_session (
				id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id), value TEXT NOT NULL
			)`)
			await pool.query('INSERT INTO majestic_session (id, value) VALUES (TRUE, $1) ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value', [value])
			return
		}
		const temporary = `${sessionPath}.tmp`
		try { await writeFile(temporary, value, { mode: 0o600 }); await rename(temporary, sessionPath) }
		catch (error) { await unlink(temporary).catch(() => {}); throw error }
	}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }: {
	send: (chatId: string, text: string) => Promise<void>; pool?: Pool; env?: NodeJS.ProcessEnv;
	validate?: typeof fetchMembers; save?: (value: string) => Promise<void>; now?: () => number;
	setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout
}) {
	let timer: ReturnType<typeof setTimeout> | undefined
	let waitingSince = 0
	let stopped = true
	async function prompt() {
		const chatId = env.TG_NOTIFICATION_CHAT_ID?.trim()
		if (!chatId) return
		await send(chatId, 'Отправьте новое значение sessionId Majestic. Текущая сессия продолжает работать до успешной проверки новой.')
		waitingSince = Math.floor(now() / 1000)
	}
	function schedule() {
		if (stopped) return
		const current = now()
		const moscowDay = Math.floor((current + 3 * 3600000) / 86400000)
		let next = moscowDay * 86400000 + 19 * 3600000
		if (next <= current) next += 86400000
		timer = setTimer(() => { void prompt().catch(() => console.error('[Majestic] Не удалось отправить запрос сессии в Telegram.')).finally(schedule) }, next - current)
		timer.unref?.()
	}
	return {
		start() { if (stopped) { stopped = false; schedule() } },
		stop() { stopped = true; clearTimer(timer) },
		async handleMessage(chatId: string, text?: string, date?: number) {
			if (!env.TG_NOTIFICATION_CHAT_ID || chatId !== env.TG_NOTIFICATION_CHAT_ID.trim() || !text) return false
			if (text.trim() === '/session') { await prompt(); return true }
			if (!waitingSince || !date || date < waitingSince || text.trim().startsWith('/')) return false
			try {
				const config = readConfig({ ...env, MAJESTIC_SESSION_ID: text.trim() })
				await validate(config)
				await save(config.sessionId)
				env.MAJESTIC_SESSION_ID = config.sessionId
				waitingSince = 0
			} catch {
				await send(chatId, 'Не удалось проверить или сохранить сессию. Старая сессия сохранена; отправьте значение sessionId ещё раз.')
				return true
			}
			await send(chatId, 'Сессия Majestic проверена и обновлена без перезапуска.')
			return true
		}
	}
}

export { createTelegramMajesticSession, loadSavedMajesticSession }
