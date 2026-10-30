import { join } from 'node:path'
import { app, BrowserWindow, Menu, nativeTheme, protocol } from 'electron'
import { registerIpc } from './ipc'
import { createMainWindow } from './main-window'
import { initConfigStore } from '@core/stores/config-store'
import { initLibraryStore } from '@core/stores/library-store'
import { initOverridesStore } from '@core/stores/overrides-store'
import { initProgressStore, flushProgress } from '@core/stores/progress-store'
import { initQueueStore } from '@core/stores/queue-store'
import { nodeStoreIO } from './adapters/node-store-io'
import { loadSeedToken } from './adapters/node-seed'
import { initDownloadManager } from '@core/downloads/download-manager'
import { nodeDownloadTransfer } from './adapters/node-download-transfer'
import { registerVideoFileProtocol } from './playback/stream-protocol'
import { stopTranscodeSession } from './playback/transcode-session'
import { initScanner, refreshStatuses, startScan } from '@core/scanner/scan-orchestrator'
import { initSharedOverridesSync } from '@core/metadata/shared-overrides-sync'
import { desktopScanEnv } from './adapters/desktop-scan-env'
import { ensureCacheDirs, serveCacheFile } from './tmdb/image-cache'
import { startLanServerFromConfig, stopLanServer } from './web/lan-server'

// Expone video.audioTracks (cambio de pista de audio en vivo): Chromium lo tiene
// implementado pero detrás de esta blink feature.
app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks')

// Dos procesos escribirían a la vez los mismos JSON de userData (en Windows, abrir otra
// vez el .exe lanza otro proceso): la segunda instancia solo enfoca la ventana abierta.
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.quit()

app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows()
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

// Las portadas se sirven por un protocolo propio en lugar de file://, para no tener
// que desactivar webSecurity en el renderer.
protocol.registerSchemesAsPrivileged([
  { scheme: 'mediacache', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'videofile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

function registerMediaCacheProtocol(): void {
  // mediacache://posters/m-603-w342.jpg  ->  host="posters", pathname="/m-603-w342.jpg"
  protocol.handle('mediacache', (request) => {
    const url = new URL(request.url)
    return serveCacheFile(decodeURIComponent(`${url.hostname}${url.pathname}`))
  })
}

void app.whenReady().then(async () => {
  if (!isPrimaryInstance) return

  registerMediaCacheProtocol()
  registerVideoFileProtocol()

  // downloads depende de que config-store ya tenga downloadsPath resuelto.
  await Promise.all([
    initConfigStore(nodeStoreIO, {
      defaultDownloadsPath: join(app.getPath('videos'), 'Video NAS'),
      loadSeedToken
    }),
    initLibraryStore(nodeStoreIO),
    initOverridesStore(nodeStoreIO),
    initQueueStore(nodeStoreIO),
    initProgressStore(nodeStoreIO)
  ])
  await Promise.all([ensureCacheDirs(), initDownloadManager(nodeStoreIO, nodeDownloadTransfer)])

  initScanner(desktopScanEnv)
  initSharedOverridesSync(desktopScanEnv)
  registerIpc()

  if (process.platform !== 'darwin') {
    // El menú por defecto de Electron sale en inglés y deja a mano Recargar y DevTools.
    Menu.setApplicationMenu(null)
    // La barra de título nativa (Windows) va oscura, como la app.
    nativeTheme.themeSource = 'dark'
  }
  createMainWindow()
  startLanServerFromConfig()

  // Al arrancar: comprobar servidores y lanzar un escaneo incremental.
  void refreshStatuses(false).then(() => {
    void startScan()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// El JsonStore escribe con debounce: sin este flush, el último save de progreso
// (el que guarda dónde te quedaste al cerrar) se puede perder. El ffmpeg de una
// sesión de transcode viva tampoco muere solo con el proceso padre.
app.on('before-quit', () => {
  // La instancia secundaria sale antes de inicializar los stores: no hay nada que guardar.
  if (!isPrimaryInstance) return
  void flushProgress()
  stopTranscodeSession()
  stopLanServer()
})
