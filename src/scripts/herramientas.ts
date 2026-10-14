/**
 * Herramientas: dividir video en partes exactas y reparar a MP4 bien formado.
 * Todo ocurre en el navegador con WebCodecs vía Mediabunny (sin ffmpeg):
 * se recodifica a H.264 + AAC con faststart, como los scripts .ps1.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
} from "mediabunny";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} no encontrado`);
  return node as T;
}

const splitInput = el<HTMLInputElement>("splitInput");
const splitSecs = el<HTMLInputElement>("splitSecs");
const splitBtn = el<HTMLButtonElement>("splitBtn");
const splitStatus = el("splitStatus");
const splitMeter = el("splitMeter");
const splitBar = el("splitBar");
const splitList = el("splitList");
const splitAll = el<HTMLButtonElement>("splitAll");

const repairInput = el<HTMLInputElement>("repairInput");
const repairBtn = el<HTMLButtonElement>("repairBtn");
const repairStatus = el("repairStatus");
const repairMeter = el("repairMeter");
const repairBar = el("repairBar");
const repairList = el("repairList");

const webcodecsOK =
  "VideoEncoder" in window &&
  "VideoDecoder" in window &&
  "AudioEncoder" in window &&
  "AudioDecoder" in window;

if (!webcodecsOK) {
  for (const [node, btn] of [
    [splitStatus, splitBtn],
    [repairStatus, repairBtn],
  ] as [HTMLElement, HTMLButtonElement][]) {
    node.textContent = "Estas herramientas necesitan Chrome o Edge (WebCodecs).";
    node.className = "tool-status error";
    btn.disabled = true;
  }
}

interface DonePart {
  name: string;
  blob: Blob;
  size: number;
}

function setStatus(node: HTMLElement, msg: string, cls = ""): void {
  node.textContent = msg;
  node.className = cls ? `tool-status ${cls}` : "tool-status";
}

function setMeter(meter: HTMLElement, bar: HTMLElement, ratio: number | null): void {
  if (ratio === null) {
    meter.hidden = true;
    return;
  }
  meter.hidden = false;
  bar.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
}

function sanitizeBase(filename: string): string {
  const base = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w\- ]/g, "")
    .replace(/\s+/g, "_")
    .trim();
  return base || "video";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function fmtMB(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fmtTime(total: number): string {
  const m = Math.floor(total / 60);
  return `${m}:${String(Math.floor(total % 60)).padStart(2, "0")}`;
}

function addPartRow(list: HTMLElement, part: DonePart): void {
  const li = document.createElement("li");
  li.className = "part";
  const name = document.createElement("span");
  name.className = "part-name";
  name.textContent = `${part.name} · ${fmtMB(part.size)}`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-small";
  btn.textContent = "Descargar";
  btn.addEventListener("click", () => downloadBlob(part.blob, part.name));
  li.append(name, btn);
  list.appendChild(li);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

/** Recodifica [start, end) a MP4 (H.264 + AAC, faststart). Sin end = archivo entero. */
async function convertRange(file: File, start: number, end: number | null, onProgress: (p: number) => void): Promise<Blob> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  const conversion = await Conversion.init({
    input,
    output,
    tracks: "primary",
    video: { codec: "avc", quality: new Quality("high"), frameRate: 60, forceTranscode: true },
    audio: { codec: "aac", quality: new Quality("high"), forceTranscode: true, numberOfChannels: 2 },
    ...(end === null ? {} : { trim: { start, end } }),
  });
  if (!conversion.isValid) {
    const why = conversion.discardedTracks.map((t) => String(t.reason)).join("; ");
    throw new Error(why ? `No convertible: ${why}` : "Conversión no soportada para este archivo.");
  }
  conversion.onProgress = (p: number) => onProgress(p);
  await conversion.execute();
  if (!output.target.buffer) throw new Error("El codificador no devolvió datos.");
  return new Blob([output.target.buffer], { type: "video/mp4" });
}

// ====== DIVIDIR ======
let splitBusy = false;
const splitParts: DonePart[] = [];

splitBtn.addEventListener("click", () => {
  void (async () => {
    if (splitBusy || !webcodecsOK) return;
    const file = splitInput.files?.[0];
    if (!file) {
      setStatus(splitStatus, "Primero elige un archivo de video.", "error");
      return;
    }
    const secs = Math.min(600, Math.max(5, parseInt(splitSecs.value, 10) || 90));
    splitSecs.value = String(secs);
    splitBusy = true;
    splitBtn.disabled = true;
    splitAll.disabled = true;
    splitList.replaceChildren();
    splitParts.length = 0;
    try {
      setStatus(splitStatus, "Leyendo duración…");
      setMeter(splitMeter, splitBar, 0);
      const probe = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
      const duration = await probe.computeDuration();
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("No pude leer la duración del archivo.");
      }
      const parts = Math.max(1, Math.ceil(duration / secs));
      for (let i = 0; i < parts; i++) {
        const start = i * secs;
        const end = Math.min(start + secs, duration);
        setStatus(splitStatus, `Parte ${i + 1}/${parts} (${fmtTime(start)} → ${fmtTime(end)})…`);
        const blob = await convertRange(file, start, end, (p) => setMeter(splitMeter, splitBar, (i + p) / parts));
        const name = `${sanitizeBase(file.name)}_parte_${String(i).padStart(2, "0")}.mp4`;
        const part: DonePart = { name, blob, size: blob.size };
        splitParts.push(part);
        addPartRow(splitList, part);
        downloadBlob(blob, name);
        await sleep(700);
      }
      setMeter(splitMeter, splitBar, 1);
      setStatus(splitStatus, `Listo: ${parts} partes de ~${secs}s.`, "ok");
      splitAll.disabled = splitParts.length === 0;
    } catch (err) {
      console.error("dividir:", err);
      setStatus(splitStatus, err instanceof Error ? err.message : "Falló la división.", "error");
    } finally {
      splitBusy = false;
      splitBtn.disabled = false;
    }
  })();
});

splitAll.addEventListener("click", () => {
  void (async () => {
    for (const part of splitParts) {
      downloadBlob(part.blob, part.name);
      await sleep(700);
    }
  })();
});

// ====== REPARAR ======
let repairBusy = false;

repairBtn.addEventListener("click", () => {
  void (async () => {
    if (repairBusy || !webcodecsOK) return;
    const file = repairInput.files?.[0];
    if (!file) {
      setStatus(repairStatus, "Primero elige el archivo a reparar.", "error");
      return;
    }
    repairBusy = true;
    repairBtn.disabled = true;
    repairList.replaceChildren();
    try {
      setStatus(repairStatus, "Reparando…");
      setMeter(repairMeter, repairBar, 0);
      const blob = await convertRange(file, 0, null, (p) => setMeter(repairMeter, repairBar, p));
      const name = `${sanitizeBase(file.name)}_reparado.mp4`;
      const part: DonePart = { name, blob, size: blob.size };
      addPartRow(repairList, part);
      downloadBlob(blob, name);
      setMeter(repairMeter, repairBar, 1);
      setStatus(repairStatus, `Listo: ${name} (${fmtMB(blob.size)}).`, "ok");
    } catch (err) {
      console.error("reparar:", err);
      setStatus(repairStatus, err instanceof Error ? err.message : "Falló la reparación.", "error");
    } finally {
      repairBusy = false;
      repairBtn.disabled = false;
    }
  })();
});
