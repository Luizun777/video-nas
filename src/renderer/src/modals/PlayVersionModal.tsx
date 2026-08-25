import { DownloadButton } from '@/components/DownloadButton'
import { downloadFor, useAppStore } from '@/store/app-store'

export function PlayVersionModal(): React.JSX.Element | null {
  const versionPickerItemId = useAppStore((s) => s.versionPickerItemId)
  const openVersionPicker = useAppStore((s) => s.openVersionPicker)
  const library = useAppStore((s) => s.library)
  const play = useAppStore((s) => s.play)
  const downloads = useAppStore((s) => s.downloads)

  const item = versionPickerItemId ? library.items[versionPickerItemId] : null
  if (!item || !item.versions || item.versions.length < 2) return null

  const close = (): void => openVersionPicker(null)

  const choose = (videoRelPath: string): void => {
    void play(item.id, videoRelPath)
    close()
  }

  const isDownloaded = (relPath: string): boolean =>
    downloadFor(downloads, item.id, relPath)?.state === 'done'

  // La versión ya descargada va primera: es la que se reproduce sin depender del NAS.
  const versions = [...item.versions].sort((a, b) => {
    const aDown = isDownloaded(a.videoRelPath) ? 1 : 0
    const bDown = isDownloaded(b.videoRelPath) ? 1 : 0
    return bDown - aDown
  })

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>Elige una versión</h2>
          <p>Este título tiene {item.versions.length} copias en el NAS.</p>
        </div>

        <div className="modal-body">
          {versions.map((version) => (
            <div key={version.videoRelPath} className="version-option">
              <div className="version-option-info">
                <div className="version-option-label">{version.label || 'Versión'}</div>
                {version.parts && (
                  <div className="version-option-sub">{version.parts.length} partes</div>
                )}
                {isDownloaded(version.videoRelPath) && (
                  <div className="version-option-sub">Copia local (descargada)</div>
                )}
              </div>
              {version.parts ? (
                <div className="version-option-parts">
                  {version.parts.map((part) => (
                    <div key={part.videoRelPath} className="version-option-parts">
                      <button className="btn btn-sm" onClick={() => choose(part.videoRelPath)}>
                        ▶ {part.label}
                      </button>
                      <DownloadButton itemId={item.id} relPath={part.videoRelPath} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="version-option-parts">
                  <button className="btn btn-primary btn-sm" onClick={() => choose(version.videoRelPath)}>
                    ▶ Reproducir
                  </button>
                  <DownloadButton itemId={item.id} relPath={version.videoRelPath} />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="modal-foot">
          <span />
          <button className="btn btn-sm" onClick={close}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
