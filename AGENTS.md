# video-nas — Catálogo tipo Netflix para NAS (macOS)

App de escritorio que escanea shares SMB de uno o varios NAS, identifica películas y
series contra TheMovieDB (es-MX) y las reproduce con el reproductor nativo del sistema.

## Stack

- **Electron 43** + **electron-vite** (main / preload / renderer)
- **React 19** + react-router-dom (HashRouter) + **zustand**
- **TypeScript**, CSS plano con variables (tema oscuro), UI 100% en español
- **vitest** para los módulos puros del escáner

## Comandos

```bash
npm run dev         # app en modo desarrollo (HMR en renderer, reload en main)
npm test            # tests del parser y el grouper
npm run typecheck   # tsc sobre node (main/preload) y web (renderer)
npm run build       # typecheck + build de producción a out/
npm run dist        # empaqueta .app de macOS con electron-builder
```

## Reglas del proyecto

- **CERO módulos nativos.** Nada que requiera node-gyp (no better-sqlite3, no bindings
  compilados). La persistencia es JSON. Si algo parece necesitar un módulo nativo,
  se busca alternativa en JS puro o se implementa a mano.
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
src/shared/    types.ts (data model + contrato IPC), ipc-channels.ts
src/main/      index.ts, ipc.ts, stores/, nas/, scanner/, tmdb/
src/preload/   index.ts (contextBridge)
src/renderer/  src/{components,views,modals,store,styles}
tests/         name-parser.test.ts, grouper.test.ts
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
