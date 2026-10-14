/**
 * Lyric Render — script de cliente (Vite-bundled desde LyricRenderer.astro).
 *
 * Velocidad máxima de decodificación del navegador:
 *  1. `canvas.getContext("2d", { alpha: false, desynchronized: true })`:
 *     canvas opaco + baja latencia (sin composición alfa, sin bloqueo).
 *  2. Portada vía `createImageBitmap()` (decodifica fuera del hilo principal,
 *     bitmap listo para GPU) con fallback a `img.decode()` (decodificación
 *     asíncrona explícita en vez de solo `onload`).
 *  3. Video con `preload="auto"` + `requestVideoFrameCallback()` cuando existe:
 *     dibuja solo cuando el decodificador de hardware entrega un frame nuevo
 *     (sincronizado a vsync), en vez de repintar a ciegas con rAF.
 *  4. Fuentes canvas precalentadas con `document.fonts.load()` para no medir
 *     texto con la fuente fallback.
 */

import { extractEmbeddedPicture } from "./embedded-art";
import { isLineExpired, lyricsfileToEnhancedLrc, parseLyrics, sungSpan, MAX_SUNG_SPAN } from "./lrc";
import type { LyricLine } from "./lrc";

interface AspectPreset {
  w: number;
  h: number;
  centerY: number;
  lineHeight: number;
  fActive: number;
  fActiveT: number;
  fIdle: number;
  fIdleT: number;
  maxW: number;
  maxWT: number;
  fTitle: number;
  fArtist: number;
  titleY: number;
  artistY: number;
  css: { width: string; height: string; aspectRatio: string };
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} no encontrado`);
  return node as T;
}

const canvas = el<HTMLCanvasElement>("appCanvas");
// alpha:false = canvas opaco (el compositor se ahorra el blending).
// desynchronized:true = el canvas no bloquea al compositor (menor latencia).
// willReadFrequently:false = optimiza para escritura (drawImage/fillText).
let ctx: CanvasRenderingContext2D;
try {
  ctx =
    canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
      willReadFrequently: false,
      colorSpace: "srgb",
    } as CanvasRenderingContext2DSettings) ?? canvas.getContext("2d")!;
} catch {
  ctx = canvas.getContext("2d")!;
}

// El blur vive en un lienzo a 1/4 de resolución: cuesta ~1/16 y al reescalar
// se ve idéntico. El doble blur a 1080×1920 con rAF a 60fps tiraba frames
// (glitches) en GPUs integradas.
const bgCanvas = document.createElement("canvas");
const bctx = bgCanvas.getContext("2d")!;
const BG_SCALE = 0.25;

const video = el<HTMLVideoElement>("videoPlayer");
const overlay = el("ui-overlay");
const statusText = el("status");
const mediaInput = el<HTMLInputElement>("mediaInput");
const lyricsInput = el<HTMLTextAreaElement>("lyricsInput");
const titleInput = el<HTMLInputElement>("titleInput");
const artistInput = el<HTMLInputElement>("artistInput");
const coverInput = el<HTMLInputElement>("coverInput");
const aspectInput = el<HTMLSelectElement>("aspectInput");
const karaokeInput = el<HTMLInputElement>("karaokeInput");
const exitBtn = el<HTMLButtonElement>("exitBtn");
const recDot = el("recDot");
const stageEl = el("stage");

// La portada puede ser un ImageBitmap (vía rápida) o un <img> (fallback).
let coverBitmap: ImageBitmap | null = null;
let coverImage: HTMLImageElement | null = null;
let coverW = 0;
let coverH = 0;
let mediaObjectUrl: string | null = null;
let coverObjectUrl: string | null = null;

// ====== PRESETS DE FORMATO ======
const PRESETS: Record<string, AspectPreset> = {
  "9:16": {
    w: 1080,
    h: 1920,
    centerY: 700,
    lineHeight: 190,
    fActive: 62,
    fActiveT: 48,
    fIdle: 54,
    fIdleT: 40,
    maxW: 960,
    maxWT: 920,
    fTitle: 52,
    fArtist: 42,
    titleY: 1655,
    artistY: 1725,
    css: { width: "auto", height: "100%", aspectRatio: "9 / 16" },
  },
  "16:9": {
    w: 1920,
    h: 1080,
    centerY: 400,
    lineHeight: 135,
    fActive: 52,
    fActiveT: 38,
    fIdle: 44,
    fIdleT: 32,
    maxW: 1700,
    maxWT: 1600,
    fTitle: 44,
    fArtist: 34,
    titleY: 930,
    artistY: 990,
    css: { width: "100%", height: "auto", aspectRatio: "16 / 9" },
  },
};

let width = 1080;
let height = 1920;
let centerY = 700;
let lineHeight = 190;
let fActive = 62;
let fActiveT = 48;
let fIdle = 54;
let fIdleT = 40;
let maxW = 960;
let maxWT = 920;
let fTitle = 52;
let fArtist = 42;
let titleY = 1655;
let artistY = 1725;

function applyAspect(key: string): void {
  const p = PRESETS[key] ?? PRESETS["9:16"];
  width = p.w;
  height = p.h;
  centerY = p.centerY;
  lineHeight = p.lineHeight;
  fActive = p.fActive;
  fActiveT = p.fActiveT;
  fIdle = p.fIdle;
  fIdleT = p.fIdleT;
  maxW = p.maxW;
  maxWT = p.maxWT;
  fTitle = p.fTitle;
  fArtist = p.fArtist;
  titleY = p.titleY;
  artistY = p.artistY;
  canvas.width = width;
  canvas.height = height;
  bgCanvas.width = Math.max(2, Math.round(width * BG_SCALE));
  bgCanvas.height = Math.max(2, Math.round(height * BG_SCALE));
  canvas.style.width = p.css.width;
  canvas.style.height = p.css.height;
  canvas.style.aspectRatio = p.css.aspectRatio;
  // Precalienta la fuente a los tamaños reales del preset para que el
  // canvas mida texto ya con Quicksand decodificada (sin FOUT).
  void warmFonts();
}

async function warmFonts(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`700 ${fActive}px Quicksand`),
      document.fonts.load(`600 ${fIdle}px Quicksand`),
      document.fonts.load(`400 ${fActiveT}px Quicksand`),
      document.fonts.load(`700 ${fTitle}px Quicksand`),
    ]);
    await document.fonts.ready;
  } catch {
    /* document.fonts puede no existir en navegadores viejos */
  }
}

applyAspect(aspectInput.value);
aspectInput.addEventListener("change", () => applyAspect(aspectInput.value));

let isPlaying = false;
let isRecording = false;
let frameHandle = 0;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let lyrics: LyricLine[] = [];
let activeIndex = -1;
let targetScrollY = 0;
let currentScrollY = 0;

// ====== EJEMPLO DE LETRA (bórralo y pega la tuya) ======
lyricsInput.value = `[00:01.02]Love you like a brother
[00:01.02] [Te quiero como a un hermano]
[00:03.88]Treat you like a friend
[00:03.88] [Te trato como a un amigo]
[00:06.75]Respect you like a lover
[00:06.75] [Te respeto como a un amante]
[00:12.54]You could bet that never gotta sweat that
[00:12.54] [Puedes apostar que nunca tendrás que preocuparte]
[00:23.31]If you be the cash I'll be the rubber band
[00:23.31] [Si tú eres el dinero, yo seré la liga]
[00:26.39]You be the match I'mma be your fuse boom
[00:26.39] [Tú eres la cerilla, yo seré tu mecha, boom]
[01:09.31]Cause this love is a sure thing
[01:09.31] [Porque este amor es una apuesta segura]`;

// ====== FONDO: BLUR PODEROSO ANIMADO ======
function drawBackground(): void {
  let source: CanvasImageSource | null = null;
  let sw = 0;
  let sh = 0;
  if (video.readyState >= 2 && video.videoWidth > 0) {
    source = video;
    sw = video.videoWidth;
    sh = video.videoHeight;
  } else if (coverBitmap) {
    source = coverBitmap;
    sw = coverW;
    sh = coverH;
  } else if (coverImage) {
    source = coverImage;
    sw = coverImage.naturalWidth;
    sh = coverImage.naturalHeight;
  }

  if (source && sw > 0 && sh > 0) {
    // Todo ocurre en el lienzo pequeño (k = escala); el canvas grande solo
    // recibe el reescalado final, un blit barato.
    const k = BG_SCALE;
    const W = bgCanvas.width;
    const H = bgCanvas.height;
    const t = performance.now() / 1000;
    const zoom = 1.18 + Math.sin(t * 0.25) * 0.07;
    const panX = Math.sin(t * 0.18) * 55 * k;
    const panY = Math.cos(t * 0.14) * 70 * k;

    const baseScale = Math.max(W / sw, H / sh);
    const bgScale = baseScale * zoom;
    const bgW = sw * bgScale;
    const bgH = sh * bgScale;

    bctx.clearRect(0, 0, W, H);
    bctx.save();
    bctx.filter = "blur(15px) brightness(0.62) saturate(1.7) contrast(1.08)";
    bctx.drawImage(source, (W - bgW) / 2 + panX, (H - bgH) / 2 + panY, bgW, bgH);
    bctx.restore();

    bctx.save();
    bctx.globalAlpha = 0.45;
    bctx.filter = "blur(22px) brightness(0.75) saturate(1.9)";
    const zoom2 = zoom * 1.12;
    const bgW2 = sw * baseScale * zoom2;
    const bgH2 = sh * baseScale * zoom2;
    bctx.drawImage(source, (W - bgW2) / 2 - panX * 1.4, (H - bgH2) / 2 - panY * 1.4, bgW2, bgH2);
    bctx.restore();

    const pulse = 0.28 + Math.sin(t * 0.8) * 0.05;
    bctx.fillStyle = `rgba(35, 20, 32, ${pulse})`;
    bctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bgCanvas, 0, 0, width, height);
    ctx.restore();
  } else {
    const t = performance.now() / 1000;
    const shift = (Math.sin(t * 0.3) + 1) / 2;
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, `rgb(${138 + shift * 30}, ${90 - shift * 15}, ${68 + shift * 20})`);
    grad.addColorStop(0.5, "#5c3a40");
    grad.addColorStop(1, "#2a1c26");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }
}

// ====== DIBUJO DE UNA LÍNEA ======
function drawLyricBlock(
  lyric: LyricLine,
  isActive: boolean,
  emphasis: number,
  x: number,
  y: number,
  scale: number,
  now: number,
  lineEnd: number | null,
  karaoke: boolean,
): void {
  const hasTranslation = !!lyric.translation;
  const originalY = hasTranslation ? -Math.round(lineHeight * 0.19) : 0;
  const translationY = Math.round(lineHeight * 0.2);
  const words = lyric.words ?? [];
  const end = lineEnd ?? lyric.time + MAX_SUNG_SPAN;
  const span = sungSpan(lyric.time, end);
  // Caducada: el cantante ya calló (solo instrumental). Se dibuja apagada
  // aunque siga siendo el índice activo.
  const expired = isActive && isLineExpired(now, lyric.time, end);
  // Exacto con tiempos por palabra; estimado con barrido proporcional cuando
  // la línea no trae tiempos de palabra pero sí fin conocido.
  const exact = isActive && karaoke && words.length > 0 && !expired;
  const estimated = isActive && karaoke && !exact && !expired;

  // Tamaño y color continuos: nada salta al cambiar de verso.
  const e = expired ? 0 : emphasis;
  const fMain = fIdle + (fActive - fIdle) * e;
  const fTrans = fIdleT + (fActiveT - fIdleT) * e;
  const mainColor = `rgb(${Math.round(227 + 28 * e)},${Math.round(220 + 35 * e)},${Math.round(228 + 27 * e)})`;

  ctx.save();
  ctx.translate(x, y);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.font = `${e > 0.5 ? 700 : 600} ${fMain}px Quicksand, sans-serif`;
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 8 + 4 * e;

  let safeScale = 1;
  const textWidth = ctx.measureText(lyric.text).width;
  if (textWidth > maxW) safeScale = maxW / textWidth;

  const paintY = originalY / (scale * safeScale);

  if (exact) {
    // Palabra por palabra: base tenue y lo ya cantado en blanco.
    ctx.save();
    ctx.scale(scale * safeScale, scale * safeScale);
    ctx.textAlign = "left";
    const widths = words.map((w) => ctx.measureText(`${w.text} `).width);
    const total = widths.reduce((a, b) => a + b, 0);
    let cursor = -total / 2;
    words.forEach((w, i) => {
      ctx.fillStyle = now >= w.time ? "#ffffff" : "rgba(227, 220, 228, 0.5)";
      ctx.fillText(w.text, cursor, paintY);
      cursor += widths[i];
    });
    ctx.restore();
  } else if (estimated) {
    // Barrido proporcional sobre la duración cantada estimada.
    const progress = Math.min(1, Math.max(0, (now - lyric.time) / span));
    ctx.fillStyle = "rgba(227, 220, 228, 0.6)";
    ctx.save();
    ctx.scale(scale * safeScale, scale * safeScale);
    ctx.fillText(lyric.text, 0, paintY);
    ctx.restore();
    if (progress > 0) {
      ctx.save();
      ctx.scale(scale * safeScale, scale * safeScale);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.rect(-textWidth / 2 - 4, paintY - fMain, textWidth * progress + 8, fMain * 2);
      ctx.clip();
      ctx.fillText(lyric.text, 0, paintY);
      ctx.restore();
    }
  } else {
    ctx.fillStyle = mainColor;
    ctx.save();
    ctx.scale(scale * safeScale, scale * safeScale);
    ctx.fillText(lyric.text, 0, paintY);
    ctx.restore();
  }

  if (hasTranslation) {
    ctx.font = `400 ${fTrans}px Quicksand, sans-serif`;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.75 + 0.13 * e})`;

    let tSafeScale = 1;
    const tText = `[${lyric.translation}]`;
    const tWidth = ctx.measureText(tText).width;
    if (tWidth > maxWT) tSafeScale = maxWT / tWidth;

    ctx.save();
    ctx.scale(scale * tSafeScale, scale * tSafeScale);
    ctx.fillText(tText, 0, translationY / (scale * tSafeScale));
    ctx.restore();
  }

  ctx.restore();
}

