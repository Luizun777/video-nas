import { useMemo, useState } from 'react'
import type { LibraryItem } from '@shared/types'
import { GENRE_NAMES } from '@shared/genres'
import { PosterCard } from '@/components/PosterCard'
import { displayTitle, displayYear, sortByTitle, useAppStore, visibleItems } from '@/store/app-store'

type SortMode = 'titulo' | 'anio-desc' | 'anio-asc' | 'recientes'

interface Props {
  title: string
  subtitle: string
  filter: (item: LibraryItem) => boolean
  emptyMessage: string
}

export function CatalogView({ title, subtitle, filter, emptyMessage }: Props): React.JSX.Element {
  const library = useAppStore((s) => s.library)
  const [sortMode, setSortMode] = useState<SortMode>('titulo')
  const [letter, setLetter] = useState('')
  const [genreId, setGenreId] = useState<number | ''>('')

  const baseItems = useMemo(() => visibleItems(library).filter(filter), [library, filter])

  // Solo se ofrecen géneros que de verdad aparecen entre los títulos identificados.
  const availableGenres = useMemo(() => {
    const ids = new Set<number>()
    for (const item of baseItems) {
      for (const id of item.tmdb?.genreIds ?? []) if (GENRE_NAMES[id]) ids.add(id)
    }
    return [...ids].sort((a, b) => GENRE_NAMES[a].localeCompare(GENRE_NAMES[b], 'es'))
  }, [baseItems])

  const items = useMemo(() => {
    let list = baseItems

    if (genreId !== '') {
      list = list.filter((item) => item.tmdb?.genreIds.includes(genreId))
    }

    if (letter) {
      list = list.filter((item) => {
        const first = displayTitle(item).trim().charAt(0).toUpperCase()
        return letter === '#' ? !/[A-ZÁÉÍÓÚÑ]/.test(first) : first === letter
      })
    }

    switch (sortMode) {
      case 'anio-desc':
        return [...list].sort((a, b) => (displayYear(b) ?? 0) - (displayYear(a) ?? 0))
      case 'anio-asc':
        return [...list].sort((a, b) => (displayYear(a) ?? 9999) - (displayYear(b) ?? 9999))
      case 'recientes':
        return [...list].sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt))
      default:
        return sortByTitle(list)
    }
  }, [baseItems, sortMode, letter, genreId])

  const letters = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')]

  return (
    <div className="page">
      <h1 className="page-title">{title}</h1>
      <p className="page-subtitle">{subtitle}</p>

      <div className="toolbar">
        <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
          <option value="titulo">Ordenar por título</option>
          <option value="anio-desc">Año (más nuevo primero)</option>
          <option value="anio-asc">Año (más antiguo primero)</option>
          <option value="recientes">Agregadas recientemente</option>
        </select>
        <select value={letter} onChange={(e) => setLetter(e.target.value)}>
          <option value="">Todas las letras</option>
          {letters.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={genreId}
          onChange={(e) => setGenreId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">Todos los géneros</option>
          {availableGenres.map((id) => (
            <option key={id} value={id}>
              {GENRE_NAMES[id]}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <span className="nav-count">{items.length} resultados</span>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <p>{emptyMessage}</p>
        </div>
      ) : (
        <div className="grid">
          {items.map((item) => (
            <PosterCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
