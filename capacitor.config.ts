import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.luizun.videonas',
  appName: 'Video NAS',
  webDir: 'dist/mobile',
  server: {
    // Origen http://localhost: cargar el puente http://127.0.0.1 NO es mixed content,
    // así que no hace falta debilitar el WebView con allowMixedContent. El cleartext
    // queda acotado a 127.0.0.1 en res/xml/network_security_config.xml.
    androidScheme: 'http'
  }
}

export default config
