import { downloadFor, useAppStore } from '@/store/app-store'

interface Props {
  itemId: string
  relPath: string
  className?: string
}

/** Botón de descarga con sus 4 estados: sin descargar, en curso, con error, completada. */
export function DownloadButton({ itemId, relPath, className }: Props): React.JSX.Element {
  const downloads = useAppStore((s) => s.downloads)
  const startDownload = useAppStore((s) => s.startDownload)
  const cancelDownload = useAppStore((s) => s.cancelDownload)
  const deleteDownload = useAppStore((s) => s.deleteDownload)

  const cls = className ?? 'btn btn-ghost btn-sm'
  const entry = downloadFor(downloads, itemId, relPath)

  if (!entry) {
    return (
      <button className={cls} onClick={() => void startDownload(itemId, relPath)}>
        ⬇ Descargar
      </button>
    )
  }

  if (entry.state === 'queued' || entry.state === 'downloading') {
    const percent =
      entry.totalBytes > 0 ? Math.round((entry.bytesDone / entry.totalBytes) * 100) : 0
    return (
      <button className={cls} onClick={() => void cancelDownload(itemId, relPath)}>
        {entry.state === 'queued' ? 'En cola… (cancelar)' : `${percent}% · Cancelar`}
      </button>
    )
  }

  if (entry.state === 'error') {
    return (
      <button className={cls} title={entry.error} onClick={() => void startDownload(itemId, relPath)}>
        ⚠ Reintentar descarga
      </button>
    )
  }

  return (
    <button className={cls} onClick={() => void deleteDownload(itemId, relPath)}>
      ✓ Descargada · Eliminar
    </button>
  )
}
