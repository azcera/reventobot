/**
 * Разбивает никнейм пользователя на Name и Static
 * @param {string} memberNickname
 * @returns {{memberName: string, memberStatic: string} | null}
 */
function parseDisplayName(memberNickname) {
	if (!memberNickname || !memberNickname.includes('|')) {
		return null
	}

	// Берём только первые два куска (после второго | может быть "inactive" и т.п.)
	const parts = memberNickname.split('|')
	let memberName = parts[0].trim()
	let memberStatic = parts[1].trim()

	// memberStatic должен быть строго числом
	if (!/^\d+$/.test(memberStatic)) {
		return null
	}

	// memberName:
	// - только латиница, "/" и пробелы сразу слева/справа от "/"
	// - обычные пробелы без "/" — запрещены
	// - цифры, кириллица, спецсимволы — запрещены
	const nameRegex = /^[A-Za-z]+(?:\s*\/\s*[A-Za-z]+)*$/
	if (!nameRegex.test(memberName)) {
		return null
	}

	// Нормализуем пробелы вокруг /
	memberName = memberName.replace(/\s*\/\s*/g, ' / ')

	return { memberName, memberStatic }
}

module.exports = { parseDisplayName }
