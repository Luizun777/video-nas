import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ChapterMarks, ExtraDetails, PlayTarget } from '@shared/types'
import { videoStreamUrl } from '@shared/playback-url'
import { posterSrc } from '@shared/media-src'
import { THUMB_SIZE, tmdbImageUrl } from '@shared/tmdb-images'
import { decideNextUp } from '@shared/next-up'
import { displayTitle, queuedItems, tmdbIndex, useAppStore } from '@/store/app-store'

/** Antes de este umbral desde el final se ofrece lo que siga (episodio/cola/recomendación). */
const NEXT_UP_THRESHOLD_SECONDS = 30
const NEXT_UP_COUNTDOWN_SECONDS = 15
const CONTROLS_HIDE_DELAY_MS = 3000
const SEEK_STEP_SECONDS = 10

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  return hours > 0 ? `${hours}:${mm}:${String(secs).padStart(2, '0')}` : `${mm}:${String(secs).padStart(2, '0')}`
}

export interface VideoPlayerProps {
  itemId: string
  relPath?: string
  startAt?: number
  /** true en la ventana separada: sin "Ver ficha" y Escape cierra la ventana. */
  standalone: boolean
  onClose: () => void
  onChangeTarget: (target: PlayTarget) => void
  /** Presente solo en el overlay: renderiza "Separar" con la posición actual. */
  onDetach?: (currentTimeSeconds: number) => void
  /** Presente solo en la ventana separada: renderiza "Volver a la app". */
  onReattach?: (currentTimeSeconds: number) => void
}

