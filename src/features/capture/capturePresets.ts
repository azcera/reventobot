import { ApplicationCommandType, LabelBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js'
import type { Guild, ModalSubmitInteraction } from 'discord.js'
import { collectionCreationError } from './collectionCreation'
import type { Actor, CapturePreset, GuildInteraction, ServiceOptions, Store } from '../../types'
import { problem } from '../../dashboard/auth'
import { parseDateTime, getDiscordTimestamp } from '../../utils/dateUtils'

const reserved = new Set(['capt', 'group', 'move-all'])

export function validatePresets(value: unknown, guild: Guild): CapturePreset[] {
	if (!Array.isArray(value) || value.length > 20) throw problem(400, 'Можно создать не более 20 предустановок.')
	const ids = new Set<string>(), names = new Set(reserved)
	return value.map(item => {
		if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/.test(item.id) || ids.has(item.id)) throw problem(400, 'Некорректная предустановка.')
		if (typeof item.command !== 'string' || !/^[\p{Ll}\p{Lo}\p{N}_-]{1,32}$/u.test(item.command) || names.has(item.command)) throw problem(400, 'Команда должна быть уникальной: 1–32 строчных буквы, цифры, _ или -.')
		if (typeof item.target !== 'string' || !item.target.trim() || item.target.length > 100 || /[\r\n]/.test(item.target)) throw problem(400, 'Укажите цель длиной до 100 символов в одной строке.')
		const channel = guild.channels.cache.get(item.channelId)
		if (!channel || channel.type !== 0 || !guild.members.me || !channel.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) throw problem(400, 'Выберите текстовый канал, в который бот может отправлять сообщения.')
		if (typeof item.accessRoleId !== 'string' || item.accessRoleId.split(',').filter(Boolean).some((id: string) => !guild.roles.cache.has(id) || id === guild.id)) throw problem(400, 'Выберите роль доступа к команде.')
		if (!Number.isInteger(item.maxMain) || item.maxMain < 1 || item.maxMain > 2147483647) throw problem(400, 'Количество участников должно быть целым числом от 1 до 2147483647.')
		ids.add(item.id); names.add(item.command)
		return { id: item.id, command: item.command, target: item.target.trim(), channelId: item.channelId, accessRoleId: item.accessRoleId, maxMain: item.maxMain }
	})
}

function canCreate(interaction: GuildInteraction, preset: CapturePreset, store: Store) {
	return interaction.member.permissions.has(PermissionFlagsBits.Administrator) || store.roleIds('ADMIN_ROLES').some(id => interaction.member.roles.cache.has(id)) || preset.accessRoleId.split(',').filter(Boolean).some(id => interaction.member.roles.cache.has(id))
}

