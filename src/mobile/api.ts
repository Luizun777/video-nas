// Stub de la fase F6: la implementación real de window.api sobre Capacitor + el plugin
// SMB nativo llega en la fase F8 (createMobileApi con stores de core + puente HTTP).

export async function installMobileApi(): Promise<void> {
  throw new Error('La capa nativa de Android todavía no está implementada.')
}
