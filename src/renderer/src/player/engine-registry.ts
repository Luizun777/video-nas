import type { PlaybackEngine } from './engine'
import { HtmlVideoEngine } from './html-video-engine'

/**
 * Mismo patrón que setVideoUrlResolver (playback-url.ts): el boot móvil registra su
 * fábrica (VlcNativeEngine) antes de montar React; el desktop usa el default.
 */

type EngineFactory = () => PlaybackEngine

let factory: EngineFactory = () => new HtmlVideoEngine()

export function registerEngineFactory(next: EngineFactory): void {
  factory = next
}

export function createEngine(): PlaybackEngine {
  return factory()
}
