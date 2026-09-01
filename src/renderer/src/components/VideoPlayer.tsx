import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ChapterMarks, ExtraDetails, PlayTarget } from '@shared/types'
import { posterSrc } from '@shared/media-src'
import { THUMB_SIZE, tmdbImageUrl } from '@shared/tmdb-images'
import { decideNextUp } from '@shared/next-up'
import { displayTitle, queuedItems, tmdbIndex, useAppStore } from '@/store/app-store'
import { MiniPlayerBar } from '@/components/MiniPlayerBar'
import { TrackMenu } from '@/components/TrackMenu'
import { createEngine } from '@/player/engine-registry'
import { EngineSurface } from '@/player/EngineSurface'
import type { EngineError } from '@/player/engine'

/** Antes de este umbral desde el final se ofrece lo que siga (episodio/cola/recomendación). */
const NEXT_UP_THRESHOLD_SECONDS = 30
const NEXT_UP_COUNTDOWN_SECONDS = 15
const CONTROLS_HIDE_DELAY_MS = 3000
const SEEK_STEP_SECONDS = 10
/** Los fotogramas de vista previa se piden redondeados a este múltiplo, y se cachean. */
const PREVIEW_BUCKET_SECONDS = 10

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
  /** 'mini' = barra tipo Spotify; el componente NO se desmonta al cambiar de vista. */
  view?: 'full' | 'mini'
  /** Presentes solo en el overlay: minimizar a la barra / volver al player completo. */
  onMinimize?: () => void
  onExpand?: () => void
}

