function readConfig(env) {
	const sessionId = env.MAJESTIC_SESSION_ID?.trim()
	const server = env.MAJESTIC_SERVER?.trim()
	const characterId = env.MAJESTIC_CHARACTER_ID?.trim()
	if (!sessionId) {
		throw new Error('Заполните MAJESTIC_SESSION_ID в .env.majestic.local или окружении бота.')
	}
	if (/[;\s\x00-\x1f\x7f]/.test(sessionId)) {
		throw new Error('Неверный формат сессии: скопируйте только значения, без названий заголовков.')
	}
	if (!/^RU\d+$/.test(server || '') || !/^\d+$/.test(characterId || '')) {
		throw new Error('Проверьте MAJESTIC_SERVER и MAJESTIC_CHARACTER_ID.')
	}
	return { sessionId, server, characterId }
}

async function fetchMembers(config, fetchImpl = fetch) {
	const url = `https://api.majestic-files.net/id/${config.server}/${config.characterId}/family/members`
	let response
	try {
		response = await fetchImpl(url, {
			method: 'GET',
			redirect: 'error',
			signal: AbortSignal.timeout(20000),
			headers: {
				Accept: 'application/json',
				Origin: 'https://id.majestic-rp.ru',
				Referer: 'https://id.majestic-rp.ru/',
				selectedLanguage: 'ru',
				Cookie: `sessionId=${config.sessionId}`,
				'x-session': config.sessionId
			}
		})
	} catch {
		throw new Error('Не удалось выполнить запрос: проверьте сеть и доступность Majestic (таймаут 20 секунд).')
	}
	if (response.status === 401 || response.status === 403) {
		throw new Error(`HTTP ${response.status}: доступ отклонён. Проверьте актуальность сессии; возможна защита сайта.`)
	}
	if (!response.ok) throw new Error(`Majestic вернул HTTP ${response.status}.`)
	let data
	try {
		data = await response.json()
	} catch {
		throw new Error('Majestic вернул ответ, который не является JSON.')
	}
	const result = data?.result
	if (data?.code !== 200 || data?.status !== true || !Array.isArray(result?.items) ||
		!Number.isInteger(result.total) || result.total < 0) {
		throw new Error('Неожиданная структура ответа Majestic или ошибка API.')
	}
	const items = result.items
	if (items.length !== result.total) {
		throw new Error(`Неполный состав: получено ${items.length} из ${result.total}. Требуется проверить пагинацию.`)
	}
	if (items.some(item => !item || !Number.isSafeInteger(item.id) || item.id <= 0 ||
		typeof item.login !== 'string' || !item.login.trim() ||
		!Number.isSafeInteger(item.rankId) || typeof item.rankName !== 'string') ||
		new Set(items.map(item => item.id)).size !== items.length) {
		throw new Error('Некорректные поля участников или повторяющиеся static в ответе Majestic.')
	}
	return { total: result.total, items }
}

async function checkMembers(config, fetchImpl = fetch) {
	const { total, items } = await fetchMembers(config, fetchImpl)
	return {
		total,
		examples: items.slice(0, 3).map(item => ({
			static: item.id,
			name: item.login.trim().split(/\s+/)[0],
			rank: item.rankName.trim()
		}))
	}
}

module.exports = { readConfig, fetchMembers, checkMembers }
