import { useNavigate } from 'react-router-dom'
import type { LibraryItem } from '@shared/types'
import { displayTitle, displayYear, hasLocalCopy, useAppStore } from '@/store/app-store'
import { PlaceholderPoster } from './PlaceholderPoster'

interface Props {
  item: LibraryItem
}

export function PosterCard({ item }: Props): React.JSX.Element {
  const navigate = useNavigate()
  const statuses = useAppStore((s) => s.statuses)
  const downloads = useAppStore((s) => s.downloads)
  const offline = statuses.some(
    (status) => status.serverId === item.serverId && status.state === 'offline'
  )
  const downloaded = hasLocalCopy(downloads, item)

  const title = displayTitle(item)
  const year = displayYear(item)
  const unidentified = item.identify === 'unidentified' || item.identify === 'file-only'

  return (
    <button
      className="card"
      onClick={() => navigate(`/detalle/${encodeURIComponent(item.id)}`)}
      title={title}
    >
      <div className="card-poster">
        {item.posterCache ? (
          <img src={`mediacache://${item.posterCache}`} alt={title} loading="lazy" />
        ) : (
          <PlaceholderPoster title={title} year={year} />
        )}
        {/* Prioridad: Descargada > Sin conexión > Del archivo — una copia local siempre
            se puede reproducir, así que "sin conexión" sería engañoso. */}
        {downloaded ? (
          <span className="badge badge-downloaded">Descargada</span>
        ) : offline ? (
          <span className="badge badge-offline">Sin conexión</span>
        ) : (
          unidentified && <span className="badge badge-unidentified">Del archivo</span>
        )}
      </div>
      <div>
        <div className="card-label">{title}</div>
        <div className="card-sub">
          {year ?? 'Sin año'}
          {item.kind === 'tv' && item.episodes ? ` · ${item.episodes.length} episodios` : ''}
        </div>
      </div>
    </button>
  )
}
