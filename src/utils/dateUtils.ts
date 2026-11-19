/**
 * Парсит «ЧЧ:ММ» или «ДД.ММ.ГГГГ ЧЧ:ММ» в Date (с учётом МСК → UTC).
 * @param {string} inputString
 * @returns {Date|null}
 */
function parseDateTime(inputString: string, now = Date.now()) {
	const dateTimeRegex = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/
	const timeOnlyRegex = /^(\d{2}):(\d{2})$/

	let year, month, day, hours, minutes

	if (dateTimeRegex.test(inputString)) {
		const [, dd, mm, yyyy, hh, min] = inputString.match(dateTimeRegex)!
		year = parseInt(yyyy)
		month = parseInt(mm) - 1
		day = parseInt(dd)
		hours = parseInt(hh)
		minutes = parseInt(min)
	} else if (timeOnlyRegex.test(inputString)) {
		const [, hh, min] = inputString.match(timeOnlyRegex)!

		const mskDateStr = new Date(now).toLocaleDateString('ru-RU', {
			timeZone: 'Europe/Moscow'
		})
		const [dd, mm, yyyy] = mskDateStr.split('.')

		year = parseInt(yyyy)
		month = parseInt(mm) - 1
		day = parseInt(dd)
		hours = parseInt(hh)
		minutes = parseInt(min)
	} else {
		return null
	}

	if (
		year < 1 ||
		month < 0 ||
		month > 11 ||
		day < 1 ||
		day > 31 ||
		hours > 23 ||
		minutes > 59
	)
		return null
	const local = new Date(0)
	local.setUTCFullYear(year, month, day)
	local.setUTCHours(hours, minutes)
	if (local.getUTCMonth() !== month || local.getUTCDate() !== day) return null
	return new Date(local.getTime() - 3 * 60 * 60 * 1000)
}

/**
 * Возвращает строку времени МСК с опциональным offset в секундах.
 * @param {Date} parsedDate
 * @param {number} [offsetSeconds=0]
 * @returns {string}
 */
function getMskTimeString(parsedDate: Date, offsetSeconds: number = 0) {
	const targetDate = new Date(parsedDate.getTime() + offsetSeconds * 1000)

	return targetDate.toLocaleTimeString('ru-RU', {
		timeZone: 'Europe/Moscow',
		hour: '2-digit',
		minute: '2-digit'
	})
}

/**
 * Возвращает Discord-timestamp `<t:...:t>`.
 * @param {Date} parsedDate
 * @returns {string}
 */
function getDiscordTimestamp(parsedDate: Date) {
	if (!parsedDate || isNaN(parsedDate.getTime())) return 'Неизвестное время'

	const finalTimestampSeconds = Math.floor(parsedDate.getTime() / 1000)

	return `<t:${finalTimestampSeconds}:t>`
}

export { getDiscordTimestamp, getMskTimeString, parseDateTime }
