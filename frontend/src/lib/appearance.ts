import { useEffect, useState } from 'react'
import { useMotion } from './motion'

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
			document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0c0d16' : '#e5e7f0')
		}
		apply()
		system.addEventListener('change', apply)
		return () => system.removeEventListener('change', apply)
	}, [theme])

	useMotion(effects)

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
