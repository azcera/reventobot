/**
 * Разбивает никнейм пользователя на Name и Static
 * @returns {{memberName: string, memberStatic: string}}
 * @param {string} memberNickname
 */
function parseDisplayName(memberNickname) {
	if (!memberNickname.includes('|')) {
		throw new Error('❌ Переданный никнейм имеет неверный формат')
	}

	let [memberName, memberStatic] = memberNickname.split('|')

	memberStatic = memberStatic.trim()
	memberName = memberName.replace(/^\[.*\]\s+/g, '').trim()

	return { memberName, memberStatic }
}

module.exports = { parseDisplayName }
