function parseDateTime(inputString) {
	const dateTimeRegex = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/
	const timeOnlyRegex = /^(\d{2}):(\d{2})$/

	let year, month, day, hours, minutes

	if (dateTimeRegex.test(inputString)) {
		const [, dd, mm, yyyy, hh, min] = inputString.match(dateTimeRegex)
		year = parseInt(yyyy)
		month = parseInt(mm) - 1
		day = parseInt(dd)
		hours = parseInt(hh)
		minutes = parseInt(min)
	} else if (timeOnlyRegex.test(inputString)) {
		const [, hh, min] = inputString.match(timeOnlyRegex)

		const mskDateStr = new Date().toLocaleDateString('ru-RU', {
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

	const utcTimestamp = Date.UTC(year, month, day, hours, minutes, 0)

	const targetDate = new Date(utcTimestamp - 3 * 60 * 60 * 1000)

	if (isNaN(targetDate.getTime())) {
		return null
	}

	return targetDate
}

function getMskTimeString(parsedDate, offsetSeconds = 0) {
	const targetDate = new Date(parsedDate.getTime() + offsetSeconds * 1000)

	return targetDate.toLocaleTimeString('ru-RU', {
		timeZone: 'Europe/Moscow',
		hour: '2-digit',
		minute: '2-digit'
	})
}

function getDiscordTimestamp(parsedDate) {
	if (!parsedDate || isNaN(parsedDate.getTime())) return 'Неизвестное время'

	const finalTimestampSeconds = Math.floor(parsedDate.getTime() / 1000)

	return `<t:${finalTimestampSeconds}:t>`
}

module.exports = { parseDateTime, getMskTimeString, getDiscordTimestamp }
