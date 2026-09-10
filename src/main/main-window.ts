import { join } from 'node:path'
import { BrowserWindow } from 'electron'

// En módulo propio (y no en index.ts) porque el reattach de la ventana del reproductor
// puede necesitar recrear la ventana principal, e importarla desde index.ts crearía el
// ciclo index -> ipc -> index.

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b0b0f',
    // En macOS la barra de título se funde con la nav y los semáforos quedan dentro. En
    // Windows hiddenInset no existe: barra nativa, oscura por nativeTheme (index.ts).
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.once('ready-to-show', () => window.show())

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
