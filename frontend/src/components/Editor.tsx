import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import type { Resources } from '../types'
import { errorMessage } from '../types'
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Bold, Code, CodeXml, Eye, Heading1, Heading2, Heading3, Image, Italic, Link, List, ListOrdered, Minus, SlidersHorizontal, PanelRight, Pilcrow, Quote, Redo2, SeparatorHorizontal, SquareDashed, Strikethrough, TextCursorInput, Underline, Undo2 } from 'lucide-react'
import { queryAt, suggestions } from '../lib/mentions'
import { editorTokens, type EditorToken } from '../lib/editorTokens'
import { AutoTextarea, Button, Field, IconButton, useModal } from './ui'
import { DiscordPreview, Markdown } from './DiscordPreview'

type Format = [LucideIcon, string, string, string, string?, boolean?]
const formats: Format[] = [
	[Bold, 'Полужирный', '**', '**'], [Italic, 'Курсив', '*', '*'], [Underline, 'Подчёркнутый', '__', '__'], [Strikethrough, 'Зачёркнутый', '~~', '~~'],
	[Heading1, 'Заголовок 1', '# ', '', 'Заголовок', true], [Heading2, 'Заголовок 2', '## ', '', 'Заголовок', true], [Heading3, 'Заголовок 3', '### ', '', 'Заголовок', true],
	[Pilcrow, 'Мелкая подпись', '-# ', '', 'подпись', true], [Quote, 'Цитата', '> ', '', 'цитата', true], [List, 'Маркированный список', '- ', '', 'пункт', true], [ListOrdered, 'Нумерованный список', '1. ', '', 'пункт', true],
	[SquareDashed, 'Скрытый текст', '||', '||'], [Code, 'Код в строке', '`', '`'], [CodeXml, 'Блок кода', '```\n', '\n```', 'код', true], [Link, 'Ссылка', '[', '](https://example.com)', 'подпись']
]
const componentFormats: Format[] = [[Minus, 'Разделитель', '', '', '---', true], [SeparatorHorizontal, 'Большой разделитель', '', '', '***', true], [Image, 'Изображение', '', '', '<img src="https://example.com/image.png" />', true], [PanelRight, 'Секция с кнопкой справа', '<section buttonLabel="Открыть" buttonLink="https://example.com">', '</section>', 'Текст секции', true]]

function rawText(node: Node): string {
	if (node instanceof HTMLElement && node.dataset.source !== undefined) return node.dataset.source
	if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
	if (node.nodeName === 'BR') return '\n'
	return [...node.childNodes].map(rawText).join('')
}

function caretRange(root: HTMLElement): [number, number] {
	const selection = window.getSelection()
	if (!selection?.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return [0, 0]
	const range = selection.getRangeAt(0)
	const before = range.cloneRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset)
	const through = before.cloneRange(); through.setEnd(range.endContainer, range.endOffset)
	return [rawText(before.cloneContents()).length, rawText(through.cloneContents()).length]
}

function setCaret(root: HTMLElement, start: number, end: number) {
	const locate = (offset: number): [Node, number] => {
		for (let i = 0; i < root.childNodes.length; i++) {
			const node = root.childNodes[i], size = rawText(node).length
			if (offset <= size) return node.nodeType === Node.TEXT_NODE ? [node, offset] : [root, i + (offset > 0 ? 1 : 0)]
			offset -= size
		}
		return [root, root.childNodes.length]
	}
	const range = document.createRange(); range.setStart(...locate(start)); range.setEnd(...locate(end))
	root.focus({ preventScroll: true }); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range)
}

