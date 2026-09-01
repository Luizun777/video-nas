import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

// Espejo TS del plugin Java (android/.../VlcPlayerPlugin.java + VlcPlayerManager.java).
// Cualquier cambio aquí debe reflejarse allá: este archivo ES el contrato JS↔nativo.

export interface VlcTrack {
  /** Id interno de libVLC (entero ≥0; la entrada "Disable" -1 se filtra en nativo). */
  id: number
  /** Nombre que reporta libVLC: "Español [AC3 5.1]", "Track 1", etc. */
  name: string
}

export interface VlcEvent {
  kind: 'playing' | 'paused' | 'time' | 'duration' | 'ended' | 'error' | 'buffering' | 'tracks'
  timeMs: number
  durationMs: number
  message?: string
}

export interface VlcPlayerPluginApi {
  /** Abre y reproduce. La superficie nativa queda DEBAJO del WebView transparente. */
  open(options: { url: string; startAtMs?: number }): Promise<{ ok: boolean }>

  play(): Promise<void>
  pause(): Promise<void>
  seek(options: { timeMs: number }): Promise<void>
  /** 0..100 (escala nativa de libVLC). */
  setVolume(options: { volume: number }): Promise<void>

  getTracks(): Promise<{
    audio: VlcTrack[]
    subtitles: VlcTrack[]
    selectedAudio: number
    selectedSubtitle: number
  }>
  setAudioTrack(options: { id: number }): Promise<void>
  /** id null = apagar subtítulos (spu -1 en libVLC). */
  setSubtitleTrack(options: { id: number | null }): Promise<void>
  /** .srt/.ass externo servido por el puente HTTP; select lo activa de inmediato. */
  addSubtitleSlave(options: { url: string; select?: boolean }): Promise<void>

  /** 'fullscreen' = video a pantalla; 'hidden' = solo audio (mini-barra). */
  setVideoLayout(options: { mode: 'fullscreen' | 'hidden' }): Promise<void>

  close(): Promise<void>

  addListener(eventName: 'vlcEvent', cb: (event: VlcEvent) => void): Promise<PluginListenerHandle>
}

export const VlcPlayer = registerPlugin<VlcPlayerPluginApi>('VlcPlayer')
