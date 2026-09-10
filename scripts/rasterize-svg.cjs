// Rasteriza SVG a PNG con transparencia dibujándolo en un <canvas> dentro de una ventana
// oculta de Electron (toDataURL conserva el alpha). Lo lanza generate-icons.mjs como
// `electron scripts/rasterize-svg.cjs`, con los trabajos en ICON_JOBS.
// Descartados: Chrome headless --screenshot se cuelga en macOS, y el offscreen de Electron
// (evento paint) entrega frames en blanco y sin alpha.
const { readFileSync, writeFileSync } = require('node:fs')
const { app, BrowserWindow } = require('electron')

// Sin este listener Electron sale al cerrar la última ventana, también en macOS.
app.on('window-all-closed', () => {})

/**
 * Corre dentro de la página. La imagen llega como data: URL, que cuenta como mismo origen:
 * el canvas no queda "tainted" y toDataURL funciona.
 */
function drawInPage(svgBase64, size) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      canvas.getContext('2d').drawImage(image, 0, 0, size, size)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error('Chromium no pudo decodificar el SVG'))
    image.src = `data:image/svg+xml;base64,${svgBase64}`
  })
}

async function rasterize() {
  app.dock?.hide()
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  await window.loadURL('data:text/html;charset=utf-8,<!doctype html><title>rasterize</title>')
  for (const { svg, png, size = 1024 } of JSON.parse(process.env.ICON_JOBS)) {
    const svgBase64 = readFileSync(svg).toString('base64')
    const dataUrl = await window.webContents.executeJavaScript(
      `(${drawInPage})(${JSON.stringify(svgBase64)}, ${size})`
    )
    writeFileSync(png, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
    console.log(`  ${png.split('/').pop()}: ${size}x${size}`)
  }
  window.destroy()
}

app
  .whenReady()
  .then(rasterize)
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