function TagForm({ token, selected, resources, onSubmit, close }: { token: Pick<EditorToken, 'kind' | 'source'>; selected: string; resources: Resources; onSubmit(value: string | null): void; close(): void }) {
	let initialText = selected, initialUrl = '', initialLabel = 'Открыть'
	if (token.source) {
		if (token.kind === 'link') { const match = /^\[([^\]]*)\]\((.*)\)$/.exec(token.source); initialText = match?.[1] || ''; initialUrl = match?.[2] || '' }
		else { try { const item = window.componentMarkdown.parse(token.source)[0]; if (item.type === 'image') initialUrl = item.value; if (item.type === 'section') { initialText = item.value; initialUrl = item.btnLink || ''; initialLabel = item.btnLabel || '' } } catch { /* Keep malformed source editable. */ } }
	}
	const [text, setText] = useState(initialText), [url, setUrl] = useState(initialUrl), [label, setLabel] = useState(initialLabel), [error, setError] = useState('')
	return <form className="mt-5 grid gap-4" onSubmit={event => {
		event.preventDefault()
		try {
			if (token.kind === 'section' && !text) throw new Error('Заполни текст секции.')
			const parsed = new URL(url); if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Укажи HTTP(S)-ссылку без логина и пароля.')
			let source: string
			if (token.kind === 'link') { if (/[\]\n]/.test(text) || /[\s)]/.test(url)) throw new Error('Проверь подпись и ссылку.'); source = `[${text}](${url})` }
			else { source = window.componentMarkdown.stringify([token.kind === 'image' ? { type: 'image', value: url } : { type: 'section', value: text, btnLabel: label, btnLink: url }]); window.componentMarkdown.parse(source) }
			onSubmit(source); close()
		} catch (error) { setError(errorMessage(error)) }
	}}>
		{token.kind !== 'image' && <Field label={token.kind === 'section' ? 'Текст секции' : 'Текст ссылки'}>{token.kind === 'section' ? <EditorWorkspace resetKey={token.source} footer={null} renderPreview={() => <DiscordPreview><Markdown source={text} /></DiscordPreview>}><MarkdownEditor aria-label="Текст секции" value={text} onChange={setText} resources={resources} components={false} /></EditorWorkspace> : <AutoTextarea required value={text} rows={4} onChange={event => setText(event.target.value)} />}</Field>}
		{token.kind === 'section' && <Field label="Название кнопки"><input required value={label} maxLength={80} onChange={event => setLabel(event.target.value)} /></Field>}
		<Field label={token.kind === 'image' ? 'Ссылка на изображение' : token.kind === 'section' ? 'Ссылка кнопки' : 'Адрес ссылки'}><input required type="url" value={url} onChange={event => setUrl(event.target.value)} /></Field>
		{error && <p role="alert" className="text-danger">{error}</p>}
		<div className="flex flex-wrap justify-end gap-2">{token.source && <Button variant="danger" onClick={() => { onSubmit(null); close() }}>Удалить</Button>}<Button onClick={close}>Отмена</Button><Button type="submit" variant="primary">{token.source ? 'Сохранить' : 'Добавить'}</Button></div>
	</form>
}

