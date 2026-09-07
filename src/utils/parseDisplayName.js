/**
 * Разбивает никнейм пользователя на Name и Static
 * @returns {{memberName: string, memberStatic: string}}
 * @param {string} memberNickname
 */
function parseDisplayName(memberNickname) {
	if (!memberName.includes('|')) {
		throw new Error('❌ Переданный никнейм имеет неверный формат')
	}

	let [memberName, memberStatic] = memberName.split('|')

	static = static.trim()
	name = name.replace(/^\[.*\]\s+/g, '').trim()

	return { memberName, memberStatic }
}

module.exports = { parseDisplayName }
