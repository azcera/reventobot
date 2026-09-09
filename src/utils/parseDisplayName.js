/**
 * Разбивает никнейм пользователя на Name и Static
 * @param {string} memberNickname
 * @returns {{memberName: string, memberStatic: string} | null}
 */
function parseDisplayName(memberNickname) {
	if (!memberNickname || !memberNickname.includes('|')) {
		return null
	}

	const parts = memberNickname.split('|')
	let memberName = parts[0].trim()
	let memberStatic = parts[1].trim()

	// memberStatic — строго только цифры
	if (!/^\d+$/.test(memberStatic)) {
		return null
	}

	// Убираем префикс вида [что угодно] (включая юникод)
	memberName = memberName.replace(/^\[.*?\]\s*/, '').trim()

	// memberName: только латиница + опционально " / " между словами
	const nameRegex = /^[A-Za-z]+(?:\s*\/\s*[A-Za-z]+)*$/
	if (!nameRegex.test(memberName)) {
		return null
	}

	// Нормализуем пробелы вокруг /
	memberName = memberName.replace(/\s*\/\s*/g, ' / ')

	return { memberName, memberStatic }
}

module.exports = { parseDisplayName }
