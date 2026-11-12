import type { Api } from '../types'

type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string'
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const boolean = (value: unknown): value is boolean => typeof value === 'boolean'
const array = (value: unknown, valid: (item: unknown) => boolean): boolean => Array.isArray(value) && value.every(valid)
const resource = (value: unknown): boolean => record(value) && text(value.id) && text(value.name)
const field = (value: unknown): boolean => record(value) && text(value.key) && text(value.group) && text(value.label) && text(value.type) && text(value.value)
const settingValue = (value: unknown): boolean => text(value) || boolean(value) || array(value, entry => record(entry) && text(entry.roleId) && text(entry.prefix))
const setting = (value: unknown): boolean => record(value) && text(value.key) && text(value.label) && text(value.type) && settingValue(value.value)
const history = (value: unknown): boolean => record(value) && (text(value.id) || number(value.id)) && text(value.action) && text(value.actor) && text(value.target) && text(value.created_at) && (value.details === undefined || value.details === null || text(value.details) || record(value.details))
const config = (value: unknown): boolean => record(value) && number(value.revision) && array(value.templates, field) && array(value.settings, setting) && (value.bindings === undefined || record(value.bindings))
const source = (value: unknown): boolean => record(value) && text(value.url) && text(value.channelId) && boolean(value.canEdit) && text(value.revision)
const item = (value: unknown): boolean => record(value) && (value.type === 'separator' || ['text', 'image', 'section'].includes(String(value.type)) && text(value.value))
const mclList = (value: unknown): boolean => record(value) && ['id', 'title', 'channelId', 'roleId', 'addName', 'removeName'].every(key => text(value[key])) && (value.accessRoleId === undefined || text(value.accessRoleId))
const row = (value: unknown): boolean => record(value) && text(value.discordId) && text(value.status) && (value.currentNickname === null || text(value.currentNickname))
const majestic = (value: unknown): boolean => record(value) && boolean(value.busy) && boolean(value.configured) && record(value.decisions) && record(value.rankRoles) && (value.preview === null || record(value.preview) && text(value.preview.id) && number(value.preview.generatedAt) && number(value.preview.familyTotal) && array(value.preview.rows, row) && record(value.preview.summary)) && (value.run === null || record(value.run) && text(value.run.kind) && text(value.run.status) && number(value.run.completed) && number(value.run.total) && Array.isArray(value.run.results))

function validResponse(path: string, value: unknown): boolean {
  if (['config', 'templates', 'templates/create', 'templates/delete', 'settings', 'permanent-message', 'permanent-message/publish', 'permanent-message/sync', 'navigation/sync'].includes(path)) return config(value)
  if (path === 'resources') return record(value) && array(value.roles, resource) && array(value.channels, channel => resource(channel) && record(channel) && number(channel.type))
  if (path === 'session') return record(value) && text(value.csrf) && resource(value.guild) && resource(value.user)
  if (path === 'history') return array(value, history)
  if (path === 'overview') return record(value) && boolean(value.ready) && number(value.ping) && number(value.uptime) && boolean(value.database) && array(value.history, history)
  if (path === 'mcl-lists') return record(value) && number(value.revision) && array(value.lists, mclList)
  if (path === 'capture-presets') return record(value) && number(value.revision) && array(value.presets, item => record(item) && ['id', 'command', 'target', 'channelId', 'accessRoleId'].every(key => text(item[key])) && number(item.maxMain))
  if (path === 'majestic' || path.startsWith('majestic/')) return majestic(value)
  if (path.startsWith('container-message?')) return record(value) && array(value.items, item) && source(value.source)
  if (path === 'role-prefixes/sync') return record(value) && ['updated', 'unchanged', 'skipped', 'failed'].every(key => number(value[key]))
  if (path === 'edit-container') return record(value) && boolean(value.success) && source(value.source)
  if (path === 'send-container' || path === 'logout') return record(value) && boolean(value.success)
  return false
}

/** JSON enters as unknown; route-specific checks precede the typed API boundary. */
export function createApi(csrf: () => string, unauthorized: () => void): Api {
  const request = async (path: string, body?: unknown): Promise<unknown> => {
    let response: Response
    try {
      response = await fetch('/api/' + path, { credentials: 'same-origin', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() }, body: JSON.stringify(body) }) })
    } catch { throw new Error('Не удалось связаться с сервером. Проверь подключение и повтори действие. Черновики остаются в редакторе.') }
    let result: unknown
    try { result = await response.json() } catch { throw new Error('Сервер вернул неожиданный ответ. Повтори действие позже.') }
    if (!response.ok) {
      if (response.status === 401) unauthorized()
      throw Object.assign(new Error(record(result) && text(result.error) ? result.error : 'Не удалось выполнить запрос.'), { status: response.status })
    }
    if (!validResponse(path, result)) throw new Error('Сервер вернул неожиданный ответ. Повтори действие позже.')
    return result
  }
  return request as Api
}

export async function readAuthStatus(response: Response): Promise<{ configured: boolean }> {
  const value: unknown = await response.json()
  if (!record(value) || !boolean(value.configured)) throw new Error('Сервер вернул неожиданный ответ. Повтори действие позже.')
  return { configured: value.configured }
}
