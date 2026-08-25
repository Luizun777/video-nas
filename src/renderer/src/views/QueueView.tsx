import { useNavigate } from 'react-router-dom'
import { PlaceholderPoster } from '@/components/PlaceholderPoster'
import {
  displayTitle,
  displayYear,
  queuedItems,
  useAppStore
} from '@/store/app-store'

export function QueueView(): React.JSX.Element {
  const library = useAppStore((s) => s.library)
  const queue = useAppStore((s) => s.queue)
  const removeFromQueue = useAppStore((s) => s.removeFromQueue)
  const clearQueue = useAppStore((s) => s.clearQueue)
  const playSmart = useAppStore((s) => s.playSmart)
  const navigate = useNavigate()

  const items = queuedItems(library, queue)

  if (items.length === 0) {
    return (
      <div className="empty">
        <h2>Tu cola está vacía</h2>
        <p>
          Abre cualquier película o serie y usa <strong>Añadir a la cola</strong>. Cuando
          termine lo que estés viendo, seguirá lo siguiente de la cola automáticamente.
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/peliculas')}>
          Explorar películas
        </button>
      </div>
    )
  }

  return (
    <div className="page">
      <h1 className="page-title">Tu cola</h1>
      <p className="page-subtitle">
        Se reproducen en este orden al terminar lo que estés viendo.
      </p>

      <div className="toolbar">
        <span className="nav-count">
          {items.length} título{items.length === 1 ? '' : 's'} en cola
        </span>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => void clearQueue()}>
          Vaciar cola
        </button>
      </div>

      <div className="queue-list">
        {items.map((item, index) => {
          const title = displayTitle(item)
          const year = displayYear(item)
          return (
            <div className="queue-row" key={item.id}>
              <span className="queue-position">{index + 1}</span>
              <button
                className="queue-poster"
                onClick={() => navigate(`/detalle/${encodeURIComponent(item.id)}`)}
                title="Ver ficha"
              >
                {item.posterCache ? (
                  <img src={`mediacache://${item.posterCache}`} alt={title} />
                ) : (
                  <PlaceholderPoster title={title} year={year} />
                )}
              </button>
              <div className="queue-info">
                <div className="card-label">{title}</div>
                <div className="card-sub">
                  {year ?? 'Sin año'} · {item.kind === 'movie' ? 'Película' : 'Serie'}
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  void removeFromQueue(item.id)
                  playSmart(item.id)
                }}
              >
                ▶ Reproducir ya
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => void removeFromQueue(item.id)}>
                Quitar
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
