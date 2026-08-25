# Video NAS

Catálogo de escritorio, estilo Netflix, para las películas y series que tienes en tu NAS.
Escanea shares SMB, trae portadas y sinopsis de TheMovieDB en español, y reproduce cada
título con el reproductor nativo de tu Mac.

## Qué hace

- **Escanea recursivamente** uno o varios NAS por SMB, incluyendo subcarpetas.
- **Portadas reales** desde TheMovieDB en español (es-MX), guardadas en caché local: una
  vez escaneado, la biblioteca se ve completa aunque estés sin internet.
- **Modo sin API key**: sin token la app funciona igual, mostrando el título real leído del
  nombre del archivo sobre una portada generada. Nunca te quedas sin ver qué es cada cosa.
- **Editor de metadata**: si TheMovieDB se equivoca (o no encuentra nada), buscas el título
  a mano, eliges el correcto de una lista con miniaturas y la portada se corrige. La
  corrección **sobrevive a los re-escaneos**.
- **Series con temporadas y episodios**, con los nombres reales de cada capítulo.
- **Multi-NAS**: agrega todos los servidores que quieras; la biblioteca los combina. Si uno
  está apagado, sus títulos siguen visibles marcados como "sin conexión".
- **Reproductor nativo**: al darle play, el archivo se abre con QuickTime, IINA, VLC o lo
  que tengas asociado. La app no reproduce nada por dentro.
- **Detalle enriquecido**: reparto con fotos, dirección (o creación, en series) y una fila
  de "Relacionadas" — las secuelas o similares que ya tienes en el NAS llevan directo a su
  detalle; las que no tienes se muestran atenuadas con la etiqueta "No está en tu NAS".
- **Copias duplicadas fusionadas**: si la misma película está en dos calidades (o como
  carpeta y como archivo suelto), sale una sola tarjeta. Al reproducir, si hay más de una
  versión, se muestra un selector con la calidad, el contenedor y el tamaño de cada una.
- **Filtro por género** en Películas y Series, y filas por género en Inicio.
- **Modo offline**: descarga cualquier película o episodio a `~/Movies/Video NAS` con
  progreso y cancelación. Con el NAS apagado, lo descargado sigue reproduciéndose desde la
  copia local (la tarjeta muestra "Descargada" en vez de "Sin conexión").
- **Reproductor integrado** (activado por defecto, configurable en Ajustes): reproduce
  dentro de la app con controles estilo Netflix, atajos de teclado y pantalla completa.
  - **Saltar intro**: automático si el archivo trae capítulos con nombre (común en MKV de
    anime); si no, marcas una vez dónde termina el intro y se recuerda para toda la serie.
  - **Siguiente episodio automático**: cerca del final aparece "Siguiente episodio en Ns"
    con cuenta regresiva, botón para saltar ya o para cancelar y seguir viendo.
  - **Al terminar una película**, durante los créditos propone la secuela si la tienes en
    el NAS (salto directo) o una recomendación relacionada.
  - **Fallback automático**: si un archivo usa un códec que Chromium no decodifica (DivX
    en .avi, MPEG-2 en .mpg…), se abre solo en tu reproductor externo, sin preguntar. En
    Ajustes puedes desactivar el integrado y elegir qué aplicación externa usar siempre
    (VLC, IINA, QuickTime o cualquier otra).

## Requisitos

- macOS
- Node.js 20 o superior
- Un NAS con SMB accesible

## Puesta en marcha

```bash
npm install
```

Para usar TheMovieDB, crea un archivo `seed.config.json` en la raíz del proyecto con tu
token (el archivo está en `.gitignore`, nunca se sube):

```json
{ "tmdbBearerToken": "TU_API_READ_ACCESS_TOKEN_V4" }
```

También puedes pegarlo directamente en **Ajustes → TheMovieDB** dentro de la app.

```bash
npm run dev     # desarrollo
npm run build   # compilar
npm run dist    # empaquetar .app de macOS
```

En el primer arranque, la app intenta montar el NAS configurado por defecto
(`smb://192.168.0.189/video`, carpetas `Movies` y `TvShow`) y escanea. Si el share no está
montado, macOS te pedirá usuario y contraseña una vez y los guardará en el llavero.

## Cómo organiza tus archivos

La app entiende los nombres tal como suelen estar en un NAS, sin pedirte que renombres nada:

| En tu NAS | Cómo lo interpreta |
|---|---|
| `Movies/Avatar (2009)/Avatar.2009.2160p.BluRay.x265-[YTS.MX].mkv` | Avatar, 2009 |
| `Movies/Amelie (2001).mp4` | Amelie, 2001 |
| `Movies/300 (2006 ).avi` | 300, 2006 |
| `Movies/Apocalypto.mp4` | Apocalypto, sin año |
| `Movies/… (2019) 4K Ultra HD Latino Dual` | se descartan las etiquetas de calidad |
| `TvShow/Arcane (2021)/Arcane 1x01.mp4` | Arcane, temporada 1 episodio 1 |
| `TvShow/Big Bang Theory/TBBT1/capitulo 01.avi` | temporada 1 episodio 1 |
| `TvShow/Serie/Temporada 2/S02E05.mkv` | temporada 2 episodio 5 |

Los títulos que no logre identificar aparecen en la pestaña **Sin identificar**, listos para
corregirse a mano.

## Acceso remoto: ver tu NAS desde fuera de casa

**No abras el puerto 445 (SMB) en tu router.** Es uno de los puertos más escaneados por
atacantes y exponerlo a internet es una mala idea, con o sin contraseña.

La forma segura es una VPN de malla como [Tailscale](https://tailscale.com) (basada en
WireGuard). Tu Mac y tu NAS quedan conectados como si estuvieran en la misma red local, sin
abrir puertos ni configurar DNS dinámico:

1. **Instala Tailscale en el NAS.** Synology y QNAP tienen paquete oficial; si tu NAS admite
   Docker, sirve el contenedor oficial. Si no admite ninguno, instálalo en una Raspberry Pi
   conectada a la misma red y anúnciala como ruta de subred:

   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up --advertise-routes=192.168.0.0/24
   ```

   (Luego aprueba la ruta desde el panel de administración de Tailscale.)

2. **Instala Tailscale en tu Mac** e inicia sesión con la misma cuenta.

3. **Anota la dirección del NAS en la tailnet**: una IP tipo `100.x.y.z`, o su nombre
   MagicDNS (`nas.tu-tailnet.ts.net`).

4. **Agrégalo en la app**: Ajustes → Servidores NAS → *Agregar servidor*, poniendo esa
   dirección como host y el mismo nombre de share. No hace falta nada más — el campo de
   dirección acepta cualquier IP o hostname, así que desde fuera funciona igual que en casa.

La velocidad dependerá de la subida de tu internet doméstico (típicamente 10–50 MB/s), así
que un 4K puede tardar en arrancar. La app espera hasta 60 segundos a que monte el share
antes de marcar el servidor como sin conexión.

## Dónde se guardan tus datos

`~/Library/Application Support/video-nas/`

- `config.json` — token de TheMovieDB y servidores configurados
- `library.json` — el catálogo escaneado
- `overrides.json` — tus correcciones manuales de metadata
- `cache/` — portadas y fondos descargados

Borrar `library.json` y volver a escanear es seguro: las correcciones viven en
`overrides.json` y se vuelven a aplicar solas.

## Desarrollo

```bash
npm test         # tests del parser de nombres y del agrupador
npm run typecheck
```

Ver [CLAUDE.md](CLAUDE.md) para las convenciones del proyecto.
