import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MessageFlags,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	type ButtonInteraction,
	type Guild,
	type StringSelectMenuInteraction,
	type ThreadChannel
} from 'discord.js'
import { randomUUID } from 'node:crypto'
import { store } from '../../dashboard/store'
import { authorize } from '../../services/adminApplicationCommands'
import { loadDiscordMembers } from '../../services/discordMembers'
import { getUnusedArchives, isArchiveUsed } from './unusedArchives'

const PREFIX = 'archive_cleanup_'
const sessions = new Map<
	string,
	{
		actorId: string
		guildId: string
		threads: ThreadChannel[]
		selected: string[]
		createdAt: number
	}
>()

function selectionContent(threads: ThreadChannel[], selected: string[] = []) {
	return (
		`Выбрано: ${selected.length} из ${threads.length}. Ветки будут удалены вместе со всем содержимым.\n` +
		threads
			.map(
				thread =>
					`${selected.includes(thread.id) ? '☑' : '☐'} ${thread.name.slice(0, 40)} — <#${thread.id}>`
			)
			.join('\n')
	)
}

async function getUnusedArchiveLists(guild: Guild) {
	const threads = await getUnusedArchives(guild)
	const containers: ContainerBuilder[] = []
	for (let offset = 0; offset < Math.max(1, threads.length); offset += 25) {
		const page = threads.slice(offset, offset + 25)
		const text =
			`# Неиспользуемые архивные ветки — ${threads.length}\n` +
			(page
				.map((thread, index) => `${offset + index + 1}. <#${thread.id}>`)
				.join('\n') || 'Список пуст.')
		containers.push(
			new ContainerBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
				.addActionRowComponents(
					new ActionRowBuilder<ButtonBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId(`${PREFIX}open_${offset / 25}`)
							.setLabel('Выбрать ветки для удаления')
							.setStyle(ButtonStyle.Danger)
							.setDisabled(!page.length)
					)
				)
		)
	}
	return containers
}

function selectionComponents(
	token: string,
	threads: ThreadChannel[],
	selected: string[] = []
) {
	return [
		new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId(`${PREFIX}select_${token}`)
				.setPlaceholder('Выберите архивные ветки')
				.setMinValues(0)
				.setMaxValues(threads.length)
				.addOptions(
					threads.map(thread => ({
						label: thread.name.slice(0, 100),
						value: thread.id,
						default: selected.includes(thread.id)
					}))
				)
		),
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`${PREFIX}delete_${token}`)
				.setLabel(`Удалить выбранные (${selected.length})`)
				.setStyle(ButtonStyle.Danger)
				.setDisabled(!selected.length),
			new ButtonBuilder()
				.setCustomId(`${PREFIX}all_${token}`)
				.setLabel('Выбрать всю страницу')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(selected.length === threads.length),
			new ButtonBuilder()
				.setCustomId(`${PREFIX}clear_${token}`)
				.setLabel('Снять выбор')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(!selected.length)
		)
	]
}

async function handleArchiveCleanup(
	interaction:
		| ButtonInteraction<'cached'>
		| StringSelectMenuInteraction<'cached'>
) {
	if (!(await authorize(interaction, store))) return
	for (const [key, session] of sessions)
		if (Date.now() - session.createdAt > 10 * 60 * 1000) sessions.delete(key)
	const action = interaction.customId.slice(PREFIX.length)
	if (interaction.isButton() && action.startsWith('open_')) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral })
		const offset = Number(action.slice(5)) * 25
		if (!Number.isSafeInteger(offset) || offset < 0)
			return interaction.editReply('Некорректный список.')
		const threads = (await getUnusedArchives(interaction.guild)).slice(
			offset,
			offset + 25
		)
		if (!threads.length)
			return interaction.editReply(
				'На этом месте больше нет неиспользуемых веток. Дождитесь обновления списка.'
			)
		const token = randomUUID()
		sessions.set(token, {
			actorId: interaction.user.id,
			guildId: interaction.guildId,
			threads,
			selected: [],
			createdAt: Date.now()
		})
		return interaction.editReply({
			content: selectionContent(threads),
			components: selectionComponents(token, threads)
		})
	}
	const token = action.slice(action.indexOf('_') + 1)
	const session = sessions.get(token)
	if (
		!session ||
		session.actorId !== interaction.user.id ||
		session.guildId !== interaction.guildId
	) {
		return interaction.reply({
			content: 'Выбор устарел. Откройте список заново.',
			flags: MessageFlags.Ephemeral
		})
	}
	const deleting = interaction.isButton() && action.startsWith('delete_')
	if (deleting) sessions.delete(token)
	await interaction.deferUpdate()
	if (interaction.isStringSelectMenu() && action.startsWith('select_')) {
		if (
			interaction.values.some(
				id => !session.threads.some(thread => thread.id === id)
			)
		)
			return interaction.editReply({
				content: 'Некорректный выбор.',
				components: []
			})
		session.selected = [...new Set(interaction.values)]
		return interaction.editReply({
			content: selectionContent(session.threads, session.selected),
			components: selectionComponents(token, session.threads, session.selected)
		})
	}
	if (
		interaction.isButton() &&
		(action.startsWith('all_') || action.startsWith('clear_'))
	) {
		session.selected = action.startsWith('all_')
			? session.threads.map(thread => thread.id)
			: []
		return interaction.editReply({
			content: selectionContent(session.threads, session.selected),
			components: selectionComponents(token, session.threads, session.selected)
		})
	}
	if (deleting) {
		const selected = [...session.selected]
		await interaction.editReply({
			content: `Проверяю состав сервера и удаляю выбранные ветки (${selected.length})…`,
			components: []
		})
		let unused: ThreadChannel[]
		try {
			unused = await getUnusedArchives(interaction.guild, true)
		} catch (error) {
			sessions.set(token, session)
			console.error(
				'[Archives] Не удалось проверить состав перед удалением',
				(error as Error).message
			)
			return interaction.editReply({
				content:
					'Не удалось проверить состав сервера. Ничего не удалено. Повторите удаление.\n' +
					selectionContent(session.threads, selected),
				components: selectionComponents(token, session.threads, selected)
			})
		}
		let deleted = 0,
			failed = 0
		for (const id of selected) {
			const thread = unused.find(thread => thread.id === id)
			if (!thread) continue
			try {
				await store.audit(
					{ id: interaction.user.id },
					'archive.delete.request',
					id,
					{ name: thread.name }
				)
				// Recheck the channel and current roster immediately before each deletion.
				const current = await interaction.guild.channels.fetch(id, {
					force: true
				})
				if (
					!current?.isThread() ||
					current.parentId !== store.getSetting('PARENT_CHANNEL_ID') ||
					!/^archive .+ \d+$/.test(current.name)
				)
					continue
				const members = await loadDiscordMembers(interaction.guild)
				if (isArchiveUsed(current.name, members.values())) continue
				await current.delete(
					`Неиспользуемый архив: удаление выбрал ${interaction.user.id}`
				)
				deleted++
				await store.audit(
					{ id: interaction.user.id },
					'archive.delete.result',
					id,
					{ status: 'deleted' }
				)
			} catch (error) {
				failed++
				console.error(
					'[Archives] Не удалось удалить выбранную ветку',
					id,
					(error as Error).message
				)
			}
		}
		await interaction.editReply({
			content: `Удалено: ${deleted}. Пропущено: ${selected.length - deleted - failed}. Ошибок: ${failed}.`,
			components: []
		})
		await (await import('./updateLists')).updateLists(interaction.guild)
	}
}

export { getUnusedArchiveLists, handleArchiveCleanup }
