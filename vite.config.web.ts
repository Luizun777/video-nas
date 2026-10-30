import { copyFileSync, existsSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Build web del renderer para el servidor LAN de la app de escritorio
// (src/main/web/lan-server.ts sirve out/web). Va dentro del asar junto a out/main.

/** El input se llama index.web.html; el servidor sirve index.html. Y el icono como favicon. */
function finishWebBundle(): Plugin {
  return {
    name: 'finish-web-bundle',
    apply: 'build',
    closeBundle() {
      const dir = resolve(__dirname, 'out/web')
      const from = resolve(dir, 'index.web.html')
      if (existsSync(from)) renameSync(from, resolve(dir, 'index.html'))
      const icon = resolve(__dirname, 'build/icon.png')
      if (existsSync(icon)) copyFileSync(icon, resolve(dir, 'icon.png'))
    }
  }
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: '',
  plugins: [react(), finishWebBundle()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, 'src/core'),
      '@web': resolve(__dirname, 'src/web'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  build: {
    outDir: resolve(__dirname, 'out/web'),
    emptyOutDir: true,
    // Safari de iPhone/iPad y Chrome de tele/tablet no siempre al día.
    target: ['chrome100', 'safari15'],
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.web.html')
    }
  }
})
