/**
 * Arte incrustada sin dependencias: busca la imagen donde cada formato la
 * guarda (mp3: cuadro APIC de ID3v2; mp4/m4a: átomo covr; ogg/opus:
 * METADATA_BLOCK_PICTURE en los comentarios). Devuelve el Blob o null.
 *
 * Las portadas suelen ser más grandes que cualquier cabecera fija, así que
 * la ventana de lectura se dimensiona con lo que el propio formato anuncia
 * (tamaño de la etiqueta ID3, cola del mp4 cuando el moov va al final).
 */
export async function extractEmbeddedPicture(file: File): Promise<Blob | null> {
  const readAt = async (start: number, len: number): Promise<Uint8Array> => {
    const end = Math.min(start + len, file.size);
    if (end <= start) return new Uint8Array(0);
    return new Uint8Array(await file.slice(start, end).arrayBuffer());
  };
  const ascii = (bytes: Uint8Array, at: number, len: number): string => {
    let s = "";
    for (let i = 0; i < len && at + i < bytes.length; i++) s += String.fromCharCode(bytes[at + i]);
    return s;
  };
  const sync32 = (bytes: Uint8Array, p: number): number =>
    ((bytes[p] & 0x7f) << 21) | ((bytes[p + 1] & 0x7f) << 14) | ((bytes[p + 2] & 0x7f) << 7) | (bytes[p + 3] & 0x7f);

  const probe = await readAt(0, 64);
  if (probe.length < 12) return null;

  // --- MP3 con etiqueta ID3v2: la etiqueta entera (portada incluida) ---
  if (ascii(probe, 0, 3) === "ID3") {
    const v4 = probe[3] === 4;
    const tagLen = 10 + sync32(probe, 6);
    const bytes = await readAt(0, Math.min(tagLen, 16 * 1024 * 1024));
    const raw = (p: number): number =>
      ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
    const end = Math.min(10 + sync32(bytes, 6), bytes.length - 10);
    let p = 10;
    while (p + 10 <= end) {
      const id = ascii(bytes, p, 4);
      if (id.charCodeAt(0) === 0) break;
      const size = v4 ? sync32(bytes, p + 4) : raw(p + 4);
      if (size <= 0 || p + 10 + size > bytes.length) break;
      if (id === "APIC" && size > 20) {
        let q = p + 10;
        const enc = bytes[q];
        q += 1;
        let mimeEnd = q;
        while (mimeEnd < p + 10 + size && bytes[mimeEnd] !== 0) mimeEnd++;
        const mime = ascii(bytes, q, mimeEnd - q) || "image/jpeg";
        q = mimeEnd + 2; // NUL del mime + byte de tipo de imagen
        if (enc === 1 || enc === 2) {
          // UTF-16 con o sin BOM: la descripción termina en 00 00.
          while (q + 1 < p + 10 + size && !(bytes[q] === 0 && bytes[q + 1] === 0)) q += 2;
          q += 2;
        } else {
          while (q < p + 10 + size && bytes[q] !== 0) q++;
          q += 1;
        }
        const data = bytes.slice(q, p + 10 + size);
        return data.length > 0 ? new Blob([data.buffer as ArrayBuffer], { type: mime }) : null;
      }
      p += 10 + size;
    }
    return null;
  }

  // --- MP4/M4A: átomo covr con hijo data (el moov suele ir al final) ---
  if (ascii(probe, 4, 4) === "ftyp") {
    const boxSize = (bytes: Uint8Array, p: number): number =>
      ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
    const scanMp4 = (bytes: Uint8Array): Blob | null => {
      for (let p = 0; p + 8 < bytes.length; p++) {
        if (ascii(bytes, p + 4, 4) === "covr") {
          const boxEnd = Math.min(p + boxSize(bytes, p), bytes.length);
          let q = p + 8;
          while (q + 16 < boxEnd) {
            const child = boxSize(bytes, q);
            if (child < 16 || q + child > bytes.length) break;
            if (ascii(bytes, q + 4, 4) === "data") {
              const kind = boxSize(bytes, q + 8);
              const mime = kind === 14 ? "image/png" : kind === 27 ? "image/bmp" : "image/jpeg";
              const data = bytes.slice(q + 16, q + child);
              return data.length > 0 ? new Blob([data.buffer as ArrayBuffer], { type: mime }) : null;
            }
            q += child;
          }
          return null;
        }
      }
      return null;
    };
    const head = await readAt(0, Math.min(file.size, 2 * 1024 * 1024));
    const found = scanMp4(head);
    if (found || file.size <= head.length) return found;
    return scanMp4(await readAt(Math.max(0, file.size - 1024 * 1024), 1024 * 1024));
  }

  // --- OGG/Opus: METADATA_BLOCK_PICTURE en los comentarios ---
  if (ascii(probe, 0, 4) === "OggS") {
    const bytes = await readAt(0, Math.min(file.size, 4 * 1024 * 1024));
    const key = "METADATA_BLOCK_PICTURE=";
    outer: for (let p = 0; p + key.length < bytes.length; p++) {
      for (let k = 0; k < key.length; k++) {
        if (bytes[p + k] !== key.charCodeAt(k)) continue outer;
      }
      let e = p + key.length;
      let b64 = "";
      while (e < bytes.length && bytes[e] !== 0) {
        b64 += String.fromCharCode(bytes[e]);
        e++;
      }
      try {
        const bin = atob(b64);
        const pic = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) pic[i] = bin.charCodeAt(i);
        const dv = new DataView(pic.buffer);
        const mimeLen = dv.getUint32(4);
        let mime = "";
        for (let i = 0; i < mimeLen; i++) mime += String.fromCharCode(pic[8 + i]);
        let o = 8 + mimeLen;
        const descLen = dv.getUint32(o);
        o += 4 + descLen + 16; // descripción + ancho/alto/profundidad/colores
        const dataLen = dv.getUint32(o);
        o += 4;
        const data = pic.slice(o, o + dataLen);
        return data.length > 0 ? new Blob([data.buffer as ArrayBuffer], { type: mime || "image/jpeg" }) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}
