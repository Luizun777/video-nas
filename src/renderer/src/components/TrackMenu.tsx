import { useEffect, useState } from 'react'
import type { TrackSet } from '@shared/types'
import type { PlaybackEngine } from '@/player/engine'

/**
 * "Audio y subtítulos": popover con radios alimentado por el motor de reproducción.
 * Compartido entre plataformas; si el motor no reporta pistas (o solo hay una de
 * audio y ningún subtítulo), el botón ni se muestra.
 */
export function TrackMenu({ engine }: { engine: PlaybackEngine }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [tracks, setTracks] = useState<TrackSet>(() => engine.listTracks())

  useEffect(() => {
    setTracks(engine.listTracks())
    return engine.on('tracksChanged', () => setTracks(engine.listTracks()))
  }, [engine])

  const worthShowing = tracks.audio.length > 1 || tracks.subtitles.length > 0
  if (!worthShowing) return null

  const subtitlesOff = !tracks.subtitles.some((t) => t.selected)

  return (
    <div className="track-menu">
      <button
        className={open ? 'btn btn-ghost btn-sm track-menu-open' : 'btn btn-ghost btn-sm'}
        onClick={() => setOpen((v) => !v)}
      >
        Audio y subtítulos
      </button>
      {open && (
        <div className="track-menu-pop">
          {tracks.audio.length > 0 && (
            <div className="track-menu-col">
              <div className="track-menu-heading">Audio</div>
              {tracks.audio.map((track) => (
                <label key={track.id} className="track-menu-option">
                  <input
                    type="radio"
                    name="audio-track"
                    checked={Boolean(track.selected)}
                    disabled={track.unsupported}
                    onChange={() => engine.setAudioTrack(track.id)}
                  />
                  <span>{track.label}</span>
                </label>
              ))}
            </div>
          )}
          {tracks.subtitles.length > 0 && (
            <div className="track-menu-col">
              <div className="track-menu-heading">Subtítulos</div>
              <label className="track-menu-option">
                <input
                  type="radio"
                  name="subtitle-track"
                  checked={subtitlesOff}
                  onChange={() => engine.setSubtitleTrack(null)}
                />
                <span>Desactivados</span>
              </label>
              {tracks.subtitles.map((track) => (
                <label
                  key={track.id}
                  className="track-menu-option"
                  title={track.unsupported ? 'Formato de imagen (PGS): no compatible aquí' : undefined}
                >
                  <input
                    type="radio"
                    name="subtitle-track"
                    checked={Boolean(track.selected)}
                    disabled={track.unsupported}
                    onChange={() => engine.setSubtitleTrack(track.id)}
                  />
                  <span>{track.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
