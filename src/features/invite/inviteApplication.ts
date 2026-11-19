import {
	ChannelType,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	PermissionFlagsBits,
	TextInputBuilder,
	TextInputStyle
} from 'discord.js'
import { store as dashboard } from '../../dashboard/store'
import {
	editReplyWithAutoDelete,
	sendEphemeralWithAutoDelete
} from '../../utils/autoDelete'
import { getError } from '../../utils/errors'
import { applicationTopic, buildContainer } from './inviteUtils'
import db = require('../../services/database.js')

const MODAL_FIELDS = [
	{
		customId: 'invite_name',
		label: 'Никнейм',
		description: 'Только имя (без фамилии и статика)',
		placeholder: 'Tony',
		style: TextInputStyle.Short,
		required: true,
		validate: (value: string) =>
			/^[A-Za-z]+$/.test(value)
				? null
				: '❌ Имя должно содержать только английские буквы.'
	},
	{
		customId: 'invite_static',
		label: 'Статик ID',
		description:
			"Ваш уникальный числовой идентификатор (можно посмотреть справа вверху в игре после символа '#')",
		placeholder: '132961',
		style: TextInputStyle.Short,
		required: true,
		validate: (value: string) =>
			/^\d+$/.test(value) ? null : '❌ Статик должен содержать только цифры.'
	},
	{
		customId: 'invite_age',
		label: 'Возраст (ООС)',
		placeholder: '18',
		style: TextInputStyle.Short,
		required: true,
		validate: (value: string) => {
			const age = parseInt(value)
			if (isNaN(age) || age < 10 || age > 90)
				return '❌ Возраст должен быть введен верным числом.'
			return null
		}
	},
	{
		customId: 'invite_info',
		label: 'Как узнали о семье и чего ждете?',
		description: 'Расскажите о ваших ожиданиях',
		placeholder: 'Узнал через маркет, хочу развиваться',
		style: TextInputStyle.Paragraph,
		required: true,
		validate: () => null
	},
	{
		customId: 'invite_history',
		label: 'Где ранее играли?',
		description: 'Указывайте проекты и семьи',
		placeholder: 'Revento, Sweet, Gucci (5rp)',
		style: TextInputStyle.Paragraph,
		required: true,
		validate: () => null
	}
]

/**
 * Класс-обработчик заявок кандидата.
 * Содержит MODAL_FIELDS с валидаторами.
 */
class InviteCandidate {
	MODAL_FIELDS = MODAL_FIELDS

	/**
	 * Проверяет, нет ли уже активной заявки, показывает модалку с 5 полями.
	 * @param {ButtonInteraction} interaction
	 */
	async showModal(
		interaction: import('discord.js').ButtonInteraction<'cached'>
	) {
		const modal = new ModalBuilder()
			.setCustomId('invite_modal_submit')
			.setTitle('Заявка в семью REVENTO')

		const labels = MODAL_FIELDS.map(field => {
			const label = new LabelBuilder()
				.setLabel(field.label)
				.setTextInputComponent(
					new TextInputBuilder()
						.setCustomId(field.customId)
						.setPlaceholder(field.placeholder)
						.setStyle(field.style)
						.setRequired(field.required)
				)
			if (field.description) label.setDescription(field.description)
			return label
		})

		modal.addLabelComponents(...labels)

		return interaction.showModal(modal)
	}

