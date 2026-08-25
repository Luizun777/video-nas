import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ExternalPlayerInfo } from '@shared/types'

const CANDIDATE_APPS = ['VLC.app', 'IINA.app', 'mpv.app', 'QuickTime Player.app']

/** QuickTime vive en /System/Applications desde Catalina, no en /Applications. */
const BASE_DIRS = ['/Applications', '/System/Applications', join(homedir(), 'Applications')]

export function listExternalPlayers(): ExternalPlayerInfo[] {
  const found: ExternalPlayerInfo[] = []
  for (const appName of CANDIDATE_APPS) {
    for (const baseDir of BASE_DIRS) {
      const path = join(baseDir, appName)
      if (existsSync(path)) {
        found.push({ name: appName.replace(/\.app$/, ''), path })
        break
      }
    }
  }
  return found
}
