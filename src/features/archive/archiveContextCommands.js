const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextDisplayBuilder } = require('discord.js')
const { parseDisplayName } = require('../../utils/parseDisplayName')
const { createArchiveChannel } = require('../../utils/channelUtils')
const { findMemberArchive } = require('./archiveSearch')

const pending = new Set()

function showNotice(interaction, content) {
	return interaction.showModal(new ModalBuilder()
		.setCustomId('archive_notice')
		.setTitle('Архив участника')
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(content)))
}

async function handleArchiveCommand(interaction) {
	// A modal must be the initial response. Slow Discord lookups need a deferred
	// response instead; in that case the notification can be opened with a button.
	let acknowledgement
	const timer = setTimeout(() => {
		acknowledgement = interaction.deferReply({ flags: MessageFlags.Ephemeral })
		acknowledgement.catch(() => {})
	}, 1800)
	async function notice(content) {
		clearTimeout(timer)
		if (!acknowledgement) return showNotice(interaction, content)
		await acknowledgement
		return interaction.editReply({ content, components: [new ActionRowBuilder().addComponents(
			new ButtonBuilder().setCustomId('archive_show_notice').setLabel('Показать уведомление').setStyle(ButtonStyle.Secondary)
		)] })
	}
	async function acknowledge() {
		clearTimeout(timer)
		await (acknowledgement || interaction.deferReply({ flags: MessageFlags.Ephemeral }))
	}
	let key
	try {
		const member = await interaction.guild.members.fetch(interaction.targetId)
		const parsed = parseDisplayName(member.displayName)
		if (!parsed) return await notice('❌ Ник участника не по форме. Ожидается: Name | Static.')
		const lockKey = `${interaction.guild.id}:${parsed.memberStatic}`
		if (pending.has(lockKey)) return await notice('⏳ Архив этого участника уже обрабатывается. Повторите позже.')
		key = lockKey
		pending.add(key)
		const archive = await findMemberArchive(interaction.guild, parsed)
		if (interaction.commandName === 'Создать архив') {
			if (archive) return await notice(`❌ Архив уже создан: <#${archive.id}>.`)
			await acknowledge()
			return await createArchiveChannel(interaction, {
				channelName: ['archive', parsed.memberName.toLowerCase(), parsed.memberStatic].join(' '), member
			})
		}
		if (!archive) return await notice('❌ Для этого участника архив не найден.')
		await acknowledge()
		if (archive.archived) await archive.setArchived(false)
		await archive.members.add(interaction.user.id)
		await interaction.editReply({
			content: `Архив участника: <#${archive.id}>`,
			components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
				.setLabel('Открыть архив').setStyle(ButtonStyle.Link)
				.setURL(`https://discord.com/channels/${interaction.guild.id}/${archive.id}`))]
		})
	} finally {
		clearTimeout(timer)
		if (key) pending.delete(key)
		if (acknowledgement) await acknowledgement
	}
}

module.exports = { handleArchiveCommand, showNotice }
