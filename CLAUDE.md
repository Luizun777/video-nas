# video-nas — Catálogo tipo Netflix para NAS (macOS + Windows + Android)

App que escanea shares SMB de uno o varios NAS, identifica películas y series contra
TheMovieDB (es-MX) y las reproduce. Corre como app de escritorio (Electron, macOS y Windows) y
como APK Android (Capacitor) compartiendo el renderer y toda la lógica de `src/core`.

## Stack

- **Electron 43** + **electron-vite** (main / preload / renderer) para escritorio
- **Capacitor 7** (WebView + plugin Java: SMBJ + NanoHTTPD) para Android
- **React 19** + react-router-dom (HashRouter) + **zustand**
- **TypeScript**, CSS plano con variables (tema oscuro), UI 100% en español
- **vitest** para los módulos puros de `src/core`

## Comandos

```bash
npm run dev         # app de escritorio en modo desarrollo (HMR)
npm test            # tests de core (parser, grouper, identifier, http-range, config)
npm run typecheck   # tsc sobre node (main/core) y web (renderer/core/mobile)
npm run build       # typecheck + build de producción de escritorio a out/
npm run dist        # empaqueta para el SO actual (macOS: dmg+zip arm64; Windows: .exe portable)
git tag vX.Y.Z && git push origin vX.Y.Z  # Actions compila Mac + Windows y publica la release
npm run icons       # regenera build/icon.{icns,ico,png} y los mipmaps de Android desde el SVG
                    # de scripts/generate-icons.mjs (solo macOS: sips + iconutil)

npm run dev:mobile      # preview móvil en navegador con API mock (puerto 5199,
                        # abrir /index.mobile.html)
npm run build:mobile    # bundle web móvil a dist/mobile
npm run cap:sync        # build:mobile + copia a android/ (npx cap sync)
npm run android:apk     # cap:sync + gradlew assembleDebug (APK debug)
npm run android:install # adb install del APK en el dispositivo conectado
npm run android:log     # logcat filtrado (Capacitor, NasPlugin, chromium)
```

El tooling Android vive fuera de brew (ver Lecciones): JDK 21 en
`~/android-tools/jdk-21`, SDK en `~/Library/Android/sdk`. Gradle necesita
`JAVA_HOME="$HOME/android-tools/jdk-21/Contents/Home"` y `ANDROID_HOME="$HOME/Library/Android/sdk"`.

## Reglas del proyecto

- **CERO módulos nativos en Node.** Nada que requiera node-gyp (no better-sqlite3, no
  bindings compilados). La persistencia es JSON. (El plugin Java de Android no cuenta:
  es Capacitor, no node-gyp.)
- **`src/core` es agnóstico de plataforma**: prohibido importar `electron`, `node:*` o
  `@capacitor/*` ahí. Todo IO pasa por las interfaces de `src/core/io.ts` (StoreIO,
  FsAdapter, ImageCacheAdapter, ScanEnv, DownloadTransfer); Electron las implementa en
  `src/main/adapters/` y Android en `src/mobile/adapters/`. UNA sola implementación de
  la lógica: nada de copiar el orquestador/stores por plataforma.
- **Los contratos JS↔nativo son `src/mobile/nas-plugin.ts` ↔ `NasPlugin.java` y
  `src/mobile/vlc-player-plugin.ts` ↔ `VlcPlayerPlugin.java`.** Cambios en uno se
  reflejan en el otro. El puente HTTP de Android replica 1:1 el contrato Range de
  `src/core/playback/http-range.ts` (tests/http-range.test.ts es la referencia para
  ambos servidores).
- **El reproductor tiene UNA UI y dos motores** detrás de la interfaz `PlaybackEngine`
  (`src/renderer/src/player/`): `HtmlVideoEngine` (el `<video>` de Chromium, desktop) y
  `VlcNativeEngine` (`src/mobile/vlc-engine.ts`, libVLC en un TextureView DEBAJO del
  WebView transparente — clase `native-video-full` en body). El boot móvil registra su
  fábrica en `engine-registry.ts`, mismo patrón que `setVideoUrlResolver`. Los controles,
  el menú de pistas y la mini-barra son compartidos; nada de UI por plataforma.
- **libVLC va clavado a 3.6.x** (`libvlc-all:3.6.5`): 3.7+ exige compileSdk 36 y el
  proyecto (AGP 8.7) topa en 35. `abiFilters "arm64-v8a"` — para emulador x86_64 hay
  que quitar el filtro temporalmente.
