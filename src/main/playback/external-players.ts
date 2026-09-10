import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ExternalPlayerInfo } from '@shared/types'

const exec = promisify(execFile)

interface Candidate {
  name: string
  /** Relativa a cada carpeta base: el .app en macOS, el .exe en Windows. */
  path: string
}

const MAC_CANDIDATES: Candidate[] = ['VLC', 'IINA', 'mpv', 'QuickTime Player'].map((name) => ({
  name,
  path: `${name}.app`
}))

/** QuickTime vive en /System/Applications desde Catalina, no en /Applications. */
const MAC_BASE_DIRS = ['/Applications', '/System/Applications', join(homedir(), 'Applications')]

/** Ruta de instalación por defecto de cada reproductor dentro de Program Files. */
const WINDOWS_CANDIDATES: Candidate[] = [
  { name: 'VLC', path: 'VideoLAN\\VLC\\vlc.exe' },
  { name: 'MPC-HC', path: 'MPC-HC\\mpc-hc64.exe' },
  { name: 'MPC-BE', path: 'MPC-BE x64\\mpc-be64.exe' },
  { name: 'PotPlayer', path: 'DAUM\\PotPlayer\\PotPlayerMini64.exe' }
]

function windowsBaseDirs(): string[] {
  const { ProgramFiles, LOCALAPPDATA } = process.env
  const dirs = [ProgramFiles, process.env['ProgramFiles(x86)'], LOCALAPPDATA && join(LOCALAPPDATA, 'Programs')]
  return dirs.filter((dir): dir is string => Boolean(dir))
}

export function listExternalPlayers(): ExternalPlayerInfo[] {
  const onWindows = process.platform === 'win32'
  const candidates = onWindows ? WINDOWS_CANDIDATES : MAC_CANDIDATES
  const baseDirs = onWindows ? windowsBaseDirs() : MAC_BASE_DIRS

  const found: ExternalPlayerInfo[] = []
  for (const candidate of candidates) {
    for (const baseDir of baseDirs) {
      const path = join(baseDir, candidate.path)
      if (existsSync(path)) {
        found.push({ name: candidate.name, path })
        break
      }
    }
  }
  return found
}

/**
 * Abre un archivo con un reproductor concreto. macOS lanza el .app con `open -a`; en
 * Windows el .exe recibe la ruta (local o UNC) como argumento y vive aparte de la app.
 */
export async function openWithPlayer(playerPath: string, filePath: string): Promise<void> {
  if (process.platform === 'darwin') {
    await exec('/usr/bin/open', ['-a', playerPath, filePath])
    return
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(playerPath, [filePath], { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
