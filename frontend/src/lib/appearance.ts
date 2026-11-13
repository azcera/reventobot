import { useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'
const themeKey = 'revento-theme'
const effectsKey = 'revento-effects'

function read(key: string) {
	try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string) {
	try { localStorage.setItem(key, value) } catch { /* Preferences remain usable for this session. */ }
}
function storedTheme(): Theme {
	const value = read(themeKey)
	return value === 'light' || value === 'dark' ? value : 'system'
}

export function useAppearance() {
	const [theme, setTheme] = useState<Theme>(storedTheme)
	const [effects, setEffects] = useState(() => read(effectsKey) !== 'off')
	useEffect(() => {
		const system = matchMedia('(prefers-color-scheme: dark)')
		const apply = () => {
			const resolved = theme === 'system' ? system.matches ? 'dark' : 'light' : theme
			document.documentElement.dataset.theme = resolved
			document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#151720' : '#f3f4fa')
		}
		apply()
		system.addEventListener('change', apply)
		return () => system.removeEventListener('change', apply)
	}, [theme])

	useEffect(() => {
		const root = document.documentElement
		const pointer = matchMedia('(hover: hover) and (pointer: fine)')
		const reduced = matchMedia('(prefers-reduced-motion: reduce)')
		let frame = 0
		let card: HTMLElement | null = null
		let x = 0, y = 0
		const resetCard = () => { card?.style.removeProperty('transform'); card = null }
		const reset = () => {
			cancelAnimationFrame(frame); frame = 0; resetCard()
			root.style.removeProperty('--cursor-x'); root.style.removeProperty('--cursor-y')
			root.style.removeProperty('--drift-x'); root.style.removeProperty('--drift-y')
			root.dataset.cursor = 'off'
		}
		const apply = () => {
			reset()
			root.dataset.effects = effects && pointer.matches && !reduced.matches ? 'on' : 'off'
		}
		const move = (event: PointerEvent) => {
			if (root.dataset.effects !== 'on' || event.pointerType === 'touch') return
			x = event.clientX; y = event.clientY
			const next = event.target instanceof Element ? event.target.closest<HTMLElement>('.metric') : null
			if (next !== card) { resetCard(); card = next }
			if (frame) return
			frame = requestAnimationFrame(() => {
				frame = 0; root.dataset.cursor = 'on'
				root.style.setProperty('--cursor-x', `${x}px`); root.style.setProperty('--cursor-y', `${y}px`)
				root.style.setProperty('--drift-x', `${(x / innerWidth - .5) * 18}px`)
				root.style.setProperty('--drift-y', `${(y / innerHeight - .5) * 18}px`)
				if (card) {
					const rect = card.getBoundingClientRect()
					card.style.transform = `perspective(800px) rotateX(${-(y - rect.top - rect.height / 2) / rect.height * 3}deg) rotateY(${(x - rect.left - rect.width / 2) / rect.width * 3}deg)`
				}
			})
		}
		apply()
		pointer.addEventListener('change', apply); reduced.addEventListener('change', apply)
		document.addEventListener('pointermove', move, { passive: true })
		document.addEventListener('pointerleave', reset); window.addEventListener('blur', reset)
		window.addEventListener('scroll', reset, { passive: true })
		return () => {
			reset(); pointer.removeEventListener('change', apply); reduced.removeEventListener('change', apply)
			document.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', reset)
			window.removeEventListener('blur', reset); window.removeEventListener('scroll', reset)
		}
	}, [effects])

	useEffect(() => {
		const sync = (event: StorageEvent) => {
			if (event.key === themeKey || event.key === null) setTheme(storedTheme())
			if (event.key === effectsKey || event.key === null) setEffects(read(effectsKey) !== 'off')
		}
		window.addEventListener('storage', sync)
		return () => window.removeEventListener('storage', sync)
	}, [])
	return { theme, effects, changeTheme: (value: Theme) => { write(themeKey, value); setTheme(value) }, toggleEffects: () => { write(effectsKey, effects ? 'off' : 'on'); setEffects(!effects) } }
}
