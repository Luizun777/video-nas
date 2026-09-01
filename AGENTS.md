# Instrucciones para agentes

Las convenciones de este proyecto viven en **[CLAUDE.md](CLAUDE.md)**: arquitectura
(core agnóstico de plataforma, adaptadores de Electron y Android), reglas duras,
comandos, y las lecciones aprendidas depurando contra el NAS real.

Este archivo existía como copia y se quedó atrás, así que ahora solo apunta allí: dos
documentos con las mismas reglas acaban contradiciéndose.

Lo mínimo antes de tocar nada:

- **CERO módulos nativos de node-gyp.** La persistencia es JSON. Binarios standalone
  (ffmpeg) y el plugin Java de Capacitor sí valen.
- **`src/core` no importa `electron`, `node:*` ni `@capacitor/*`.** Todo IO pasa por las
  interfaces de `src/core/io.ts`.
- **El token de TheMovieDB nunca va en el código ni en git** (`seed.config.json` está en
  `.gitignore`). La app debe funcionar entera sin token.
- **Evidencia, no afirmaciones**: tras cada cambio, la salida real de `npm test` y
  `npm run typecheck`, y verificación en el dispositivo cuando el cambio se ve.
