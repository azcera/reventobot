export {}
import path = require('node:path')
import fs = require('node:fs/promises')
const { Client, Events, GatewayIntentBits, PermissionFlagsBits } = require('discord.js')
import dotenv = require('dotenv')
const { readConfig, fetchMembers } = require('./check-majestic')
const { buildPreview } = require('../src/features/majestic/syncPreview')

async function main() {
	const root = path.join(__dirname, '..')
	dotenv.config({ path: path.join(root, '.env.majestic.local'), quiet: true })
	dotenv.config({ path: path.join(root, '.env'), quiet: true })
	if (!process.env.TOKEN || !/^\d{17,20}$/.test(process.env.GUILD_ID || '')) {
		throw new Error('Для чтения Discord нужны TOKEN и GUILD_ID в .env.')
	}
	const family = await fetchMembers(readConfig(process.env))
	const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] })
	let timer
	try {
		await new Promise((resolve, reject) => {
			timer = setTimeout(() => reject(new Error('Таймаут подключения к Discord.')), 30000)
			client.once(Events.ClientReady, resolve)
			client.on(Events.Error, () => reject(new Error('Ошибка подключения к Discord.')))
			client.login(process.env.TOKEN).catch(() => reject(new Error('Не удалось войти в Discord: проверьте TOKEN и Server Members Intent.')))
		})
		clearTimeout(timer)
		const guild = await client.guilds.fetch(process.env.GUILD_ID)
		await guild.roles.fetch()
		const members = await guild.members.fetch({ time: 30000 })
		const rows = buildPreview(family.items, [...members.values()].map(member => ({
			id: member.id, nickname: member.nickname, bot: member.user.bot,
			roleIds: [...member.roles.cache.keys()]
		})))
		for (const row of rows) {
			if (row.status !== 'change') continue
			const member = members.get(row.discordId)
			const issues = []
			if (row.nickname && (!member.manageable || !guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames))) {
				issues.push('Нет прав или недостаточна иерархия для изменения ника.')
			}
			if (row.addRoles.length || row.removeRoles.length) {
				if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) issues.push('Нет права Manage Roles.')
				for (const id of [...row.addRoles, ...row.removeRoles]) {
					if (!guild.roles.cache.get(id)?.editable) issues.push(`Роль ${id} отсутствует или недоступна боту для изменения.`)
				}
			}
			if (issues.length) {
				row.status = 'blocked'
				row.reason = issues.join(' ')
			}
		}
		const summary: Record<string, number> = {}
		for (const row of rows) summary[row.status] = (summary[row.status] || 0) + 1
		const report = { mode: 'preview', generatedAt: new Date().toISOString(),
			guildId: guild.id, server: process.env.MAJESTIC_SERVER, familyTotal: family.total,
			binding: 'По static из текущего ника; постоянные подтверждённые привязки пока не созданы.',
			summary, rows }
		await fs.writeFile(path.join(root, '.majestic-preview.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
		console.log('Предпросмотр сохранён в .majestic-preview.json. Ники и роли не изменялись.')
		console.log(JSON.stringify(summary, null, 2))
	} finally {
		clearTimeout(timer)
		client.destroy()
	}
}

main().catch(error => {
	// Не печатаем произвольные ошибки Discord: они могут содержать детали запроса.
	const known = /^(Для чтения Discord|Заполните MAJESTIC_|Неверный формат сессии|Проверьте MAJESTIC_|Не удалось выполнить запрос|HTTP \d|Majestic вернул|Неожиданная структура|Неполный состав|Некорректные поля|Таймаут подключения|Ошибка подключения|Не удалось войти)/
	console.error(known.test(error.message) ? error.message : 'Не удалось создать предпросмотр. Проверьте доступ бота к серверу, Server Members Intent, сеть и возможность записи отчёта.')
	process.exitCode = 1
})