// ====== FRAME COMPLETO ======
function drawFrame(currentTime: number): void {
  // Con alpha:false el clearRect es opcional, pero lo mantenemos barato:
  // el fondo siempre repinta el canvas completo.
  drawBackground();

  let newActiveIndex = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (currentTime >= lyrics[i].time) newActiveIndex = i;
    else break;
  }

  if (newActiveIndex !== activeIndex && newActiveIndex !== -1) {
    activeIndex = newActiveIndex;
    targetScrollY = -(activeIndex * lineHeight);
  }

  currentScrollY += (targetScrollY - currentScrollY) * 0.08;

  const lyricsX = width / 2;

  for (let i = 0; i < lyrics.length; i++) {
    const lineY = centerY + i * lineHeight + currentScrollY;
    if (lineY > -120 && lineY < height + 120) {
      const distFromCenter = Math.abs(lineY - centerY);
      const ratio = Math.max(0, 1 - distFromCenter / (height / 2));
      const opacity = Math.pow(ratio, 1.5);
      const scale = 0.92 + 0.08 * ratio;
      // Énfasis continuo según cercanía al centro: las líneas ya no aparecen,
      // desaparecen ni cambian de tamaño de golpe al cambiar de verso.
      const raw = Math.max(0, 1 - distFromCenter / (lineHeight * 1.2));
      const emphasis = raw * raw * (3 - 2 * raw);

      const nextTime =
        i + 1 < lyrics.length
          ? lyrics[i + 1].time
          : Number.isFinite(video.duration)
            ? video.duration
            : lyrics[i].time + 5;
      ctx.save();
      ctx.globalAlpha = opacity;
      drawLyricBlock(lyrics[i], i === activeIndex, emphasis, lyricsX, lineY, scale, currentTime, nextTime, karaokeInput.checked);
      ctx.restore();
    }
  }

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 10;

  ctx.font = `700 ${fTitle}px Quicksand, sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(titleInput.value.trim(), width / 2, titleY);

  ctx.font = `400 ${fArtist}px Quicksand, sans-serif`;
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillText(artistInput.value.trim(), width / 2, artistY);
  ctx.restore();
}

// Bucle de pintado con rAF a 60fps, haya o no pista de video en el archivo.
// requestVideoFrameCallback no sirve aquí: con audio (mp3, opus, sin frames
// de video) su callback nunca se dispara y el lienzo quedaba congelado.
function scheduleNext(): void {
  if (!isPlaying) return;
  frameHandle = requestAnimationFrame(() => {
    if (!isPlaying) return;
    drawFrame(video.currentTime);
    scheduleNext();
  });
}

function stopLoop(): void {
  isPlaying = false;
  cancelAnimationFrame(frameHandle);
}

function animate(): void {
  if (!isPlaying) return;
  drawFrame(video.currentTime);
  scheduleNext();
}

// ====== VOLVER AL ESTUDIO ======
// El preview ocultaba el panel sin salida; al terminar la canción, con el
// botón o con Esc, se restaura todo lo que initPlayback escondió.
let uiGen = 0;

function showStudio(): void {
  uiGen++;
  stopLoop();
  try {
    video.pause();
  } catch {
    /* sin reproducción activa */
  }
  isRecording = false;
  document.querySelectorAll(".field").forEach((f) => ((f as HTMLElement).style.display = ""));
  const rowEl = document.querySelector(".row") as HTMLElement | null;
  rowEl?.style.removeProperty("display");
  const actionsEl = document.querySelector(".actions") as HTMLElement | null;
  actionsEl?.style.removeProperty("display");
  el("previewBtn").style.display = "";
  el("renderBtn").style.display = "";
  statusText.style.display = "none";
  overlay.style.display = "";
  overlay.style.opacity = "1";
  exitBtn.style.display = "none";
  recDot.style.display = "none";
  document.body.classList.remove("is-playing");
  document.body.classList.remove("is-recording");
  if (document.fullscreenElement) {
    try {
      void document.exitFullscreen().catch(() => {});
    } catch {
      /* ya estamos fuera */
    }
  }
}

exitBtn.addEventListener("click", showStudio);
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape" && exitBtn.style.display !== "none") showStudio();
});

// Pantalla completa sobre el escenario (sigue siendo el mismo canvas que se
// graba). Si el navegador la niega, vale el escenario expandido por CSS.
function enterFullscreen(): void {
  try {
    const req = stageEl.requestFullscreen?.call(stageEl) as Promise<void> | undefined;
    req?.catch(() => {
      /* sin pantalla completa: sigue el modo expandido */
    });
  } catch {
    /* idem */
  }
}

// ====== LÓGICA DE GRABACIÓN ======
function pickMimeType(): string | undefined {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* noop */
    }
  }
  return undefined;
}

function startRecording(): void {
  try {
    const canvasStream = canvas.captureStream(60);

    let audioStream: MediaStream;
    const v = video as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    if (v.captureStream) {
      audioStream = v.captureStream();
    } else if (v.mozCaptureStream) {
      audioStream = v.mozCaptureStream();
    } else {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AC();
      const dest = audioCtx.createMediaStreamDestination();
      const source = audioCtx.createMediaElementSource(video);
      source.connect(dest);
      source.connect(audioCtx.destination);
      audioStream = dest.stream;
    }

    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioStream.getAudioTracks(),
    ]);

    const mimeType = pickMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(combinedStream, { mimeType }) : new MediaRecorder(combinedStream);

    mediaRecorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const type = mimeType?.includes("mp4") ? "video/mp4" : "video/webm";
      const ext = type === "video/mp4" ? ".mp4" : ".webm";
      const blob = new Blob(recordedChunks, { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      const base = (titleInput.value.trim() || "render_9x16")
        .replace(/[^\w\- ]/g, "")
        .replace(/\s+/g, "_");
      a.download = base + ext;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      statusText.innerText = "¡Video renderizado y descargado!";
      statusText.style.display = "block";
      isRecording = false;
      document.body.classList.remove("is-recording");
      recDot.style.display = "none";
      exitBtn.style.display = "block";
    };

    mediaRecorder.start();
    isRecording = true;
  } catch (err) {
    console.error("Error al iniciar la grabación: ", err);
    alert("Tu navegador no soporta la grabación directa. Prueba en Google Chrome o Edge.");
  }
}

function initPlayback(record = false): void {
  if (!video.src) {
    alert("Primero elige un archivo de música o video.");
    return;
  }

  lyrics = parseLyrics(lyricsInput.value);
  if (lyrics.length === 0) {
    alert("No encontré líneas válidas. Usa el formato [mm:ss.xx] Texto");
    return;
  }
  activeIndex = -1;
  // La primera frase espera un escalón abajo del centro hasta que llegue su
  // tiempo; al activarse sube con el desplazamiento suavizado habitual.
  targetScrollY = lineHeight;
  currentScrollY = lineHeight;
  recordedChunks = [];
  enterFullscreen();

  overlay.style.opacity = "0";
  const gen = ++uiGen;
  setTimeout(() => {
    if (gen === uiGen) overlay.style.display = "none";
  }, 500);

  if (record) {
    overlay.style.display = "flex";
    overlay.style.opacity = "1";
    el("previewBtn").style.display = "none";
    el("renderBtn").style.display = "none";
    document.querySelectorAll(".field").forEach((f) => ((f as HTMLElement).style.display = "none"));
    (document.querySelector(".row") as HTMLElement | null)?.style.setProperty("display", "none");
    (document.querySelector(".actions") as HTMLElement | null)?.style.setProperty("display", "none");
    // Render mínimo: ni banda, ni panel, ni aviso. Solo el video y el punto rojo.
    statusText.style.display = "none";
    recDot.style.display = "block";
    document.body.classList.add("is-recording");
    startRecording();
  }

  video.currentTime = 0;
  document.body.classList.add("is-playing");
  if (!record) exitBtn.style.display = "block";
  void warmFonts().finally(() => {
    video
      .play()
      .then(() => {
        stopLoop();
        isPlaying = true;
        animate();
      })
      .catch((e) => console.error("No se pudo reproducir:", e));
  });
}

mediaInput.addEventListener("change", () => {
  const file = mediaInput.files?.[0];
  if (file) {
    if (mediaObjectUrl) URL.revokeObjectURL(mediaObjectUrl);
    mediaObjectUrl = URL.createObjectURL(file);
    video.src = mediaObjectUrl;
    video.load();
    // Autocompleta título/artista/letra sin bloquear la UI.
    void lookupMusic(false);
    // Si el audio trae portada incrustada se usa como fondo.
    loadEmbeddedCover(file);
  }
});

// Decodifica cualquier imagen (archivo elegido o arte incrustada del audio)
// fuera del hilo principal y la deja lista como fondo blur.
async function applyCoverFile(file: File | Blob): Promise<void> {
    // Vía rápida: createImageBitmap decodifica en paralelo, fuera del hilo
    // principal, y entrega un bitmap listo para dibujar en GPU.
    if ("createImageBitmap" in window) {
      try {
        const bitmap = await createImageBitmap(file, {
          imageOrientation: "from-image",
          premultiplyAlpha: "premultiply",
          colorSpaceConversion: "default",
          resizeQuality: "high",
        } as ImageBitmapOptions);
        coverBitmap?.close();
        coverBitmap = bitmap;
        coverImage = null;
        coverW = bitmap.width;
        coverH = bitmap.height;
        if (coverObjectUrl) {
          URL.revokeObjectURL(coverObjectUrl);
          coverObjectUrl = null;
        }
        return;
      } catch (e) {
        console.warn("createImageBitmap falló, uso Image + decode():", e);
      }
    }
    // Fallback: elemento img con decoding=async + await img.decode():
    // asíncrona explícita sin bloquear el primer pintado.
    if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl);
    coverObjectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = "high";
    img.src = coverObjectUrl;
    try {
      await img.decode();
    } catch {
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
    }
    coverBitmap?.close();
    coverBitmap = null;
    coverImage = img;
}

coverInput.addEventListener("change", () => {
  const file = coverInput.files?.[0];
  if (!file) return;
  void applyCoverFile(file);
});

// Si el audio trae imagen incrustada y el usuario no eligió portada,
// esa imagen se usa sola como fondo del blur.
function loadEmbeddedCover(file: File): void {
  if (coverInput.files?.length) return;
  void extractEmbeddedPicture(file)
    .then((blob) => {
      if (!blob || coverInput.files?.length) return;
      void applyCoverFile(blob);
    })
    .catch(() => {
      /* sin arte legible: sigue el degradado cálido */
    });
}

el("previewBtn").addEventListener("click", () => initPlayback(false));
el("renderBtn").addEventListener("click", () => initPlayback(true));

video.addEventListener("ended", () => {
  stopLoop();
  if (isRecording && mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  } else if (!isRecording) {
    showStudio();
  }
});

// ====== MÚSICA ONLINE: LRCLIB (gratis, sin key, con CORS) ======
// Al subir el audio adivina artista/título (inputs o nombre del archivo),
// trae la duración del propio <video> y descarga la letra sincronizada.
// Docs: https://lrclib.net/docs

interface LrclibTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  hasWordSync: boolean;
  lyricsfile: string | null;
}

const DEFAULT_TITLE = "Sure Thing";
const DEFAULT_ARTIST = "Miguel";

const lookupBtn = el<HTMLButtonElement>("lookupBtn");
const lookupStatus = el("lookup-status");
let lookingUp = false;

function setLookup(msg: string, cls = ""): void {
  lookupStatus.textContent = msg;
  lookupStatus.className = cls;
}

// "Miguel - Sure Thing.mp3" -> { artist: "Miguel", title: "Sure Thing" }.
// Limpia sufijos tipo "[xYjFxFFdyyk]" o "(Official Video)".
function guessFromFilename(name: string): { artist: string; title: string } {
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/\s*\((official|official video|lyrics?|audio|hd|hq|4k|mv|m\/v)[^)]*\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
  }
  return { artist: "", title: base };
}

function getMediaDuration(): Promise<number> {
  return new Promise((resolve) => {
    if (video.readyState >= 1 && Number.isFinite(video.duration)) {
      resolve(video.duration);
      return;
    }
    const timer = window.setTimeout(() => {
      video.removeEventListener("loadedmetadata", onMeta);
      resolve(NaN);
    }, 8000);
    const onMeta = (): void => {
      window.clearTimeout(timer);
      resolve(video.duration);
    };
    video.addEventListener("loadedmetadata", onMeta, { once: true });
  });
}

async function lrclibGet(artist: string, title: string, duration: number): Promise<LrclibTrack | null> {
  const params = new URLSearchParams({ artist_name: artist, track_name: title });
  if (Number.isFinite(duration)) params.set("duration", String(Math.round(duration)));
  const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB devolvió ${res.status}`);
  return (await res.json()) as LrclibTrack;
}

