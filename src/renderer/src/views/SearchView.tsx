import { useMemo } from 'react'
import { PosterCard } from '@/components/PosterCard'
import { normalize, sortByTitle, useAppStore, visibleItems } from '@/store/app-store'

export function SearchView(): React.JSX.Element {
  const library = useAppStore((s) => s.library)
  const query = useAppStore((s) => s.query)

  const results = useMemo(() => {
    const needle = normalize(query.trim())
    if (!needle) return []
    return sortByTitle(
      visibleItems(library).filter((item) => {
        const haystack = [
          item.parsed.title,
          item.tmdb?.title ?? '',
          item.tmdb?.originalTitle ?? '',
          item.relPath
        ]
          .map(normalize)
          .join(' ')
        return haystack.includes(needle)
      })
    )
  }, [library, query])

  return (
    <div className="page">
      <h1 className="page-title">Búsqueda</h1>
      <p className="page-subtitle">
        {query.trim()
          ? `${results.length} resultado${results.length === 1 ? '' : 's'} para "${query.trim()}"`
          : 'Escribe algo en el buscador de arriba para filtrar tu biblioteca.'}
      </p>

      {results.length > 0 && (
        <div className="grid">
          {results.map((item) => (
            <PosterCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {query.trim() && results.length === 0 && (
        <div className="empty">
          <p>
            No hay coincidencias. La búsqueda mira el título del archivo, el de TheMovieDB y la ruta
            en el NAS.
          </p>
        </div>
      )}
    </div>
  )
}
