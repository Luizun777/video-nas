interface Props {
  title: string
  year?: number
}

/** Gradiente determinista a partir del título: la misma película siempre se ve igual. */
function hashOf(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export function PlaceholderPoster({ title, year }: Props): React.JSX.Element {
  const hash = hashOf(title)
  const hue = hash % 360
  const hue2 = (hue + 40 + (hash % 60)) % 360

  return (
    <div
      className="placeholder"
      style={{
        background: `linear-gradient(150deg, hsl(${hue} 42% 26%), hsl(${hue2} 38% 14%))`
      }}
    >
      <div className="placeholder-title">{title}</div>
      {year !== undefined && <div className="placeholder-year">{year}</div>}
    </div>
  )
}
