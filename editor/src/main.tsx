import { createRoot } from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@xyflow/react/dist/style.css'
import { App } from './ui/App'

const root = document.getElementById('root')
if (!root) throw new Error('Missing application root')
createRoot(root).render(<App />)
