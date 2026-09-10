import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/global.css'

// Marca el sistema en <body>: la nav solo deja hueco a los semáforos en macOS.
document.body.classList.add(`os-${window.api.capabilities.os}`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