async function lrclibSearch(query: string): Promise<LrclibTrack[]> {
  const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Búsqueda LRCLIB devolvió ${res.status}`);
  return (await res.json()) as LrclibTrack[];
}

function applyTrack(track: LrclibTrack, overwriteLyrics: boolean): void {
  if (track.trackName) titleInput.value = track.trackName;
  if (track.artistName) artistInput.value = track.artistName;

  if (track.instrumental) {
    setLookup(`"${track.trackName}" figura como instrumental: no hay letra.`, "ok");
    return;
  }

  const synced = track.syncedLyrics?.trim();
  if (track.hasWordSync && track.lyricsfile) {
    const enhanced = lyricsfileToEnhancedLrc(track.lyricsfile);
    if (enhanced) {
      if (overwriteLyrics || lyricsInput.value.trim() === "") {
        lyricsInput.value = enhanced;
        setLookup(`Karaoke palabra por palabra cargado: ${track.artistName} – ${track.trackName}.`, "ok");
      } else {
        setLookup(
          `Encontré karaoke de ${track.artistName} – ${track.trackName}, pero ya tienes texto. Pulsa el botón para reemplazarlo.`,
          "",
        );
      }
      return;
    }
  }
  if (synced) {
    if (overwriteLyrics || lyricsInput.value.trim() === "") {
      lyricsInput.value = synced;
      setLookup(`Letra sincronizada cargada: ${track.artistName} – ${track.trackName}.`, "ok");
    } else {
      setLookup(
        `Encontré letra de ${track.artistName} – ${track.trackName}, pero ya tienes texto. Pulsa el botón para reemplazarla.`,
        "",
      );
    }
    return;
  }

  const plain = track.plainLyrics?.trim();
  if (plain) {
    if (overwriteLyrics || lyricsInput.value.trim() === "") {
      lyricsInput.value = plain;
    }
    setLookup("Solo hay letra sin tiempos: agrégale los [mm:ss.xx] a cada línea.", "error");
    return;
  }

  setLookup(`Encontré ${track.artistName} – ${track.trackName}, pero sin letra disponible.`, "error");
}

async function lookupMusic(manual: boolean): Promise<void> {
  if (lookingUp) return;
  lookingUp = true;
  try {
    lookupBtn.disabled = true;
    setLookup("Buscando datos y letra…", "");

    const file = mediaInput.files?.[0] ?? null;
    let artist = artistInput.value.trim();
    let title = titleInput.value.trim();
    const isDefault = artist === DEFAULT_ARTIST && title === DEFAULT_TITLE;

    // El nombre del archivo manda si los inputs siguen con el ejemplo.
    if (file && ((!artist && !title) || isDefault)) {
      const guess = guessFromFilename(file.name);
      if (guess.artist) {
        artist = guess.artist;
        artistInput.value = guess.artist;
      }
      if (guess.title) {
        title = guess.title;
        titleInput.value = guess.title;
      }
    }

    if (!artist && !title) {
      setLookup("Escribe artista y canción, o sube un archivo con ese dato en el nombre.", "error");
      return;
    }

    const duration = file ? await getMediaDuration() : NaN;

    // 1) Intento exacto (artista + título + duración).
    if (artist && title) {
      const exact = await lrclibGet(artist, title, duration);
      if (exact) {
        applyTrack(exact, manual || lyricsInput.value.trim() === "");
        return;
      }
    }

    // 2) Fallback: búsqueda libre, prioriza resultados con letra sincronizada.
    const query = [artist, title].filter(Boolean).join(" ") || file?.name || "";
    const results = await lrclibSearch(query);
    const withSync = results.filter((r) => r.syncedLyrics?.trim());
    const pool = withSync.length > 0 ? withSync : results;
    if (pool.length === 0) {
      setLookup(`Sin resultados para "${query}" en LRCLIB.`, "error");
      return;
    }
    const best = pool[0];
    const full = await lrclibGet(best.artistName, best.trackName, best.duration);
    applyTrack(full ?? best, manual || lyricsInput.value.trim() === "");
  } catch (err) {
    console.error("lookupMusic:", err);
    setLookup("No pude contactar LRCLIB (¿sin internet?). Puedes pegar la letra a mano.", "error");
  } finally {
    lookingUp = false;
    lookupBtn.disabled = false;
  }
}

try {
  const saved = localStorage.getItem("lyric-karaoke");
  if (saved !== null) karaokeInput.checked = saved !== "0";
} catch {
  /* sin almacenamiento: queda activado */
}
karaokeInput.addEventListener("change", () => {
  try {
    localStorage.setItem("lyric-karaoke", karaokeInput.checked ? "1" : "0");
  } catch {
    /* noop */
  }
});

lookupBtn.addEventListener("click", () => void lookupMusic(true));

// Al terminar de editar artista o título, la letra se busca sola si el
// cuadro sigue vacío: adiós al subir a por el botón en cada canción.
function autoLookupOnChange(): void {
  if (lyricsInput.value.trim() !== "") return;
  if (!titleInput.value.trim() && !artistInput.value.trim()) return;
  void lookupMusic(false);
}
titleInput.addEventListener("change", autoLookupOnChange);
artistInput.addEventListener("change", autoLookupOnChange);

// ====== MODO DEMO: abrir /#demo (o /#demo16x9) para ver el diseño sin música ======
if (location.hash.includes("demo")) {
  if (location.hash.includes("16x9")) {
    aspectInput.value = "16:9";
    applyAspect("16:9");
  }
  lyrics = parseLyrics(lyricsInput.value);
  overlay.style.display = "none";
  void warmFonts().then(() => {
    const start = Date.now();
    const offset = 14;
    const demoLoop = (): void => {
      drawFrame((Date.now() - start) / 1000 + offset);
      requestAnimationFrame(demoLoop);
    };
    demoLoop();
  });
}
