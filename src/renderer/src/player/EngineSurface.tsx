import { useEffect, useRef } from 'react'
import type { PlaybackEngine } from './engine'

interface EngineSurfaceProps {
  engine: PlaybackEngine
  onClick?: () => void
}

/**
 * La superficie donde "vive" el video. Con el motor HTML es el <video> real (y hace de
 * miniatura viva en la mini-barra); con el motor nativo (libVLC pinta DETRÁS del
 * WebView) es un hueco transparente que solo captura los taps.
 * El elemento debe ser SIEMPRE el mismo nodo entre cambios de target y de vista
 * full/mini: si React lo remonta, la reproducción se reinicia.
 */
export function EngineSurface({ engine, onClick }: EngineSurfaceProps): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    engine.attachMedia(ref.current)
    return () => engine.attachMedia(null)
  }, [engine])

  if (!engine.caps.rendersVideoInDom) {
    return <div className="player-video player-native-surface" onClick={onClick} />
  }

  return <video ref={ref} className="player-video" autoPlay onClick={onClick} />
}
