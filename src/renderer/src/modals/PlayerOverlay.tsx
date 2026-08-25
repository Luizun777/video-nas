import { useEffect } from 'react'
import { VideoPlayer } from '@/components/VideoPlayer'
import { useAppStore } from '@/store/app-store'

/**
 * Wrapper del reproductor para la ventana principal: overlay controlado por el store.
 * También escucha el "volver a la app" desde la ventana separada — esta suscripción vive
 * aquí a propósito, porque este componente NO se monta en la ventana separada.
 */
export function PlayerOverlay(): React.JSX.Element | null {
  const playingTarget = useAppStore((s) => s.playingTarget)
  const openPlayer = useAppStore((s) => s.openPlayer)
  const closePlayer = useAppStore((s) => s.closePlayer)

  useEffect(() => {
    const unsubscribe = window.api.onPlayerAttach((target) => openPlayer(target))
    // Si la ventana principal se recreó durante un reattach, el target quedó pendiente en main.
    void window.api.consumePendingAttach().then((target) => {
      if (target) openPlayer(target)
    })
    return unsubscribe
  }, [openPlayer])

  if (!playingTarget) return null

  return (
    <VideoPlayer
      itemId={playingTarget.itemId}
      relPath={playingTarget.relPath}
      startAt={playingTarget.startAt}
      standalone={false}
      onClose={closePlayer}
      onChangeTarget={openPlayer}
      onDetach={
        // Sin ventanas separadas en la plataforma (Android): el botón no se renderiza.
        window.api.capabilities.separateWindow
          ? (seconds) => {
              const target = { ...playingTarget, startAt: seconds }
              closePlayer()
              void window.api.openPlayerWindow(target)
            }
          : undefined
      }
    />
  )
}
