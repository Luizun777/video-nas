import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LibraryItem } from '@shared/types'
import { GENRE_NAMES } from '@shared/genres'
import { Row } from '@/components/Row'
import {
  displayTitle,
  displayYear,
  hasLocalCopy,
  queuedItems,
  sortByTitle,
  useAppStore,
  visibleItems
} from '@/store/app-store'

/** Filas por género con al menos esta cantidad de títulos identificados. */
const MIN_GENRE_ROW_SIZE = 5
const MAX_GENRE_ROWS = 3

function Hero({ item }: { item: LibraryItem }): React.JSX.Element {
  const navigate = useNavigate()
  const play = useAppStore((s) => s.play)
  const playSmart = useAppStore((s) => s.playSmart)
  const title = displayTitle(item)
  const year = displayYear(item)

  return (
    <header className="hero">
      {item.backdropCache && (
        <div
          className="hero-bg"
          style={{ backgroundImage: `url("mediacache://${item.backdropCache}")` }}
        />
      )}
      <div className="hero-scrim" />
      <div className="hero-body">
        <div className="hero-kicker">{item.kind === 'movie' ? 'Película' : 'Serie'}</div>
        <h1 className="hero-title">{title}</h1>
        <div className="hero-meta">
          {year !== undefined && <span>{year}</span>}
          {item.tmdb && item.tmdb.voteAverage > 0 && (
            <span>★ {item.tmdb.voteAverage.toFixed(1)}</span>
          )}
          {item.kind === 'tv' && item.episodes && <span>{item.episodes.length} episodios</span>}
        </div>
        {item.tmdb?.overview && <p className="hero-overview">{item.tmdb.overview}</p>}
        <div className="hero-actions">
          <button
            className="btn btn-primary"
            onClick={() =>
              item.kind === 'tv' ? void play(item.id, item.episodes?.[0]?.relPath) : playSmart(item.id)
            }
          >
            ▶ Reproducir
          </button>
          <button
            className="btn"
            onClick={() => navigate(`/detalle/${encodeURIComponent(item.id)}`)}
          >
            Más información
          </button>
        </div>
      </div>
    </header>
  )
}

export function HomeView(): React.JSX.Element {
  const library = useAppStore((s) => s.library)
  const progress = useAppStore((s) => s.progress)
  const downloads = useAppStore((s) => s.downloads)
  const queue = useAppStore((s) => s.queue)
  const navigate = useNavigate()

  const items = useMemo(() => visibleItems(library), [library])

  const { hero, recent, movies, series, unidentified, genreRows, downloaded } = useMemo(() => {
    const movies = sortByTitle(items.filter((item) => item.kind === 'movie'))
    const series = sortByTitle(items.filter((item) => item.kind === 'tv'))
    const unidentified = sortByTitle(
      items.filter((item) => item.identify === 'unidentified' || item.identify === 'file-only')
    )
    const recent = [...items]
      .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt))
      .slice(0, 30)

    // El hero necesita un backdrop: se elige entre los identificados que tengan uno.
    const candidates = items.filter((item) => item.backdropCache && item.tmdb?.overview)
    const hero =
      candidates.length > 0
        ? candidates[Math.floor(Date.now() / 60000) % candidates.length]
        : items[0]

    // Filas por género: solo los más representados en la biblioteca, para no saturar Inicio.
    const byGenre = new Map<number, LibraryItem[]>()
    for (const item of items) {
      for (const id of item.tmdb?.genreIds ?? []) {
        if (!GENRE_NAMES[id]) continue
        const bucket = byGenre.get(id)
        if (bucket) bucket.push(item)
        else byGenre.set(id, [item])
      }
    }
    const genreRows = [...byGenre.entries()]
      .filter(([, list]) => list.length >= MIN_GENRE_ROW_SIZE)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, MAX_GENRE_ROWS)
      .map(([id, list]) => ({ id, name: GENRE_NAMES[id], items: sortByTitle(list) }))

    const downloaded = sortByTitle(items.filter((item) => hasLocalCopy(downloads, item)))

    return { hero, recent, movies, series, unidentified, genreRows, downloaded }
  }, [items, downloads])

  if (items.length === 0) {
    return (
      <div className="empty">
        <h2>Tu biblioteca está vacía</h2>
        <p>
          {progress.running
            ? 'Estamos escaneando tu NAS. Las portadas irán apareciendo conforme se identifiquen los títulos.'
            : 'No encontramos títulos todavía. Revisa que el NAS esté conectado y que las carpetas configuradas existan.'}
        </p>
        {!progress.running && (
          <button className="btn btn-primary" onClick={() => navigate('/ajustes')}>
            Ir a Ajustes
          </button>
        )}
      </div>
    )
  }

  return (
    <div>
      {hero && <Hero item={hero} />}
      <Row title="Tu cola" items={queuedItems(library, queue)} />
      <Row title="Descargadas" items={downloaded} />
      <Row title="Agregadas recientemente" items={recent} />
      <Row title="Películas" items={movies} />
      <Row title="Series" items={series} />
      {genreRows.map((row) => (
        <Row key={row.id} title={row.name} items={row.items} />
      ))}
      <Row title="Sin identificar" items={unidentified} />
    </div>
  )
}
