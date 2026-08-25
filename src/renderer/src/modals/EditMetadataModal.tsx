import { useEffect, useState } from 'react'
import type { MediaKind, TmdbSearchResult } from '@shared/types'
import { displayYear, useAppStore } from '@/store/app-store'

export function EditMetadataModal(): React.JSX.Element | null {
  const editingItemId = useAppStore((s) => s.editingItemId)
  const openEditor = useAppStore((s) => s.openEditor)
  const library = useAppStore((s) => s.library)
  const config = useAppStore((s) => s.config)
  const pushToast = useAppStore((s) => s.pushToast)

  const item = editingItemId ? library.items[editingItemId] : null

  const [query, setQuery] = useState('')
  const [year, setYear] = useState('')
  const [kind, setKind] = useState<MediaKind>('movie')
  const [results, setResults] = useState<TmdbSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)

  // Al abrir el modal se precarga lo que sabemos del archivo.
  useEffect(() => {
    if (!item) return
    setQuery(item.parsed.title)
    setYear(item.parsed.year ? String(item.parsed.year) : '')
    setKind(item.kind)
    setResults([])
    setSearched(false)
  }, [item?.id])

  if (!item) return null

  const close = (): void => openEditor(null)

  const runSearch = async (): Promise<void> => {
    if (!query.trim()) return
    setSearching(true)
    setSearched(true)
    const parsedYear = year.trim() ? Number(year.trim()) : undefined
    const found = await window.api.tmdbSearch(
      query.trim(),
      Number.isFinite(parsedYear) ? parsedYear : undefined,
      kind
    )
    setResults(found)
    setSearching(false)
  }

  const choose = async (result: TmdbSearchResult): Promise<void> => {
    const updated = await window.api.applyOverride(item.id, {
      mode: 'tmdb',
      tmdbId: result.id,
      mediaType: result.mediaType,
      setAt: new Date().toISOString()
    })
    if (updated?.tmdb) pushToast(`Ahora "${item.parsed.title}" se muestra como "${updated.tmdb.title}".`)
    else pushToast('No se pudo aplicar la corrección.', 'error')
    close()
  }

  const useFileNameOnly = async (): Promise<void> => {
    await window.api.applyOverride(item.id, { mode: 'file-only', setAt: new Date().toISOString() })
    pushToast('Este título usará solo el nombre del archivo.')
    close()
  }

  const restoreAutomatic = async (): Promise<void> => {
    await window.api.clearOverride(item.id)
    pushToast('Corrección eliminada. Vuelve a escanear para identificarlo automáticamente.')
    close()
  }

  const noToken = !config?.tmdbBearerToken

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>Editar información</h2>
          <p>
            Archivo en el NAS: <code>{item.relPath}</code>
            {displayYear(item) !== undefined ? ` · Año detectado: ${displayYear(item)}` : ''}
          </p>
        </div>

        <div className="modal-body">
          {noToken ? (
            <div className="empty">
              <h2>No hay token de TheMovieDB</h2>
              <p>
                Sin token la app funciona en modo sin API key: se muestra el título tal como está en
                el archivo. Agrega tu token en Ajustes para poder buscar portadas.
              </p>
            </div>
          ) : (
            <>
              <div className="field-row">
                <input
                  autoFocus
                  value={query}
                  placeholder="Título real de la película o serie"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void runSearch()
                  }}
                />
                <input
                  style={{ flex: '0 0 100px', minWidth: 100 }}
                  value={year}
                  placeholder="Año"
                  inputMode="numeric"
                  onChange={(event) => setYear(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void runSearch()
                  }}
                />
                <select
                  style={{ flex: '0 0 130px' }}
                  value={kind}
                  onChange={(event) => setKind(event.target.value as MediaKind)}
                >
                  <option value="movie">Película</option>
                  <option value="tv">Serie</option>
                </select>
                <button className="btn btn-primary" onClick={() => void runSearch()} disabled={searching}>
                  {searching ? 'Buscando…' : 'Buscar'}
                </button>
              </div>

              {searched && !searching && results.length === 0 && (
                <p className="settings-hint">
                  TheMovieDB no devolvió resultados. Prueba con el título original en inglés, o quita
                  el año.
                </p>
              )}

              {results.map((result) => (
                <button key={result.id} className="result" onClick={() => void choose(result)}>
                  {result.posterUrl ? (
                    <img className="result-poster" src={result.posterUrl} alt={result.title} />
                  ) : (
                    <div className="result-poster" />
                  )}
                  <div>
                    <div className="result-title">{result.title}</div>
                    <div className="result-meta">
                      {result.year ?? 'Sin año'}
                      {result.originalTitle && result.originalTitle !== result.title
                        ? ` · ${result.originalTitle}`
                        : ''}
                      {result.voteAverage > 0 ? ` · ★ ${result.voteAverage.toFixed(1)}` : ''}
                    </div>
                    <div className="result-overview">{result.overview || 'Sin sinopsis.'}</div>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>

        <div className="modal-foot">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => void useFileNameOnly()}>
              Usar solo el nombre del archivo
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void restoreAutomatic()}>
              Restaurar automático
            </button>
          </div>
          <button className="btn btn-sm" onClick={close}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
