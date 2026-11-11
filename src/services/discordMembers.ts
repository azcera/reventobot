import { getError } from '../utils/errors'
import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
import { setTimeout as delay } from 'node:timers/promises'

interface LoadState { pending?: Promise<D.Collection<string, D.GuildMember>> | null; members?: D.Collection<string, D.GuildMember>; loadedAt?: number }
const loads = new WeakMap<D.Guild, LoadState>()
const CACHE_MS = 30000

async function loadDiscordMembers(guild: D.Guild, { now = Date.now, sleep = delay, onRateLimit = () => {} }: { now?: () => number; sleep?: (ms: number) => Promise<unknown>; onRateLimit?: (details: { guildId: string; attempt: number; waitMs: number }) => void } = {}) {
	const previous = loads.get(guild)
	if (previous?.pending) return previous.pending
	if (previous && now() - (previous.loadedAt || 0) < CACHE_MS) return guild.members.cache || previous.members
	const state: LoadState = {}
	loads.set(guild, state)
	state.pending = (async () => {
		for (let attempt = 0; ; attempt++) {
			try {
				state.members = await guild.members.fetch({ time: 30000 })
				state.loadedAt = now()
				return state.members
			} catch (caughtError) {
 const error = getError(caughtError)

				const seconds = error?.data?.retry_after
				if (error?.name !== 'GatewayRateLimitError' || error.data?.opcode !== 8 ||
					typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > 60 || attempt >= 2) throw error
				const waitMs = Math.ceil(seconds * 1000) + 250
				onRateLimit({ guildId: guild.id, attempt: attempt + 1, waitMs })
				await sleep(waitMs)
			}
		}
	})()
	try { return await state.pending }
	catch (caughtError) {
 const error = getError(caughtError)
 loads.delete(guild); throw error }
	finally { state.pending = null }
}

export { loadDiscordMembers }
