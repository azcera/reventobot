const INTERVAL_MS = 10 * 60 * 1000
const actor = { id: 'majestic-auto', name: 'Автосинхронизация Majestic' }

function createMajesticNicknameScheduler({ client, sync, store, env = process.env,
	logger = console, setTimer = setTimeout, clearTimer = clearTimeout }) {
	let stopped = true, timer, active, runningGuild
	function schedule(delay) {
		if (stopped) return
		timer = setTimer(tick, delay)
		timer.unref?.()
	}
	async function tick() {
		if (stopped) return
		active = (async () => {
			if (!store.ready || !store.getSetting('MAJESTIC_AUTO_NICKNAMES')) return
			if (!env.MAJESTIC_SESSION_ID || !env.MAJESTIC_SERVER || !env.MAJESTIC_CHARACTER_ID) return
			const guild = await client.guilds.fetch(env.GUILD_ID)
			if (stopped) return
			const started = await sync.autoNicknames(guild)
			if (!started) return
			runningGuild = guild
			if (stopped) await sync.stop(guild, actor)
			await sync.wait(guild)
		})()
		try { await active }
		catch { logger.error('[Majestic] Не удалось запустить автосинхронизацию. Проверьте базу и подключение Discord.') }
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

module.exports = { createMajesticNicknameScheduler, INTERVAL_MS }
