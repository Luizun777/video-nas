// Genera todos los iconos de la app desde un único dibujo vectorial:
//   build/icon.icns (macOS), build/icon.ico (Windows), build/icon.png (referencia)
//   y los mipmaps de Android.
// Rasteriza con el Electron del proyecto (scripts/rasterize-svg.cjs) y escala con
// sips/iconutil, así que corre en macOS.
//   npm run icons            (KEEP_WORK=1 deja los renders intermedios para revisarlos)
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = dirname(fileURLToPath(import.meta.url))
const ROOT = join(SCRIPTS, '..')
const ANDROID_RES = join(ROOT, 'android/app/src/main/res')
const work = mkdtempSync(join(tmpdir(), 'video-nas-icons-'))

// ---- Dibujo (lienzo de 1024) --------------------------------------------------------
// Un play partido en tres bahías de disco —el NAS—, cada una con su LED y el del medio
// encendido. A tamaños chicos las ranuras desaparecen y queda un play limpio.

const RED = '#e50914'

function artwork() {
  return `
    <defs>
      <linearGradient id="play" x1="363" y1="262" x2="804" y2="762" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#ff4a4f"/>
        <stop offset="1" stop-color="#b8060f"/>
      </linearGradient>
      <radialGradient id="glow" cx="540" cy="512" r="360" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="${RED}" stop-opacity="0.28"/>
        <stop offset="1" stop-color="${RED}" stop-opacity="0"/>
      </radialGradient>
      <mask id="bays" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
        <rect width="1024" height="1024" fill="#fff"/>
        <rect y="412" width="1024" height="24" fill="#000"/>
        <rect y="588" width="1024" height="24" fill="#000"/>
        <circle cx="452" cy="352" r="13" fill="#000"/>
        <circle cx="452" cy="672" r="13" fill="#000"/>
      </mask>
    </defs>
    <circle cx="540" cy="512" r="360" fill="url(#glow)"/>
    <path d="M393 292 L774 512 L393 732 Z" fill="url(#play)" stroke="url(#play)"
      stroke-width="60" stroke-linejoin="round" mask="url(#bays)"/>
    <circle cx="452" cy="512" r="14" fill="#fff"/>`
}

/** Placa oscura detrás del play: squircle o círculo, con sombra solo donde el sistema la usa. */
function plate({ kind, inset, radius, shadow }) {
  const size = 1024 - inset * 2
  const shape = (attrs) =>
    kind === 'circle'
      ? `<circle cx="512" cy="512" r="${size / 2}" ${attrs}/>`
      : `<rect x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${radius}" ${attrs}/>`
  return `
    <defs>
      <linearGradient id="plate" x1="0" y1="${inset}" x2="0" y2="${1024 - inset}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#262631"/>
        <stop offset="1" stop-color="#0b0b0f"/>
      </linearGradient>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
        <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.4"/>
      </filter>
    </defs>
    ${shape(`fill="url(#plate)"${shadow ? ' filter="url(#shadow)"' : ''}`)}
    ${shape('fill="none" stroke="#fff" stroke-opacity="0.07" stroke-width="3"')}`
}

function iconSvg({ plate: plateOptions, scale }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    ${plateOptions ? plate(plateOptions) : ''}
    <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">${artwork()}</g>
  </svg>`
}

const VARIANTS = {
  // macOS no recorta los iconos: el squircle, su margen y la sombra van dibujados.
  mac: { plate: { kind: 'rect', inset: 100, radius: 185, shadow: true }, scale: 1 },
  // Windows no usa ese margen: la placa llena el lienzo y se lee mejor a 16 px.
  windows: { plate: { kind: 'rect', inset: 24, radius: 210 }, scale: 1.18 },
  androidSquare: { plate: { kind: 'rect', inset: 48, radius: 190 }, scale: 1.1 },
  androidRound: { plate: { kind: 'circle', inset: 48 }, scale: 1 },
  // Primer plano del icono adaptativo: el launcher muestra 72 de los 108 dp y lo pone
  // sobre @color/ic_launcher_background.
  androidForeground: { plate: null, scale: 0.83 }
}

// ---- Rasterizado ------------------------------------------------------------------

/** Rasteriza todas las variantes a 1024 px en una sola pasada de Electron. */
function renderAll() {
  const jobs = Object.keys(VARIANTS).map((name) => {
    const svg = join(work, `${name}.svg`)
    writeFileSync(svg, iconSvg(VARIANTS[name]))
    return { name, svg, png: join(work, `${name}.png`) }
  })
  const env = { ...process.env, ICON_JOBS: JSON.stringify(jobs) }
  delete env.ELECTRON_RUN_AS_NODE
  const electron = createRequire(import.meta.url)('electron')
  execFileSync(electron, [join(SCRIPTS, 'rasterize-svg.cjs')], { env, stdio: 'inherit', timeout: 120_000 })

  for (const { png } of jobs) {
    if (!existsSync(png) || statSync(png).size === 0) throw new Error(`No se rasterizó ${png}`)
  }
  return Object.fromEntries(jobs.map((job) => [job.name, job.png]))
}

function resize(source, size, target) {
  mkdirSync(dirname(target), { recursive: true })
  execFileSync('sips', ['-z', String(size), String(size), source, '--out', target], { stdio: 'ignore' })
  return target
}

/** ICO con cada tamaño embebido como PNG (Windows Vista+). */
function writeIco(images, target) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length + images.length * 16
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    return entry
  })
  writeFileSync(target, Buffer.concat([header, ...entries, ...images.map((image) => image.data)]))
}

// ---- Salidas ----------------------------------------------------------------------

mkdirSync(join(ROOT, 'build'), { recursive: true })
const { mac, windows, androidSquare: square, androidRound: round, androidForeground: foreground } = renderAll()

const iconset = join(work, 'icon.iconset')
mkdirSync(iconset)
for (const size of [16, 32, 128, 256, 512]) {
  resize(mac, size, join(iconset, `icon_${size}x${size}.png`))
  resize(mac, size * 2, join(iconset, `icon_${size}x${size}@2x.png`))
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(ROOT, 'build/icon.icns')])
copyFileSync(mac, join(ROOT, 'build/icon.png'))

writeIco(
  [16, 24, 32, 48, 64, 128, 256].map((size) => ({
    size,
    data: readFileSync(resize(windows, size, join(work, `windows-${size}.png`)))
  })),
  join(ROOT, 'build/icon.ico')
)

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
for (const [density, factor] of Object.entries(DENSITIES)) {
  const dir = join(ANDROID_RES, `mipmap-${density}`)
  resize(square, 48 * factor, join(dir, 'ic_launcher.png'))
  resize(round, 48 * factor, join(dir, 'ic_launcher_round.png'))
  resize(foreground, 108 * factor, join(dir, 'ic_launcher_foreground.png'))
}

if (process.env.KEEP_WORK) {
  console.log(`Renders intermedios en ${work}`)
} else {
  rmSync(work, { recursive: true, force: true })
}
console.log('Iconos generados: build/icon.icns, build/icon.ico, build/icon.png y mipmaps de Android.')
