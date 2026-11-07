const { MessageFlags } = require('discord.js')
const { store } = require('./store')

const groups = { rules: 'Правила', promotion: 'Система повышения', recruit: 'Памятка рекрута' }

function linesOf(message) {
	const lines = []
	if (message.content) lines.push(...message.content.split('\n'))
	function walk(components) {
		for (const source of components || []) {
			const item = source.toJSON ? source.toJSON() : source
			if (item.content) lines.push(...item.content.split('\n'))
			if (item.label) lines.push('Кнопка: ' + item.label)
			if (item.url) lines.push('Ссылка: ' + item.url)
			for (const image of item.items || []) lines.push('Изображение: ' + image.media?.url)
			walk(item.components)
			if (item.accessory) walk([item.accessory])
		}
	}
	walk(message.components)
	return lines
}

// LCS keeps separate edits separate; omit unchanged regions except one context line.
function diffLines(before, after) {
	if (JSON.stringify(before) === JSON.stringify(after)) return ''
	let prefix = 0
	while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
	let endA = before.length, endB = after.length
	while (endA > prefix && endB > prefix && before[endA - 1] === after[endB - 1]) { endA--; endB-- }
	const a = before.slice(prefix, endA), b = after.slice(prefix, endB)
	const edits = []
	if (prefix) edits.push(' ' + before[prefix - 1])
	if (a.length * b.length > 1000000) {
		edits.push(...a.map(line => '-' + line), ...b.map(line => '+' + line))
	} else {
		const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
		for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
			table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
		let i = 0, j = 0
		while (i < a.length || j < b.length) {
			if (i < a.length && j < b.length && a[i] === b[j]) { edits.push(' ' + a[i]); i++; j++ }
			else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) edits.push('-' + a[i++])
			else edits.push('+' + b[j++])
		}
	}
	if (endA < before.length) edits.push(' ' + before[endA])
	const visible = []
	for (let i = 0; i < edits.length; i++) {
		if (edits[i][0] !== ' ' || edits[i - 1]?.[0] !== ' ' || edits[i + 1]?.[0] !== ' ') visible.push(edits[i])
		else if (visible.at(-1) !== ' …') visible.push(' …')
	}
	return visible.join('\n')
}

async function logMessageChange({ guild, actor, link, before, after, kind }) {
	kind ||= Object.entries(store.bindings).find(([, binding]) => binding.link === link)?.[0]
	if (!groups[kind]) return {}
	const diff = diffLines(before, after)
	if (!diff) return {}
	const details = { kind, diff, actorName: actor?.name, outcome: 'Сообщение обновлено в Discord' }
	try {
		const channelId = store.getSetting('CHANGELOG_CHANNEL_ID')
		if (!channelId) throw new Error('Выберите канал журнала изменений в настройках дашборда')
		const channel = await guild.channels.fetch(channelId)
		if (!channel?.send) throw new Error('Канал журнала недоступен')
		// Reserve space for metadata and fences, and escape embedded code fences.
		const safe = diff.replace(/```/g, '``\u200b`')
		const chunks = []
		let chunk = ''
		for (const line of safe.split('\n')) {
			let remaining = line
			while (remaining.length > 2400) {
				if (chunk) { chunks.push(chunk); chunk = '' }
				chunks.push(remaining.slice(0, 2400))
				remaining = line[0] + remaining.slice(2400)
			}
			if (chunk.length + remaining.length + 1 > 2500) { chunks.push(chunk); chunk = '' }
			chunk += (chunk ? '\n' : '') + remaining
		}
		if (chunk) chunks.push(chunk)
		const clean = value => String(value || '').replace(/[`*_~<>@\n\r]/g, '').slice(0, 100)
		for (const [index, chunk] of chunks.entries()) {
			const text = content => ({ type: 10, content })
			const separator = { type: 14, divider: true, spacing: 1 }
			await channel.send({ flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] }, components: [{
				type: 17, components: [
					text(`### 📝 ${groups[kind]} — изменения${chunks.length > 1 ? ` · ${index + 1}/${chunks.length}` : ''}\n**Редактор:** ${clean(actor?.name) || 'Бот'} · Discord ID: ${clean(actor?.id || actor)}\n**Время:** <t:${Math.floor(Date.now() / 1000)}:F>`),
					separator, text('```diff\n' + chunk + '\n```'), separator,
					text(`**Результат:** сообщение обновлено\n[Открыть сообщение](${link})`)
				]
			}] })
		}
		details.logSent = true
	} catch (error) {
		details.logError = 'Не удалось отправить журнал: ' + error.message
		console.error('[Dashboard changelog]', error.message)
	}
	await store.audit(actor || 'bot', 'message.change', link, details)
		.catch(error => console.error('[Dashboard audit]', error.message))
	return details.logError ? { logError: details.logError } : {}
}

module.exports = { linesOf, diffLines, logMessageChange }