- **ffmpeg/ffprobe del desktop** vienen de `ffmpeg-static` + `@ffprobe-installer/ffprobe`
  (dependencies, NO devDependencies), van como `external` en el build de main y
  `asarUnpack` en electron-builder (un binario dentro del asar no ejecuta). Esos paquetes
  instalan el binario del SO y la arquitectura donde corrió `npm install`: por eso el dmg
  es SOLO arm64 y **cada plataforma se empaqueta en su propia máquina**
  (`.github/workflows/release.yml`: macos-latest y windows-latest). Nunca empaquetes
  Windows en cruzado desde la Mac: el .exe llevaría binarios de Mac y el main revienta al
  importar `@ffprobe-installer/ffprobe`. Ojo: `ffprobe-static` trae un binario
  darwin/arm64 de arquitectura equivocada; por eso se usa `@ffprobe-installer/ffprobe`.
- **Windows no monta shares**: `mount-manager.ts` usa la ruta UNC `\\host\share` como
  punto de montaje (con caché de acceso: se consulta en cada petición Range) y, si Windows
  aún no tiene sesión, abre `explorer.exe \\host\share` para que el sistema pida y
  recuerde las credenciales — el equivalente del `open smb://` + Llavero de macOS. Lo
  específico de cada SO vive en `src/main` detrás de `process.platform` (montaje,
  descubrimiento, reproductores externos, codificador del transcode, ventana); el
  renderer solo ve `capabilities.os` para los textos (Finder/Explorador).
- **NUNCA pongas `crossOrigin` en el `<video>` del desktop.** El esquema `videofile://`
  no está registrado con `corsEnabled`, así que marcar el elemento como cross-origin
  hace que Chromium rechace TODOS los formatos con `MEDIA_ELEMENT_ERROR: Format error`
  (mkv, mp4 y avi por igual). Por eso los subtítulos del desktop viajan como texto por
  IPC (`getSubtitleVtt`) y se montan con `blob:`, que es mismo origen y no necesita
  `<track>` cross-origin. Verificado con el NAS real: mismo MKV, con `crossOrigin` da
  Format error y sin él carga 3840x1606.
- **El transcode se sirve como stream NO buscable** (200 sin Accept-Ranges ni
  Content-Length, para que Chromium jamás mande Range a un pipe); el seek lo finge
  HtmlVideoEngine matando la sesión y relanzando ffmpeg con `-ss`.
- **La normalización NFC de nombres SMB vive SOLO en `src/mobile/adapters/smb-fs-adapter.ts`**,
  nunca en core: los ids del desktop se construyeron con el NFD de macOS y no deben
  cambiar.
- **Las credenciales SMB (`ServerConfig.username/password/domain`) son solo de Android**;
  el desktop delega en el sistema al conectar (Llavero en macOS, Administrador de
  credenciales en Windows). Prohibido loguearlas (logcat incluido).
- **El token de TheMovieDB nunca va en el código fuente ni en git.** Vive en
  `seed.config.json` (gitignored) para desarrollo, y en `config.json` de userData en
  runtime. La app debe funcionar **completamente sin token** (modo sin API key).
- **Los tipos compartidos van solo en `src/shared/`.** main, preload y renderer se
  tipan contra `src/shared/types.ts`; nadie redefine shapes localmente.
- **`name-parser.ts` y `grouper.ts` son puros**: sin imports de electron ni de fs, para
  que vitest los pruebe directamente. Toda la lógica de nombres raros vive ahí.
- **El escaneo nunca pisa las correcciones del usuario.** `overrides.json` es un archivo
  aparte de `library.json`; la precedencia es siempre override > match cacheado > búsqueda.
- **Las correcciones viajan entre dispositivos por `.video-nas/overrides.json` en la
  raíz de cada share** (`src/core/metadata/`): claves = relPath del ancla en NFC y SIN
  serverId (ni los serverId ni la forma NFD/NFC de los ids locales son estables entre
  dispositivos — el mapeo se hace contra los relPaths recién caminados en el escaneo).
  Newest-wins por `setAt`; "restaurar automático" escribe un tombstone `mode:'none'`
  (nunca borrar la entrada: el otro dispositivo re-empujaría su copia vieja). Todo es
  best-effort: NAS apagado o share de solo lectura deja el override pendiente
  (`syncedAt` < `setAt`) y se reintenta en el siguiente escaneo.
- **El renderer nunca construye rutas absolutas.** Pide `play(itemId)` y el proceso main
  resuelve el punto de montaje actual + la ruta relativa.
- Un servidor sin conexión no borra nada: su contenido cacheado sigue visible con badge.

