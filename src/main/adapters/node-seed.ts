import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Lee el token de `seed.config.json` (gitignored) solo en desarrollo. El token nunca
 * vive en el código fuente ni en git.
 */
export async function loadSeedToken(): Promise<string | null> {
  const candidates = [
    join(app.getAppPath(), 'seed.config.json'),
    join(process.cwd(), 'seed.config.json')
  ]
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, 'utf-8')
      const parsed = JSON.parse(raw) as { tmdbBearerToken?: string }
      if (parsed.tmdbBearerToken) return parsed.tmdbBearerToken
    } catch {
      // seed.config.json es opcional
    }
  }
  return null
}
