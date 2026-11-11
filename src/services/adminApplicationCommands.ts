import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
import { SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits, MessageFlags } from 'discord.js'

const MOVED_BUTTON_IDS = new Set(['capt', 'group', 'move-all'])
const definitions: [string, string, (interaction: D.ChatInputCommandInteraction<'cached'>) => unknown][] = [
	['capt', 'Создать обычную регистрацию на мероприятие', (interaction: D.ChatInputCommandInteraction<'cached'>) => (require('../features/capture/captureInteractions') as typeof import('../features/capture/captureInteractions')).showCaptModal(interaction)],
	['group', 'Создать группу: время, цель и код', (interaction: D.ChatInputCommandInteraction<'cached'>) => (require('../features/capture/groupInteractions') as typeof import('../features/capture/groupInteractions')).showGroupModal(interaction)],
	['move-all', 'Переместить всех участников в один голосовой канал', (interaction: D.ChatInputCommandInteraction<'cached'>) => (require('../features/moveAll/moveAllInteractions') as typeof import('../features/moveAll/moveAllInteractions')).showMoveAllSelect(interaction)]
]

async function authorize(interaction: T.GuildInteraction, store: T.Store) {
	if (interaction.guild && (interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
		interaction.member.roles.cache.some(role => store.roleIds('ADMIN_ROLES').includes(role.id)))) return true
	await interaction.reply({ content: '❌ Действие доступно только администраторам и ролям ADMIN_ROLES.', flags: MessageFlags.Ephemeral })
	return false
}

async function registerAdminApplicationCommands(client: D.Client, guild: D.Guild, store: T.Store) {
	for (const [name, description, execute] of definitions) {
		const data = new SlashCommandBuilder().setName(name).setDescription(description)
		client.commands.set(name, {
			data,
			async execute(interaction: T.GuildInteraction) {
				if (await authorize(interaction, store)) return execute(interaction as D.ChatInputCommandInteraction<'cached'>)
			}
		})
		// Create upserts by name without replacing unrelated application commands.
		await guild.commands.create(data.toJSON())
	}
	for (const name of ['Создать архив', 'Открыть архив']) {
		const data = new ContextMenuCommandBuilder().setName(name).setType(ApplicationCommandType.User)
		client.commands.set(name, {
			data,
			async execute(interaction: T.GuildInteraction) {
				if (await authorize(interaction, store)) {
					return (require('../features/archive/archiveContextCommands') as typeof import('../features/archive/archiveContextCommands')).handleArchiveCommand(interaction as D.UserContextMenuCommandInteraction<'cached'>)
				}
			}
		})
		await guild.commands.create(data.toJSON())
	}
}

export { registerAdminApplicationCommands, authorize, MOVED_BUTTON_IDS }
