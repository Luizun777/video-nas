import { useAppStore } from '@/store/app-store'

export function ScanProgressBar(): React.JSX.Element | null {
  const progress = useAppStore((s) => s.progress)
  if (!progress.running) return null

  const hasTotal = progress.total > 0
  const percent = hasTotal ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div className="scan-bar">
      <span className="scan-label">{progress.label || 'Escaneando…'}</span>
      {hasTotal && (
        <span className="nav-count">
          {progress.current} / {progress.total}
        </span>
      )}
      <div className="scan-track">
        <div
          className={hasTotal ? 'scan-fill' : 'scan-fill scan-indeterminate'}
          style={hasTotal ? { width: `${percent}%` } : undefined}
        />
      </div>
      <button className="btn btn-ghost btn-sm" onClick={() => void window.api.cancelScan()}>
        Detener
      </button>
    </div>
  )
}
