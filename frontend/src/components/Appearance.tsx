import { Sparkles } from 'lucide-react'
import { useAppearance, type Theme } from '../lib/appearance'
import { IconButton } from './ui'

export function Appearance() {
	const { theme, effects, changeTheme, toggleEffects } = useAppearance()
	return <div className="appearance-controls">
		<select aria-label="Тема оформления" value={theme} onChange={event => changeTheme(event.target.value as Theme)}>
			<option value="system">Системная</option><option value="light">Светлая</option><option value="dark">Тёмная</option>
		</select>
		<IconButton icon={Sparkles} label="Декоративные эффекты" aria-pressed={effects} onClick={toggleEffects} />
	</div>
}
