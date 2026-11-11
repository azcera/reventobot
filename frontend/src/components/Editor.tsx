import type { LucideIcon } from 'lucide-react'
import type { Resources } from '../types'
import { errorMessage } from '../types'
import React, { useId, useLayoutEffect, useRef, useState } from 'react'
import { Bold, Code, CodeXml, Eye, Heading1, Heading2, Heading3, Image, Italic, Link, List, ListOrdered, Minus, PanelRight, Pilcrow, Quote, Redo2, SeparatorHorizontal, SquareDashed, Strikethrough, TextCursorInput, Underline, Undo2 } from 'lucide-react'
import { queryAt, suggestions } from '../lib/mentions'
import { IconButton, useModal } from './ui'

type Format = [LucideIcon, string, string, string, string?, boolean?]
const formats: Format[] = [
	[Bold, 'Полужирный', '**', '**'], [Italic, 'Курсив', '*', '*'], [Underline, 'Подчёркнутый', '__', '__'], [Strikethrough, 'Зачёркнутый', '~~', '~~'],
	[Heading1, 'Заголовок 1', '# ', '', 'Заголовок', true], [Heading2, 'Заголовок 2', '## ', '', 'Заголовок', true], [Heading3, 'Заголовок 3', '### ', '', 'Заголовок', true],
	[Pilcrow, 'Мелкая подпись', '-# ', '', 'подпись', true], [Quote, 'Цитата', '> ', '', 'цитата', true], [List, 'Маркированный список', '- ', '', 'пункт', true], [ListOrdered, 'Нумерованный список', '1. ', '', 'пункт', true],
	[SquareDashed, 'Скрытый текст', '||', '||'], [Code, 'Код в строке', '`', '`'], [CodeXml, 'Блок кода', '```\n', '\n```', 'код', true], [Link, 'Ссылка', '[', '](https://example.com)', 'подпись']
]
const componentFormats: Format[] = [[Minus, 'Разделитель', '', '', '---', true], [SeparatorHorizontal, 'Большой разделитель', '', '', '***', true], [Image, 'Изображение', '', '', '<img src="https://example.com/image.png" />', true], [PanelRight, 'Секция с кнопкой справа', '<section buttonLabel="Открыть" buttonLink="https://example.com">', '</section>', 'Текст секции', true]]

