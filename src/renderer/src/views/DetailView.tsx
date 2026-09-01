import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { CastMember, EpisodeEntry, LibraryItem, RelatedTitle } from '@shared/types'
import { PROFILE_SIZE, THUMB_SIZE, tmdbImageUrl } from '@shared/tmdb-images'
import { backdropSrc, posterSrc } from '@shared/media-src'
import { DownloadButton } from '@/components/DownloadButton'
import { PlaceholderPoster } from '@/components/PlaceholderPoster'
import { displayTitle, displayYear, inQueue, tmdbIndex, useAppStore } from '@/store/app-store'

function fileNameOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx === -1 ? relPath : relPath.slice(idx + 1)
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function CastPhoto({ url, name }: { url: string | null; name: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (!url || failed) {
    return <div className="cast-photo cast-photo-placeholder">{initialsOf(name)}</div>
  }
  return <img className="cast-photo" src={url} alt={name} onError={() => setFailed(true)} />
}

function CastRow({ cast }: { cast: CastMember[] }): React.JSX.Element {
  return (
    <div className="cast-row">
      {cast.map((member) => (
        <div key={member.id} className="cast-card">
          <CastPhoto
            url={member.profilePath ? tmdbImageUrl(member.profilePath, PROFILE_SIZE) : null}
            name={member.name}
          />
          <div className="cast-name">{member.name}</div>
          {member.character && <div className="cast-character">{member.character}</div>}
        </div>
      ))}
    </div>
  )
}

function RelatedCard({
  related,
  ownedItemId
}: {
  related: RelatedTitle
  ownedItemId?: string
}): React.JSX.Element {
  const navigate = useNavigate()
  const posterUrl = related.posterPath ? tmdbImageUrl(related.posterPath, THUMB_SIZE) : null

  const content = (
    <>
      <div className="card-poster">
        {posterUrl ? (
          <img src={posterUrl} alt={related.title} loading="lazy" />
        ) : (
          <PlaceholderPoster title={related.title} year={related.year ?? undefined} />
        )}
      </div>
      <div className="card-label">{related.title}</div>
      <div className="card-sub">
        {related.year ?? 'Sin año'}
        {!ownedItemId && ' · No está en tu NAS'}
      </div>
    </>
  )

  if (ownedItemId) {
    return (
      <button className="card" onClick={() => navigate(`/detalle/${encodeURIComponent(ownedItemId)}`)}>
        {content}
      </button>
    )
  }
  return <div className="card related-card-disabled">{content}</div>
}

function SeasonPicker({
  item,
  detailed
}: {
  item: LibraryItem
  detailed: LibraryItem | null
}): React.JSX.Element {
  const play = useAppStore((s) => s.play)
  const episodes = item.episodes ?? []

  const seasons = useMemo(() => {
    const unique = [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b)
    return unique
  }, [episodes])

  const [season, setSeason] = useState<number>(seasons[0] ?? 1)

  useEffect(() => {
    if (seasons.length > 0 && !seasons.includes(season)) setSeason(seasons[0])
  }, [seasons, season])

  const seasonDetails = detailed?.tvDetails?.seasons.find((s) => s.season === season)
  const list: EpisodeEntry[] = episodes.filter((e) => e.season === season)

  return (
    <div>
      {seasons.length > 1 && (
        <div className="season-tabs">
          {seasons.map((number) => (
            <button
              key={number}
              className={number === season ? 'season-tab active' : 'season-tab'}
              onClick={() => setSeason(number)}
            >
              Temporada {number}
            </button>
          ))}
        </div>
      )}

      <div className="episode-list">
        {list.map((episode) => (
          <div key={episode.relPath} className="episode">
            <button className="episode-main" onClick={() => void play(item.id, episode.relPath)}>
              <span className="episode-number">{episode.episode}</span>
              <span className="episode-name">
                <div>
                  {seasonDetails?.episodeNames[episode.episode] ?? `Episodio ${episode.episode}`}
                </div>
                <div className="episode-file">{fileNameOf(episode.relPath)}</div>
              </span>
              <span className="btn btn-ghost btn-sm">▶ Reproducir</span>
            </button>
            <DownloadButton itemId={item.id} relPath={episode.relPath} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function DetailView(): React.JSX.Element {
  const { itemId } = useParams<{ itemId: string }>()
  const navigate = useNavigate()
  const library = useAppStore((s) => s.library)
  const play = useAppStore((s) => s.play)
  const playSmart = useAppStore((s) => s.playSmart)
  const playExternal = useAppStore((s) => s.playExternal)
  const playRandomEpisode = useAppStore((s) => s.playRandomEpisode)
  const openEditor = useAppStore((s) => s.openEditor)
  const pushToast = useAppStore((s) => s.pushToast)
  const statuses = useAppStore((s) => s.statuses)
  const queue = useAppStore((s) => s.queue)
  const addToQueue = useAppStore((s) => s.addToQueue)
  const removeFromQueue = useAppStore((s) => s.removeFromQueue)

  const decodedId = itemId ? decodeURIComponent(itemId) : ''
  const item = library.items[decodedId]
  const ownedIndex = useMemo(() => tmdbIndex(library), [library])

  const [detailed, setDetailed] = useState<LibraryItem | null>(null)
  const [extra, setExtra] = useState<LibraryItem | null>(null)

  // Los nombres de episodio se piden solo al abrir el detalle de una serie.
  useEffect(() => {
    setDetailed(null)
    if (!item || item.kind !== 'tv' || !item.tmdb) return
    let cancelled = false
    void window.api.getTvDetails(item.id).then((updated) => {
      if (!cancelled) setDetailed(updated)
    })
    return () => {
      cancelled = true
    }
  }, [item?.id, item?.tmdb?.id])

  // Reparto, dirección y relacionadas: se piden lazy y quedan cacheadas en el item.
  useEffect(() => {
    setExtra(null)
    if (!item?.tmdb) return
    let cancelled = false
    void window.api.getExtraDetails(item.id).then((updated) => {
      if (!cancelled) setExtra(updated)
    })
    return () => {
      cancelled = true
    }
  }, [item?.id, item?.tmdb?.id])

  if (!item) {
    return (
      <div className="empty">
        <h2>No encontramos este título</h2>
        <p>Puede que se haya eliminado del NAS o que la biblioteca se haya vuelto a escanear.</p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          Volver al inicio
        </button>
      </div>
    )
  }

  const title = displayTitle(item)
  const year = displayYear(item)
  const offline = statuses.some((s) => s.serverId === item.serverId && s.state === 'offline')
  const backdrop = backdropSrc(item)
  const poster = posterSrc(item)

  return (
    <div>
      <header className="detail-hero">
        {backdrop && (
          <div className="hero-bg" style={{ backgroundImage: `url("${backdrop}")` }} />
        )}
        <div className="hero-scrim" />
        <div className="detail-flex">
          <div className="detail-poster">
            {poster ? (
              <img src={poster} alt={title} />
            ) : (
              <PlaceholderPoster title={title} year={year} />
            )}
          </div>
          <div className="detail-info">
            <h1 className="detail-title">{title}</h1>
            {item.tmdb?.originalTitle && item.tmdb.originalTitle !== title && (
              <div className="detail-original">Título original: {item.tmdb.originalTitle}</div>
            )}
            <div className="chips">
              {year !== undefined && <span className="chip">{year}</span>}
              <span className="chip">{item.kind === 'movie' ? 'Película' : 'Serie'}</span>
              {item.tmdb && item.tmdb.voteAverage > 0 && (
                <span className="chip">★ {item.tmdb.voteAverage.toFixed(1)}</span>
              )}
              {item.kind === 'tv' && item.episodes && (
                <span className="chip">{item.episodes.length} episodios</span>
              )}
              {item.versions && item.versions.length >= 2 && (
                <span className="chip">{item.versions.length} versiones</span>
              )}
              {item.identify === 'unidentified' && <span className="chip">Sin identificar</span>}
              {item.identify === 'file-only' && <span className="chip">Solo nombre de archivo</span>}
              {item.identify === 'manual' && <span className="chip">Corregido manualmente</span>}
              {offline && <span className="chip">Servidor sin conexión</span>}
            </div>
          </div>
        </div>
      </header>

      <div className="detail-body">
        {item.tmdb?.overview ? (
          <p className="detail-overview">{item.tmdb.overview}</p>
        ) : (
          <p className="detail-overview">
            No hay sinopsis para este título. Usa <strong>Editar información</strong> para buscarlo
            manualmente en TheMovieDB y traer su portada real.
          </p>
        )}

        {extra?.extraDetails && extra.extraDetails.directors.length > 0 && (
          <p className="detail-directors">
            <strong>{item.kind === 'movie' ? 'Dirección' : 'Creación'}:</strong>{' '}
            {extra.extraDetails.directors.join(', ')}
          </p>
        )}

        <div className="toolbar">
          {item.kind === 'movie' && item.versions && item.versions.length >= 2 && (
            <button className="btn btn-primary" onClick={() => playSmart(item.id)}>
              ▶ Reproducir
            </button>
          )}
          {item.kind === 'movie' && (!item.versions || item.versions.length < 2) && !item.parts && (
            <button className="btn btn-primary" onClick={() => void play(item.id)}>
              ▶ Reproducir
            </button>
          )}
          {(!item.versions || item.versions.length < 2) &&
            item.parts?.map((part) => (
              <button
                key={part.videoRelPath}
                className="btn btn-primary"
                onClick={() => void play(item.id, part.videoRelPath)}
              >
                ▶ {part.label}
              </button>
            ))}
          {item.kind === 'movie' && (!item.versions || item.versions.length < 2) && item.videoRelPath && (
            <DownloadButton itemId={item.id} relPath={item.videoRelPath} />
          )}
          {item.versions && item.versions.length >= 2 && (
            <span className="settings-hint">Elige una versión para descargarla.</span>
          )}
          {item.kind === 'tv' && (item.episodes?.length ?? 0) > 1 && (
            <button
              className="btn btn-primary"
              onClick={() => playRandomEpisode(item.id)}
              title="Reproduce un episodio al azar; al terminar, sale otro al azar"
            >
              🔀 Aleatorio
            </button>
          )}
          <button
            className="btn"
            onClick={() =>
              inQueue(queue, item.id) ? void removeFromQueue(item.id) : void addToQueue(item.id)
            }
          >
            {inQueue(queue, item.id) ? '✓ En la cola' : '＋ Añadir a la cola'}
          </button>
          <button className="btn" onClick={() => openEditor(item.id)}>
            Editar información
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => void playExternal(item.id)}
            title="Abre este título en VLC u otro reproductor instalado"
          >
            Reproductor externo
          </button>
          {window.api.capabilities.revealInFiles && (
            <button
              className="btn btn-ghost"
              onClick={() =>
                void window.api.revealInFinder(item.id).then((result) => {
                  if (!result.ok) pushToast(result.error ?? 'No se pudo abrir el Finder.', 'error')
                })
              }
            >
              Mostrar en Finder
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>
            ← Volver
          </button>
        </div>

        {item.kind === 'tv' && <SeasonPicker item={item} detailed={detailed} />}

        {extra?.extraDetails && extra.extraDetails.cast.length > 0 && (
          <section className="detail-section">
            <h2 className="row-title">Reparto</h2>
            <CastRow cast={extra.extraDetails.cast} />
          </section>
        )}

        {extra?.extraDetails && extra.extraDetails.related.length > 0 && (
          <section className="detail-section">
            <h2 className="row-title">Relacionadas</h2>
            <div className="related-scroller">
              {extra.extraDetails.related.map((related) => (
                <RelatedCard
                  key={`${related.mediaType}:${related.id}`}
                  related={related}
                  ownedItemId={ownedIndex.get(`${related.mediaType}:${related.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        <div className="path-hint">{item.relPath}</div>
      </div>
    </div>
  )
}
