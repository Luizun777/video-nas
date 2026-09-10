## Descargas

| Sistema | Archivo |
|---|---|
| macOS con Apple Silicon (M1 o posterior) | `video-nas-…-mac-arm64.dmg` (o el `.zip`, con la app tal cual) |
| Windows 10/11 de 64 bits | `video-nas-…-windows-x64-portable.exe`: no se instala, se ejecuta directo |

## La primera vez que la abres

La app no está firmada con un certificado de pago, así que el sistema avisa la primera vez.

**macOS**: arrastra *Video NAS* a Aplicaciones y ábrela. Cuando diga que no puede verificar
la app, ve a **Ajustes del Sistema → Privacidad y seguridad** y pulsa **Abrir igualmente**.
Si aun así dice que la app "está dañada", ejecuta en la Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Video NAS.app"
```

**Windows**: si aparece "Windows protegió tu PC", pulsa **Más información → Ejecutar de
todas formas**. El `.exe` portable se descomprime cada vez que lo abres, así que tarda unos
segundos en arrancar.

## Conectar tu NAS

En **Ajustes → Servidores NAS** pon la dirección y el share (por ejemplo `192.168.1.100` y
`video`) y pulsa **Reconectar servidores**.

- **macOS** pide usuario y contraseña del share una vez y los guarda en el Llavero.
- **Windows** abre el Explorador en `\\servidor\share`: escribe usuario y contraseña, marca
  **Recordar mis credenciales**, y la app detecta el acceso sola. Si tu NAS solo permite
  entrar como invitado sin contraseña, Windows 11 lo bloquea: crea un usuario en el NAS.

Sin token de TheMovieDB la app funciona igual (portadas y títulos salen del nombre del
archivo). Para metadata completa, pega tu token en **Ajustes → TheMovieDB**.
