import { useEffect, useState } from 'react'
import type {
  DiscoveredServer,
  DownloadEntry,
  ExternalPlayerInfo,
  MediaKind,
  PlaybackMode,
  ServerConfig,
  ServerStatus
} from '@shared/types'
import { displayTitle, useAppStore } from '@/store/app-store'

const STATE_LABEL: Record<ServerStatus['state'], string> = {
  online: 'Conectado',
  offline: 'Sin conexión',
  mounting: 'Conectando…',
  disabled: 'Desactivado'
}

const DOWNLOAD_STATE_LABEL: Record<DownloadEntry['state'], string> = {
  queued: 'En cola',
  downloading: 'Descargando',
  done: 'Completada',
  error: 'Con error'
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

function newLocalServer(): ServerConfig {
  return {
    id: '',
    name: 'NAS nuevo',
    host: '',
    share: '',
    folders: [
      { path: 'Movies', kind: 'movie' },
      { path: 'TvShow', kind: 'tv' }
    ],
    enabled: true
  }
}

function ServerEditor({
  server,
  status,
  onChange,
  onRemove
}: {
  server: ServerConfig
  status: ServerStatus | undefined
  onChange: (next: ServerConfig) => void
  onRemove: () => void
}): React.JSX.Element {
  const state = status?.state ?? (server.enabled ? 'offline' : 'disabled')

  return (
    <div className="server-card">
      <div className="server-head">
        <span className={`status-dot status-${state}`} title={STATE_LABEL[state]} />
        <span className="server-name">{server.name || 'Sin nombre'}</span>
        <span className="nav-count">
          {STATE_LABEL[state]}
          {status?.mountPoint ? ` · ${status.mountPoint}` : ''}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onChange({ ...server, enabled: !server.enabled })}
        >
          {server.enabled ? 'Desactivar' : 'Activar'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onRemove}>
          Eliminar
        </button>
      </div>

      {status?.message && <p className="settings-hint">{status.message}</p>}

      <div className="field-row">
        <div style={{ flex: 1 }}>
          <label className="field-label">Nombre</label>
          <input
            value={server.name}
            onChange={(e) => onChange({ ...server, name: e.target.value })}
            placeholder="NAS de la sala"
          />
        </div>
        <div style={{ flex: 1.4 }}>
          <label className="field-label">Dirección (IP, hostname o IP de Tailscale)</label>
          <input
            value={server.host}
            onChange={(e) => onChange({ ...server, host: e.target.value.trim() })}
            placeholder="192.168.1.100"
          />
        </div>
        <div style={{ flex: 0.8 }}>
          <label className="field-label">Share</label>
          <input
            value={server.share}
            onChange={(e) => onChange({ ...server, share: e.target.value.trim() })}
            placeholder="video"
          />
        </div>
      </div>

      {window.api.capabilities.smbCredentials && (
        <div className="field-row">
          <div style={{ flex: 1 }}>
            <label className="field-label">Usuario SMB</label>
            <input
              value={server.username ?? ''}
              autoComplete="off"
              onChange={(e) => onChange({ ...server, username: e.target.value })}
              placeholder="usuario del NAS"
            />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">Contraseña</label>
            <input
              type="password"
              value={server.password ?? ''}
              autoComplete="new-password"
              onChange={(e) => onChange({ ...server, password: e.target.value })}
              placeholder="contraseña"
            />
          </div>
          <div style={{ flex: 0.7 }}>
            <label className="field-label">Dominio (opcional)</label>
            <input
              value={server.domain ?? ''}
              autoComplete="off"
              onChange={(e) => onChange({ ...server, domain: e.target.value })}
              placeholder="WORKGROUP"
            />
          </div>
        </div>
      )}

      <label className="field-label">Carpetas a escanear dentro del share</label>
      {server.folders.map((folder, index) => (
        <div className="folder-row" key={index}>
          <input
            value={folder.path}
            placeholder="Movies"
            onChange={(e) => {
              const folders = [...server.folders]
              folders[index] = { ...folder, path: e.target.value }
              onChange({ ...server, folders })
            }}
          />
          <select
            value={folder.kind}
            onChange={(e) => {
              const folders = [...server.folders]
              folders[index] = { ...folder, kind: e.target.value as MediaKind }
              onChange({ ...server, folders })
            }}
          >
            <option value="movie">Películas</option>
            <option value="tv">Series</option>
          </select>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() =>
              onChange({ ...server, folders: server.folders.filter((_, i) => i !== index) })
            }
          >
            Quitar
          </button>
        </div>
      ))}
      <button
        className="btn btn-ghost btn-sm"
        onClick={() =>
          onChange({ ...server, folders: [...server.folders, { path: '', kind: 'movie' }] })
        }
      >
        + Agregar carpeta
      </button>
    </div>
  )
}

