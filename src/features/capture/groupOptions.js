const { StringSelectMenuOptionBuilder } = require('discord.js')

const optionsMap = {
	drop1: { icon: '🎈', target: 'ДРОП', time: '00:00' },
	drop2: { icon: '🎈', target: 'ДРОП', time: '04:00' },
	drop3: { icon: '🎈', target: 'ДРОП', time: '08:00' },
	drop4: { icon: '🎈', target: 'ДРОП', time: '12:00' },
	drop5: { icon: '🎈', target: 'ДРОП', time: '16:00' },
	drop6: { icon: '🎈', target: 'ДРОП', time: '20:00' },
	dillers1: { icon: '💊', target: 'ДИЛЕРЫ', time: '10:45' },
	dillers2: { icon: '💊', target: 'ДИЛЕРЫ', time: '18:45' },
	ceha1: { icon: '🚛', target: 'ЦЕХА', time: '14:45' },
	ceha2: { icon: '🚛', target: 'ЦЕХА', time: '22:45' },
	tainiki1: { icon: '🪙', target: 'ТАЙНИКИ', time: '02:00' },
	tainiki2: { icon: '🪙', target: 'ТАЙНИКИ', time: '06:00' },
	tainiki3: { icon: '🪙', target: 'ТАЙНИКИ', time: '10:00' },
	tainiki4: { icon: '🪙', target: 'ТАЙНИКИ', time: '14:00' },
	tainiki5: { icon: '🪙', target: 'ТАЙНИКИ', time: '18:00' },
	tainiki6: { icon: '🪙', target: 'ТАЙНИКИ', time: '22:00' }
}

/**
 * Возвращает 3 ближайших события из optionsMap + опцию «other».
 * Считает относительно текущего времени МСК.
 * @returns {StringSelectMenuOptionBuilder[]}
 */
function getFilteredOptions() {
	const nowMSK = new Date(
		new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' })
	)

	const futureEvents = []

	for (const key in optionsMap) {
		const item = optionsMap[key]
		const [hours, minutes] = item.time.split(':').map(Number)

		const eventDate = new Date(nowMSK)
		eventDate.setHours(hours, minutes, 0, 0)

		if (eventDate <= nowMSK) {
			eventDate.setDate(eventDate.getDate() + 1)
		}

		futureEvents.push({
			key,
			item,
			diff: eventDate - nowMSK
		})
	}

	const nearestEvents = futureEvents.sort((a, b) => a.diff - b.diff).slice(0, 3)

	let options = nearestEvents.map(({ key, item }) => {
		return new StringSelectMenuOptionBuilder()
			.setLabel(`${item.icon} ${item.target} ${item.time}`)
			.setValue(key)
	})

	options.push(
		new StringSelectMenuOptionBuilder().setLabel('ДРУГОЕ').setValue('other')
	)

	return options
}

module.exports = { getFilteredOptions, optionsMap }
