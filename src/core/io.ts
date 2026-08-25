// Interfaces de IO que src/core necesita del mundo exterior. Cada plataforma las
// implementa UNA vez: Electron con Node (src/main/adapters/) y Android con Capacitor
// + el plugin nativo (src/mobile/adapters/). src/core no importa electron, node:* ni
// @capacitor/*; todo acceso a disco o red de plataforma pasa por aquí.

export interface StoreIO {
  /** Contenido del archivo de datos, o null si no existe. */
  read(fileName: string): Promise<string | null>
  /** Escritura atómica (tmp + rename): nunca deja un JSON a medias en disco. */
  writeAtomic(fileName: string, contents: string): Promise<void>
}
