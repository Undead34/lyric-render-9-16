# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Creadores de videos verticales para TikTok / Reels / Shorts. Usan Lyric Render en desktop (Chrome/Edge) antes de publicar: suben su canción, pegan la letra y generan un lyric video bilingüe listo para compartir. Secundario implícito: fans que traducen EN<>ES para su comunidad — no se separa como audiencia distinta en esta fase.

## Product Purpose

Convertir cualquier canción + letra LRC en un lyric video vertical u horizontal estilo app de música, con fondo blur animado, línea activa destacada y traducción visible. Existe para evitar editores pesados o subidas a servicios: pegar, previsualizar y grabar en el navegador. Éxito = video descargado y publicable en 9:16 (1080x1920) o 16:9 (1920x1080) sin fricción.

## Positioning

Render bilingüe original + [traducción] con fondo blur vivo que respira/deriva desde portada o video, autocompletado de título/artista/letra vía LRCLIB y grabación 100% local en el navegador — ningún editor genérico combina LRC bilingüe + doble formato Shorts + exportación local sin backend en un flujo de una sola pantalla.

## Operating Context

Flujo real: elige archivo de música/video local → (opcional) portada como fondo → edita canción, artista y Formato → pega letra LRC → Solo Previsualizar o Renderizar Video (graba hasta que termina la canción y descarga). Entornos: navegador desktop para grabar, móvil para previsualizar (mobile-first, dvh, safe-area). Herramientas vecinas: ffmpeg para extraer carátula incrustada, LRCLIB online opcional, modo demo `/#demo` y `/#demo16x9` para ver el diseño sin audio.

## Capabilities and Constraints

Confirmado que debe preservarse tras el rediseño:
- Pegar LRC `[mm:ss.xx] Texto` + traducción en línea siguiente `[mm:ss.xx] [Texto traducido]`, parseo y orden por tiempo.
- Previsualización en canvas + grabación/descarga (`canvas.captureStream` 60fps + `MediaRecorder`).
- Doble formato: 9:16 vertical 1080x1920 y 16:9 horizontal 1920x1080, con título + artista al pie.
- Fondo blur animado (respira, deriva, pulsa) desde video > portada > degradado cálido.
- Autocompletado LRCLIB: adivina desde nombre de archivo, intento exacto + búsqueda libre, prioriza letra sincronizada.
- Herramientas en `/herramientas` (misma app, página aparte): Dividir video en partes exactas de N segundos y Reparar video a MP4 H.264 bien formado, ambas con WebCodecs vía Mediabunny empaquetado en local — reemplazan los scripts ffmpeg sin sacar archivos del navegador.

Restricciones duras confirmadas por el usuario:
- 100% local y privado: sin backend ni cuentas, los archivos nunca suben.
- Grabación solo fiable en Chrome/Edge (MediaRecorder + `canvas.captureStream`).
- Mantener stack Astro estático actual, sin migrar de framework.
- La decodificación vía canvas no basta: hay que re-recodificar a un formato compatible para compartir usando las APIs del navegador.

Terminología del producto: LRC, traducción entre corchetes, Formato, Solo Previsualizar vs Renderizar Video.
Indeciso explícito: códec/formato final de exportación compatible para TikTok/Shorts (mp4 vs webm), bitrate y límites de duración — no inventar en trabajo visual futuro.

## Brand Commitments

Nombre existente: Lyric Render 9:16. UI y copy en español, voz directa de creador. Fuente cargada en local vía Fontsource (Quicksand) — se registra como activo existente, sin directriz visual para el rediseño.

## Evidence on Hand

- Código vigente: `src/components/LyricRenderer.astro`, `src/scripts/lyric-render.ts`, `src/styles/global.css`, `src/layouts/Layout.astro`, `src/pages/index.astro`.
- Legado independiente: `index.html` (render original, no modificar como referencia de producto).
- Docs: `README.md` (uso, formato LRC, comandos `abrir-server.cmd`).
- Contenido real de ejemplo: `A Whole New World [xYjFxFFdyyk].txt`, `.png`, `.webm`, `A_Whole_New_World_reparado.mp4`, `2026-08-26 10-29-55_reparado.mp4`.
- Ausencias que no deben fabricarse: sin testimonios, clientes, benchmarks, pricing, licencias ni claims de distribución.

## Product Principles

1. Local primero: nada sale del navegador; la privacidad es la feature.
2. Bilingüe legible siempre: original + traducción nunca compiten, siempre acompañan.
3. Vertical primero, dual sin costo: 9:16 manda, 16:9 sale del mismo flujo.
4. Pegar-grabar-compartir sin fricción: cada paso extra es un video que no se publica.
5. Rendimiento honesto: el canvas nunca bloquea la UI ni miente sobre lo que el navegador puede exportar.
