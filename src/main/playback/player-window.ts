import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import type { PlayTarget } from '@shared/types'

// Ventana separada del reproductor: una sola a la vez (singleton). Es un reproductor
// completo y autónomo: auto-avanza episodios y continúa la cola sin la ventana principal.

let playerWindow: BrowserWindow | null = null

/** Target guardado cuando se hace reattach sin ventana principal viva (macOS). */
let pendingAttach: PlayTarget | null = null

function playerHash(target: PlayTarget): string {
  const params = new URLSearchParams({ itemId: target.itemId })
  if (target.relPath) params.set('relPath', target.relPath)
  if (target.startAt && target.startAt > 0) params.set('t', String(Math.floor(target.startAt)))
  return `/reproductor?${params.toString()}`
}

function loadInto(window: BrowserWindow, hash: string): void {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void window.loadURL(`${devServerUrl}#${hash}`)
  } else {
    // URLSearchParams percent-encoda acentos y '/', así que el hash es ASCII-safe.
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
}

export function openPlayerWindow(target: PlayTarget): void {
  const hash = playerHash(target)

  if (playerWindow && !playerWindow.isDestroyed()) {
    loadInto(playerWindow, hash)
    playerWindow.focus()
    return
  }

  playerWindow = new BrowserWindow({
    width: 960,
    height: 540,
    minWidth: 480,
    minHeight: 270,
    show: false,
    backgroundColor: '#000000',
    title: 'Reproductor — Video NAS',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  playerWindow.once('ready-to-show', () => playerWindow?.show())
  // Cerrar la ventana simplemente detiene la reproducción; no hay nada más que limpiar.
  playerWindow.on('closed', () => {
    playerWindow = null
  })

  loadInto(playerWindow, hash)
}

export function closePlayerWindow(): void {
  if (playerWindow && !playerWindow.isDestroyed()) playerWindow.close()
  playerWindow = null
}

/** Primera ventana viva que no sea la del reproductor (la del catálogo). */
export function findCatalogWindow(): BrowserWindow | null {
  return (
    BrowserWindow.getAllWindows().find(
      (window) => window !== playerWindow && !window.isDestroyed()
    ) ?? null
  )
}

export function setPendingAttach(target: PlayTarget): void {
  pendingAttach = target
}

export function consumePendingAttach(): PlayTarget | null {
  const target = pendingAttach
  pendingAttach = null
  return target
}