	/**
	 * Обрабатывает отправку модального окна заявки.
	 * Валидирует 5 полей, создаёт приватный канал, записывает данные в БД
	 * и отправляет контейнер с кнопками модерации.
	 * @param {ModalSubmitInteraction} interaction
	 */
	async submitModal(
		interaction: import('discord.js').ModalSubmitInteraction<'cached'>
	) {
		const values: Record<string, string> = {}
		MODAL_FIELDS.forEach(field => {
			values[field.customId] = interaction.fields
				.getTextInputValue(field.customId)
				.trim()
		})

		// 1. Быстрая валидация полей (в памяти, 0 мс)
		for (const field of MODAL_FIELDS) {
			const error = field.validate(values[field.customId])
			if (error)
				return sendEphemeralWithAutoDelete(interaction, {
					content: error
				})
		}

		/**
		 * @type {string}
		 */
		const name = values.invite_name
		const capitalizedName =
			name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()

		const fullName = `${capitalizedName} | ${values.invite_static}`
		const age = parseInt(values.invite_age)

		await interaction.deferReply({ flags: MessageFlags.Ephemeral as const })

		let claimed = false
		try {
			const claim = await db.query(
				`INSERT INTO family_applications
				(user_id, channel_id, guild_id, full_name, age, about_and_expectations, previous_experience, status, creation_id)
				VALUES ($1, '', $2, $3, $4, $5, $6, 'creating', $7)
				ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
				[
					interaction.user.id,
					interaction.guild.id,
					fullName,
					age,
					values.invite_info,
					values.invite_history,
					interaction.id
				]
			)
			if (!claim.rows.length)
				return editReplyWithAutoDelete(interaction, {
					content:
						'❌ У вас уже есть заявка или она ещё создаётся. Если канал не появился, обратитесь к модератору.'
				})
			claimed = true

			await interaction.member.setNickname(fullName).catch(() => {})

			const permissionOverwrites = [
				{
					id: interaction.guild.id,
					deny: [PermissionFlagsBits.ViewChannel]
				},
				{
					id: interaction.user.id,
					allow: [
						PermissionFlagsBits.ViewChannel,
						PermissionFlagsBits.SendMessages
					]
				}
			]
			dashboard.roleIds('ADMIN_ROLES').forEach(roleId =>
				permissionOverwrites.push({
					id: roleId,
					allow: [
						PermissionFlagsBits.ViewChannel,
						PermissionFlagsBits.SendMessages
					]
				})
			)

			const cleanName = fullName.replace('| ', '').trim().toLowerCase()
			const channel = await interaction.guild.channels.create({
				name: `заявка-${cleanName}`,
				topic: applicationTopic(interaction.id),
				type: ChannelType.GuildText,
				parent: dashboard.getSetting('INVITE_CATEGORY_ID'),
				permissionOverwrites
			})

			await db.query(
				`UPDATE family_applications SET channel_id = $2
				WHERE creation_id = $1 AND status = 'creating'`,
				[interaction.id, channel.id]
			)

			const container = await buildContainer(
				interaction.user.id,
				fullName,
				age,
				values.invite_info,
				values.invite_history,
				'отправления'
			)

			const message = await channel.send({
				components: [container.toJSON()],
				flags: MessageFlags.IsComponentsV2 as const,
				nonce: interaction.id,
				enforceNonce: true
			})
			const result = await db.query(
				`UPDATE family_applications SET message_id = $2, status = 'pending'
				WHERE creation_id = $1 AND status = 'creating' RETURNING user_id`,
				[interaction.id, message.id]
			)
			if (!result.rows.length)
				throw new Error('Не удалось подтвердить создание заявки.')

			return await editReplyWithAutoDelete(interaction, {
				content: `✅ Ваша заявка зарегистрирована! <#${channel.id}>`
			})
		} catch (caught) {
			const error = getError(caught)
			console.error('[InviteCandidate] Ошибка создания заявки:', error)
			if (claimed)
				await db
					.query(
						`UPDATE family_applications SET status = 'creation_failed'
				WHERE creation_id = $1 AND status = 'creating'`,
						[interaction.id]
					)
					.catch(console.error)
			return await editReplyWithAutoDelete(interaction, {
				content: claimed
					? 'Не удалось подтвердить создание заявки. Бот повторно проверит её состояние. Если канал не появился, обратитесь к модератору.'
					: '❌ Произошла ошибка при создании заявки.'
			})
		}
	}
}

const inviteCandidateInstance = new InviteCandidate()

export = inviteCandidateInstance
