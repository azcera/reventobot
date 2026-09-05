const { TelegramClient } = require('telegram')
const { StringSession } = require('telegram/sessions')
const qrcode = require('qrcode-terminal') // Рисует QR в консоли
const readline = require('readline')

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
})

const promptConsole = query => {
	return new Promise(resolve => {
		console.log(`\n${'='.repeat(60)}`)
		console.log(`❓ ${query}`)
		console.log(`👉 (Кликните в консоль, введите ответ и нажмите Enter)`)
		console.log(`${'='.repeat(60)}\n`)
		rl.question('', answer => {
			resolve(answer.trim())
		})
	})
}

/**
 * Инициализирует и авторизует Telegram клиент
 * @returns {Promise<TelegramClient>} Готовый к работе клиент Telegram
 */
async function initTelegramClient() {
	// Автоматически берем ваши API данные
	const apiId = Number(process.env.TG_API_ID) || 25984937
	const apiHash = process.env.TG_API_HASH || 'ca79edeb3041ffb1ec655fa00de11af1'

	// Валидация сохраненной сессии
	let rawSession = (process.env.TG_SESSION || '')
		.trim()
		.replace(/^["']|["']$/g, '')
	let stringSession
	let isNewSession = false

	// Оставляем проверку только на длину, чтобы не конфликтовать со сменой форматов
	if (!rawSession || rawSession.length < 50) {
		console.log(
			'📝 TG_SESSION не задан или невалиден. Будет запрошен вход по QR-коду.'
		)
		stringSession = new StringSession('')
		isNewSession = true
	} else {
		console.log('✅ Используется сохраненная TG_SESSION.')
		stringSession = new StringSession(rawSession)
	}

	const tgClient = new TelegramClient(stringSession, apiId, apiHash, {
		connectionRetries: 5,
		useWSS: false
	})

	// Подключаемся к серверам Telegram напрямую
	await tgClient.connect()

	// Если сессия новая — запускаем процесс QR-авторизации
	if (isNewSession) {
		console.log('\n⏳ Инициализация входа по QR-коду...\n')

		try {
			// Использованием встроенный в gramJS метод для входа через QR
			await tgClient.signInUserWithQrCode(
				{ apiId, apiHash },
				{
					onError: err => console.error('❌ Ошибка при генерации QR:', err),

					// Функция отрисовки QR в консоли
					qrCode: async qrCodeBuffer => {
						// gramJS в этот метод отдает объект с токеном. Превращаем его в строку ссылки:
						const qrCodeString = `tg://login?token=${qrCodeBuffer.token.toString('base64url')}`

						console.log('\n' + '📱'.repeat(30))
						console.log('ОТКРОЙТЕ TELEGRAM НА ТЕЛЕФОНЕ:')
						console.log(
							'Настройки -> Устройства -> Ссылка на устройство (Link Device)'
						)
						console.log('\n👇 ОТСКАНИРУЙТЕ ЭТОТ QR-КОД КАМЕРОЙ ТЕЛЕФОНА 👇\n')

						// Отрисовка
						qrcode.generate(qrCodeString, { small: true })

						console.log('\n📱'.repeat(30) + '\n')
						console.log(
							'[⏳] Ожидание сканирования... Наведите камеру телефона.'
						)
					},

					// Функция запроса пароля 2FA, если он включен на аккаунте
					password: async () => {
						return await promptConsole(
							'🔒 QR отсканирован! Введите ваш ОБЛАЧНЫЙ ПАРОЛЬ (2FA) для подтверждения входа:'
						)
					}
				}
			)
		} catch (error) {
			console.error('❌ Критическая ошибка при QR авторизации:', error)
			process.exit(1)
		}

		console.log('✅ Успешно подключено к Telegram!')

		// Экспортируем готовую рабочую сессию
		const newSession = tgClient.session.save()
		console.log('\n🔥 🔥 🔥 ВАЖНО: СКОПИРУЙТЕ СТРОКУ НИЖЕ 🔥 🔥 🔥')
		console.log(newSession)
		console.log(
			'🔥 🔥 🔥 И ВСТАВЬТЕ ЕЁ В SECRETS (или .env) КАК TG_SESSION 🔥 🔥 🔥\n'
		)
		console.log(
			'После этого перезапустите бота, и QR-код больше не появится!\n'
		)
	} else {
		console.log('✅ Успешно подключено к Telegram по сохраненной сессии!')
	}

	return tgClient
}

module.exports = { initTelegramClient }