## Datos en runtime

`~/Library/Application Support/video-nas/` (macOS) · `%APPDATA%\video-nas\` (Windows)

- `config.json` — token de TMDB y lista de servidores NAS
- `library.json` — catálogo escaneado (clave: `"${serverId}:${relPath}"`)
- `overrides.json` — correcciones manuales de metadata (con `setAt`/`syncedAt` de sync)
- `progress.json` — "continuar viendo" (ambas plataformas desde F10)
- `cache/posters/`, `cache/backdrops/` — imágenes descargadas, servidas por `mediacache://`

Y en el NAS, por share: `.video-nas/overrides.json` — correcciones compartidas entre
dispositivos (el walker ignora dotdirs, nunca aparece en el catálogo).

## Estructura

```
src/shared/    types.ts (data model + contrato IpcApi + capabilities), ipc-channels.ts,
               media-src.ts y playback-url.ts (resolvers por plataforma + URLs de
               subs/transcode del desktop)
src/core/      lógica compartida SIN plataforma: io.ts (interfaces), scanner/, tmdb/,
               stores/ (JsonStore + config/library/overrides/queue/progress),
               playback/ (http-range, ebml-chapters, chapter-reader, resolve-target,
               subtitle-candidates, media-probe), metadata/ (override-service +
               shared-overrides puro + shared-overrides-sync), downloads/
src/main/      solo Electron: index.ts, ipc.ts, adapters/ (Node impls de core/io),
               nas/ (mount por Llavero, discovery), playback/ (protocolos stream/subs/
               transcode, ffmpeg, subtitle-extractor, transcode-session, ventana)
src/preload/   index.ts (contextBridge + DESKTOP_CAPABILITIES)
src/mobile/    solo Android/preview: boot.ts, api.ts (window.api completo en WebView),
               nas-plugin.ts y vlc-player-plugin.ts (contratos de plugins),
               vlc-engine.ts (PlaybackEngine sobre libVLC), adapters/ (Capacitor impls),
               playback.ts (URLs del puente), dev-mock-api.ts (preview en navegador)
src/renderer/  src/{components,views,modals,store,styles} — compartido tal cual;
               src/player/ (PlaybackEngine + HtmlVideoEngine + registry + surface);
               index.html (desktop) e index.mobile.html (Android)
android/       proyecto Capacitor; los plugins viven en app/src/main/java/com/luizun/videonas/
               (NasPlugin, SmbClientManager, StreamServer, VlcPlayerPlugin, VlcPlayerManager)
tests/         módulos puros de core (corren sin Electron ni Android)
.github/       workflows/release.yml (compila Mac + Windows, publica la release con tag v*)
               y release-notes.md (instrucciones de descarga y primer arranque)
scripts/       generate-icons.mjs (dibujo SVG del icono → icns/ico/mipmaps) y rasterize-svg.cjs
build/         icon.icns, icon.ico, icon.png: generados, electron-builder los toma solos
```

## Lecciones aprendidas

- macOS entrega los nombres de archivo del SMB en **NFD** (acentos descompuestos). Sin
  `.normalize('NFC')` en `cleanTitle`, TheMovieDB no reconoce ningún título con acento:
  eran 43 de 44 fallos de identificación en el NAS real.
- Al emparejar con TheMovieDB, **un año coincidente no rescata un título que no se parece**.
  Buscar "300" filtrando por 2006 (la película es de 2007) devuelve material irrelevante de
  ese año; aceptar el primer resultado ponía una portada equivocada.
- Las coincidencias parciales de título se comparan **por palabras completas y midiendo el
  solape**, distinguiendo si caen al inicio o en medio: "Frieren" identifica
  "Frieren: Más allá del final del viaje", pero "300" dentro de "Home Movies 300-1" no.
- Las búsquedas de respaldo (sin año, con el título recortado) solo deben correr cuando no
  hubo ningún acierto. Dejarlas competir hizo que "Big Bang" ganara a "The Big Bang Theory".
- Los release names a veces pegan varios tags de calidad con guion y sin espacios
  ("1080P-Dual-Lat"). Tokenizar solo por espacios/puntos deja ese bloque como un único
  token que no matchea nada; hay que probar también sus partes por guion cuando el token
  completo no es un compuesto conocido (blu-ray, web-dl).
