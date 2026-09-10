# Video NAS

Catálogo estilo Netflix para las películas y series que tienes en tu NAS. Escanea shares
SMB, trae portadas y sinopsis de TheMovieDB en español, y las reproduce **dentro de la
app** — en Mac, Windows y Android, con la misma biblioteca.

## Qué hace

### Catálogo

- **Escanea recursivamente** uno o varios NAS por SMB, incluyendo subcarpetas.
- **Portadas reales** desde TheMovieDB en español (es-MX), guardadas en caché local: una
  vez escaneado, la biblioteca se ve completa aunque estés sin internet.
- **Modo sin API key**: sin token la app funciona igual, mostrando el título real leído del
  nombre del archivo sobre una portada generada. Nunca te quedas sin ver qué es cada cosa.
- **Editor de metadata**: si TheMovieDB se equivoca (o no encuentra nada), buscas el título
  a mano, eliges el correcto de una lista con miniaturas y la portada se corrige. La
  corrección **sobrevive a los re-escaneos** y **viaja al resto de tus dispositivos**
  (ver *Metadata compartida*).
- **Series con temporadas y episodios**, con los nombres reales de cada capítulo. El número
  de episodio se saca del nombre del archivo con los formatos que se usan de verdad
  (`S01E02`, `1x02`, `Serie - 002 - Título`, `01 - Título`, `13. Título`, `c11`, `#10`,
  `Ep03`…), no por orden alfabético.
- **Multi-NAS**: agrega todos los servidores que quieras; la biblioteca los combina. Si uno
  está apagado, sus títulos siguen visibles marcados como "sin conexión".
- **Detalle enriquecido**: reparto con fotos, dirección (o creación, en series) y una fila
  de "Relacionadas" — las secuelas o similares que ya tienes en el NAS llevan directo a su
  detalle; las que no tienes se muestran atenuadas con la etiqueta "No está en tu NAS".
- **Copias duplicadas fusionadas**: si la misma película está en dos calidades (o como
  carpeta y como archivo suelto), sale una sola tarjeta. Al reproducir, si hay más de una
  versión, se muestra un selector con la calidad, el contenedor y el tamaño de cada una.
- **Filtro por género** en Películas y Series, y filas por género en Inicio.
- **Cola de reproducción** compartida entre ventanas y dispositivos del mismo equipo.
- **Modo offline**: descarga cualquier película o episodio con progreso y cancelación. Con
  el NAS apagado, lo descargado sigue reproduciéndose desde la copia local.

### Reproductor

Reproduce **cualquier formato**, sin depender de los códecs del navegador:

- **En Android**: libVLC va embebido en la app. Decodifica lo que el WebView no puede —
  AC3/DTS (habitual en los rips "Dual-Lat"), HEVC 10 bits, DivX, MPEG-2 — y dibuja los
  subtítulos, incluidos los de imagen (PGS).
- **En macOS y Windows**: la app trae ffmpeg. Antes de reproducir analiza el archivo y, si
  Chromium no puede con él, lo transcodifica al vuelo (por hardware con VideoToolbox en el
  Mac) copiando el video cuando solo falla el audio, así que arranca enseguida y no pierde
  calidad.
- **Pistas de audio y subtítulos**: menú para cambiar de idioma y activar subtítulos, tanto
  los del archivo como los `.srt`/`.ass` que estén junto al video o en una carpeta `Subs/`.
- **Vista previa al arrastrar**: la barra de progreso muestra la miniatura del punto al que
  vas a saltar, con su tiempo.
- **Mini-barra tipo Spotify**: minimiza el reproductor y sigue navegando el catálogo con el
  video sonando; tócala para volver a pantalla completa.
- **Saltar intro**: automático si el archivo trae capítulos con nombre (común en MKV de
  anime); si no, marcas una vez dónde termina el intro y se recuerda para toda la serie.
- **Siguiente episodio automático** con cuenta regresiva, y botón ⏭ para saltar ya. Al
  terminar una película propone la secuela si la tienes en el NAS.
- **Modo aleatorio**: en cualquier serie, un botón reproduce un episodio al azar y encadena
  otro al terminar.
- **Continuar viendo**: recuerda dónde te quedaste en cada archivo.
- **Reproductor externo** disponible siempre como alternativa manual (VLC, IINA,
  QuickTime, MPC-HC, PotPlayer, MX Player…).

### Metadata compartida entre dispositivos

Cuando corriges la metadata de un título, la corrección se guarda también en el propio NAS
(`.video-nas/overrides.json` en la raíz del share). Cualquier otro dispositivo con la app
la aplica al escanear, así que no tienes que arreglar lo mismo dos veces. Las claves usan la
ruta del archivo normalizada, de modo que funciona aunque macOS y Android escriban los
acentos de forma distinta. Si el NAS está apagado o el share es de solo lectura, el cambio
queda pendiente y se sube en el siguiente escaneo.

## Descargar