export function VideoPlayer({
  itemId,
  relPath,
  startAt,
  standalone,
  onClose,
  onChangeTarget,
  onDetach,
  onReattach,
  view = 'full',
  onMinimize,
  onExpand
}: VideoPlayerProps): React.JSX.Element | null {
  const playExternal = useAppStore((s) => s.playExternal)
  const pushToast = useAppStore((s) => s.pushToast)
  const library = useAppStore((s) => s.library)
  const config = useAppStore((s) => s.config)
  const queue = useAppStore((s) => s.queue)
  const shuffleItemId = useAppStore((s) => s.shuffleItemId)
  const navigate = useNavigate()

  // El motor vive lo que vive el componente; cambiar de target es engine.load(), no
  // recrearlo. Se destruye al desmontar (cerrar el player de verdad).
  const [engine] = useState(() => createEngine())
  const containerRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef(0)
  const handleErrorRef = useRef<(reason: EngineError['reason']) => void>(() => {})
  const handleTimeUpdateRef = useRef<() => void>(() => {})
  const handleEndedRef = useRef<() => void>(() => {})
  const scrubbingRef = useRef(false)
  const previewCacheRef = useRef(new Map<number, string | null>())
  const previewSeqRef = useRef(0)

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
  const [preview, setPreview] = useState<{ leftPx: number; seconds: number; url: string | null } | null>(
    null
  )

  const item = library.items[itemId]
  const effectiveRelPath =
    relPath ?? item?.videoRelPath ?? item?.episodes?.[0]?.relPath ?? item?.relPath ?? ''

  const isSeries = item?.kind === 'tv'
  const ownedIndex = useMemo(() => tmdbIndex(library), [library])

  // Qué sigue al terminar: episodio > cola > nada. Puro y testeado en shared/next-up.ts.
  // En modo aleatorio el "siguiente episodio" se sortea. Se recalcula con currentTime
  // congelado a propósito: la decisión no debe cambiar de episodio en cada tick.
  const decision = useMemo(() => {
    if (!item) return { kind: 'none' as const }
    return decideNextUp(item, effectiveRelPath, queuedItems(library, queue), {
      shuffle: shuffleItemId === item.id
    })
  }, [item, effectiveRelPath, library, queue, shuffleItemId])

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

  // Carga en el motor. La posición de reanudación se resuelve ANTES de cargar para
  // que cualquier motor (HTML o nativo) arranque directamente donde quedó.
  useEffect(() => {
    let cancelled = false
    lastSavedRef.current = 0
    previewCacheRef.current.clear() // las miniatura son de OTRO archivo
    setPreview(null)
    const doLoad = async (): Promise<void> => {
      let at = startAt && startAt > 0 ? startAt : undefined
      if (at === undefined && window.api.getPlaybackProgress) {
        const entries = await window.api.getPlaybackProgress().catch(() => [])
        const entry = entries.find((e) => e.key === `${itemId}::${effectiveRelPath}`)
        if (entry && !entry.finished) at = entry.positionSec
      }
      if (!cancelled) engine.load({ itemId, relPath: effectiveRelPath, startAt: at })
    }
    void doLoad()
    return () => {
      cancelled = true
    }
  }, [engine, itemId, effectiveRelPath, startAt])

  // Eventos del motor → estado de la UI. Los handlers con lógica de negocio (guardar
  // progreso, countdown, fallback) se leen por ref para no re-suscribir en cada render.
  useEffect(() => {
    const offs = [
      engine.on('play', () => setPlaying(true)),
      engine.on('pause', () => {
        setPlaying(false)
        const state = engine.getState()
        if (state.duration) saveProgress(state.currentTime, state.duration)
      }),
      engine.on('durationchange', () => setDuration(engine.getState().duration)),
      engine.on('timeupdate', () => handleTimeUpdateRef.current()),
      engine.on('ended', () => handleEndedRef.current())
    ]
    const offError = engine.onError((error) => handleErrorRef.current(error.reason))
    return () => {
      offs.forEach((off) => off())
      offError()
    }
  }, [engine, saveProgress])

  // El motor muere con el componente (cerrar el player); minimizar no desmonta.
  useEffect(() => () => engine.destroy(), [engine])

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
    const state = engine.getState()
    if (state.duration) saveProgress(state.currentTime, state.duration)
    // No dejar una ventana PiP flotante huérfana ni la app atrapada en fullscreen.
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {})
    if (document.fullscreenElement) void document.exitFullscreen()
    onClose()
  }, [engine, onClose, saveProgress])

  // Minimizar no debe dejar una ventana PiP huérfana ni la app atrapada en fullscreen.
  const handleMinimize = useCallback(() => {
    if (!onMinimize) return
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {})
    if (document.fullscreenElement) void document.exitFullscreen()
    onMinimize()
  }, [onMinimize])

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
    if (engine.getState().playing) engine.pause()
    else engine.play()
  }, [engine])

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      engine.seekBy(deltaSeconds)
    },
    [engine]
  )

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void containerRef.current?.requestFullscreen()
  }, [])

  const togglePip = useCallback(async () => {
    const video = engine.videoElement
    if (!video) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await video.requestPictureInPicture()
    } catch {
      pushToast('No se pudo activar Picture in Picture con este video.', 'error')
    }
  }, [engine, pushToast])

  useEffect(() => {
    const onFullscreenChange = (): void => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  // Estado PiP sincronizado con los eventos nativos del video. El elemento es siempre
  // el mismo nodo (EngineSurface no lo remonta), así que basta suscribirse una vez.
  useEffect(() => {
    const video = engine.videoElement
    if (!video) return
    const onEnter = (): void => setIsPip(true)
    const onLeave = (): void => setIsPip(false)
    video.addEventListener('enterpictureinpicture', onEnter)
    video.addEventListener('leavepictureinpicture', onLeave)
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter)
      video.removeEventListener('leavepictureinpicture', onLeave)
    }
  }, [engine])

  // Atajos de teclado. En modo mini NO se registran: el usuario está navegando el
  // catálogo (espacio/flechas/Escape deben quedarse para la app, no para el player).
  useEffect(() => {
    if (view === 'mini') return
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
          // En el overlay minimiza (la reproducción sigue en la barra); en la ventana
          // separada no hay barra, así que cierra como siempre.
          if (!document.fullscreenElement) {
            if (onMinimize) handleMinimize()
            else handleClose()
          }
          break
      }
      revealControls()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [view, togglePlay, seekBy, toggleFullscreen, handleClose, handleMinimize, onMinimize, revealControls])

  useEffect(() => {
    engine.setVolume(volume)
  }, [engine, volume])

  // El motor nativo oculta su superficie en mini (el audio sigue); el HTML no hace nada.
  useEffect(() => {
    engine.setViewMode(view)
  }, [engine, view])

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
    const state = engine.getState()
    setCurrentTime(state.currentTime)

    if (Math.abs(state.currentTime - lastSavedRef.current) >= 10) {
      lastSavedRef.current = state.currentTime
      saveProgress(state.currentTime, state.duration)
    }

    if (countdownActive && nextUpState === 'hidden' && state.currentTime >= nextUpTrigger) {
      setCountdown(NEXT_UP_COUNTDOWN_SECONDS)
      setNextUpState('countdown')
    }
  }
  handleTimeUpdateRef.current = handleTimeUpdate

  const handleEnded = (): void => {
    const state = engine.getState()
    if (state.duration) saveProgress(state.duration, state.duration)
    if (countdownActive && nextUpState !== 'cancelled') void advance()
  }
  handleEndedRef.current = handleEnded

  /**
   * 'codec' (motor HTML: Chromium no decodifica DivX/MPEG-2, o el watchdog detectó
   * pista muda): se abre en el reproductor externo sin dejar pantalla negra.
   * Cualquier otro motivo (motor nativo: red/stream) no se manda al externo — libVLC
   * ya decodifica todo, así que el externo fallaría igual.
   */
  const handleError = (reason: EngineError['reason']): void => {
    handleClose()
    if (reason === 'codec') {
      void playExternal(itemId, effectiveRelPath)
      pushToast(
        'Este formato no es compatible con el reproductor integrado. Se abrió en tu reproductor externo.'
      )
    } else {
      pushToast('La reproducción falló. Revisa la conexión con el NAS.', 'error')
    }
  }
  handleErrorRef.current = handleError

  /** Segundos del punto de la barra donde está el puntero. */
  const secondsAt = (clientX: number, bar: HTMLElement): number | null => {
    const duration = engine.getState().duration
    if (!duration) return null
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return ratio * duration
  }

  /**
   * Miniatura del punto señalado. Se pide por buckets (y se cachean) porque cada
   * fotograma cuesta un ffmpeg en escritorio y una lectura del NAS en Android:
   * arrastrar sin esto dispararía cientos de peticiones.
   */
  const updatePreview = (clientX: number, bar: HTMLElement): void => {
    const seconds = secondsAt(clientX, bar)
    if (seconds === null) return
    const rect = bar.getBoundingClientRect()
    const leftPx = Math.max(0, Math.min(rect.width, clientX - rect.left))
    const bucket = Math.max(0, Math.round(seconds / PREVIEW_BUCKET_SECONDS) * PREVIEW_BUCKET_SECONDS)
    const cached = previewCacheRef.current.get(bucket)
    setPreview({ leftPx, seconds, url: cached ?? null })

    if (cached !== undefined || !window.api.getPreviewFrame) return
    const seq = ++previewSeqRef.current
    void window.api
      .getPreviewFrame(itemId, effectiveRelPath, bucket)
      .then((url) => {
        previewCacheRef.current.set(bucket, url)
        if (seq === previewSeqRef.current) {
          setPreview((current) => (current ? { ...current, url } : current))
        }
      })
      .catch(() => {})
  }

  const handleScrubStart = (event: React.PointerEvent<HTMLDivElement>): void => {
    // La captura mantiene el arrastre aunque el dedo se salga de la barra.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Puntero ya liberado (o evento sintético): el arrastre sigue funcionando.
    }
    scrubbingRef.current = true
    updatePreview(event.clientX, event.currentTarget)
  }

  const handleScrubMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    // Con ratón se previsualiza al pasar por encima; en táctil solo al arrastrar.
    if (!scrubbingRef.current && event.pointerType === 'touch') return
    updatePreview(event.clientX, event.currentTarget)
  }

  const handleScrubEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!scrubbingRef.current) return
    scrubbingRef.current = false
    const seconds = secondsAt(event.clientX, event.currentTarget)
    if (seconds !== null) engine.seekTo(seconds)
    setPreview(null)
  }

  const handleSkipIntro = (): void => {
    if (introEnd === undefined) return
    engine.seekTo(introEnd)
    setSkippedIntro(true)
  }

  const handleMarkIntro = (): void => {
    const seconds = Math.floor(engine.getState().currentTime)
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

  const isMini = view === 'mini'

  return (
    <div
      className={isMini ? 'player-overlay player-overlay--mini' : 'player-overlay'}
      ref={containerRef}
      onMouseMove={isMini || isCoarsePointer ? undefined : revealControls}
      onDoubleClick={isMini ? undefined : toggleFullscreen}
    >
      <EngineSurface
        engine={engine}
        view={view}
        posterUrl={posterSrc(item)}
        onClick={isMini ? onExpand : isCoarsePointer ? handleVideoTap : togglePlay}
      />

      {!isMini && showSkipIntro && (
        <button className="player-skip-intro" onClick={handleSkipIntro}>
          Saltar intro
        </button>
      )}

      {!isMini && nextUpState === 'countdown' && decision.kind === 'episode' && (
        <div className="player-next-up">
          <div className="player-next-up-title">
            {shuffleItemId === item.id ? 'Otro episodio al azar' : 'Siguiente episodio'} en {countdown}s
          </div>
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

      {!isMini && nextUpState === 'countdown' && decision.kind === 'queue' && (
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

      {!isMini && recommendation && (
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

      {isMini && (
        <MiniPlayerBar
          title={title}
          subtitle={subtitle}
          playing={playing}
          progressPercent={progressPercent}
          canAdvance={decision.kind !== 'none'}
          onTogglePlay={togglePlay}
          onNext={() => void advance()}
          onExpand={onExpand ?? (() => {})}
          onClose={handleClose}
        />
      )}

      {!isMini && (
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
                onClick={() => onDetach(engine.getState().currentTime)}
                title="Sigue viendo en una ventana aparte mientras navegas el catálogo"
              >
                ⧉ Separar
              </button>
            )}
            {onReattach && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => onReattach(engine.getState().currentTime)}
              >
                ⇤ Volver a la app
              </button>
            )}
            {onMinimize && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleMinimize}
                title="Sigue reproduciendo en una barra abajo mientras navegas el catálogo"
              >
                ⌄ Minimizar
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={handleClose}>
              ✕ Cerrar
            </button>
          </div>
        </div>

        <div className="player-bottom">
          <div className="player-progress-wrap">
            {preview && (
              <div className="player-preview" style={{ left: `${preview.leftPx}px` }}>
                {preview.url ? (
                  <img className="player-preview-img" src={preview.url} alt="" />
                ) : (
                  <div className="player-preview-img player-preview-empty" />
                )}
                <div className="player-preview-time">{formatTime(preview.seconds)}</div>
              </div>
            )}
            <div
              className="player-progress"
              onPointerDown={handleScrubStart}
              onPointerMove={handleScrubMove}
              onPointerUp={handleScrubEnd}
              onPointerCancel={handleScrubEnd}
              onPointerLeave={() => {
                if (!scrubbingRef.current) setPreview(null)
              }}
            >
              <div className="player-progress-fill" style={{ width: `${progressPercent}%` }}>
                <span className="player-progress-knob" />
              </div>
            </div>
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
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void advance()}
              disabled={decision.kind === 'none'}
              title={
                decision.kind === 'episode'
                  ? `Siguiente episodio: T${decision.episode.season} · E${decision.episode.episode}`
                  : decision.kind === 'queue'
                    ? `Siguiente de tu cola: ${displayTitle(decision.item)}`
                    : 'No hay nada después: ni episodio siguiente ni cola'
              }
            >
              ⏭ Siguiente
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
            <TrackMenu engine={engine} />
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
            {engine.caps.pip && document.pictureInPictureEnabled && (
              <button className="btn btn-ghost btn-sm" onClick={() => void togglePip()}>
                {isPip ? 'Salir de PiP' : 'PiP'}
              </button>
            )}
            {engine.caps.htmlFullscreen && (
              <button className="btn btn-ghost btn-sm" onClick={toggleFullscreen}>
                {isFullscreen ? 'Salir' : 'Pantalla completa'}
              </button>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
