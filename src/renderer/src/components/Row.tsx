import type { LibraryItem } from '@shared/types'
import { PosterCard } from './PosterCard'

interface Props {
  title: string
  items: LibraryItem[]
  limit?: number
}

export function Row({ title, items, limit = 30 }: Props): React.JSX.Element | null {
  if (items.length === 0) return null
  const shown = items.slice(0, limit)

  return (
    <section className="row">
      <div className="row-header">
        <h2 className="row-title">{title}</h2>
        <span className="row-count">
          {items.length > shown.length
            ? `${shown.length} de ${items.length}`
            : `${items.length} título${items.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="row-scroller">
        {shown.map((item) => (
          <PosterCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}