En [Releases](https://github.com/Luizun777/video-nas/releases/latest) está lista para usar:

- **macOS (Apple Silicon)**: `video-nas-…-mac-arm64.dmg`
- **Windows 10/11 (64 bits)**: `video-nas-…-windows-x64-portable.exe`, sin instalación

No está firmada con un certificado de pago, así que la primera vez el sistema avisa. En
macOS: **Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente**. En Windows:
**Más información → Ejecutar de todas formas**. Las notas de cada release traen el detalle.

## Requisitos

- macOS (Apple Silicon) o Windows 10/11 de 64 bits para la app de escritorio
- Android 8+ para el APK
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

### Escritorio (macOS y Windows)

```bash
npm run dev     # desarrollo
npm run build   # compilar
npm run dist    # empaquetar para el sistema donde corre (Mac: .dmg y .zip; Windows: .exe portable)
```

En el primer arranque, la app intenta conectar el NAS configurado por defecto y escanea. Si
el sistema aún no tiene acceso al share, macOS te pedirá usuario y contraseña una vez y los
guardará en el llavero; en Windows se abre el Explorador en `\\servidor\share` para que los
escribas y marques **Recordar mis credenciales**.

**Publicar una versión**: sube el número en `package.json` y crea el tag. GitHub Actions
compila en una Mac y en una PC con Windows (cada una con su ffmpeg) y publica la release
con los dos archivos:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

### Android

El tooling vive fuera de brew: JDK 21 en `~/android-tools/jdk-21` y el SDK en
`~/Library/Android/sdk`. Gradle necesita `JAVA_HOME` y `ANDROID_HOME` apuntando ahí.

```bash
npm run dev:mobile      # preview en el navegador con datos de prueba (puerto 5199)
npm run android:apk     # compila el APK de depuración
npm run android:install # lo instala en el dispositivo conectado
npm run android:log     # logcat filtrado
```

En Android las credenciales SMB se escriben en **Ajustes** (no hay llavero del sistema que
las aporte). El reproductor se bloquea en horizontal mientras ves algo y libera la
orientación al minimizar.

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
| `TvShow/Ranma ½/Ranma ½ - 155 - Título.mkv` | numeración absoluta: episodio 155 |
| `TvShow/Serie/OVA/…Ep03….mkv` | temporada 0 (especiales) |

Los títulos que no logre identificar aparecen en la pestaña **Sin identificar**, listos para
corregirse a mano.

## Acceso remoto: ver tu NAS desde fuera de casa

**No abras el puerto 445 (SMB) en tu router.** Es uno de los puertos más escaneados por
atacantes y exponerlo a internet es una mala idea, con o sin contraseña.

La forma segura es una VPN de malla como [Tailscale](https://tailscale.com) (basada en
WireGuard). Tus dispositivos y tu NAS quedan conectados como si estuvieran en la misma red
local, sin abrir puertos ni configurar DNS dinámico:

1. **Instala Tailscale en el NAS.** Synology y QNAP tienen paquete oficial; si tu NAS admite
   Docker, sirve el contenedor oficial. Si no admite ninguno, instálalo en una Raspberry Pi
   conectada a la misma red y anúnciala como ruta de subred:

   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up --advertise-routes=192.168.0.0/24
   ```

   (Luego aprueba la ruta desde el panel de administración de Tailscale.)

2. **Instala Tailscale** en la computadora o el teléfono e inicia sesión con la misma cuenta.

3. **Anota la dirección del NAS en la tailnet**: una IP tipo `100.x.y.z`, o su nombre
   MagicDNS (`nas.tu-tailnet.ts.net`).

4. **Agrégalo en la app**: Ajustes → Servidores NAS → *Agregar servidor*, poniendo esa
   dirección como host y el mismo nombre de share. El campo de dirección acepta cualquier IP
   o hostname, así que desde fuera funciona igual que en casa.

La velocidad dependerá de la subida de tu internet doméstico (típicamente 10–50 MB/s), así
que un 4K puede tardar en arrancar.

## Dónde se guardan tus datos

En el Mac, `~/Library/Application Support/video-nas/`; en Windows, `%APPDATA%\video-nas\`
(en Android, el almacenamiento privado de la app):

- `config.json` — token de TheMovieDB y servidores configurados
- `library.json` — el catálogo escaneado
- `overrides.json` — tus correcciones manuales de metadata
- `progress.json` — dónde te quedaste en cada archivo
- `cache/` — portadas y fondos descargados

Borrar `library.json` y volver a escanear es seguro: las correcciones viven en
`overrides.json` (y en el NAS) y se vuelven a aplicar solas.

## Desarrollo

```bash
npm test         # módulos puros: parser de nombres, agrupador, numeración de episodios,
                 # contrato Range, capítulos MKV, metadata compartida…
npm run typecheck
```

Ver [CLAUDE.md](CLAUDE.md) para la arquitectura y las convenciones del proyecto.
