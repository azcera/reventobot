/**
 * Разбивает никнейм пользователя на Name и Static
 * @param {string} memberNickname
 * @returns {{memberName: string, memberStatic: string} | null}
 */
import { store } from '../dashboard/store'
import { stripRolePrefix } from './adminPrefix'

function parseDisplayName(memberNickname: string, rolePrefixes = store.getSetting('ROLE_PREFIXES')) {
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
	memberName = stripRolePrefix(memberName, rolePrefixes)

	// Разрешаем латиницу, символ @ и опционально " / " между словами
	const nameRegex = /^[A-Za-z]+(?:\s*\/\s*[@A-Za-z]+)*$/
	if (!nameRegex.test(memberName)) {
		return null
	}

	// Нормализуем пробелы вокруг /
	memberName = memberName.replace(/\s*\/\s*/g, ' / ')

	return { memberName, memberStatic }
}

export { parseDisplayName }
