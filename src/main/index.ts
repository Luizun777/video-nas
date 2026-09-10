import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join, normalize } from 'node:path'
import { Readable } from 'node:stream'
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
import { cacheRoot, ensureCacheDirs } from './tmdb/image-cache'

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

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

function registerMediaCacheProtocol(): void {
  protocol.handle('mediacache', async (request) => {
    const url = new URL(request.url)
    // mediacache://posters/m-603-w342.jpg  ->  host="posters", pathname="/m-603-w342.jpg"
    const relative = decodeURIComponent(`${url.hostname}${url.pathname}`)
    const root = cacheRoot()
    const absolute = normalize(join(root, relative))

    if (!absolute.startsWith(root)) {
      return new Response('Ruta no permitida', { status: 403 })
    }

    try {
      await fs.access(absolute)
    } catch {
      return new Response('No encontrado', { status: 404 })
    }

    const extension = absolute.slice(absolute.lastIndexOf('.')).toLowerCase()
    const stream = createReadStream(absolute)
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        'Content-Type': MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000'
      }
    })
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
})
