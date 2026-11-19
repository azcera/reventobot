import { ComponentType } from 'discord.js'
import { captureExpired } from '../features/capture/captureExpiry'
import { enqueueCaptureEdit } from '../features/capture/captureMessageQueue'
import type { ServiceOptions } from '../types'

// Keep message contents and participant lists intact when closing controls.
export function disableCaptureControls(components: any[]): any[] {
	return components.map(component => {
		const data =
			typeof component.toJSON === 'function' ? component.toJSON() : component
		return {
			...data,
			...(data.type === ComponentType.Button &&
			['capt_join', 'capt_leave', 'capt_edit_time_trigger'].includes(
				data.custom_id
			)
				? { disabled: true }
				: {}),
			...(data.components
				? { components: disableCaptureControls(data.components) }
				: {})
		}
	})
}

export function createCaptureExpiry({ client, pool, store }: ServiceOptions) {
	let running = false
	let timer: ReturnType<typeof setInterval> | undefined
	let active: Promise<void> | undefined
	async function tick() {
		if (running) return
		running = true
		try {
			const { rows } =
				await pool.query(`SELECT message_id, channel_id, discord_timestamp, message_refresh_pending, closure_pending, controls_closed
				FROM active_captures WHERE controls_closed = FALSE OR closure_pending OR message_refresh_pending`)
			for (const row of rows) {
				try {
					if (
						row.closure_pending ||
						(!row.controls_closed &&
							captureExpired(row.discord_timestamp || ''))
					) {
						await enqueueCaptureEdit(row.message_id, async () => {
							const { rows } = await pool.query(
								`UPDATE active_captures
								SET controls_closed = TRUE, closure_pending = TRUE
								WHERE message_id = $1 AND (closure_pending OR (controls_closed = FALSE
									AND substring(discord_timestamp from '<t:([0-9]+)')::bigint * 1000 + 3600000 <= $2))
								RETURNING channel_id`,
								[row.message_id, Date.now()]
							)
							if (!rows.length) return
							// Rows created before channel_id was stored use configured collection channels.
							const channels = rows[0].channel_id
								? [rows[0].channel_id]
								: [
										...new Set([
											store.getSetting('PLUS_CHANNEL_ID'),
											...Object.values(store.capturePresets).map(
												preset => preset.channelId
											)
										])
									].filter(Boolean)
							let foundChannel: string | null = null
							for (const channelId of channels) {
								const channel = await client.channels
									.fetch(channelId)
									.catch(error => {
										if (Number(error.code) === 10003) return null
										throw error
									})
								if (!channel || !('messages' in channel)) continue
								const message = await channel.messages
									.fetch(row.message_id)
									.catch(error => {
										if (Number(error.code) === 10008) return null
										throw error
									})
								if (!message) continue
								await message.edit({
									components: disableCaptureControls(message.components)
								})
								foundChannel = channelId
								break
							}
							await pool.query(
								`UPDATE active_captures SET closure_pending = FALSE, channel_id = COALESCE($2, channel_id)
								WHERE message_id = $1`,
								[row.message_id, foundChannel]
							)
						})
					} else if (row.message_refresh_pending && row.channel_id) {
						const { updateCollectionTime } =
							await import('../features/capture/captureManager')
						await updateCollectionTime(row.message_id, row.channel_id, client)
					}
				} catch (error) {
					console.error('[Capture expiry]', error)
				}
			}
		} finally {
			running = false
		}
	}
	return {
		tick,
		start() {
			if (timer) return
			const update = () => {
				if (active) return
				active = tick()
					.catch(error => console.error('[Capture expiry]', error))
					.finally(() => {
						active = undefined
					})
			}
			update()
			timer = setInterval(update, 30000)
			timer.unref()
		},
		async stop() {
			clearInterval(timer)
			timer = undefined
			await active
		}
	}
}