export function MarkdownEditor({ id, value, onChange, maxLength = 16000, components = true, resources, ...props }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & { value: string; onChange(value: string): void; components?: boolean; resources: Resources }) {
	const ref = useRef<HTMLDivElement>(null)
	const selection = useRef<[number, number] | null>(null)
	const lastSelection = useRef<[number, number]>([0, 0])
	const stack = useRef([{ value, start: 0, end: 0 }]), position = useRef(0)
	const listId = useId()
	const [query, setQuery] = useState<ReturnType<typeof queryAt>>(null), [selected, setSelected] = useState(0)
	const [renderVersion, updateHistory] = useState(0)
	const [formatting, setFormatting] = useState(false)
	const [desktop, setDesktop] = useState(() => matchMedia('(min-width: 1024px)').matches)
	useEffect(() => {
		const media = matchMedia('(min-width: 1024px)')
		const change = () => setDesktop(media.matches)
		media.addEventListener('change', change)
		return () => media.removeEventListener('change', change)
	}, [])
	const modal = useModal(), found = suggestions(query, resources)
	function remember() { const [start, end] = caretRange(ref.current!); lastSelection.current = [start, end]; stack.current[position.current] = { value, start, end } }
	function change(next: string, start: number, end = start) {
		if (next.length > maxLength) { modal({ kind: 'error', title: 'Слишком длинный текст', message: `В этом поле допускается не больше ${maxLength} символов.` }); updateHistory(n => n + 1); return }
		stack.current.splice(position.current + 1); stack.current.push({ value: next, start, end })
		if (stack.current.length > 100) stack.current.shift()
		position.current = stack.current.length - 1; selection.current = [start, end]; lastSelection.current = [start, end]
		onChange(next); updateHistory(n => n + 1)
	}
	function restore(redo: boolean) {
		const next = position.current + (redo ? 1 : -1); if (!stack.current[next]) return
		position.current = next; const state = stack.current[next]; selection.current = [state.start, state.end]; lastSelection.current = selection.current
		onChange(state.value); setQuery(null); updateHistory(n => n + 1)
	}
	function replace(start: number, end: number, content: string) { change(value.slice(0, start) + content + value.slice(end), start + content.length); setQuery(null) }
	function insert(before: string, after = '', sample = 'текст', line = false) {
		const [start, end] = lastSelection.current, text = value.slice(start, end) || sample
		const prefix = line && start && value[start - 1] !== '\n' ? '\n' : '', suffix = line && value[end] !== '\n' ? '\n' : ''
		replace(start, end, prefix + (line && !after && before ? text.split('\n').map(part => before + part).join('\n') : before + text + after) + suffix)
	}
	function openTag(kind: EditorToken['kind'], token?: EditorToken) {
		const [start, end] = token ? [token.start, token.end] : lastSelection.current
		modal({ title: (token ? 'Редактировать: ' : 'Добавить: ') + ({ image: 'изображение', section: 'секция', link: 'ссылка' })[kind], hideFooter: true,
			content: ({ close }) => <TagForm token={{ kind, source: token?.source || '' }} selected={token ? '' : value.slice(start, end)} resources={resources} close={close} onSubmit={source => {
				const block = kind !== 'link' && source !== null
				replace(start, end, (block && start && value[start - 1] !== '\n' ? '\n' : '') + (source || '') + (block && value[end] !== '\n' ? '\n' : ''))
			}} /> })
	}
	useLayoutEffect(() => {
		const root = ref.current!
		if (stack.current[position.current].value !== value) { stack.current = [{ value, start: 0, end: 0 }]; position.current = 0 }
		const focused = document.activeElement === root, caret = selection.current || (focused ? caretRange(root) : null)
		const nodes: Node[] = []; let offset = 0
		for (const token of editorTokens(value, components, resources)) {
			nodes.push(document.createTextNode(value.slice(offset, token.start)))
			if (token.kind === 'mention') {
				const mention = document.createElement('span'); mention.contentEditable = 'false'; mention.dataset.source = token.source; mention.className = 'discord-mention font-sans'; mention.textContent = token.label; mention.title = token.source
				nodes.push(mention); offset = token.end
				continue
			}
			const chip = document.createElement('span'); chip.contentEditable = 'false'; chip.dataset.source = token.source; chip.className = 'editor-chip'; chip.role = 'button'; chip.tabIndex = 0; chip.textContent = token.label; chip.setAttribute('aria-label', 'Редактировать: ' + token.label)
			chip.onclick = () => openTag(token.kind, token)
			chip.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); openTag(token.kind, token) } }
			nodes.push(chip); offset = token.end
		}
		nodes.push(document.createTextNode(value.slice(offset)))
		if (root.closest('fieldset')?.disabled) root.setAttribute('aria-disabled', 'true'); else root.removeAttribute('aria-disabled')
		root.replaceChildren(...nodes)
		if (caret) {
			setCaret(root, Math.min(caret[0], value.length), Math.min(caret[1], value.length))
			const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect()
			const toolbar = root.previousElementSibling?.getBoundingClientRect()
			if (rect && rect.height) { const top = Math.max(0, toolbar?.bottom || 0) + 16; if (rect.top < top) window.scrollBy(0, rect.top - top); else if (rect.bottom > window.innerHeight - 32) window.scrollBy(0, rect.bottom - window.innerHeight + 32) }
		}
		selection.current = null
	}, [value, components, resources, renderVersion])
	function refresh() { const [start, end] = caretRange(ref.current!); lastSelection.current = [start, end]; setQuery(queryAt(value, start, end)); setSelected(0) }
	function choose(index: number) {
		const item = found[index]; if (!query || !item) return
		replace(query.start, query.end, (query.kind === '@' ? `<@&${item.id}>` : `<#${item.id}>`) + ' ')
	}
	return <div className="relative min-w-0">
		<div className="toolbar-anchor" aria-hidden="true" />
		<div className="editor-toolbar" role="toolbar" aria-label="Форматирование Markdown" onPointerDown={event => event.preventDefault()}>
			<IconButton icon={Undo2} label="Отменить (Ctrl+Z)" disabled={!position.current} onClick={() => restore(false)} />
			<IconButton icon={Redo2} label="Повторить (Ctrl+Shift+Z)" disabled={position.current >= stack.current.length - 1} onClick={() => restore(true)} />
			<IconButton className="formatting-toggle lg:hidden" icon={SlidersHorizontal} label="Инструменты форматирования" aria-expanded={formatting} onClick={() => setFormatting(value => !value)} /><div className="formatting-tools" hidden={!desktop && !formatting}>
			{[...formats, ...(components ? componentFormats : [])].map(([Icon, label, ...args]) => <IconButton key={label} icon={Icon} label={label} onClick={() => Icon === Link ? openTag('link') : Icon === Image ? openTag('image') : Icon === PanelRight ? openTag('section') : insert(...args)} />)}
			</div>
			<div className="toolbar-save-slot" />
		</div>
		<div ref={ref} id={id} role="textbox" aria-label={props['aria-label'] || 'Текст сообщения'} aria-describedby={props['aria-describedby']} aria-multiline="true" contentEditable={!props.disabled} suppressContentEditableWarning className="markdown-source" spellCheck={false}
			aria-autocomplete="list" aria-controls={found.length ? listId : undefined} aria-activedescendant={found.length ? `${listId}-${selected}` : undefined}
			onDrop={event => event.preventDefault()}
			onBeforeInput={event => { if (ref.current?.closest('fieldset')?.disabled) { event.preventDefault(); return }; const type = (event.nativeEvent as InputEvent).inputType; if (type === 'historyUndo' || type === 'historyRedo') { event.preventDefault(); restore(type === 'historyRedo') } else remember() }}
			onInput={event => { if ((event.nativeEvent as InputEvent).isComposing) return; const root = ref.current!, [start, end] = caretRange(root); const next = rawText(root); change(next, start, end); setQuery(queryAt(next, start, end)); setSelected(0) }}
			onMouseUp={refresh} onClick={refresh} onKeyUp={event => { if (!event.ctrlKey && !event.metaKey && !(found.length && ['ArrowUp', 'ArrowDown'].includes(event.key))) refresh() }} onBlur={() => { if (ref.current!.contains(window.getSelection()?.anchorNode || null)) remember(); setQuery(null) }} onFocus={() => { if (!ref.current!.contains(window.getSelection()?.anchorNode || null)) setCaret(ref.current!, ...lastSelection.current) }}
			onCompositionEnd={() => { const root = ref.current!, [start, end] = caretRange(root); change(rawText(root), start, end) }}
			onPaste={event => { event.preventDefault(); remember(); const [start, end] = lastSelection.current; replace(start, end, event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')) }}
			onCopy={event => { const [start, end] = caretRange(ref.current!); if (start !== end) { event.preventDefault(); event.clipboardData.setData('text/plain', value.slice(start, end)) } }}
			onCut={event => { if (props.disabled || ref.current?.closest('fieldset')?.disabled) { event.preventDefault(); return }; const [start, end] = caretRange(ref.current!); if (start !== end) { event.preventDefault(); event.clipboardData.setData('text/plain', value.slice(start, end)); remember(); replace(start, end, '') } }}
			onKeyDown={event => {
				if (ref.current?.closest('fieldset')?.disabled) { event.preventDefault(); return }
				if (event.nativeEvent.isComposing) return
				if ((event.ctrlKey || event.metaKey) && !event.altKey && ['KeyZ', 'KeyY'].includes(event.code)) { event.preventDefault(); restore(event.code === 'KeyY' || event.shiftKey); return }
				if (found.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setSelected(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length); return }
				if (found.length && ['Enter', 'Tab'].includes(event.key)) { event.preventDefault(); choose(selected); return }
				if (event.key === 'Escape') setQuery(null)
				if (event.key === 'Enter') { event.preventDefault(); remember(); const [start, end] = lastSelection.current; replace(start, end, '\n') }
			}} />
		{found.length > 0 && <div id={listId} role="listbox" aria-label={query!.kind === '@' ? 'Роли сервера' : 'Каналы сервера'} className="mention-menu">{found.map((item, index) => <button key={item.id} id={`${listId}-${index}`} role="option" aria-selected={selected === index} tabIndex={-1} type="button" onPointerDown={event => event.preventDefault()} onClick={() => choose(index)}><span>{query!.kind}{item.name}</span><small>{item.id}</small></button>)}</div>}
		<div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] text-muted"><span>Markdown · @ для ролей, # для каналов</span><span className="tabular-nums">{value.length.toLocaleString('ru-RU')} / {maxLength.toLocaleString('ru-RU')}</span></div>
	</div>
}

export function EditorWorkspace({ children, renderPreview, footer, resetKey }: { children: React.ReactNode; renderPreview(): React.ReactNode; footer: React.ReactNode; resetKey: string | number }) {
	const [mode, setMode] = useState('edit')
	const workspace = useRef<HTMLDivElement>(null)
	const [saveSlot, setSaveSlot] = useState<HTMLElement | null>(null)
	const saveElement = useRef<HTMLDivElement>(null)
	const saveTarget = useRef<HTMLElement | null>(null)
	const savePosition = useRef<DOMRect | null>(null)
	const [preview, setPreview] = useState<React.ReactNode>(null)
	const previousKey = useRef(resetKey)
	const id = useId()
	const modal = useModal()
	// Switching documents returns to editing; draft values stay owned by the page.
	if (previousKey.current !== resetKey) { previousKey.current = resetKey; setMode('edit'); setPreview(null) }
	function switchMode(next: string) {
		if (next === mode) return
		if (next === 'preview') {
			try { setPreview(renderPreview()) }
			catch (error) { modal({ kind: 'error', title: 'Не удалось открыть предпросмотр', message: errorMessage(error) }); return }
		}
		setMode(next)
	}
	useEffect(() => {
		const toggle = (event: KeyboardEvent) => {
			if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.code !== 'KeyQ' || event.repeat) return
			const tabs = document.getElementById(`${id}-edit-tab`)
			if (!tabs?.getClientRects().length || tabs.closest('[hidden]') || tabs.closest('fieldset')?.disabled) return
			const dialog = document.querySelector('dialog[open]')
			if (dialog && !dialog.contains(tabs)) return
			event.preventDefault(); switchMode(mode === 'edit' ? 'preview' : 'edit')
		}
		window.addEventListener('keydown', toggle)
		return () => window.removeEventListener('keydown', toggle)
	})
	useEffect(() => {
		if (mode !== 'edit' || !footer) { setSaveSlot(null); return }
		const root = workspace.current!
		let frame = 0
		const update = () => {
			frame = 0
			let slot: HTMLElement | null = null
			for (const toolbar of root.querySelectorAll<HTMLElement>('.editor-toolbar')) {
				if (toolbar.closest('.editor-workspace') !== root || !toolbar.getClientRects().length) continue
				const top = parseFloat(getComputedStyle(toolbar).top) || 0
				const anchor = toolbar.previousElementSibling!.getBoundingClientRect()
				if (anchor.top <= top && toolbar.parentElement!.getBoundingClientRect().bottom > top + 8) slot = toolbar.querySelector('.toolbar-save-slot')
			}
			if (slot !== saveTarget.current) savePosition.current = saveElement.current?.getBoundingClientRect() || null
			setSaveSlot(previous => previous === slot ? previous : slot)
		}
		const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
		const observer = new ResizeObserver(schedule)
		observer.observe(root)
		window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule)
		schedule()
		return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule) }
	}, [mode, resetKey, Boolean(footer)])
	const target = mode === 'edit' && saveSlot?.isConnected ? saveSlot : null
	useLayoutEffect(() => {
		saveTarget.current = target
		const element = saveElement.current, before = savePosition.current
		savePosition.current = null
		if (!element || !before || mode !== 'edit' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
		const after = element.getBoundingClientRect()
		// Keep the flight visible when the original button is outside the viewport.
		const top = Math.max(-before.height, Math.min(before.top, window.innerHeight))
		const animation = element.animate([
			{ transform: `translate(${before.left - after.left}px, ${top - after.top}px)` },
			{ transform: 'translate(0, 0)' }
		], { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
		return () => animation.cancel()
	}, [target, mode])
	const saveButton = <div ref={saveElement} className="relative z-30 mx-auto w-fit max-w-full">{footer}</div>
	return <div ref={workspace} className={`editor-workspace grid gap-4 editor-mode-${mode}`}>
		{footer && <div className="editor-save-home">{target ? createPortal(saveButton, target) : saveButton}</div>}
		<div className="editor-tabs" role="tablist" aria-label="Режим редактора" title="Переключить режим: Alt+Q" aria-keyshortcuts="Alt+Q" onKeyDown={event => {
			if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
			event.preventDefault()
			const next = event.key === 'Home' ? 'edit' : event.key === 'End' ? 'preview' : mode === 'edit' ? 'preview' : 'edit'
			switchMode(next); document.getElementById(`${id}-${next}-tab`)?.focus()
		}}>
			{([['edit', 'Редактирование', TextCursorInput], ['preview', 'Просмотр', Eye]] satisfies [string, string, LucideIcon][]).map(([key, label, Icon]) => <button key={key} type="button" role="tab" id={`${id}-${key}-tab`} aria-selected={mode === key} aria-controls={`${id}-${key}-panel`} tabIndex={mode === key ? 0 : -1} onClick={() => switchMode(key)}><Icon aria-hidden="true" />{label}</button>)}
		</div>
		<div role="tabpanel" id={`${id}-edit-panel`} aria-labelledby={`${id}-edit-tab`} hidden={mode !== 'edit'}>{children}</div>
		{mode === 'preview' && <div role="tabpanel" id={`${id}-preview-panel`} aria-labelledby={`${id}-preview-tab`}>{preview}</div>}
	</div>
}
