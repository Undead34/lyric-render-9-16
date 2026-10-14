# Lyric Render 9:16

Estudio local para lyric videos bilingües (TikTok/Shorts/Reels): canción + letra
LRC → video 9:16 u 16:9 estilo app de música, con fondo blur vivo, traducción
visible y coloreo karaoke opcional. Más herramientas para dividir y reparar
video. Todo en el navegador, nada se sube.

## Uso

```sh
npm install
npm run dev      # estudio en http://localhost:8000/lyric-render-9-16/
```
Doble clic en `abrir-server.cmd` hace lo mismo (abre el navegador y levanta el dev).

- Abre `/herramientas/` para Dividir y Reparar video.
- `/lyric-render-9-16/#demo` y `/lyric-render-9-16/#demo16x9`: ver el diseño sin audio.
- `npm run build` genera `dist/` (lo que se publica).

## Flujo del estudio

1. Elige el archivo de música/video (si trae video se usa de fondo).
2. Edita canción y artista: al salir del campo se buscan solos el título, el artista y la letra vía LRCLIB (botón para reintentar).
3. (Opcional) Portada: si el audio trae imagen incrustada se usa sola; si no, degradado cálido.
4. Pega la letra LRC; marca Coloreo karaoke o no.
5. Solo Previsualizar (← Volver o Esc para salir) o Renderizar Video: graba a pantalla completa mínima y descarga al terminar.

## Formato de la letra

```
[mm:ss.xx] Texto original
[mm:ss.xx] [Traducción]
[mm:ss.xx] <mm:ss.xx>Palabra <mm:ss.xx>por <mm:ss.xx>palabra
```

- **Original:** `[mm:ss.xx] Texto`
- **Traducción:** justo debajo de su línea, **entre corchetes** (opcional).
- **Karaoke:** tiempos por palabra con `<mm:ss.xx>` (opcional). Sin tiempos usa barrido estimado; LRCLIB trae word-sync cuando existe.

## Herramientas (`/herramientas/`)

- **Dividir:** partes exactas de N segundos (90 por defecto) en MP4 H.264 + AAC con faststart.
- **Reparar:** tu `.webm` grabado a `_reparado.mp4` bien formado.
- Recodificación con WebCodecs (Mediabunny empaquetado); sin ffmpeg ni backend.

## Notas

- Chrome o Edge en desktop para grabar y convertir; todo es local y privado.
- El sitio vive bajo el subpath `/lyric-render-9-16/` (Astro `base`): en GitHub Pages se publica en `https://undead34.github.io/lyric-render-9-16/` con el workflow de `.github/workflows/deploy.yml` (Settings → Pages → Source: GitHub Actions).
- Licencia MIT. Las muestras de audio/video propias no se suben al repo (ver `.gitignore`).
