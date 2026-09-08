/**
 * Разбивает никнейм пользователя на Name и Static
 * @param {string} memberNickname
 * @returns {{memberName: string, memberStatic: string} | null}
 */
function parseDisplayName(memberNickname) {
	if (!memberNickname || !memberNickname.includes('|')) {
		return null
	}

	let [memberName, memberStatic] = memberNickname.split('|')

	memberStatic = memberStatic.trim()
	memberName = memberName.replace(/^\[.*\]\s+/g, '').trim()

	// Дополнительная защита: если после split что-то пустое
	if (!memberName || !memberStatic) {
		return null
	}

	return { memberName, memberStatic }
}

module.exports = { parseDisplayName }
