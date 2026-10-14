/**
 * LRC puro (sin DOM): parseo de letra con traducción y tiempos por palabra,
 * más conversión del `lyricsfile` de LRCLIB a LRC mejorado. Testeable en Node.
 */

export interface LyricWord {
  /** segundos desde el inicio */
  time: number;
  text: string;
}

export interface LyricLine {
  time: number;
  text: string;
  translation: string | null;
  /** tiempos por palabra (`<mm:ss.xx>`); null = solo nivel de línea */
  words: LyricWord[] | null;
}

const LINE_RE = /\[(\d{2}):(\d{2}\.\d{2})\](.*)/;
const WORD_RE = /<(\d{2}):(\d{2}\.\d{2})>/g;

function toSeconds(min: string, sec: string): number {
  return parseInt(min, 10) * 60 + parseFloat(sec);
}

/** Segundos máximos que una frase se considera cantada sin más datos.
 *  Pasado esto (p. ej. un solo instrumental) la línea se apaga aunque no
 *  haya llegado la siguiente: el cantante ya calló. */
export const MAX_SUNG_SPAN = 8;

/** Duración cantada estimada de una línea, recortada al tope. */
export function sungSpan(start: number, end: number): number {
  return Math.min(Math.max(end - start, 0.1), MAX_SUNG_SPAN);
}

/** ¿La frase ya terminó? Verdadero pasado su tope cantado. */
export function isLineExpired(now: number, start: number, end: number): boolean {
  return now - start > sungSpan(start, end);
}

/** [mm:ss.xx] a partir de segundos (centésimas, aritmética entera). */
export function formatLrcTime(total: number): string {
  const cs = Math.max(0, Math.round(total * 100));
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `[${pad(Math.floor(cs / 6000))}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}]`;
}

function pushChunk(words: LyricWord[], chunk: string, time: number): void {
  for (const token of chunk.split(/\s+/)) {
    if (token) words.push({ time, text: token });
  }
}

/**
 * Una línea por verso: `[mm:ss.xx] Texto original`.
 * Traducción justo debajo, entre corchetes: `[mm:ss.xx] [Texto traducido]`.
 * Karaoke palabra por palabra (opcional): `[mm:ss.xx] <mm:ss.xx>Palabra ...`.
 */
export function parseLyrics(raw: string): LyricLine[] {
  const parsed: LyricLine[] = [];
  raw
    .trim()
    .split("\n")
    .forEach((line) => {
      const match = line.trim().match(LINE_RE);
      if (!match) return;
      const time = toSeconds(match[1], match[2]);
      const text = match[3].trim();
      if (!text) return;

      const translationMatch = text.match(/^\[(.*)\]$/);
      if (translationMatch && parsed.length > 0) {
        parsed[parsed.length - 1].translation = translationMatch[1].trim();
      } else {
        parsed.push({ time, text: displayText(text), translation: null, words: parseWords(text, time) });
      }
    });
  parsed.sort((a, b) => a.time - b.time);
  return parsed;
}

/** Texto visible: etiquetas de palabra fuera, espacios normalizados. */
function displayText(text: string): string {
  return text.replace(WORD_RE, " ").replace(/\s+/g, " ").trim();
}

/** Tiempos por palabra desde etiquetas `<mm:ss.xx>`; null si no hay. */
function parseWords(text: string, lineTime: number): LyricWord[] | null {
  WORD_RE.lastIndex = 0;
  let m = WORD_RE.exec(text);
  if (!m) return null;
  const words: LyricWord[] = [];
  let pending = lineTime;
  let last = 0;
  while (m) {
    pushChunk(words, text.slice(last, m.index), pending);
    pending = toSeconds(m[1], m[2]);
    last = m.index + m[0].length;
    m = WORD_RE.exec(text);
  }
  pushChunk(words, text.slice(last), pending);
  return words.length > 0 ? words : null;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\"/g, '"');
  }
  return v;
}

/**
 * `lyricsfile` (YAML de LRCLIB) → LRC mejorado con `<mm:ss.xx>` por palabra.
 * Parser mínimo para la forma documentada (`lines: - text/start_ms/words:`).
 * Devuelve null si no hay word-sync aprovechable.
 */
export function lyricsfileToEnhancedLrc(yaml: string): string | null {
  interface Draft {
    text: string;
    start: number | null;
    words: { text: string; start: number }[];
  }
  const lines: Draft[] = [];
  let current: Draft | null = null;
  let inWords = false;

  for (const rawLine of yaml.split("\n")) {
    const line = rawLine.replace(/\t/g, "  ");
    const indent = line.length - line.trimStart().length;
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) continue;

    const dashText = clean.match(/^-\s+text:\s*(.*)$/);
    if (dashText) {
      if (indent === 0) {
        current = { text: unquote(dashText[1]), start: null, words: [] };
        lines.push(current);
        inWords = false;
      } else if (current && inWords) {
        current.words.push({ text: unquote(dashText[1]), start: -1 });
      }
      continue;
    }
    const startMs = clean.match(/^start_ms:\s*(\d+)/);
    if (startMs && current) {
      if (indent <= 2 && !inWords) current.start = parseInt(startMs[1], 10);
      else if (current.words.length > 0) current.words[current.words.length - 1].start = parseInt(startMs[1], 10);
      continue;
    }
    if (clean === "words:" && current) {
      inWords = true;
      continue;
    }
  }

  const out: string[] = [];
  for (const l of lines) {
    if (l.start === null || l.words.length === 0) continue;
    if (l.words.some((w) => w.start < 0)) continue;
    const tags = l.words.map((w) => `<${formatLrcTime(w.start / 1000).slice(1, -1)}>${w.text}`).join("");
    out.push(`${formatLrcTime(l.start / 1000)} ${tags}`.trimEnd());
  }
  return out.length > 0 ? out.join("\n") : null;
}
