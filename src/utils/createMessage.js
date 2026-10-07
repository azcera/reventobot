const { Channel, ChannelType, ComponentBuilder } = require('discord.js')

const pool = require('../services/database')
/**
 * Создает сообщение в канал
 * @param {Channel} channel
 * @param {ComponentBuilder} component
 * @param {'all' | 'unanswered'} type
 * @param {1 | 2 | 3} part
 */
async function createMessage(channel, component, type, part) {
	if (channel.type !== ChannelType.GuildText) return
	const message = await channel.send({
		components: [component],
		flags: [MessageFlags.IsComponentsV2]
	})
	console.log(
		`Создано новое сообщение ${type.toUpperCase()} List с ID: ${message.id}`
	)
	const timestamp = message.createdTimestamp
	pool.query(
		`INSERT INTO settings_archive_messages (message_id, discord_timestamp, type, part) VALUES ($1, $2, $3, $4)`,
		[message.id, message.createdTimestamp, type, part]
	)
	return message
}

module.exports = { createMessage }
