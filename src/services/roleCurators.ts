import type * as D from 'discord.js'
import type { GuildInteraction, RoleCurator, ServiceOptions } from '../types'
import { ApplicationCommandType, ContextMenuCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } from 'discord.js'
import { problem } from '../dashboard/auth'
import { getError } from '../utils/errors'

export const ROLE_CURATOR_COMMAND = 'Управление ролями'
const PAGE_SIZE = 5

function operationMessage(caught: unknown) {
	const error = getError(caught)
	if (error.status === 403 && error.code === undefined) return error.message
	if (error.code === 10007) return 'Участник больше не находится на сервере.'
	return 'Не удалось обновить роли. Проверьте права бота и откройте управление ролями заново.'
}

export function validateRoleCurators(curators: RoleCurator[], guild: D.Guild) {
	if (!Array.isArray(curators)) throw problem(400, 'Передайте список кураторов.')
	const seen = new Set<string>()
	for (const curator of curators) {
		if (!curator || typeof curator.roleId !== 'string' || curator.roleId === guild.id || !guild.roles.cache.has(curator.roleId) || seen.has(curator.roleId)) throw problem(400, 'Выберите уникальную роль куратора этого сервера.')
		seen.add(curator.roleId)
		if (!Array.isArray(curator.managedRoleIds) || !curator.managedRoleIds.length || new Set(curator.managedRoleIds).size !== curator.managedRoleIds.length) throw problem(400, 'Выберите роли, которыми управляет куратор, без повторений.')
		for (const id of curator.managedRoleIds) {
			const role = typeof id === 'string' && guild.roles.cache.get(id)
			if (!role || role.id === guild.id || role.managed || !role.editable) throw problem(400, 'Бот не может управлять выбранной ролью. Проверьте его права и иерархию ролей.')
		}
	}
}

