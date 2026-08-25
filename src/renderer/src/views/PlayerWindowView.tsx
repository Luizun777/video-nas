import { useSearchParams } from 'react-router-dom'
import { VideoPlayer } from '@/components/VideoPlayer'
import { useAppStore } from '@/store/app-store'

/**
 * Contenido de la ventana separada del reproductor. La URL (hash) es el único estado:
 * `#/reproductor?itemId=..&relPath=..&t=..` — auto-avanzar de episodio o de cola reescribe
 * los params, así que un reload reanuda el mismo título.
 */
export function PlayerWindowView(): React.JSX.Element {
  const [params, setParams] = useSearchParams()
  const itemId = params.get('itemId') ?? ''
  const relPath = params.get('relPath') ?? undefined
  const t = Number(params.get('t'))
  const startAt = Number.isFinite(t) && t > 0 ? t : undefined

  const booted = useAppStore((s) => s.config !== null)
  const item = useAppStore((s) => s.library.items[itemId])

  if (!booted) {
    return <div className="player-window-status">Cargando…</div>
  }

  if (!item) {
    return (
      <div className="player-window-status">
        <p>Este título ya no está en la biblioteca.</p>
        <button className="btn" onClick={() => window.close()}>
          Cerrar
        </button>
      </div>
    )
  }

  return (
    <VideoPlayer
      itemId={itemId}
      relPath={relPath}
      startAt={startAt}
      standalone
      onClose={() => window.close()}
      onChangeTarget={(target) => {
        const next = new URLSearchParams({ itemId: target.itemId })
        if (target.relPath) next.set('relPath', target.relPath)
        // Sin `t`: el nuevo título empieza desde cero.
        setParams(next, { replace: true })
      }}
      onReattach={(seconds) => {
        void window.api.reattachPlayer({ itemId, relPath, startAt: seconds })
      }}
    />
  )
}
