import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installPlatformApi } from '@mobile/boot'
import { App } from './App'
import './styles/global.css'

// Entrada de Android/preview móvil: aquí no hay preload de Electron, así que la
// plataforma instala window.api (plugin nativo + core, o el mock de navegador)
// ANTES de montar React. El App y todas las vistas son los mismos del desktop.
document.body.classList.add('mobile-shell')

void installPlatformApi()
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  })
  .catch((error: Error) => {
    document.getElementById('root')!.innerText = `No se pudo iniciar la app: ${error.message}`
  })