- El reproductor embebido sirve video por el protocolo `videofile://` con soporte de HTTP
  Range (206) — sin Range el `<video>` no puede hacer seek en archivos de varios GB. La
  URL solo lleva itemId+relPath; main resuelve la ruta real (copia local > NAS) igual que
  `IPC.play`. En esta Mac (Apple Silicon) Chromium SÍ decodifica HEVC por hardware; lo que
  seguro no decodifica es DivX/XviD (.avi) y MPEG-2 (.mpg) → fallback automático al
  reproductor externo vía el evento `error` del `<video>`.
- Capítulos MKV: `ChapterTimeStart/End` son nanosegundos ABSOLUTOS; `TimecodeScale` NO los
  escala (solo a los Cluster). Verificado contra ffprobe en archivos reales.
- `requestPictureInPicture()` exige user activation real de Chromium: un `.click()`
  sintético desde Runtime.evaluate NO cuenta (falla en silencio); al automatizar por CDP
  hay que usar `Input.dispatchMouseEvent`. Con un click de usuario real funciona siempre.
- En esta Mac, si la licencia de Xcode está sin aceptar (`sudo xcodebuild -license accept`),
  el git de Apple Y brew entero fallan. Workarounds que no requieren sudo: usar
  `/opt/homebrew/bin/git` (anteponer al PATH) y para el tooling Android descargar JDK
  (api.adoptium.net) y cmdline-tools (dl.google.com) directo con curl — nada del
  toolchain Android necesita Xcode.
- El CLI de Capacitor no puede parsear `capacitor.config.ts` con TypeScript 7 (usa
  `ts.ModuleKind` de la API vieja): el config vive en `capacitor.config.json`.
- Los estados `:hover` del CSS van dentro de `@media (hover: hover)`: en táctil se
  quedan "pegados" tras cada tap. Los controles del player se revelan por tap (pointer
  coarse), no por mousemove.
- En Android main y renderer comparten proceso: los stores de core mutan in place y
  devolver esa referencia hace que zustand vea `===` y React NO re-renderice (en
  Electron el IPC serializa y siempre llega objeto nuevo). La API móvil debe devolver
  snapshots (`{...getLibrary()}`, `[...getQueue()]`) en todo lo que el renderer compara
  por referencia. Síntoma: progreso/estados se actualizan pero la biblioteca queda en 0.
- Un códec no soportado puede NO disparar `onError` del `<video>` en ninguna dirección:
  - Video indecodificable (HEVC 4K 10-bit en la Redmi Pad SE): audio avanza con pantalla
    negra y 0 frames decodificados.
  - **Audio indecodificable (AC3/DTS — MUY común en rips "Dual-Lat", confirmado con
    ffprobe: 4 pistas AC3 en "Los Simpson", ninguna AAC)**: Chromium no trae esos
    decodificadores por licencias **ni en Android ni en macOS** (medido en el propio
    Electron: el video se ve y `webkitAudioDecodedByteCount` se queda en 0 diez
    segundos seguidos). Antes se creía que macOS los aportaba: es FALSO, y por eso
    `media-probe.ts` los deja fuera de la whitelist y manda esos archivos a transcode
    copiando el video. Simplemente omite la pista en silencio — el video se ve
    perfecto pero sin sonido, sin ningún error. La señal confiable es `video.webkitAudioDecodedByteCount`
    (no estándar, Chromium-only): con codec soportado sube con cada frame decodificado
    (incluso en silencio digital real); con AC3/DTS se queda clavado en 0 para siempre
    aunque el video avance. Distinguir "no hay audio" es imposible sin esto — `audioTracks`
    no está expuesto en este WebView.
  El watchdog (hoy dentro de HtmlVideoEngine; por intervalo, no timeupdate, para cubrir
  también el caso atascado en pausa) cubre ambos: videoWidth===0 con metadata cargada,
  o 2 strikes de ~4s con audio en 0 mientras currentTime avanza. Desde F14 primero
  reintenta UNA vez en transcode y solo después cae al reproductor externo. En Android
  ya ni corre: VlcNativeEngine decodifica todo.
- `libvlc-all` 3.7+ exige compileSdk 36 vía su AAR metadata; con AGP 8.7 (tope SDK 35)
  hay que quedarse en 3.6.x. Y `ffprobe-static` publica un binario darwin/arm64 de
  arquitectura equivocada ("bad CPU type"): usar `@ffprobe-installer/ffprobe`.
- El mini-viewport de video EN la mini-barra no es viable con el motor nativo: el
  TextureView vive detrás del WebView y haría falta un "agujero" transparente a través
  de TODO el DOM del catálogo. En mini el motor nativo suelta las vistas
  (`detachViews`, el audio sigue) y la barra muestra la portada; el motor HTML sí
  encoge su `<video>` como miniatura viva.
