import { NavLink, useNavigate } from 'react-router-dom'
import { useAppStore, visibleItems } from '@/store/app-store'

const LINKS = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/peliculas', label: 'Películas', end: false },
  { to: '/series', label: 'Series', end: false },
  { to: '/sin-identificar', label: 'Sin identificar', end: false }
]

export function TopNav(): React.JSX.Element {
  const navigate = useNavigate()
  const query = useAppStore((s) => s.query)
  const setQuery = useAppStore((s) => s.setQuery)
  const library = useAppStore((s) => s.library)
  const statuses = useAppStore((s) => s.statuses)
  const queue = useAppStore((s) => s.queue)

  const total = visibleItems(library).length
  const offlineCount = statuses.filter((s) => s.state === 'offline').length

  return (
    <nav className="nav">
      <span className="nav-brand">Video NAS</span>
      <div className="nav-links">
        {LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            {link.label}
          </NavLink>
        ))}
        <NavLink to="/cola" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
          {queue.length > 0 ? `Cola (${queue.length})` : 'Cola'}
        </NavLink>
      </div>
      <span className="nav-count">
        {total} título{total === 1 ? '' : 's'}
        {offlineCount > 0 && ` · ${offlineCount} servidor${offlineCount === 1 ? '' : 'es'} sin conexión`}
      </span>
      <input
        className="nav-search"
        type="search"
        placeholder="Buscar en tu biblioteca…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          if (event.target.value.trim()) navigate('/buscar')
        }}
      />
      <NavLink to="/ajustes" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
        Ajustes
      </NavLink>
    </nav>
  )
}
