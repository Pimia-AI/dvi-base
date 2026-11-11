import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ModuleApp } from '@dvi-base/kit'
import { Screens } from './screens'
import './styles.css'

createRoot(document.getElementById('root')!).render(<StrictMode><ModuleApp><Screens /></ModuleApp></StrictMode>)
