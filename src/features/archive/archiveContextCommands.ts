import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	ModalBuilder,
	TextDisplayBuilder
} from 'discord.js'
import { createArchiveChannel } from '../../utils/channelUtils'
import { store } from '../../dashboard/store'
import { parseDisplayName } from '../../utils/parseDisplayName'
import { canViewArchive } from './archiveAccess'
import { findArchiveByOwner } from './archiveSearch'

const pending = new Set()

function showNotice(
	interaction:
		| import('discord.js').ButtonInteraction<'cached'>
		| import('discord.js').UserContextMenuCommandInteraction<'cached'>,
	content: string
) {
	return interaction.showModal(
		new ModalBuilder()
			.setCustomId('archive_notice')
			.setTitle('Архив участника')
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
	)
}

async function handleArchiveCommand(
	interaction: import('discord.js').UserContextMenuCommandInteraction<'cached'>
) {
	// A modal must be the initial response. Slow Discord lookups need a deferred
	// response instead; in that case the notification can be opened with a button.
	let acknowledgement: ReturnType<typeof interaction.deferReply> | undefined
	const timer = setTimeout(() => {
		acknowledgement = interaction.deferReply({ flags: MessageFlags.Ephemeral })
		acknowledgement.catch(() => {})
	}, 1800)
	async function notice(content: string) {
		clearTimeout(timer)
		if (!acknowledgement) return showNotice(interaction, content)
		await acknowledgement
		return interaction.editReply({
			content,
			components: [
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId('archive_show_notice')
						.setLabel('Показать уведомление')
						.setStyle(ButtonStyle.Secondary)
				)
			]
		})
	}
	async function acknowledge() {
		clearTimeout(timer)
		await (acknowledgement ||
			interaction.deferReply({ flags: MessageFlags.Ephemeral }))
	}
	let key
	try {
		const member = await interaction.guild.members.fetch(interaction.targetId)
		const create = interaction.commandName === 'Создать архив'
		const managed = store.getSetting('ARCHIVE_MANAGE_ACCESS')
		const canView = !managed || canViewArchive(interaction.member, member, store.roleIds('ARCHIVE_VIEWER_ROLES'))
		if (!create && !canView)
			return await notice('❌ У вашей роли нет доступа к этому архиву.')
		const lockKey = `${interaction.guild.id}:${member.id}`
		if (pending.has(lockKey))
			return await notice(
				'⏳ Архив этого участника уже обрабатывается. Повторите позже.'
			)
		key = lockKey
		pending.add(key)
		const archive = await findArchiveByOwner(interaction.guild, member.id)
		if (create) {
			if (archive) return await notice(canView ? `❌ Архив уже создан: <#${archive.id}>.` : '❌ Архив уже создан.')
			const parsed = parseDisplayName(member.displayName)
			if (!parsed) return await notice('❌ Ник участника не по форме. Ожидается: Name | Static.')
			await acknowledge()
			return await createArchiveChannel(interaction, {
				channelName: [
					'archive',
					parsed.memberName.toLowerCase(),
					parsed.memberStatic
				].join(' '),
				member
			})
		}
		if (!archive || !archive.isThread())
			return await notice('❌ Для этого участника архив не найден.')
		await acknowledge()
		if (!managed) {
			if (archive.archived) await archive.setArchived(false)
			await archive.members.add(interaction.user.id)
		}
		await interaction.editReply({
			content: `Архив участника: <#${archive.id}>`,
			components: [
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder()
						.setLabel('Открыть архив')
						.setStyle(ButtonStyle.Link)
						.setURL(
							`https://discord.com/channels/${interaction.guild.id}/${archive.id}`
						)
				)
			]
		})
	} finally {
		clearTimeout(timer)
		if (key) pending.delete(key)
		if (acknowledgement) await acknowledgement
	}
}

export { handleArchiveCommand, showNotice }
