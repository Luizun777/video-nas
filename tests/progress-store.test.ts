import { describe, expect, it } from 'vitest'
import type { StoreIO } from '../src/core/io'
import {
  clearProgress,
  getAllProgress,
  getProgressFor,
  initProgressStore,
  setProgress
} from '../src/core/stores/progress-store'

// Con F10 el store corre también en el main de Electron (antes solo Android);
// se prueba con IO en memoria como el resto de stores de core.

function memoryIO(initial: Record<string, string> = {}): StoreIO {
  const files = new Map(Object.entries(initial))
  return {
    read: async (name) => files.get(name) ?? null,
    writeAtomic: async (name, contents) => {
      files.set(name, contents)
    }
  }
}

const ENTRY = {
  key: 'srv_a:Pelis/Amélie::Pelis/Amélie/Amélie.mkv',
  itemId: 'srv_a:Pelis/Amélie',
  relPath: 'Pelis/Amélie/Amélie.mkv',
  positionSec: 600,
  durationSec: 7200
}

describe('progress-store', () => {
  it('guarda una posición normal como no terminada', async () => {
    await initProgressStore(memoryIO())
    setProgress(ENTRY)

    const saved = getProgressFor(ENTRY.key)
    expect(saved?.positionSec).toBe(600)
    expect(saved?.finished).toBe(false)
    expect(saved?.updatedAt).toBeTruthy()
  })

  it('≥95% cuenta como terminado y la posición salta al final', async () => {
    await initProgressStore(memoryIO())
    setProgress({ ...ENTRY, positionSec: 7000 })

    const saved = getProgressFor(ENTRY.key)
    expect(saved?.finished).toBe(true)
    expect(saved?.positionSec).toBe(ENTRY.durationSec)
  })

  it('menos de 30 s no vale la pena: borra la entrada si existía', async () => {
    await initProgressStore(memoryIO())
    setProgress(ENTRY)
    setProgress({ ...ENTRY, positionSec: 10 })

    expect(getProgressFor(ENTRY.key)).toBeUndefined()
    expect(getAllProgress()).toHaveLength(0)
  })

  it('clearProgress elimina solo la clave pedida', async () => {
    await initProgressStore(memoryIO())
    setProgress(ENTRY)
    setProgress({ ...ENTRY, key: 'otra::clave', relPath: 'Otra.mkv' })

    clearProgress(ENTRY.key)
    expect(getProgressFor(ENTRY.key)).toBeUndefined()
    expect(getAllProgress()).toHaveLength(1)
  })

  it('un progress.json corrupto no revienta: parte de cero', async () => {
    await initProgressStore(memoryIO({ 'progress.json': '{esto no es json' }))
    expect(getAllProgress()).toEqual([])
  })
})
