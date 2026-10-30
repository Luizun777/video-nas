import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installWebApi } from '@web/api'
import { App } from './App'
import './styles/global.css'

// Entrada de la versión web: la sirve el servidor LAN de la app de escritorio. window.api
// habla con ese servidor por HTTP; el App y todas las vistas son los mismos del desktop.
// mobile-shell: sin app-region de Electron y con las safe areas del teléfono.
document.body.classList.add('mobile-shell', 'web-shell')

installWebApi()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
