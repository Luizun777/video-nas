/**
 * Barra persistente tipo Spotify: se muestra cuando el reproductor está minimizado.
 * Presentacional a propósito — el estado vive en VideoPlayer, que nunca se desmonta
 * al minimizar (si se desmontara, la reproducción se reiniciaría).
 */
export interface MiniPlayerBarProps {
  title: string
  subtitle?: string
  playing: boolean
  progressPercent: number
  canAdvance: boolean
  onTogglePlay: () => void
  onNext: () => void
  onExpand: () => void
  onClose: () => void
}

export function MiniPlayerBar({
  title,
  subtitle,
  playing,
  progressPercent,
  canAdvance,
  onTogglePlay,
  onNext,
  onExpand,
  onClose
}: MiniPlayerBarProps): React.JSX.Element {
  return (
    <div className="mini-player-info" onClick={onExpand} title="Volver al reproductor">
      <div className="mini-player-progress">
        <div className="mini-player-progress-fill" style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="mini-player-text">
        <div className="mini-player-title">{title}</div>
        {subtitle && <div className="mini-player-subtitle">{subtitle}</div>}
      </div>
      <div className="mini-player-buttons" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-ghost btn-sm" onClick={onTogglePlay} aria-label="Reproducir o pausar">
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onNext}
          disabled={!canAdvance}
          aria-label="Siguiente"
        >
          ⏭
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Cerrar reproductor">
          ✕
        </button>
      </div>
    </div>
  )
}