export function createRoleCurators({ client, pool, store, env = process.env }: ServiceOptions) {
	let queue: Promise<unknown> = Promise.resolve()
	const mutations = new Map<string, Promise<unknown>>()
	const serial = <R>(work: () => Promise<R>) => { const next = queue.then(work, work); queue = next.catch(() => {}); return next }
	const allowedRoles = (actor: D.GuildMember) => [...new Set(Object.values(store.roleCurators)
		.filter(curator => actor.roles.cache.has(curator.roleId)).flatMap(curator => curator.managedRoleIds))]

	async function context(interaction: D.RepliableInteraction<'cached'>) {
		if (interaction.guildId !== env.GUILD_ID) throw problem(403, 'Команда недоступна на этом сервере.')
		const actor = await interaction.guild.members.fetch({ user: interaction.user.id, force: true })
		const channel = interaction.channel
		if (!channel || !actor.permissionsIn(channel).has([PermissionFlagsBits.ViewChannel, channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages])) throw problem(403, 'Команда доступна в чатах, где вы можете писать.')
		const ids = allowedRoles(actor)
		if (!ids.length) throw problem(403, 'Управление ролями доступно только настроенным кураторам.')
		return { actor, ids }
	}
	function panel(actor: D.GuildMember, target: D.GuildMember, ids: string[], requestedPage = 0, notice = '') {
		const pages = Math.max(1, Math.ceil(ids.length / PAGE_SIZE))
		const page = Math.max(0, Math.min(requestedPage, pages - 1))
		const buttonId = (action: string, roleId = '0', nextPage = page) => `role_curator_${action}_${actor.id}_${target.id}_${roleId}_${nextPage}`
		const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Роли участника <@${target.id}>${notice ? '\n' + notice : ''}`))
		for (const id of ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
			const role = target.guild.roles.cache.get(id)
			const has = target.roles.cache.has(id)
			container.addSectionComponents(new SectionBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${role ? `<@&${id}>` : `Недоступная роль · ${id}`} — **${has ? 'есть' : 'нет'}**`))
				.setButtonAccessory(new ButtonBuilder().setCustomId(buttonId(has ? 'remove' : 'add', id))
					.setLabel(has ? 'Убрать' : 'Добавить').setStyle(has ? ButtonStyle.Danger : ButtonStyle.Success)
					.setDisabled(!role || role.managed || !role.editable)))
		}
		if (pages > 1) container.addActionRowComponents(new ActionRowBuilder<D.ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(buttonId('page', '0', page - 1)).setLabel('←').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
			new ButtonBuilder().setCustomId(buttonId('page', '0', page + 1)).setLabel('→').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1)))
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Страница ${page + 1}/${pages} · Доступны только назначенные вам роли`))
		return { components: [container], allowedMentions: { parse: [] as const } }
	}
	async function open(interaction: D.UserContextMenuCommandInteraction<'cached'>) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral })
		try {
			const { actor, ids } = await context(interaction)
			await interaction.guild.roles.fetch()
			const target = await interaction.guild.members.fetch({ user: interaction.targetId, force: true })
			await interaction.editReply({ ...panel(actor, target, ids), flags: MessageFlags.IsComponentsV2 })
		} catch (error) {
			if (getError(error).code !== undefined || getError(error).status !== 403) console.error('[Role curators]', error)
			await interaction.editReply({ content: operationMessage(error) })
		}
	}
	async function cleanupLegacy(guild: D.Guild) {
		const { rows } = await pool.query('SELECT channel_id, message_id FROM mcl_messages WHERE guild_id = $1', [guild.id])
		for (const row of rows) {
			const channel = await guild.channels.fetch(row.channel_id).catch(error => { if (error.code === 10003) return null; throw error })
			if (channel?.isTextBased()) {
				const message = await channel.messages.fetch(row.message_id).catch(error => { if (error.code === 10008) return null; throw error })
				if (message) {
					if (message.author.id !== client.user!.id) throw new Error('Старое сообщение списка принадлежит другому автору.')
					await message.delete()
				}
			}
			await pool.query('DELETE FROM mcl_messages WHERE guild_id = $1 AND channel_id = $2', [guild.id, row.channel_id])
		}
	}
	async function sync(guild: D.Guild) {
		const { rows } = await pool.query('SELECT name FROM mcl_commands WHERE guild_id = $1', [guild.id])
		const remote = await guild.commands.fetch()
		const existing = remote.find(command => command.type === ApplicationCommandType.User && command.name === ROLE_CURATOR_COMMAND)
		if (existing && !rows.some(row => row.name === ROLE_CURATOR_COMMAND)) throw new Error('Команда «Управление ролями» уже существует и не принадлежит кураторам.')
		// Remove old list commands first to free the Discord context-menu quota.
		for (const { name } of rows) {
			if (name === ROLE_CURATOR_COMMAND) continue
			const command = remote.find(command => command.type === ApplicationCommandType.User && command.name === name)
			if (command) { await command.delete(); remote.delete(command.id) }
			client.commands.delete(name)
			await pool.query('DELETE FROM mcl_commands WHERE guild_id = $1 AND name = $2', [guild.id, name])
		}
		const data = new ContextMenuCommandBuilder().setName(ROLE_CURATOR_COMMAND).setType(ApplicationCommandType.User)
		await pool.query('INSERT INTO mcl_commands (guild_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guild.id, ROLE_CURATOR_COMMAND])
		await guild.commands.create(data.toJSON())
		client.commands.set(ROLE_CURATOR_COMMAND, { data, execute(interaction: GuildInteraction) { if (interaction.isUserContextMenuCommand()) return open(interaction) } })
		await cleanupLegacy(guild)
	}
	return {
		sync(guild: D.Guild) { return serial(() => sync(guild)) },
		async handle(interaction: D.ButtonInteraction<'cached'>) {
			const match = /^role_curator_(add|remove|page)_(\d{17,20})_(\d{17,20})_(\d{1,20})_(\d+)$/.exec(interaction.customId)
			if (!match || match[2] !== interaction.user.id) return interaction.reply({ content: 'Эта панель недоступна. Откройте управление ролями заново.', flags: MessageFlags.Ephemeral })
			await interaction.deferUpdate()
			const work = async () => {
				try {
					const { actor, ids } = await context(interaction)
					await interaction.guild.roles.fetch()
					const target = await interaction.guild.members.fetch({ user: match[3], force: true })
					let notice = ''
					if (match[1] !== 'page') {
						if (!allowedRoles(actor).includes(match[4])) throw problem(403, 'У вас больше нет доступа к этой роли.')
						const role = interaction.guild.roles.cache.get(match[4])
						if (!role || role.managed || !role.editable || role.id === interaction.guildId) throw problem(403, 'Бот не может изменить эту роль. Проверьте права и иерархию.')
						const add = match[1] === 'add'
						if (target.roles.cache.has(role.id) !== add) {
							const reason = `Куратор ролей: ${actor.id}`
							if (add) await target.roles.add(role.id, reason); else await target.roles.remove(role.id, reason)
						}
						// Refresh after the mutation instead of trusting a stale member cache.
						const updated = await interaction.guild.members.fetch({ user: target.id, force: true })
						notice = add ? '✅ Роль добавлена.' : '✅ Роль убрана.'
						return await interaction.editReply(panel(actor, updated, ids, Number(match[5]), notice))
					}
					await interaction.editReply(panel(actor, target, ids, Number(match[5])))
				} catch (error) {
					if (getError(error).code !== undefined || getError(error).status !== 403) console.error('[Role curators]', error)
					await interaction.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(operationMessage(error)))], allowedMentions: { parse: [] } })
				}
			}
			const key = `${interaction.guildId}:${match[3]}`
			const next = (mutations.get(key) || Promise.resolve()).then(work, work)
			mutations.set(key, next)
			try { await next } finally { if (mutations.get(key) === next) mutations.delete(key) }
		},
		async save(guild: D.Guild, curators: RoleCurator[], revision: number, actor?: import('../types').Actor) {
			return serial(async () => {
				await guild.roles.fetch()
				validateRoleCurators(curators, guild)
				const values = Object.fromEntries([...Object.keys(store.roleCurators).map(id => [id, null]), ...curators.map(curator => [curator.roleId, { roleId: curator.roleId, managedRoleIds: [...curator.managedRoleIds] }])])
				await store.save('roleCurators', values, revision, actor)
				try { await sync(guild) } catch (error) { throw problem(502, 'Настройки сохранены, но синхронизация команды не завершена: ' + getError(error).message) }
				return { curators: Object.values(store.roleCurators), revision: store.revision }
			})
		}
	}
}
