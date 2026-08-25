import { existsSync, readFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Build web del renderer para Android (Capacitor). El bundle de escritorio sigue
// saliendo de electron.vite.config.ts; este config ni lo toca.

/**
 * Token de desarrollo: se inyecta desde seed.config.json (gitignored) al build móvil,
 * igual que el seed del desktop. Nunca vive en el código ni en git; acaba únicamente
 * dentro del APK instalado en tus propios dispositivos.
 */
function readSeedToken(): string | null {
  try {
    const raw = readFileSync(resolve(__dirname, 'seed.config.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { tmdbBearerToken?: string }
    return parsed.tmdbBearerToken ?? null
  } catch {
    return null
  }
}

/** El input se llama index.mobile.html; Capacitor espera index.html en el webDir. */
function renameMobileIndex(): Plugin {
  return {
    name: 'rename-mobile-index',
    apply: 'build',
    closeBundle() {
      const dir = resolve(__dirname, 'dist/mobile')
      const from = resolve(dir, 'index.mobile.html')
      if (existsSync(from)) renameSync(from, resolve(dir, 'index.html'))
    }
  }
}

/** En dev (preview en navegador) la CSP estricta rompe el HMR de Vite: se quita solo ahí. */
function stripCspInDev(): Plugin {
  return {
    name: 'strip-csp-in-dev',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(/<meta[^>]*Content-Security-Policy[\s\S]*?\/>\n?/, '')
    }
  }
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: '',
  plugins: [react(), renameMobileIndex(), stripCspInDev()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, 'src/core'),
      '@mobile': resolve(__dirname, 'src/mobile'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  define: {
    __SEED_TMDB_TOKEN__: JSON.stringify(readSeedToken())
  },
  build: {
    outDir: resolve(__dirname, 'dist/mobile'),
    emptyOutDir: true,
    // Piso conservador para WebViews de tablet no actualizados; se revisa contra el
    // dumpsys real del dispositivo en la fase de tooling.
    target: 'chrome90',
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.mobile.html')
    }
  },
  server: {
    port: 5199
  }
})
