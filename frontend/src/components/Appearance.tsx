import { Monitor, Moon, Sparkles, Sun } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useAppearance, type Theme } from '../lib/appearance'
import { IconButton } from './ui'

export function Appearance() {
	const { theme, effects, changeTheme, toggleEffects } = useAppearance()
	const choices = [['system', 'Системная', Monitor], ['light', 'Светлая', Sun], ['dark', 'Тёмная', Moon]] as const
	return <div className="appearance-controls">
		<fieldset className="theme-switch" aria-label="Тема оформления" style={{ '--theme-index': choices.findIndex(([value]) => value === theme) } as CSSProperties}>
			<span className="theme-indicator" aria-hidden="true" />
			{choices.map(([value, label, Icon]) => <label key={value} title={label}>
				<input type="radio" name="theme" aria-label={label} value={value} checked={theme === value} onChange={() => changeTheme(value as Theme)} />
				<span><Icon aria-hidden="true" /><span className="theme-label">{label}</span></span>
			</label>)}
		</fieldset>
		<IconButton icon={Sparkles} label="Декоративные эффекты" aria-pressed={effects} onClick={toggleEffects} />
	</div>
}