export function MarkdownEditor({ id, value, onChange, maxLength = 16000, components = true, resources, ...props }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & { value: string; onChange(value: string): void; components?: boolean; resources: Resources }) {
	const ref = useRef<HTMLTextAreaElement>(null)
	const selection = useRef<[number, number] | null>(null)
	const stack = useRef([{ value, start: 0, end: 0 }])
	const position = useRef(0)
	const listId = useId()
	const [query, setQuery] = useState<ReturnType<typeof queryAt>>(null)
	const [selected, setSelected] = useState(0)
	const [, updateHistory] = useState(0)
	const modal = useModal()
	const found = suggestions(query, resources)
	useLayoutEffect(() => {
		if (stack.current[position.current].value !== value) { stack.current = [{ value, start: 0, end: 0 }]; position.current = 0 }
		if (selection.current) { ref.current!.focus(); ref.current!.setSelectionRange(...selection.current); selection.current = null }
		const input = ref.current!
		if (input.clientWidth) {
			input.style.height = 'auto'
			input.style.height = Math.max(240, input.scrollHeight + 2) + 'px'
		}
	}, [value])
	useLayoutEffect(() => {
		const input = ref.current!
		let previousWidth = 0
		const observer = new ResizeObserver(() => {
			if (!input.clientWidth || input.clientWidth === previousWidth) return
			previousWidth = input.clientWidth
			input.style.height = 'auto'
			input.style.height = Math.max(240, input.scrollHeight + 2) + 'px'
		})
		observer.observe(input)
		return () => observer.disconnect()
	}, [])
	function remember() {
		const input = ref.current!
		stack.current[position.current] = { value: input.value, start: input.selectionStart, end: input.selectionEnd }
	}
	function change(next: string, start: number, end = start) {
		if (next.length > maxLength) { selection.current = null; modal({ kind: 'error', title: 'Слишком длинный текст', message: `В этом поле допускается не больше ${maxLength} символов.` }); return }
		stack.current.splice(position.current + 1)
		stack.current.push({ value: next, start, end })
		if (stack.current.length > 100) stack.current.shift()
		position.current = stack.current.length - 1
		onChange(next)
		updateHistory(n => n + 1)
	}
	function restore(redo: boolean) {
		remember()
		const next = position.current + (redo ? 1 : -1)
		if (!stack.current[next]) return
		position.current = next
		const state = stack.current[next]
		selection.current = [state.start, state.end]
		onChange(state.value)
		setQuery(null)
		updateHistory(n => n + 1)
	}
	function insert(before: string, after = '', sample = 'текст', line = false) {
		remember()
		const input = ref.current!, start = input.selectionStart, end = input.selectionEnd
		const text = value.slice(start, end) || sample
		const prefix = line && start && value[start - 1] !== '\n' ? '\n' : ''
		const suffix = line && value[end] !== '\n' ? '\n' : ''
		const content = prefix + (line && !after && before ? text.split('\n').map(part => before + part).join('\n') : before + text + after) + suffix
		selection.current = [start, start + content.length]
		change(value.slice(0, start) + content + value.slice(end), start, start + content.length)
		setQuery(null)
	}
	function refresh(input: HTMLTextAreaElement) { setQuery(queryAt(input.value, input.selectionStart, input.selectionEnd)); setSelected(0) }
	function choose(index: number) {
		const item = found[index]
		if (!query || !item) return
		remember()
		const mention = (query.kind === '@' ? `<@&${item.id}>` : `<#${item.id}>`) + ' '
		selection.current = [query.start + mention.length, query.start + mention.length]
		change(value.slice(0, query.start) + mention + value.slice(query.end), query.start + mention.length)
		setQuery(null)
	}
	return <div className="relative min-w-0">
		<div className="editor-toolbar" role="toolbar" aria-label="Форматирование Markdown">
			<IconButton icon={Undo2} label="Отменить (Ctrl+Z)" disabled={!position.current} onClick={() => restore(false)} />
			<IconButton icon={Redo2} label="Повторить (Ctrl+Shift+Z)" disabled={position.current >= stack.current.length - 1} onClick={() => restore(true)} />
			<span className="toolbar-divider" />
			{[...formats, ...(components ? componentFormats : [])].map(([Icon, label, ...args]) => <IconButton key={label} icon={Icon} label={label} onPointerDown={event => event.preventDefault()} onClick={() => insert(...args)} />)}
		</div>
		<textarea ref={ref} id={id} value={value} maxLength={maxLength} className="markdown-source" spellCheck={false} {...props}
			aria-autocomplete="list" aria-controls={found.length ? listId : undefined} aria-activedescendant={found.length ? `${listId}-${selected}` : undefined}
			onBeforeInput={remember} onChange={event => { change(event.target.value, event.target.selectionStart, event.target.selectionEnd); refresh(event.currentTarget) }}
			onClick={event => refresh(event.currentTarget)} onBlur={() => setQuery(null)} onKeyDown={event => {
				if (event.nativeEvent.isComposing) return
				if ((event.ctrlKey || event.metaKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); restore(event.key.toLowerCase() === 'y' || event.shiftKey); return }
				if (!found.length) return
				if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setSelected(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length) }
				else if (['Enter', 'Tab'].includes(event.key)) { event.preventDefault(); choose(selected) }
				else if (event.key === 'Escape') { event.preventDefault(); setQuery(null) }
				else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) setQuery(null)
			}} />
		{found.length > 0 && <div id={listId} role="listbox" aria-label={query!.kind === '@' ? 'Роли сервера' : 'Каналы сервера'} className="mention-menu">
			{found.map((item, index) => <button key={item.id} id={`${listId}-${index}`} role="option" aria-selected={selected === index} tabIndex={-1} type="button" onPointerDown={event => event.preventDefault()} onClick={() => choose(index)}>
				<span>{query!.kind}{item.name}</span><small>{item.id}</small>
			</button>)}
		</div>}
		<div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] text-muted"><span>Markdown · @ для ролей, # для каналов</span><span className="tabular-nums">{value.length.toLocaleString('ru-RU')} / {maxLength.toLocaleString('ru-RU')}</span></div>
	</div>
}

export function EditorWorkspace({ children, renderPreview, footer, resetKey }: { children: React.ReactNode; renderPreview(): React.ReactNode; footer: React.ReactNode; resetKey: string | number }) {
	const [mode, setMode] = useState('edit')
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
	return <div className="grid gap-4">
		<div className="editor-tabs" role="tablist" aria-label="Режим редактора" onKeyDown={event => {
			if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
			event.preventDefault()
			const next = event.key === 'Home' ? 'edit' : event.key === 'End' ? 'preview' : mode === 'edit' ? 'preview' : 'edit'
			switchMode(next); document.getElementById(`${id}-${next}-tab`)?.focus()
		}}>
			{([['edit', 'Редактировать', TextCursorInput], ['preview', 'Предпросмотр', Eye]] satisfies [string, string, LucideIcon][]).map(([key, label, Icon]) => <button key={key} type="button" role="tab" id={`${id}-${key}-tab`} aria-selected={mode === key} aria-controls={`${id}-${key}-panel`} tabIndex={mode === key ? 0 : -1} onClick={() => switchMode(key)}><Icon aria-hidden="true" />{label}</button>)}
		</div>
		<div role="tabpanel" id={`${id}-edit-panel`} aria-labelledby={`${id}-edit-tab`} hidden={mode !== 'edit'}>{children}</div>
		{mode === 'preview' && <div role="tabpanel" id={`${id}-preview-panel`} aria-labelledby={`${id}-preview-tab`}>{preview}</div>}
		{footer}
	</div>
}
