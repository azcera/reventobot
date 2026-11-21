import type { Api } from '../types'

type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string'
const number = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value)
const boolean = (value: unknown): value is boolean => typeof value === 'boolean'
const array = (value: unknown, valid: (item: unknown) => boolean): boolean =>
	Array.isArray(value) && value.every(valid)
const resource = (value: unknown): boolean =>
	record(value) &&
	text(value.id) &&
	text(value.name) &&
	(value.manageable === undefined || boolean(value.manageable))
const tacticsMap = (value: unknown): boolean =>
	record(value) && text(value.id) && text(value.name) && number(value.width) &&
	number(value.height) && boolean(value.archived)
const field = (value: unknown): boolean =>
	record(value) &&
	text(value.key) &&
	text(value.group) &&
	text(value.label) &&
	text(value.type) &&
	text(value.value)
const settingValue = (value: unknown): boolean =>
	text(value) ||
	boolean(value) ||
	array(
		value,
		entry => record(entry) && text(entry.roleId) && text(entry.prefix)
	)
const setting = (value: unknown): boolean =>
	record(value) &&
	text(value.key) &&
	text(value.label) &&
	text(value.type) &&
	settingValue(value.value)
const history = (value: unknown): boolean =>
	record(value) &&
	(text(value.id) || number(value.id)) &&
	text(value.action) &&
	text(value.actor) &&
	text(value.target) &&
	text(value.created_at) &&
	(value.details === undefined ||
		value.details === null ||
		text(value.details) ||
		record(value.details))
const stringGroups = (value: unknown): boolean =>
	record(value) &&
	Object.values(value).every(
		group => record(group) && Object.values(group).every(text)
	)
const config = (value: unknown): boolean =>
	record(value) &&
	number(value.revision) &&
	array(value.templates, field) &&
	array(value.settings, setting) &&
	(value.bindings === undefined || record(value.bindings)) &&
	(value.templateVariables === undefined ||
		stringGroups(value.templateVariables)) &&
	(value.templateVariableLabels === undefined ||
		stringGroups(value.templateVariableLabels))
const source = (value: unknown): boolean =>
	record(value) &&
	text(value.url) &&
	text(value.channelId) &&
	boolean(value.canEdit) &&
	text(value.revision)
const item = (value: unknown): boolean =>
	record(value) &&
	(value.type === 'separator' ||
		(['text', 'image', 'section'].includes(String(value.type)) &&
			text(value.value)))
const roleCurator = (value: unknown): boolean =>
	record(value) && text(value.roleId) && array(value.managedRoleIds, text)
const row = (value: unknown): boolean =>
	record(value) &&
	text(value.discordId) &&
	text(value.status) &&
	(value.currentNickname === null || text(value.currentNickname))
const majestic = (value: unknown): boolean =>
	record(value) &&
	boolean(value.busy) &&
	boolean(value.configured) &&
	record(value.decisions) &&
	record(value.rankRoles) &&
	(value.preview === null ||
		(record(value.preview) &&
			text(value.preview.id) &&
			number(value.preview.generatedAt) &&
			number(value.preview.familyTotal) &&
			array(value.preview.rows, row) &&
			record(value.preview.summary))) &&
	(value.run === null ||
		(record(value.run) &&
			text(value.run.kind) &&
			text(value.run.status) &&
			number(value.run.completed) &&
			number(value.run.total) &&
			Array.isArray(value.run.results)))

