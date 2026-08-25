// Arranque de la plataforma móvil: decide QUÉ implementación de window.api instalar.
// Los imports son dinámicos a propósito: el mock de navegador no debe pesar en el APK
// (import.meta.env.DEV es false en producción y rollup lo poda), y la capa nativa no
// debe evaluarse en un navegador de escritorio.

export async function installPlatformApi(): Promise<void> {
  if (window.api) return // Electron ya expuso el preload (o alguien instaló antes).

  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (capacitor?.isNativePlatform?.()) {
    const { installMobileApi } = await import('./api')
    await installMobileApi()
    return
  }

  if (import.meta.env.DEV) {
    // Preview de desarrollo en navegador: datos de mentira para iterar la UI.
    const { installMockApi } = await import('./dev-mock-api')
    installMockApi()
    return
  }

  throw new Error('Plataforma desconocida: ni Electron, ni Capacitor, ni modo dev.')
}
