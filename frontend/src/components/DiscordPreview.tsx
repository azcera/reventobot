import type { Config, TemplateField } from '../types'
import React, { useMemo, useState } from 'react'
import { Check, ExternalLink, Hash, ImageOff } from 'lucide-react'
import { replaceExamples, previewFields } from '../lib/templates'

function revealSpoiler(event: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) {
	const spoiler = event.target instanceof Element ? event.target.closest('.discord-spoiler') : null
	if (!spoiler || !event.currentTarget.contains(spoiler)) return
	if (event.type === 'keydown' && !['Enter', ' '].includes('key' in event ? event.key : '')) return
	if (event.type === 'keydown') event.preventDefault()
	spoiler.classList.toggle('revealed')
	spoiler.setAttribute('aria-expanded', String(spoiler.classList.contains('revealed')))
}

export function Markdown({ source }: { source: string }) {
	const html = useMemo(() => window.discordMarkdownToHtml(source), [source])
	return <div className="discord-text" onClick={revealSpoiler} onKeyDown={revealSpoiler} dangerouslySetInnerHTML={{ __html: html }} />
}

function DiscordImage({ src }: { src: string }) {
	const [failed, setFailed] = useState(false)
	return failed || src.startsWith('attachment://') ? <div className="discord-image-error"><ImageOff aria-hidden="true" /><span>Изображение недоступно</span></div>
		: <img className="discord-image" src={src} alt="Изображение сообщения" loading="lazy" onError={() => setFailed(true)} />
}

export function DiscordButton({ children, link = false, variant = 'primary' }: { children: React.ReactNode; link?: boolean; variant?: string }) {
	return <span className={`discord-button discord-button-${variant}`} aria-label={String(children) + ' (предпросмотр)'}>{children}{link && <ExternalLink aria-hidden="true" />}</span>
}

export function Components({ source, components = true }: { source: string; components?: boolean }) {
	if (!components) return <Markdown source={source} />
	return window.componentMarkdown.parse(source).map((item, index) => {
		if (item.type === 'text') return <Markdown key={index} source={item.value} />
		if (item.type === 'image') return <DiscordImage key={item.value + index} src={item.value} />
		if (item.type === 'separator') return <div key={index} className={`discord-divider ${item.divider ? '' : 'discord-divider-hidden'} ${item.spacing === 'large' || item.large ? 'discord-divider-large' : ''}`} />
		return <div className="discord-section" key={index}><Markdown source={item.value} /><DiscordButton link>{item.btnLabel}</DiscordButton></div>
	})
}

export function DiscordPreview({ channel = 'предпросмотр', children }: { channel?: string; children: React.ReactNode }) {
	return <section className="discord-preview" aria-label="Предпросмотр сообщения в Discord">
		<div className="discord-channel"><Hash aria-hidden="true" /><span>{channel}</span><span className="ml-auto text-xs text-[#949ba4]">Предпросмотр</span></div>
		<div className="discord-message"><img src="/revento-logo.png" alt="" className="discord-avatar" />
			<div className="min-w-0"><div className="discord-author"><span>Revento</span><span className="discord-app"><Check aria-hidden="true" /> APP</span><span className="discord-time">Сегодня, в {new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })}</span></div>
				<div className="discord-container">{children}</div>
			</div>
		</div>
	</section>
}

export function TemplatePreview({ config, group, fields, values, channel }: { config: Config; group: string; fields: TemplateField[]; values: Record<string, string>; channel: string }) {
	const [applicationState, setApplicationState] = useState('pending')
	const application = ['Заявка', 'Личные сообщения заявок'].includes(group)
	const dm = group === 'Личные сообщения заявок'
	const states: Record<string, string> = dm ? { accepted: 'Принята', rejected: 'Отклонена', interview: 'Обзвон' } : { pending: 'На рассмотрении', accepted: 'Принята', rejected: 'Отклонена', interview: 'Обзвон' }
	const state = states[applicationState] ? applicationState : Object.keys(states)[0]
	const text = (key: string) => {
		let value = values[key] ?? config.templates.find(field => field.key === key)?.value ?? ''
		if (application) value = value.replace(/\{time\}/g, String(Math.floor(Date.now() / 1000)))
		return replaceExamples(value)
	}
	const sampleText = (value: string) => value.replace(/<t:\d+:[A-Za-z]>/g, match => match.endsWith(':R>') ? 'только что' : new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }))
		.replace(/<@!?\d+>/g, mention => mention.includes('987654321098765432') ? '@Куратор' : '@Tony').replace(/<#123456789012345678>/g, '#Обзвон')
	return <div className="grid gap-4">
		{application && <label className="flex flex-wrap items-center gap-3 text-sm text-muted">Состояние заявки<select className="w-auto" aria-label="Состояние заявки в предпросмотре" value={state} onChange={event => setApplicationState(event.target.value)}>{Object.entries(states).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
		<DiscordPreview channel={channel}>
			{application ? <><Components source={sampleText(text(`${dm ? 'dm' : 'application'}.document.${state}`))} />
				{!dm && state === 'pending' && <><div className="discord-divider" /><div className="discord-buttons">{['application.1', 'application.2', 'application.3'].map((key, index) => <DiscordButton key={key} variant={index === 1 ? 'danger' : 'primary'}>{text(key)}</DiscordButton>)}</div></>}
			</> : <>
				{previewFields(config, group, fields, values, window.componentMarkdown).map((field, index) => field.type === 'color' ? null : field.type === 'button' ? <DiscordButton key={field.key || index}>{replaceExamples(field.value)}</DiscordButton> : field.type === 'url' ? <DiscordImage key={field.value} src={field.value} /> : <Components key={field.key || index} source={replaceExamples(field.value)} components={field.components !== false} />)}
				{group === 'Приглашение' && <><div className="discord-divider discord-divider-large" /><div className="discord-section"><Markdown source={text('invite.3')} /><DiscordButton>{text('invite.4')}</DiscordButton></div></>}
			</>}
		</DiscordPreview>
		<p className="field-hint">Переменные заменены примерами. Кнопки показаны для проверки оформления и не выполняют действия.</p>
	</div>
}
