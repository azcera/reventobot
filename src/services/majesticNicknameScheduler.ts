import { getError } from '../utils/errors'
import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
const INTERVAL_MS = 10 * 60 * 1000
const actor = { id: 'majestic-auto', name: 'Автосинхронизация Majestic' }

function createMajesticNicknameScheduler({ client, sync, store, env = process.env,
	logger = console, setTimer = setTimeout, clearTimer = clearTimeout }: Omit<T.ServiceOptions, 'pool'> & { sync: NonNullable<D.Client['majesticSync']>; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout }) {
	let stopped = true
	let timer: ReturnType<typeof setTimeout> | undefined
	let active: Promise<void> | null = null
	let runningGuild: D.Guild | null = null
	function schedule(delay: number) {
		if (stopped) return
		timer = setTimer(tick, delay)
		timer.unref?.()
	}
	async function tick() {
		if (stopped) return
		let stage = 'settings'
		active = (async () => {
			if (!store.ready || !store.getSetting('MAJESTIC_AUTO_NICKNAMES')) return
			if (!env.MAJESTIC_SERVER || !env.MAJESTIC_CHARACTER_ID) return
			stage = 'discord.guild.fetch'
			const guild = await client.guilds.fetch(env.GUILD_ID!)
			if (stopped) return
			stage = 'sync.start'
			const started = await sync.autoNicknames(guild)
			if (!started) return
			runningGuild = guild
			if (stopped) await sync.stop(guild, actor)
			stage = 'sync.wait'
			await sync.wait(guild)
		})()
		try { await active }
		catch (caughtError) {
 const error = getError(caughtError)

			const safe = (value: unknown) => /^[A-Za-z0-9_.-]{1,80}$/.test(String(value ?? '')) ? String(value) : ''
			logger.error('[Majestic] Не удалось запустить автосинхронизацию.', { stage, name: safe(error?.name), code: safe(error?.code) })
		}
		finally { active = null; runningGuild = null; schedule(INTERVAL_MS) }
	}
	return {
		start() { if (stopped) { stopped = false; schedule(0) } },
		async stop() {
			stopped = true
			clearTimer(timer)
			if (runningGuild) await sync.stop(runningGuild, actor)
			await active?.catch(() => {})
		}
	}
}

export { createMajesticNicknameScheduler, INTERVAL_MS }
