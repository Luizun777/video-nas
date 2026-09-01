import type { TrackSet } from '@shared/types'

/**
 * Abstracción del motor de reproducción. La UI (VideoPlayer y la mini-barra) es una
 * sola para todas las plataformas; lo que cambia es quién decodifica:
 *   - HtmlVideoEngine: el <video> de Chromium (desktop, y Android hasta F13).
 *   - VlcNativeEngine: libVLC detrás del WebView (Android, F13).
 * Mismo patrón que los resolvers de playback-url.ts: el boot de cada plataforma
 * registra su fábrica en engine-registry.ts.
 */

export interface EngineCaps {
  /** El motor puede entrar a Picture-in-Picture del navegador. */
  pip: boolean
  /** Fullscreen vía la API HTML del contenedor (el motor nativo va siempre a pantalla). */
  htmlFullscreen: boolean
  /** true = renderiza un <video> en el DOM (sirve de miniatura viva en la mini-barra). */
  rendersVideoInDom: boolean
  /** true = el motor dibuja los subtítulos él mismo (libVLC); false = <track> WebVTT. */
  nativeSubtitles: boolean
}

export interface EngineLoadTarget {
  itemId: string
  relPath: string
  /** Segundos donde empezar: separar/volver o "continuar viendo". */
  startAt?: number
}

export type EngineEvent =
  | 'timeupdate'
  | 'durationchange'
  | 'play'
  | 'pause'
  | 'ended'
  | 'tracksChanged'

export interface EngineError {
  reason: 'codec' | 'network' | 'unknown'
}

export interface EngineState {
  currentTime: number
  duration: number
  playing: boolean
}

export interface PlaybackEngine {
  readonly caps: EngineCaps
  /** Solo el motor HTML: el <video> que renderiza EngineSurface (para PiP). */
  readonly videoElement?: HTMLVideoElement | null

  /** EngineSurface conecta aquí el <video> que renderizó (null al desmontar). */
  attachMedia(el: HTMLVideoElement | null): void
  load(target: EngineLoadTarget): void
  play(): void
  pause(): void
  seekTo(seconds: number): void
  seekBy(deltaSeconds: number): void
  setVolume(volume01: number): void
  getState(): EngineState

  listTracks(): TrackSet
  setAudioTrack(id: string): void
  setSubtitleTrack(id: string | null): void

  /** 'mini' oculta el video nativo (el audio sigue); el motor HTML no necesita nada. */
  setViewMode(mode: 'full' | 'mini'): void

  on(event: EngineEvent, cb: () => void): () => void
  onError(cb: (error: EngineError) => void): () => void
  destroy(): void
}