export function SettingsView(): React.JSX.Element {
  const config = useAppStore((s) => s.config)
  const statuses = useAppStore((s) => s.statuses)
  const library = useAppStore((s) => s.library)
  const progress = useAppStore((s) => s.progress)
  const downloads = useAppStore((s) => s.downloads)
  const deleteDownload = useAppStore((s) => s.deleteDownload)
  const reloadConfig = useAppStore((s) => s.reloadConfig)
  const reloadLibrary = useAppStore((s) => s.reloadLibrary)
  const pushToast = useAppStore((s) => s.pushToast)

  const [token, setToken] = useState('')
  const [servers, setServers] = useState<ServerConfig[]>([])
  const [downloadsPath, setDownloadsPath] = useState('')
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('embedded')
  const [externalPlayerPath, setExternalPlayerPath] = useState<string | null>(null)
  const [autoPlayNextEpisode, setAutoPlayNextEpisode] = useState(true)
  const [autoSkipIntro, setAutoSkipIntro] = useState(true)
  const [externalPlayers, setExternalPlayers] = useState<ExternalPlayerInfo[]>([])
  const [testing, setTesting] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [discovered, setDiscovered] = useState<DiscoveredServer[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!config) return
    setToken(config.tmdbBearerToken ?? '')
    setServers(config.servers)
    setDownloadsPath(config.downloadsPath ?? '')
    setPlaybackMode(config.playbackMode ?? 'embedded')
    setExternalPlayerPath(config.externalPlayerPath ?? null)
    setAutoPlayNextEpisode(config.autoPlayNextEpisode ?? true)
    setAutoSkipIntro(config.autoSkipIntro ?? true)
    setDirty(false)
  }, [config])

  useEffect(() => {
    if (playbackMode === 'external' || externalPlayerPath) {
      void window.api.listExternalPlayers().then(setExternalPlayers)
    }
  }, [playbackMode, externalPlayerPath])

  const missingCount = Object.values(library.items).filter((item) => item.missing).length
  const downloadedBytes = downloads
    .filter((entry) => entry.state === 'done')
    .reduce((sum, entry) => sum + entry.totalBytes, 0)

  const save = async (): Promise<void> => {
    await window.api.saveConfig({
      tmdbBearerToken: token.trim() || null,
      servers,
      downloadsPath: downloadsPath.trim() || undefined,
      playbackMode,
      externalPlayerPath,
      autoPlayNextEpisode,
      autoSkipIntro
    })
    await reloadConfig()
    setDirty(false)
    pushToast('Ajustes guardados.')
  }

  const testToken = async (): Promise<void> => {
    setTesting(true)
    const result = await window.api.testTmdbToken(token.trim())
    setTesting(false)
    if (result.ok) pushToast('El token funciona correctamente.')
    else pushToast(result.error ?? 'El token no es válido.', 'error')
  }

  const discover = async (): Promise<void> => {
    setDiscovering(true)
    const found = await window.api.discoverSmbServers()
    setDiscovering(false)
    setDiscovered(found)
    if (found.length === 0) pushToast('No se encontraron servidores SMB en la red local.')
  }

  const updateServer = (index: number, next: ServerConfig): void => {
    const copy = [...servers]
    copy[index] = next
    setServers(copy)
    setDirty(true)
  }

  return (
    <div className="page">
      <h1 className="page-title">Ajustes</h1>
      <p className="page-subtitle">Servidores, metadata y acceso remoto.</p>

      {/* ------------------------------------------------------------ TMDB */}
      <section className="settings-section">
        <h2>TheMovieDB</h2>
        <p className="settings-hint">
          El token trae portadas y sinopsis en español. Si lo dejas vacío, la app sigue funcionando
          en <strong>modo sin API key</strong>: cada título se muestra con el nombre real leído del
          archivo y una portada generada.
        </p>
        <div className="field-row">
          <input
            type="password"
            value={token}
            placeholder="Token de lectura (API Read Access Token v4)"
            onChange={(e) => {
              setToken(e.target.value)
              setDirty(true)
            }}
          />
          <button className="btn btn-ghost" onClick={() => void testToken()} disabled={testing || !token.trim()}>
            {testing ? 'Probando…' : 'Probar conexión'}
          </button>
        </div>
      </section>

      {/* --------------------------------------------------------- servidores */}
      <section className="settings-section">
        <h2>Servidores NAS</h2>
        <p className="settings-hint">
          Puedes agregar todos los NAS que quieras: la biblioteca combina el contenido de todos. Si
          uno está apagado, sus títulos siguen visibles marcados como “sin conexión”.
        </p>

        {servers.map((server, index) => (
          <ServerEditor
            key={server.id || `nuevo-${index}`}
            server={server}
            status={statuses.find((s) => s.serverId === server.id)}
            onChange={(next) => updateServer(index, next)}
            onRemove={() => {
              setServers(servers.filter((_, i) => i !== index))
              setDirty(true)
            }}
          />
        ))}

        <div className="toolbar" style={{ marginTop: 16, marginBottom: 0 }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setServers([...servers, newLocalServer()])
              setDirty(true)
            }}
          >
            + Agregar servidor
          </button>
          {window.api.capabilities.mdnsDiscovery && (
            <button className="btn btn-ghost" onClick={() => void discover()} disabled={discovering}>
              {discovering ? 'Buscando…' : 'Buscar en la red'}
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={() => void window.api.refreshServerStatuses()}
          >
            Reconectar servidores
          </button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={() => void save()} disabled={!dirty}>
            Guardar cambios
          </button>
        </div>

        {discovered.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <label className="field-label">Encontrados en la red</label>
            {discovered.map((found) => (
              <div className="folder-row" key={found.host}>
                <span style={{ flex: 1 }}>
                  {found.name} <span className="nav-count">({found.host})</span>
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setServers([...servers, { ...newLocalServer(), name: found.name, host: found.host }])
                    setDirty(true)
                  }}
                >
                  Agregar
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- escaneo */}
      <section className="settings-section">
        <h2>Biblioteca</h2>
        <p className="settings-hint">
          El escaneo es incremental: solo consulta TheMovieDB para los títulos nuevos. Tus
          correcciones manuales nunca se pierden al volver a escanear.
        </p>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button
            className="btn btn-primary"
            onClick={() => void window.api.startScan()}
            disabled={progress.running}
          >
            {progress.running ? 'Escaneando…' : 'Escanear ahora'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => void window.api.startScan({ full: true })}
            disabled={progress.running}
            title="Vuelve a preguntar a TheMovieDB por todos los títulos identificados automáticamente"
          >
            Re-identificar todo
          </button>
          {missingCount > 0 && (
            <button
              className="btn btn-ghost"
              onClick={() =>
                void window.api.purgeMissing().then(async (removed) => {
                  await reloadLibrary()
                  pushToast(`Se eliminaron ${removed} títulos que ya no están en el NAS.`)
                })
              }
            >
              Limpiar {missingCount} título{missingCount === 1 ? '' : 's'} ausente
              {missingCount === 1 ? '' : 's'}
            </button>
          )}
          <span className="spacer" />
          <span className="nav-count">
            {Object.keys(library.items).length} títulos catalogados
          </span>
        </div>
      </section>

      {/* ---------------------------------------------------------- reproductor */}
      <section className="settings-section">
        <h2>Reproductor</h2>
        <p className="settings-hint">
          El reproductor integrado reproduce dentro de la app, con salto de intro y avance
          automático de episodio. Si un archivo usa un formato que no soporta (por ejemplo
          x265/HEVC), se abrirá solo en tu reproductor externo, sin que hagas nada.
        </p>

        <div className="field-row">
          <label className="radio-row">
            <input
              type="radio"
              name="playback-mode"
              checked={playbackMode === 'embedded'}
              onChange={() => {
                setPlaybackMode('embedded')
                setDirty(true)
              }}
            />
            Reproductor integrado (recomendado)
          </label>
          <label className="radio-row">
            <input
              type="radio"
              name="playback-mode"
              checked={playbackMode === 'external'}
              onChange={() => {
                setPlaybackMode('external')
                setDirty(true)
              }}
            />
            Siempre abrir en un reproductor externo
          </label>
        </div>

        {(playbackMode === 'external' || externalPlayerPath) && (
          <div style={{ marginBottom: 14 }}>
            <label className="field-label">Aplicación externa</label>
            <label className="radio-row">
              <input
                type="radio"
                name="external-player"
                checked={!externalPlayerPath}
                onChange={() => {
                  setExternalPlayerPath(null)
                  setDirty(true)
                }}
              />
              {window.api.capabilities.platform === 'android'
                ? 'La que Android tenga asociada al video'
                : 'La que macOS tenga asociada al archivo'}
            </label>
            {externalPlayers.map((player) => (
              <label className="radio-row" key={player.path}>
                <input
                  type="radio"
                  name="external-player"
                  checked={externalPlayerPath === player.path}
                  onChange={() => {
                    setExternalPlayerPath(player.path)
                    setDirty(true)
                  }}
                />
                {player.name}
              </label>
            ))}
            {externalPlayerPath && !externalPlayers.some((p) => p.path === externalPlayerPath) && (
              <label className="radio-row">
                <input type="radio" name="external-player" checked readOnly />
                {externalPlayerPath.split('/').pop()?.replace(/\.app$/, '') ?? externalPlayerPath}
              </label>
            )}
            {window.api.capabilities.chooseExternalPlayerFile && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  void window.api.chooseExternalPlayer().then((path) => {
                    if (path) {
                      setExternalPlayerPath(path)
                      setDirty(true)
                    }
                  })
                }
              >
                Elegir otra aplicación…
              </button>
            )}
          </div>
        )}

        <label className="radio-row">
          <input
            type="checkbox"
            checked={autoPlayNextEpisode}
            onChange={(e) => {
              setAutoPlayNextEpisode(e.target.checked)
              setDirty(true)
            }}
          />
          Reproducir el siguiente episodio automáticamente
        </label>
        <label className="radio-row">
          <input
            type="checkbox"
            checked={autoSkipIntro}
            onChange={(e) => {
              setAutoSkipIntro(e.target.checked)
              setDirty(true)
            }}
          />
          Ofrecer saltar el intro cuando sea posible
        </label>

        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={() => void save()} disabled={!dirty}>
            Guardar cambios
          </button>
        </div>
      </section>

      {/* ----------------------------------------------------------- descargas */}
      <section className="settings-section">
        <h2>Descargas (modo offline)</h2>
        <p className="settings-hint">
          Lo que descargues se reproduce sin el NAS conectado. Cambiar la carpeta no mueve las
          descargas ya hechas.
        </p>
        <div className="field-row">
          <input
            value={downloadsPath}
            placeholder="Carpeta de descargas"
            // En Android la carpeta es fija (almacenamiento de la app): no se edita.
            disabled={window.api.capabilities.platform === 'android'}
            onChange={(e) => {
              setDownloadsPath(e.target.value)
              setDirty(true)
            }}
          />
          <button className="btn btn-primary" onClick={() => void save()} disabled={!dirty}>
            Guardar
          </button>
        </div>

        {downloads.length === 0 ? (
          <p className="settings-hint">Todavía no has descargado nada.</p>
        ) : (
          <>
            <div className="toolbar" style={{ marginBottom: 12 }}>
              <span className="nav-count">
                {downloads.filter((d) => d.state === 'done').length} completadas ·{' '}
                {formatBytes(downloadedBytes)} ocupados
              </span>
              <span className="spacer" />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  for (const entry of downloads) void deleteDownload(entry.itemId, entry.relPath)
                }}
              >
                Eliminar todas
              </button>
            </div>
            {downloads.map((entry) => {
              const item = library.items[entry.itemId]
              const percent =
                entry.totalBytes > 0 ? Math.round((entry.bytesDone / entry.totalBytes) * 100) : 0
              return (
                <div className="folder-row" key={entry.key}>
                  <span style={{ flex: 1 }}>
                    {item ? displayTitle(item) : entry.itemId}{' '}
                    <span className="nav-count">
                      — {DOWNLOAD_STATE_LABEL[entry.state]}
                      {entry.state === 'downloading' && ` (${percent}%)`}
                      {entry.state === 'done' && ` · ${formatBytes(entry.totalBytes)}`}
                      {entry.state === 'error' && entry.error ? ` · ${entry.error}` : ''}
                    </span>
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void deleteDownload(entry.itemId, entry.relPath)}
                  >
                    Eliminar
                  </button>
                </div>
              )
            })}
          </>
        )}
      </section>

      {/* ---------------------------------------------------- acceso remoto */}
      <section className="settings-section">
        <h2>Acceso remoto (fuera de tu red)</h2>
        <div className="remote-help">
          <p>
            <strong>Nunca abras el puerto 445 de SMB en tu router.</strong> Es uno de los puertos más
            escaneados por atacantes. La forma segura de ver tu NAS desde fuera es una VPN de malla
            como Tailscale (basada en WireGuard): este dispositivo y tu NAS quedan como si
            estuvieran en la misma red local.
          </p>
          <ol>
            <li>
              Instala Tailscale en el NAS (paquete oficial de Synology/QNAP o el contenedor Docker).
              Si tu NAS no lo soporta, instálalo en una Raspberry Pi de tu casa y anúnciala como ruta
              de subred: <code>sudo tailscale up --advertise-routes=192.168.0.0/24</code>
            </li>
            <li>
              Instala Tailscale en este dispositivo e inicia sesión con la misma cuenta.
            </li>
            <li>
              Anota la dirección que Tailscale le da al NAS: una IP tipo <code>100.x.y.z</code> o un
              nombre MagicDNS como <code>nas.tu-tailnet.ts.net</code>.
            </li>
            <li>
              Arriba, en <strong>Servidores NAS</strong>, agrega un servidor con esa dirección y el
              mismo share. No hace falta nada más: la app monta el SMB igual que en casa.
            </li>
          </ol>
          <p>
            Ten en cuenta que la velocidad dependerá de la subida de tu internet doméstico, así que
            una película en 4K puede tardar en abrir. La app espera hasta 60 segundos a que el share
            monte antes de marcar el servidor como sin conexión.
          </p>
        </div>
      </section>
    </div>
  )
}
