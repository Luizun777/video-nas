import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ScanProgressBar } from '@/components/ScanProgressBar'
import { Toasts } from '@/components/Toasts'
import { TopNav } from '@/components/TopNav'
import { EditMetadataModal } from '@/modals/EditMetadataModal'
import { PlayVersionModal } from '@/modals/PlayVersionModal'
import { PlayerOverlay } from '@/modals/PlayerOverlay'
import { CatalogView } from '@/views/CatalogView'
import { DetailView } from '@/views/DetailView'
import { HomeView } from '@/views/HomeView'
import { PlayerWindowView } from '@/views/PlayerWindowView'
import { QueueView } from '@/views/QueueView'
import { SearchView } from '@/views/SearchView'
import { SettingsView } from '@/views/SettingsView'
import { useAppStore } from '@/store/app-store'

export function App(): React.JSX.Element {
  const bootstrap = useAppStore((s) => s.bootstrap)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  // La ventana separada del reproductor carga la misma app con este hash: se renderiza
  // SOLO el reproductor (sin nav ni modales de catálogo). El hash no cambia de familia
  // dentro de una misma carga, así que evaluar aquí es seguro.
  const isPlayerWindow = window.location.hash.startsWith('#/reproductor')
  if (isPlayerWindow) {
    return (
      <HashRouter>
        <PlayerWindowView />
        <Toasts />
      </HashRouter>
    )
  }

  return (
    <HashRouter>
      <div className="app">
        <TopNav />
        <main className="content">
          <Routes>
            <Route path="/" element={<HomeView />} />
            <Route
              path="/peliculas"
              element={
                <CatalogView
                  title="Películas"
                  subtitle="Todo lo que hay en las carpetas de películas de tus NAS."
                  filter={(item) => item.kind === 'movie'}
                  emptyMessage="No hay películas con este filtro."
                />
              }
            />
            <Route
              path="/series"
              element={
                <CatalogView
                  title="Series"
                  subtitle="Cada serie agrupa sus temporadas y episodios."
                  filter={(item) => item.kind === 'tv'}
                  emptyMessage="No hay series con este filtro."
                />
              }
            />
            <Route
              path="/sin-identificar"
              element={
                <CatalogView
                  title="Sin identificar"
                  subtitle="Títulos que TheMovieDB no reconoció, o que pediste dejar con el nombre del archivo. Ábrelos y usa “Editar información” para asignarles la portada correcta."
                  filter={(item) =>
                    item.identify === 'unidentified' || item.identify === 'file-only'
                  }
                  emptyMessage="Todo tu catálogo está identificado."
                />
              }
            />
            <Route path="/buscar" element={<SearchView />} />
            <Route path="/cola" element={<QueueView />} />
            <Route path="/detalle/:itemId" element={<DetailView />} />
            <Route path="/ajustes" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <ScanProgressBar />
        <EditMetadataModal />
        <PlayVersionModal />
        <PlayerOverlay />
        <Toasts />
      </div>
    </HashRouter>
  )
}