- Los HMR de Vite pueden dejar módulos viejos mezclados tras un refactor grande (errores
  de símbolos "not defined" que el typecheck no reporta): recargar la página entera
  antes de perseguir fantasmas.
- El auto-avance y el ⏭ deben PRESERVAR la vista del player (openPlayer con
  preserveView): sin eso, avanzar de episodio con la mini-barra activa te saca del
  catálogo y te planta el player en grande.
- Un `<video>` que falla por CORS reporta exactamente lo mismo que un códec no
  soportado (`MEDIA_ELEMENT_ERROR: Format error`, code 4). Cuando "no reproduce NINGÚN
  formato" (incluido mp4 H.264), sospechar del transporte/CORS antes que de códecs: el
  discriminador rápido es cargar el mismo archivo en dos `<video>`, uno con
  `crossOrigin` y otro sin él, por CDP.
- Para depurar el desktop por CDP: `npx electron-vite dev --outDir out --
  --remote-debugging-port=N`. Matar la instancia anterior de verdad (`pkill -9 -f
  Electron`) antes de reabrir: si el puerto queda ocupado, la app arranca SIN devtools
  y te conectas por error a la instancia vieja. Y tras tocar `electron.vite.config.ts`
  hay que REINICIAR el dev server: con el config viejo en memoria, un alias nuevo no
  resuelve y el renderer queda en blanco (el build de producción sí funciona).
- Cuando el watchdog/onError manda a transcode, el video se COPIA si su códec está en
  la whitelist (el caso normal: falla solo el audio). Recodificar un 4K en vivo tarda
  demasiado en dar el primer frame; copiándolo arranca enseguida (medido con el NAS
  real). Copiar HEVC a fMP4 funciona tal cual, sin `-tag:v hvc1`.
- **En los plugins Capacitor, los números de JS se leen con `call.getDouble`, no con
  `getLong`.** Con `getLong` el valor caía al default y `seek` recibía 0: cada intento
  de saltar en la tablet reiniciaba el episodio desde el principio (parecía un fallo de
  libVLC y era el puente JS↔Java).
- El nombre del archivo manda para numerar episodios, y el respaldo de "dígitos finales"
  es peligroso: en "Ranma ½ - 155 - La guerra de animadoras parte 1" capturaba el 1 de
  "parte 1". `tests/episode-numbering.test.ts` fija los patrones reales de las 31 series
  del NAS; al tocar el parser, correrlo y validar además con un informe sobre todos los
  nombres reales (series con archivos sin número o con claves duplicadas).
- Las miniaturas de la barra se piden por buckets Y con control de peticiones en vuelo:
  sin lo segundo, cada evento de movimiento del dedo lanzaba una petición que
  invalidaba la anterior y la imagen no llegaba nunca. En Android además se reutiliza
  el `MediaMetadataRetriever` mientras sea el mismo archivo (2,1 s la primera, ~0,8 s
  las siguientes; sin caché eran 2,5 s cada una).
- Arrastrar la barra tiene que contar como actividad (`revealControls`): si no, los
  controles se auto-ocultan a los 3 s y se llevan la miniatura con ellos.
- No todo fallo de reproducción es de la app: "1917" del NAS tiene el contenedor dañado
  a partir del minuto ~55 (`invalid as first byte of an EBML number` sobre los 3 GB) y
  ahí fallan por igual Chromium, el transcode y ffmpeg. Antes de perseguir un bug,
  correr `ffmpeg -ss N -i archivo -t 8 -f null -` sobre la zona sospechosa.
- Para probar el `.app` empaquetado sin tocar la biblioteca real ni chocar con una
  instancia abierta: lanzar el binario con `HOME` y `CFFIXED_USER_HOME` apuntando a un
  directorio temporal, más `--user-data-dir=<tmp>/Library/Application Support/video-nas`
  y `--remote-debugging-port`. userData y el bloqueo de instancia única quedan aislados
  (verificado: el config se crea en el temporal y los mtime de los JSON reales no cambian).
  Y no borres `release/` sin mirar si hay una app abierta desde ahí.
- Rasterizar SVG a PNG con alpha en esta Mac (no hay rsvg ni ImageMagick): dibujar el SVG
  en un `<canvas>` desde una ventana oculta de Electron (`executeJavaScript` →
  `toDataURL`). Chrome headless `--screenshot` se cuelga, y el offscreen de Electron
  (evento `paint`) da frames en blanco y sin alpha. Además, sin listener de
  `window-all-closed` Electron sale al cerrar la última ventana, también en macOS.