export function createCapturePresets({ client, pool, store }: ServiceOptions) {
	let queue: Promise<unknown> = Promise.resolve()
	async function commandState(guild: Guild, presets: CapturePreset[]) {
		const tracked = (await pool.query<{ name: string }>('SELECT name FROM capture_preset_commands WHERE guild_id = $1', [guild.id])).rows
		const remote = await guild.commands.fetch()
		for (const preset of presets) {
			const existing = remote.find(command => command.type === ApplicationCommandType.ChatInput && command.name === preset.command)
			if ((existing || client.commands.has(preset.command)) && !tracked.some(row => row.name === preset.command)) throw problem(400, `Команда /${preset.command} уже существует.`)
		}
		return { tracked, remote }
	}
	async function sync(guild: Guild) {
		const presets = Object.values(store.capturePresets)
		const { tracked, remote } = await commandState(guild, presets)
		for (const row of tracked) if (!presets.some(preset => preset.command === row.name)) {
			const command = remote.find(command => command.type === ApplicationCommandType.ChatInput && command.name === row.name)
			if (command) await command.delete()
			client.commands.delete(row.name)
			await pool.query('DELETE FROM capture_preset_commands WHERE guild_id = $1 AND name = $2', [guild.id, row.name])
		}
		for (const preset of presets) {
			const data = new SlashCommandBuilder().setName(preset.command).setDescription('Создать сбор: ' + preset.target.slice(0, 80))
			// Track ownership before the Discord request so a retry can recover from a lost response.
			await pool.query('INSERT INTO capture_preset_commands (guild_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guild.id, preset.command])
			await guild.commands.create(data.toJSON())
			client.commands.set(preset.command, { data, async execute(interaction: GuildInteraction) {
				if (!interaction.isChatInputCommand()) return
				const current = store.capturePresets[preset.id]
				if (!current || current.command !== interaction.commandName) return interaction.reply({ content: 'Предустановка удалена или переименована.', flags: MessageFlags.Ephemeral })
				if (!canCreate(interaction, current, store)) return interaction.reply({ content: 'Недостаточно прав для создания сбора.', flags: MessageFlags.Ephemeral })
				const modal = new ModalBuilder().setCustomId('modal_capture_preset_' + current.id).setTitle('Создание сбора')
				modal.addLabelComponents(new LabelBuilder().setLabel('Дата и время (МСК)').setTextInputComponent(new TextInputBuilder().setCustomId('capt_time').setStyle(TextInputStyle.Short).setPlaceholder('18:00 или 29.08.2026 18:00').setRequired(true)))
				return interaction.showModal(modal)
			} })
		}
	}
	return {
		sync,
		save(guild: Guild, value: unknown, revision: number, actor?: Actor) {
			const work = async () => {
				if (!Number.isSafeInteger(revision)) throw problem(400, 'Обновите страницу перед сохранением.')
				await Promise.all([guild.channels.fetch(), guild.roles.fetch()])
				const presets = validatePresets(value, guild)
				await commandState(guild, presets)
				const values: Record<string, CapturePreset | null> = Object.fromEntries(Object.keys(store.capturePresets).map(id => [id, null]))
				for (const preset of presets) values[preset.id] = preset
				await store.save('capturePresets', values, revision, actor)
				try { await sync(guild) } catch { throw problem(503, 'Предустановки сохранены, но команды Discord не обновлены. Повторите сохранение.') }
				return { presets: Object.values(store.capturePresets), revision: store.revision }
			}
			const next = queue.then(work, work); queue = next.catch(() => {}); return next
		},
		async submit(interaction: ModalSubmitInteraction<'cached'>) {
			const preset = store.capturePresets[interaction.customId.slice('modal_capture_preset_'.length)]
			if (!preset) return interaction.reply({ content: 'Предустановка удалена. Вызовите актуальную команду.', flags: MessageFlags.Ephemeral })
			if (!canCreate(interaction, preset, store)) return interaction.reply({ content: 'Недостаточно прав для создания сбора.', flags: MessageFlags.Ephemeral })
			const input = interaction.fields.getTextInputValue('capt_time').trim()
			const date = parseDateTime(input)
			const parts = /^(?:(\d{2})\.(\d{2})\.(\d{4})\s+)?(\d{2}):(\d{2})$/.exec(input)
			const msk = date && new Date(date.getTime() + 3 * 60 * 60 * 1000)
			if (!date || !Number.isFinite(date.getTime()) || !parts || Number(parts[4]) > 23 || Number(parts[5]) > 59 || parts[1] && (msk!.getUTCDate() !== Number(parts[1]) || msk!.getUTCMonth() + 1 !== Number(parts[2]) || msk!.getUTCFullYear() !== Number(parts[3]))) return interaction.reply({ content: 'Укажите ЧЧ:ММ или ДД.ММ.ГГГГ ЧЧ:ММ (МСК).', flags: MessageFlags.Ephemeral })
			await interaction.deferReply({ flags: MessageFlags.Ephemeral })
			const captureManager = require('./captureManager') as typeof import('./captureManager')
			try {
				const url = await captureManager.sendCollection(interaction, getDiscordTimestamp(date), preset.target, preset.maxMain, true, preset.channelId)
				return interaction.editReply(`Сбор создан в <#${preset.channelId}>. Время: ${getDiscordTimestamp(date)}\n${url}`)
			} catch (error) {
				console.error('[Capture preset creation]', error)
				return interaction.editReply(collectionCreationError(error))
			}
		}
	}
}