export function VideoPlayer({
  itemId,
  relPath,
  startAt,
  standalone,
  onClose,
  onChangeTarget,
  onDetach,
  onReattach
}: VideoPlayerProps): React.JSX.Element | null {
  const playExternal = useAppStore((s) => s.playExternal)
  const pushToast = useAppStore((s) => s.pushToast)
  const library = useAppStore((s) => s.library)
  const config = useAppStore((s) => s.config)
  const queue = useAppStore((s) => s.queue)
  const navigate = useNavigate()

  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef(0)
  const resumeAtRef = useRef<number | null>(null)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isPip, setIsPip] = useState(false)
  const [chapterMarks, setChapterMarks] = useState<ChapterMarks>({})
  const [skippedIntro, setSkippedIntro] = useState(false)
  const [nextUpState, setNextUpState] = useState<'hidden' | 'countdown' | 'cancelled'>('hidden')
  const [countdown, setCountdown] = useState(NEXT_UP_COUNTDOWN_SECONDS)
  const [extra, setExtra] = useState<ExtraDetails | null>(null)

  const item = library.items[itemId]
  const effectiveRelPath =
    relPath ?? item?.videoRelPath ?? item?.episodes?.[0]?.relPath ?? item?.relPath ?? ''

  const isSeries = item?.kind === 'tv'
  const ownedIndex = useMemo(() => tmdbIndex(library), [library])

  // Qué sigue al terminar: episodio > cola > nada. Puro y testeado en shared/next-up.ts.
  const decision = useMemo(() => {
    if (!item) return { kind: 'none' as const }
    return decideNextUp(item, effectiveRelPath, queuedItems(library, queue))
  }, [item, effectiveRelPath, library, queue])

  const introEnd = chapterMarks.introEndSeconds ?? (isSeries ? item?.introMark?.seconds : undefined)
  const autoSkipEnabled = config?.autoSkipIntro !== false
  const autoNextEpisodeEnabled = config?.autoPlayNextEpisode !== false

  const showSkipIntro =
    autoSkipEnabled && introEnd !== undefined && !skippedIntro && currentTime > 1 && currentTime < introEnd

  // Solo se ofrece marcar el intro a mano cuando el archivo no dice dónde está.
  const canMarkIntro = isSeries && chapterMarks.introEndSeconds === undefined

  // Pantallas táctiles: no hay mousemove real, así que el tap sobre el video alterna
  // los controles (patrón de reproductor móvil); pausar se hace con el botón.
  const isCoarsePointer = useMemo(() => window.matchMedia('(pointer: coarse)').matches, [])

  const revealControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_DELAY_MS)
  }, [])

  const handleVideoTap = useCallback(() => {
    if (controlsVisible) setControlsVisible(false)
    else revealControls()
  }, [controlsVisible, revealControls])

  // "Continuar viendo" (solo si la plataforma lo implementa — Android): se guarda la
  // posición cada ~10s y al pausar/cerrar; el store decide cuándo cuenta como visto.
  const saveProgress = useCallback(
    (positionSec: number, durationSec: number) => {
      if (!window.api.setPlaybackProgress || durationSec <= 0) return
      void window.api.setPlaybackProgress({
        key: `${itemId}::${effectiveRelPath}`,
        itemId,
        relPath: effectiveRelPath,
        positionSec,
        durationSec
      })
    },
    [itemId, effectiveRelPath]
  )

  // Cada vez que cambia lo que se reproduce (incluye avanzar de episodio/cola): estado limpio.
  useEffect(() => {
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setSkippedIntro(false)
    setNextUpState('hidden')
    setCountdown(NEXT_UP_COUNTDOWN_SECONDS)
    setChapterMarks({})
    revealControls()

    let cancelled = false
    void window.api.getChapterMarks(itemId, effectiveRelPath).then((marks) => {
      if (!cancelled) setChapterMarks(marks)
    })
    return () => {
      cancelled = true
    }
  }, [itemId, effectiveRelPath, revealControls])

  // Posición guardada del título actual, para reanudar al cargar el metadata.
  useEffect(() => {
    lastSavedRef.current = 0
    resumeAtRef.current = null
    if (!window.api.getPlaybackProgress || (startAt && startAt > 0)) return
    let cancelled = false
    void window.api.getPlaybackProgress().then((entries) => {
      if (cancelled) return
      const entry = entries.find((e) => e.key === `${itemId}::${effectiveRelPath}`)
      if (entry && !entry.finished) resumeAtRef.current = entry.positionSec
    })
    return () => {
      cancelled = true
    }
  }, [itemId, effectiveRelPath, startAt])

  // Reparto/relacionadas de películas: para la recomendación de secuela al terminar.
  useEffect(() => {
    if (!item?.tmdb || item.kind !== 'movie') {
      setExtra(null)
      return
    }
    if (item.extraDetails) {
      setExtra(item.extraDetails)
      return
    }
    let cancelled = false
    void window.api.getExtraDetails(item.id).then((updated) => {
      if (!cancelled) setExtra(updated?.extraDetails ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [item?.id, item?.tmdb?.id, item?.kind, item?.extraDetails])

  const handleClose = useCallback(() => {
    const video = videoRef.current
    if (video && video.duration) saveProgress(video.currentTime, video.duration)
    // No dejar una ventana PiP flotante huérfana ni la app atrapada en fullscreen.
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {})
    if (document.fullscreenElement) void document.exitFullscreen()
    onClose()
  }, [onClose, saveProgress])

  /** Avanza a lo que decidió next-up: episodio directo, o saca de la cola en main (atómico). */
  const advance = useCallback(async () => {
    if (decision.kind === 'episode') {
      onChangeTarget({ itemId, relPath: decision.episode.relPath })
      return
    }
    if (decision.kind === 'queue') {
      const entry = await window.api.shiftQueue(itemId)
      // Se reproduce lo que main devolvió (a prueba de carreras con la otra ventana).
      if (entry) onChangeTarget({ itemId: entry.itemId })
      else setNextUpState('cancelled')
    }
  }, [decision, itemId, onChangeTarget])

  // Cuenta regresiva del auto-avance.
  useEffect(() => {
    if (nextUpState !== 'countdown') return
    const timer = setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          clearInterval(timer)
          void advance()
          return 0
        }
        return value - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [nextUpState, advance])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }, [])

  const seekBy = useCallback((deltaSeconds: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + deltaSeconds))
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void containerRef.current?.requestFullscreen()
  }, [])

  const togglePip = useCallback(async () => {
    const video = videoRef.current
    if (!video) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await video.requestPictureInPicture()
    } catch {
      pushToast('No se pudo activar Picture in Picture con este video.', 'error')
    }
  }, [pushToast])

  useEffect(() => {
    const onFullscreenChange = (): void => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  // Estado PiP sincronizado con los eventos nativos del video.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onEnter = (): void => setIsPip(true)
    const onLeave = (): void => setIsPip(false)
    video.addEventListener('enterpictureinpicture', onEnter)
    video.addEventListener('leavepictureinpicture', onLeave)
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter)
      video.removeEventListener('leavepictureinpicture', onLeave)
    }
  }, [itemId, effectiveRelPath])

  // Atajos de teclado.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement) return
      switch (event.key) {
        case ' ':
          event.preventDefault()
          togglePlay()
          break
        case 'ArrowRight':
          seekBy(SEEK_STEP_SECONDS)
          break
        case 'ArrowLeft':
          seekBy(-SEEK_STEP_SECONDS)
          break
        case 'ArrowUp':
          event.preventDefault()
          setVolume((v) => Math.min(1, v + 0.1))
          break
        case 'ArrowDown':
          event.preventDefault()
          setVolume((v) => Math.max(0, v - 0.1))
          break
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        case 'Escape':
          if (!document.fullscreenElement) handleClose()
          break
      }
      revealControls()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePlay, seekBy, toggleFullscreen, handleClose, revealControls])

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume
  }, [volume])

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [])

  if (!item) return null

  const title = displayTitle(item)
  const episode = isSeries ? item.episodes?.find((e) => e.relPath === effectiveRelPath) : undefined
  const episodeName = episode
    ? item.tvDetails?.seasons.find((s) => s.season === episode.season)?.episodeNames[episode.episode]
    : undefined
  const subtitle = episode
    ? `T${episode.season} · E${episode.episode}${episodeName ? ` · ${episodeName}` : ''}`
    : undefined

  const outroStart = chapterMarks.outroStartSeconds
  const nextUpTrigger = outroStart ?? (duration > 0 ? duration - NEXT_UP_THRESHOLD_SECONDS : Infinity)
  const countdownActive = decision.kind === 'episode' ? autoNextEpisodeEnabled : decision.kind === 'queue'

  const handleTimeUpdate = (): void => {
    const video = videoRef.current
    if (!video) return
    setCurrentTime(video.currentTime)

    if (Math.abs(video.currentTime - lastSavedRef.current) >= 10) {
      lastSavedRef.current = video.currentTime
      saveProgress(video.currentTime, video.duration || 0)
    }

    if (countdownActive && nextUpState === 'hidden' && video.currentTime >= nextUpTrigger) {
      setCountdown(NEXT_UP_COUNTDOWN_SECONDS)
      setNextUpState('countdown')
    }
  }

  const handleEnded = (): void => {
    const video = videoRef.current
    if (video?.duration) saveProgress(video.duration, video.duration)
    if (countdownActive && nextUpState !== 'cancelled') void advance()
  }

  /**
   * Chromium no decodifica todos los códecs (DivX/MPEG-2 sobre todo). En vez de dejar una
   * pantalla negra, se abre el archivo en el reproductor externo sin preguntar nada.
   */
  const handleError = (): void => {
    handleClose()
    void playExternal(itemId, effectiveRelPath)
    pushToast(
      'Este formato no es compatible con el reproductor integrado. Se abrió en tu reproductor externo.'
    )
  }

  const handleSeekClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const video = videoRef.current
    if (!video || !video.duration) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    video.currentTime = ratio * video.duration
  }

  const handleSkipIntro = (): void => {
    const video = videoRef.current
    if (!video || introEnd === undefined) return
    video.currentTime = introEnd
    setSkippedIntro(true)
  }

  const handleMarkIntro = (): void => {
    const video = videoRef.current
    if (!video) return
    const seconds = Math.floor(video.currentTime)
    void window.api.setIntroMark(item.id, seconds).then(() => {
      pushToast(`Fin del intro marcado en ${formatTime(seconds)}. Se usará en los demás episodios.`)
    })
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0
  const queuePoster = decision.kind === 'queue' ? posterSrc(decision.item) : null

  // Recomendación al terminar una película, SOLO si no hay episodio ni cola pendientes.
  const recommendation = (() => {
    if (isSeries || decision.kind !== 'none' || !extra) return null
    const nearEnd = duration > 0 && currentTime >= duration - NEXT_UP_THRESHOLD_SECONDS
    if (!nearEnd) return null
    for (const related of extra.related) {
      const ownedItemId = ownedIndex.get(`${related.mediaType}:${related.id}`)
      if (ownedItemId && ownedItemId !== item.id) return { related, ownedItemId }
    }
    const first = extra.related[0]
    return first ? { related: first, ownedItemId: undefined } : null
  })()

  return (
    <div
      className="player-overlay"
      ref={containerRef}
      onMouseMove={isCoarsePointer ? undefined : revealControls}
      onDoubleClick={toggleFullscreen}
    >
      <video
        ref={videoRef}
        className="player-video"
        src={videoStreamUrl(itemId, effectiveRelPath)}
        autoPlay
        onClick={isCoarsePointer ? handleVideoTap : togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false)
          const video = videoRef.current
          if (video && video.duration) saveProgress(video.currentTime, video.duration)
        }}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration)
          // Separar/volver conservan la posición; los wrappers no pasan startAt en auto-avance.
          if (startAt && startAt > 0 && startAt < e.currentTarget.duration) {
            e.currentTarget.currentTime = startAt
          } else if (
            resumeAtRef.current &&
            resumeAtRef.current > 0 &&
            resumeAtRef.current < e.currentTarget.duration - 10
          ) {
            // Continuar viendo (Android): reanudar donde quedó.
            e.currentTarget.currentTime = resumeAtRef.current
          }
        }}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onError={handleError}
      />

      {showSkipIntro && (
        <button className="player-skip-intro" onClick={handleSkipIntro}>
          Saltar intro
        </button>
      )}

      {nextUpState === 'countdown' && decision.kind === 'episode' && (
        <div className="player-next-up">
          <div className="player-next-up-title">Siguiente episodio en {countdown}s</div>
          <div className="player-next-up-sub">
            T{decision.episode.season} · E{decision.episode.episode}
          </div>
          <div className="player-next-up-actions">
            <button className="btn btn-primary btn-sm" onClick={() => void advance()}>
              ▶ Reproducir ahora
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setNextUpState('cancelled')}>
              Seguir viendo este
            </button>
          </div>
        </div>
      )}

      {nextUpState === 'countdown' && decision.kind === 'queue' && (
        <div className="player-next-up">
          <div className="player-next-up-title">A continuación (de tu cola) en {countdown}s</div>
          <div className="player-recommend">
            {queuePoster && (
              <img
                className="player-recommend-poster"
                src={queuePoster}
                alt={displayTitle(decision.item)}
              />
            )}
            <div className="player-next-up-sub">{displayTitle(decision.item)}</div>
          </div>
          <div className="player-next-up-actions">
            <button className="btn btn-primary btn-sm" onClick={() => void advance()}>
              ▶ Reproducir ahora
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setNextUpState('cancelled')}>
              Seguir viendo este
            </button>
          </div>
        </div>
      )}

      {recommendation && (
        <div className="player-next-up">
          <div className="player-next-up-title">
            {recommendation.ownedItemId ? 'A continuación' : 'Te puede interesar'}
          </div>
          <div className="player-recommend">
            {recommendation.related.posterPath && (
              <img
                className="player-recommend-poster"
                src={tmdbImageUrl(recommendation.related.posterPath, THUMB_SIZE)}
                alt={recommendation.related.title}
              />
            )}
            <div>
              <div className="player-next-up-sub">{recommendation.related.title}</div>
              {!recommendation.ownedItemId && (
                <div className="player-next-up-sub">No está en tu NAS</div>
              )}
            </div>
          </div>
          {recommendation.ownedItemId && (
            <div className="player-next-up-actions">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => onChangeTarget({ itemId: recommendation.ownedItemId! })}
              >
                ▶ Ver ahora
              </button>
              {!standalone && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const targetId = recommendation.ownedItemId!
                    handleClose()
                    navigate(`/detalle/${encodeURIComponent(targetId)}`)
                  }}
                >
                  Ver ficha
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className={controlsVisible ? 'player-controls' : 'player-controls player-controls-hidden'}>
        <div className="player-header">
          <div>
            <div className="player-title">{title}</div>
            {subtitle && <div className="player-subtitle">{subtitle}</div>}
          </div>
          <div className="player-header-actions">
            {onDetach && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => onDetach(videoRef.current?.currentTime ?? 0)}
                title="Sigue viendo en una ventana aparte mientras navegas el catálogo"
              >
                ⧉ Separar
              </button>
            )}
            {onReattach && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => onReattach(videoRef.current?.currentTime ?? 0)}
              >
                ⇤ Volver a la app
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={handleClose}>
              ✕ Cerrar
            </button>
          </div>
        </div>

        <div className="player-bottom">
          <div className="player-progress" onClick={handleSeekClick}>
            <div className="player-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="player-buttons">
            <button className="btn btn-ghost btn-sm" onClick={togglePlay}>
              {playing ? '❚❚' : '▶'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => seekBy(-SEEK_STEP_SECONDS)}>
              ↺ 10s
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => seekBy(SEEK_STEP_SECONDS)}>
              10s ↻
            </button>
            <span className="player-time">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <span className="spacer" />
            {canMarkIntro && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleMarkIntro}
                title="Guarda este punto como fin del intro para toda la serie"
              >
                Marcar fin del intro
              </button>
            )}
            <input
              className="player-volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volumen"
            />
            {document.pictureInPictureEnabled && (
              <button className="btn btn-ghost btn-sm" onClick={() => void togglePip()}>
                {isPip ? 'Salir de PiP' : 'PiP'}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={toggleFullscreen}>
              {isFullscreen ? 'Salir' : 'Pantalla completa'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