function validResponse(path: string, value: unknown): boolean {
	if (path === 'tactics/maps' || path.startsWith('tactics/maps?'))
		return record(value) && array(value.maps, tacticsMap) && (value.next === null || text(value.next))
	if (path.startsWith('tactics/maps/upload?')) return tacticsMap(value)
	if (path === 'tactics/maps/archive') return record(value) && boolean(value.success)
	if (
		[
			'config',
			'template-variables',
			'templates',
			'templates/create',
			'templates/delete',
			'settings',
			'permanent-message',
			'permanent-message/publish',
			'permanent-message/sync',
			'navigation/sync'
		].includes(path)
	)
		return config(value)
	if (path.startsWith('channel-threads/'))
		return array(
			value,
			channel => resource(channel) && record(channel) && number(channel.type)
		)
	if (path === 'resources')
		return (
			record(value) &&
			array(value.roles, resource) &&
			array(
				value.channels,
				channel => resource(channel) && record(channel) && number(channel.type)
			)
		)
	if (path === 'session')
		return (
			record(value) &&
			text(value.csrf) &&
			resource(value.guild) &&
			resource(value.user)
		)
	if (path === 'history' || path.startsWith('history?'))
		return array(value, history)
	if (path === 'overview')
		return (
			record(value) &&
			boolean(value.ready) &&
			number(value.ping) &&
			number(value.uptime) &&
			boolean(value.database) &&
			array(value.history, history)
		)
	if (path === 'role-curators')
		return (
			record(value) &&
			number(value.revision) &&
			array(value.curators, roleCurator)
		)
	if (path === 'capture-presets')
		return (
			record(value) &&
			number(value.revision) &&
			array(
				value.presets,
				item =>
					record(item) &&
					['id', 'command', 'target', 'channelId', 'accessRoleId'].every(key =>
						text(item[key])
					) &&
					number(item.maxMain)
			)
		)
	if (path === 'majestic' || path.startsWith('majestic/'))
		return majestic(value)
	if (path.startsWith('container-message?'))
		return record(value) && array(value.items, item) && source(value.source)
	if (path === 'capture-ranking')
		return record(value) && boolean(value.ready) && array(value.players, player =>
			record(player) && text(player.staticId) && text(player.name) &&
			(player.averageKills === null || number(player.averageKills)) &&
			['position', 'captures', 'damage', 'mvp'].every(key => number(player[key]))
		)
	if (path === 'capture-ranking/captures')
		return record(value) && boolean(value.ready) && array(value.captures, capture =>
			record(capture) && text(capture.key) && number(capture.at) &&
			text(capture.enemy) && boolean(capture.attack) && text(capture.result) &&
			boolean(capture.included) && array(capture.players, player =>
				record(player) && text(player.name) && text(player.staticId) &&
				number(player.mvp) && (player.kills === null || number(player.kills)) &&
				(player.deaths == null || number(player.deaths)) &&
				(player.damage === null || number(player.damage))
			)
		)
	if (path === 'capture-ranking/mitsuki')
		return record(value) && boolean(value.ready) && array(value.players, player =>
			record(player) && text(player.key) && text(player.name) &&
			(player.staticId === null || text(player.staticId)) &&
			(player.rating === null || number(player.rating)) &&
			['position', 'captures', 'avgDamage', 'avgKills', 'winrate'].every(key => number(player[key]))
		)
	if (path === 'role-prefixes/sync')
		return (
			record(value) &&
			['updated', 'unchanged', 'skipped', 'failed'].every(key =>
				number(value[key])
			)
		)
	if (path === 'edit-container')
		return record(value) && boolean(value.success) && source(value.source)
	if (path === 'send-container' || path === 'logout')
		return record(value) && boolean(value.success)
	return false
}

/** JSON enters as unknown; route-specific checks precede the typed API boundary. */
export function createApi(csrf: () => string, unauthorized: () => void): Api {
	const request = async (path: string, body?: unknown): Promise<unknown> => {
		const mutation = body !== undefined
		const signal = AbortSignal.timeout(mutation ? 45000 : 15000)
		const timeoutError = () =>
			new Error(
				mutation
					? 'Сервер не подтвердил результат. Проверьте, применилось ли изменение, перед повторной отправкой.'
					: 'Сервер не ответил вовремя. Повторите загрузку.'
			)
		let response: Response
		try {
			response = await fetch('/api/' + path, {
				signal,
				credentials: 'same-origin',
				...(body === undefined
					? {}
					: {
							method: 'POST',
							headers: {
								'Content-Type': body instanceof Blob ? 'application/octet-stream' : 'application/json',
								'X-CSRF-Token': csrf()
							},
							body: body instanceof Blob ? body : JSON.stringify(body)
						})
			})
		} catch {
			if (signal.aborted || mutation) throw timeoutError()
			throw new Error(
				'Не удалось связаться с сервером. Проверьте подключение и повторите загрузку.'
			)
		}
		let result: unknown
		try {
			result = await response.json()
		} catch {
			if (signal.aborted || mutation) throw timeoutError()
			throw new Error(
				'Сервер вернул неожиданный ответ. Повтори действие позже.'
			)
		}
		if (!response.ok) {
			if (response.status === 401) unauthorized()
			throw Object.assign(
				new Error(
					record(result) && text(result.error)
						? result.error
						: 'Не удалось выполнить запрос.'
				),
				{ status: response.status }
			)
		}
		if (!validResponse(path, result))
			throw new Error(
				'Сервер вернул неожиданный ответ. Повтори действие позже.'
			)
		return result
	}
	return request as Api
}

export async function readAuthStatus(
	response: Response
): Promise<{ configured: boolean }> {
	const value: unknown = await response.json()
	if (!record(value) || !boolean(value.configured))
		throw new Error('Сервер вернул неожиданный ответ. Повтори действие позже.')
	return { configured: value.configured }
}
