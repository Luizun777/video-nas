import { useEffect, useRef } from 'react'
import type { PlaybackEngine } from './engine'

interface EngineSurfaceProps {
  engine: PlaybackEngine
  onClick?: () => void
  /** 'mini' + motor nativo: la superficie no se ve, así que se muestra la portada. */
  view?: 'full' | 'mini'
  posterUrl?: string | null
}

/**
 * La superficie donde "vive" el video. Con el motor HTML es el <video> real (y hace de
 * miniatura viva en la mini-barra); con el motor nativo (libVLC pinta DETRÁS del
 * WebView) es un hueco transparente que solo captura los taps.
 * El elemento debe ser SIEMPRE el mismo nodo entre cambios de target y de vista
 * full/mini: si React lo remonta, la reproducción se reinicia.
 */
export function EngineSurface({
  engine,
  onClick,
  view = 'full',
  posterUrl
}: EngineSurfaceProps): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    engine.attachMedia(ref.current)
    return () => engine.attachMedia(null)
  }, [engine])

  if (!engine.caps.rendersVideoInDom) {
    // El motor nativo sigue sonando en mini; aquí solo cambia qué se ve en la barra.
    if (view === 'mini' && posterUrl) {
      return <img className="player-video mini-native-poster" src={posterUrl} onClick={onClick} alt="" />
    }
    return <div className="player-video player-native-surface" onClick={onClick} />
  }

  return <video ref={ref} className="player-video" autoPlay onClick={onClick} />
}
