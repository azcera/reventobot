const { setTimeout: delay } = require('node:timers/promises')

const loads = new WeakMap()
const CACHE_MS = 30000

async function loadDiscordMembers(guild, { now = Date.now, sleep = delay, onRateLimit = () => {} } = {}) {
	const previous = loads.get(guild)
	if (previous?.pending) return previous.pending
	if (previous && now() - previous.loadedAt < CACHE_MS) return guild.members.cache || previous.members
	const state = {}
	loads.set(guild, state)
	state.pending = (async () => {
		for (let attempt = 0; ; attempt++) {
			try {
				state.members = await guild.members.fetch({ time: 30000 })
				state.loadedAt = now()
				return state.members
			} catch (error) {
				const seconds = error?.data?.retry_after
				if (error?.name !== 'GatewayRateLimitError' || error.data?.opcode !== 8 ||
					!Number.isFinite(seconds) || seconds < 0 || seconds > 60 || attempt >= 2) throw error
				const waitMs = Math.ceil(seconds * 1000) + 250
				onRateLimit({ guildId: guild.id, attempt: attempt + 1, waitMs })
				await sleep(waitMs)
			}
		}
	})()
	try { return await state.pending }
	catch (error) { loads.delete(guild); throw error }
	finally { state.pending = null }
}

module.exports = { loadDiscordMembers }
