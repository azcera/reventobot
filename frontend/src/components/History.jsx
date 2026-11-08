import React from 'react'
import { ArrowUpRight, FileClock, ScanText } from 'lucide-react'
import { Empty, IconButton, useModal } from './ui.jsx'
import { permanentGroups } from '../lib/templates.mjs'

const actions = { templates: 'Обновление шаблона', settings: 'Обновление настроек', bindings: 'Привязка сообщения', 'message.edit': 'Сообщение изменено', 'message.edit.request': 'Запрос изменения', 'container.send': 'Публикация контейнера', 'container.send.request': 'Запрос публикации', 'container.edit': 'Контейнер изменён', 'container.edit.request': 'Запрос изменения контейнера', 'message.change': 'Изменение сообщения', 'message.sync': 'Обновление в Discord', 'message.sync.request': 'Запрос обновления в Discord', 'role-prefixes.sync': 'Обновление префиксов' }
const format = value => typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? 'Не задано')

export function HistoryRows({ entries, config, compact = false }) {
	const modal = useModal()
	const label = key => permanentGroups[key] || config.templates.find(field => field.key === key)?.label || config.settings.find(field => field.key === key)?.label || key
	if (!entries.length) return <Empty icon={FileClock} title="Изменений пока нет">Здесь появятся действия администраторов.</Empty>
	return <div className="divide-y divide-line">
		{entries.map(entry => {
			let details = entry.details
			try { if (typeof details === 'string') details = JSON.parse(details) } catch { details = { error: 'Не удалось прочитать подробности записи.' } }
			details ||= {}
			const failed = entry.action.endsWith('.failed') || details.error
			const title = entry.action.endsWith('.failed') ? 'Не удалось выполнить действие' : actions[entry.action] || entry.action
			const fields = { ...(Array.isArray(details.fields) ? {} : details.fields || {}) }
			for (const [key, after] of Object.entries(details.changes || {})) fields[key] = { label: label(key), before: details.before?.[key], after }
			const link = /^https:\/\/discord.com\/channels\/\d+\/\d+\/\d+$/.test(entry.target)
			return <article key={entry.id} className="history-row">
				<div className={`history-mark ${failed ? 'text-danger' : 'text-brand'}`}><FileClock aria-hidden="true" /></div>
				<div className="min-w-0 flex-1"><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 break-words text-xs text-muted">{details.actorName || 'Имя не сохранено'}{!compact && ` · Discord ID: ${entry.actor}`}</p><p className="mt-1 break-words text-xs text-muted">{link ? 'Сообщение в Discord' : String(entry.target || '').split(', ').map(label).join(', ')}</p></div>
				<div className="flex flex-wrap items-center justify-end gap-2"><time dateTime={entry.created_at} className="text-[11px] tabular-nums text-muted">{new Date(entry.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' })}</time>
					{link && <a href={entry.target} target="_blank" rel="noopener noreferrer" className="icon-button" aria-label="Открыть сообщение в Discord" title="Открыть сообщение в Discord"><ArrowUpRight aria-hidden="true" /></a>}
					<IconButton icon={ScanText} label="Подробности изменения" onClick={() => modal({ title, content: <div className="mt-4 grid gap-4 text-sm">
						<p className="text-muted">{details.actorName || entry.actor}</p>
						{details.error && <p className="callout text-danger">{details.error}</p>}
						{Object.entries(fields).map(([key, change]) => <div key={key}><h3 className="mb-2 font-medium">{change.label || label(key)}</h3><pre className="detail-code">{'Было:\n' + format(change.before) + '\n\nСтало:\n' + format(change.after)}</pre></div>)}
						{details.diff && <pre className="detail-code">{details.diff}</pre>}
						{details.outcome && <p>{details.outcome}</p>}{details.logError && <p className="text-danger">{details.logError}</p>}
						{(details.syncResults || []).map((result, index) => <p key={index} className={!result.ok ? 'text-danger' : ''}>{permanentGroups[result.kind] || 'Навигация'}: {result.ok ? 'Обновлено' : result.error}{result.logError && ' · ' + result.logError}</p>)}
						{!Object.keys(fields).length && !details.diff && !details.error && !details.syncResults?.length && <pre className="detail-code">{format(details)}</pre>}
					</div> })} />
				</div>
			</article>
		})}
	</div>
}
