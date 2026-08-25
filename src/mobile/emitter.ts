export type Unsubscribe = () => void

/**
 * Emitter tipado mínimo para los eventos push de window.api en Android (donde main y
 * renderer comparten proceso: no hay IPC real, solo callbacks en memoria).
 */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<(payload: never) => void>>()

  on<K extends keyof Events>(channel: K, cb: (payload: Events[K]) => void): Unsubscribe {
    let set = this.listeners.get(channel)
    if (!set) {
      set = new Set()
      this.listeners.set(channel, set)
    }
    set.add(cb as (payload: never) => void)
    return () => {
      set.delete(cb as (payload: never) => void)
    }
  }

  emit<K extends keyof Events>(channel: K, payload: Events[K]): void {
    const set = this.listeners.get(channel)
    if (!set) return
    for (const cb of [...set]) (cb as (payload: Events[K]) => void)(payload)
  }
}
