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
	let memberStaticRaw = parts[1].trim() // Здесь сейчас "289229 / inactive"

	// Извлекаем только первые цифры из правой части (до пробела или слэша)
	const staticMatch = memberStaticRaw.match(/^(\d+)/)
	if (!staticMatch) {
		return null
	}
	const memberStatic = staticMatch[1]

	// Убираем префикс вида [что угодно] (включая юникод)
	memberName = memberName.replace(/^\[.*?\]\s*/, '').trim()

	// Разрешаем латиницу, символ @ и опционально " / " между словами
	const nameRegex = /^[A-Za-z]+(?:\s*\/\s*[@A-Za-z]+)*$/
	if (!nameRegex.test(memberName)) {
		return null
	}

	// Нормализуем пробелы вокруг /
	memberName = memberName.replace(/\s*\/\s*/g, ' / ')

	return { memberName, memberStatic }
}

module.exports = { parseDisplayName }
