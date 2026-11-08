const { SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits, MessageFlags } = require('discord.js')

const MOVED_BUTTON_IDS = new Set(['capt', 'group', 'move-all'])
const definitions = [
	['capt', 'Создать обычную регистрацию на мероприятие', interaction => require('../features/capture/captureInteractions').showCaptModal(interaction)],
	['group', 'Создать группу: время, цель и код', interaction => require('../features/capture/groupInteractions').showGroupModal(interaction)],
	['move-all', 'Переместить всех участников в один голосовой канал', interaction => require('../features/moveAll/moveAllInteractions').showMoveAllSelect(interaction)]
]

async function authorize(interaction, store) {
	if (interaction.guild && (interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
		interaction.member.roles.cache.some(role => store.roleIds('ADMIN_ROLES').includes(role.id)))) return true
	await interaction.reply({ content: '❌ Действие доступно только администраторам и ролям ADMIN_ROLES.', flags: MessageFlags.Ephemeral })
	return false
}

function stripPanelActions(component) {
	if (MOVED_BUTTON_IDS.has(component.custom_id) || MOVED_BUTTON_IDS.has(component.accessory?.custom_id)) return null
	if (!component.components) return component
	const components = component.components.map(stripPanelActions).filter(Boolean)
	return components.length ? { ...component, components } : null
}

async function removePanelActions(guild, client, store) {
	const channelId = store.getSetting('ADMIN_PANEL_CHANNEL_ID')
	if (!channelId) return
	const channel = await guild.channels.fetch(channelId)
	if (!channel?.messages) return
	const messages = await channel.messages.fetch({ limit: 100 })
	for (const message of messages.values()) {
		if (message.author.id !== client.user.id || message.webhookId) continue
		const before = message.components.map(component => component.toJSON())
		const components = before.map(stripPanelActions).filter(Boolean)
		if (JSON.stringify(before) !== JSON.stringify(components)) await message.edit({ components })
	}
}

async function registerAdminApplicationCommands(client, guild, store) {
	for (const [name, description, execute] of definitions) {
		const data = new SlashCommandBuilder().setName(name).setDescription(description)
		client.commands.set(name, {
			data,
			async execute(interaction) {
				if (await authorize(interaction, store)) return execute(interaction)
			}
		})
		// Create upserts by name without replacing unrelated application commands.
		await guild.commands.create(data.toJSON())
	}
	for (const name of ['Создать архив', 'Открыть архив']) {
		const data = new ContextMenuCommandBuilder().setName(name).setType(ApplicationCommandType.User)
		client.commands.set(name, {
			data,
			async execute(interaction) {
				if (await authorize(interaction, store)) {
					return require('../features/archive/archiveContextCommands').handleArchiveCommand(interaction)
				}
			}
		})
		await guild.commands.create(data.toJSON())
	}
	await removePanelActions(guild, client, store)
}

module.exports = { registerAdminApplicationCommands, authorize, MOVED_BUTTON_IDS, stripPanelActions }
