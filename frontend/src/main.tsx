import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource/noto-sans/cyrillic-400.css'
import '@fontsource/noto-sans/cyrillic-600.css'
import '@fontsource/noto-sans/cyrillic-700.css'
import '@fontsource/noto-sans/latin-400.css'
import '@fontsource/noto-sans/latin-600.css'
import '@fontsource/noto-sans/latin-700.css'
import './styles.css'
import { App } from './App'
import { ModalProvider } from './components/ui'

createRoot(document.getElementById('root')!).render(<ModalProvider><div className="ambient-scene" aria-hidden="true"><div className="ambient-orb ambient-orb-pink" /><div className="ambient-orb ambient-orb-blue" /><div className="ambient-ribbon" /><div className="ambient-ribbon ambient-ribbon-secondary" /><div className="ambient-grid" /><div className="cursor-aura" /></div><App /></ModalProvider>)
