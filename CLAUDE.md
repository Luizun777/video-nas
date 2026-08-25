# video-nas — Catálogo tipo Netflix para NAS (macOS + Android)

App que escanea shares SMB de uno o varios NAS, identifica películas y series contra
TheMovieDB (es-MX) y las reproduce. Corre como app de escritorio (Electron, macOS) y
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
npm run dist        # empaqueta .app de macOS con electron-builder

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
- **El contrato JS↔nativo es `src/mobile/nas-plugin.ts` ↔ `NasPlugin.java`.** Cambios
  en uno se reflejan en el otro. El puente HTTP de Android replica 1:1 el contrato
  Range de `src/core/playback/http-range.ts` (tests/http-range.test.ts es la referencia
  para ambos servidores).
- **La normalización NFC de nombres SMB vive SOLO en `src/mobile/adapters/smb-fs-adapter.ts`**,
  nunca en core: los ids del desktop se construyeron con el NFD de macOS y no deben
  cambiar.
- **Las credenciales SMB (`ServerConfig.username/password/domain`) son solo de Android**;
  el desktop sigue delegando en el Llavero al montar. Prohibido loguearlas (logcat
  incluido).
- **El token de TheMovieDB nunca va en el código fuente ni en git.** Vive en
  `seed.config.json` (gitignored) para desarrollo, y en `config.json` de userData en
  runtime. La app debe funcionar **completamente sin token** (modo sin API key).
- **Los tipos compartidos van solo en `src/shared/`.** main, preload y renderer se
  tipan contra `src/shared/types.ts`; nadie redefine shapes localmente.
- **`name-parser.ts` y `grouper.ts` son puros**: sin imports de electron ni de fs, para
  que vitest los pruebe directamente. Toda la lógica de nombres raros vive ahí.
- **El escaneo nunca pisa las correcciones del usuario.** `overrides.json` es un archivo
  aparte de `library.json`; la precedencia es siempre override > match cacheado > búsqueda.
- **El renderer nunca construye rutas absolutas.** Pide `play(itemId)` y el proceso main
  resuelve el punto de montaje actual + la ruta relativa.
- Un servidor sin conexión no borra nada: su contenido cacheado sigue visible con badge.

## Datos en runtime

`~/Library/Application Support/video-nas/`

- `config.json` — token de TMDB y lista de servidores NAS
- `library.json` — catálogo escaneado (clave: `"${serverId}:${relPath}"`)
- `overrides.json` — correcciones manuales de metadata
- `cache/posters/`, `cache/backdrops/` — imágenes descargadas, servidas por `mediacache://`

## Estructura

```
src/shared/    types.ts (data model + contrato IpcApi + capabilities), ipc-channels.ts,
               media-src.ts y playback-url.ts (resolvers por plataforma)
src/core/      lógica compartida SIN plataforma: io.ts (interfaces), scanner/, tmdb/,
               stores/ (JsonStore + config/library/overrides/queue/progress),
               playback/ (http-range, ebml-chapters, chapter-reader, resolve-target),
               downloads/
src/main/      solo Electron: index.ts, ipc.ts, adapters/ (Node impls de core/io),
               nas/ (mount por Llavero, discovery), playback/ (protocolos, ventana)
src/preload/   index.ts (contextBridge + DESKTOP_CAPABILITIES)
src/mobile/    solo Android/preview: boot.ts, api.ts (window.api completo en WebView),
               nas-plugin.ts (contrato del plugin), adapters/ (Capacitor impls),
               playback.ts (URLs del puente), dev-mock-api.ts (preview en navegador)
src/renderer/  src/{components,views,modals,store,styles} — compartido tal cual;
               index.html (desktop) e index.mobile.html (Android)
android/       proyecto Capacitor; el plugin vive en app/src/main/java/com/luizun/videonas/
               (NasPlugin, SmbClientManager, StreamServer)
tests/         módulos puros de core (corren sin Electron ni Android)
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
- Un códec de video no soportado puede NO disparar `onError` del `<video>`: si solo la
  pista de video es indecodificable (HEVC 4K 10-bit en la Redmi Pad SE), el audio avanza
  con pantalla negra y 0 frames decodificados. El watchdog de VideoPlayer (currentTime>5
  con videoWidth===0) lo trata como formato incompatible y cae al reproductor externo.
