import { DiscordSDK } from '@discord/embedded-app-sdk'
import type { ClientMessage, ServerMessage } from '../../../shared/tactics'

function activityUrl(path: string) {
	return new URL(path, window.location.href)
}

async function checked(response: Response) {
	if (response.ok) return response
	const result = await response.json().catch(() => null)
	throw new Error(result?.error ?? 'Не удалось получить данные доски.')
}

export function connectActivity(
	onMessage: (message: ServerMessage) => void,
	onStatus: (status: string, connected: boolean) => void
) {
	let socket: WebSocket | undefined
	let sdk: DiscordSDK | undefined
	let sessionToken = ''
	let stopped = false
	let starting = false
	let reconnect: number | undefined
	let attempt = 0

	async function start() {
		if (starting || socket || stopped) return
		clearTimeout(reconnect)
		starting = true
		onStatus('Подключение к Discord…', false)
		try {
			if (!sessionToken) {
				if (!sdk) {
					const config = await checked(await fetch(activityUrl('./api/config'), { signal: AbortSignal.timeout(10000) }))
					const { appId } = await config.json()
					if (stopped) return
					sdk = new DiscordSDK(appId, { disableConsoleLogOverride: true })
					await sdk.ready()
				}
				if (!sdk.guildId || !sdk.channelId) throw new Error('Запустите доску в голосовом канале сервера.')
				const { code } = await sdk.commands.authorize({
					client_id: sdk.clientId, response_type: 'code', state: '', prompt: 'none', scope: ['identify']
				})
				const tokenResponse = await checked(await fetch(activityUrl('./api/token'), {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ code }),
					signal: AbortSignal.timeout(12000)
				}))
				const { accessToken } = await tokenResponse.json()
				await sdk.commands.authenticate({ access_token: accessToken })
				const session = await checked(await fetch(activityUrl('./api/session'), {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
					body: JSON.stringify({ instanceId: sdk.instanceId }),
					signal: AbortSignal.timeout(27000)
				}))
				const { sessionToken: token } = await session.json()
				sessionToken = token
			}
			if (stopped) return
			const url = activityUrl('./socket')
			url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
			const peer = new WebSocket(url)
			socket = peer
			const timeout = window.setTimeout(() => peer.close(), 12000)
			peer.onopen = () => peer.send(JSON.stringify({ type: 'auth', token: sessionToken, version: 2 }))
			peer.onmessage = event => {
				const message = JSON.parse(event.data) as ServerMessage
				if (message.type === 'snapshot') {
					clearTimeout(timeout)
					attempt = 0
					onStatus('', true)
				}
				onMessage(message)
			}
			peer.onclose = event => {
				clearTimeout(timeout)
				socket = undefined
				if (stopped) return
				if (event.code === 4001) sessionToken = ''
				onStatus('Связь с доской прервана. Переподключение…', false)
				reconnect = window.setTimeout(start, Math.min(1000 * 2 ** attempt++, 15000))
			}
		} catch (error) {
			if (!stopped) onStatus(error instanceof Error ? error.message : 'Не удалось подключиться.', false)
		} finally {
			starting = false
		}
	}

	return {
		start,
		send(message: ClientMessage) {
			if (socket?.readyState !== WebSocket.OPEN) return false
			socket.send(JSON.stringify(message))
			return true
		},
		async get(path: string, signal?: AbortSignal) {
			return checked(await fetch(activityUrl(`./api/${path}`), {
				headers: { Authorization: `Bearer ${sessionToken}` },
				signal: signal ?? AbortSignal.timeout(10000)
			}))
		},
		stop() {
			stopped = true
			clearTimeout(reconnect)
			socket?.close()
			sdk?.close(1000, 'Closed')
		}
	}
}
