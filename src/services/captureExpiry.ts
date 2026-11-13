import type { ServiceOptions } from '../types'
import { captureExpired } from '../features/capture/captureExpiry'
import { ComponentType } from 'discord.js'

// Keep message contents and participant lists intact when closing controls.
export function disableCaptureControls(components: any[]): any[] {
	return components.map(component => {
		const data = typeof component.toJSON === 'function' ? component.toJSON() : component
		return {
			...data,
			...(data.type === ComponentType.Button && ['capt_join', 'capt_leave', 'capt_edit_time_trigger'].includes(data.custom_id) ? { disabled: true } : {}),
			...(data.components ? { components: disableCaptureControls(data.components) } : {})
		}
	})
}

export function createCaptureExpiry({ client, pool, store }: ServiceOptions) {
	let running = false
	async function tick() {
		if (running) return
		running = true
		try {
			const { rows } = await pool.query('SELECT message_id, channel_id, discord_timestamp FROM active_captures WHERE controls_closed = FALSE')
			for (const row of rows) {
				if (!captureExpired(row.discord_timestamp || '')) continue
				const connection = await pool.connect()
				try {
					await connection.query('BEGIN')
					const current = (await connection.query('SELECT * FROM active_captures WHERE message_id = $1 FOR UPDATE', [row.message_id])).rows[0]
					if (!current || current.controls_closed || !captureExpired(current.discord_timestamp || '')) {
						await connection.query('ROLLBACK')
						continue
					}
					// Older rows predate channel_id; try configured collection channels.
					const channels = current.channel_id ? [current.channel_id] : [...new Set([
						store.getSetting('PLUS_CHANNEL_ID'), ...Object.values(store.capturePresets).map(preset => preset.channelId)
					])].filter(Boolean)
					let foundChannel: string | null = null
					for (const channelId of channels) {
						const channel = await client.channels.fetch(channelId)
						if (!channel || !('messages' in channel)) continue
						const message = await channel.messages.fetch(row.message_id).catch(error => {
							if (error.code === 10008) return null
							throw error
						})
						if (!message) continue
						await message.edit({ components: disableCaptureControls(message.components) })
						foundChannel = channelId
						break
					}
					// Deleted messages must not cause fresh Discord requests every tick.
					await connection.query('UPDATE active_captures SET controls_closed = TRUE, channel_id = COALESCE($2, channel_id) WHERE message_id = $1', [row.message_id, foundChannel])
					await connection.query('COMMIT')
				} catch (error) {
					await connection.query('ROLLBACK').catch(() => {})
					console.error('[Capture expiry]', error)
				} finally { connection.release() }
			}
		} finally { running = false }
	}
	return {
		tick,
		start() {
			const update = () => tick().catch(error => console.error('[Capture expiry]', error))
			void update()
			const timer = setInterval(update, 30000)
			timer.unref()
			return timer
		}
	}
}
