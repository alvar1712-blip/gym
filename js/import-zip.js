// import-zip.js — descompresión de archivos .gz y .zip para importar actividades.
// PURO (sin DOM ni store): usa DecompressionStream ('gzip' y 'deflate-raw'), disponible en Safari 16.4+ y en
// Node 18+, así que se prueba en Node (tests/unit/import.test.mjs). El lector ZIP es propio y mínimo: lee el
// directorio central y admite entradas 'stored' (método 0) y 'deflate' (método 8); sin ZIP64 ni cifrado.

/** Error con un mensaje apto para mostrar al usuario. */
export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Convierte ArrayBuffer / vista / Buffer de Node en Uint8Array (sin copiar). */
export function toU8(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Se esperaba un ArrayBuffer o Uint8Array');
}

export const isGzip = (u8) => u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;
export const isZip = (u8) => u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b
  && ((u8[2] === 3 && u8[3] === 4) || (u8[2] === 5 && u8[3] === 6));

async function decompress(u8, format) {
  if (typeof DecompressionStream === 'undefined') {
    throw new ImportError('Este navegador no puede descomprimir archivos: descomprímelo antes de importarlo.');
  }
  try {
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new ImportError('El archivo comprimido está dañado o incompleto.');
  }
}

/** Descomprime un .gz. */
export function gunzip(input) {
  return decompress(toU8(input), 'gzip');
}

/** Descomprime datos 'deflate' sin cabecera (los de una entrada ZIP). */
export function inflateRaw(input) {
  return decompress(toU8(input), 'deflate-raw');
}

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;
const utf8 = new TextDecoder('utf-8');

/**
 * Entradas de un ZIP (del directorio central).
 * @returns {{name, method, compSize, size, localOffset, encrypted, dir}[]}
 */
export function zipEntries(input) {
  const u8 = toU8(input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  const stop = Math.max(0, u8.length - 22 - 0xffff);
  for (let i = u8.length - 22; i >= stop; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new ImportError('El .zip está dañado o incompleto.');
  const count = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ImportError('Este .zip es demasiado grande (ZIP64): descomprímelo antes.');
  const out = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== SIG_CEN) throw new ImportError('El .zip está dañado.');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = utf8.decode(u8.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compSize, size, localOffset, encrypted: !!(flags & 1), dir: name.endsWith('/') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Contenido descomprimido de una entrada del ZIP. */
export async function zipRead(input, entry) {
  const u8 = toU8(input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const lo = entry.localOffset;
  if (entry.encrypted) throw new ImportError('El archivo del .zip está protegido con contraseña.');
  if (lo + 30 > u8.length || dv.getUint32(lo, true) !== SIG_LOC) throw new ImportError('El .zip está dañado.');
  const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
  const end = start + entry.compSize;
  if (end > u8.length) throw new ImportError('El .zip está incompleto.');
  const data = u8.subarray(start, end);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new ImportError('El .zip usa una compresión no admitida: descomprímelo antes.');
}

/** Nombre sin carpetas: 'actividades/123.fit' → '123.fit'. */
export const baseName = (name) => String(name || '').split(/[\\/]/).filter(Boolean).pop() || String(name || '');

/** Entradas que no son archivos del usuario (carpetas, metadatos de macOS). */
export function isJunkEntry(entry) {
  const b = baseName(entry.name);
  return entry.dir || /(^|\/)__MACOSX\//.test(entry.name) || b.startsWith('._') || b === '.DS_Store';
}
