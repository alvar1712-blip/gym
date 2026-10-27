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

/**
 * Topes de descompresión contra «bombas» .gz/.zip. Se aplican a los bytes que de verdad salen del descompresor (no
 * al tamaño que declara el .zip, que un archivo manipulado puede falsear). Por archivo: pico de memoria (los trozos
 * más la copia final, ~2×); un GPX de 24 h a 1 Hz pesa ~13 MB. Por importación (suma de todo lo descomprimido):
 * acota el tiempo de CPU con un .zip de miles de entradas; la memoria no se acumula porque cada entrada se libera.
 * Medido en escritorio: ~24 ms por MB (descomprimir + analizar) con pico de memoria plano; en un iPhone, 3-5 veces
 * más lento, así que 250 MB son ~30 s como máximo y ya equivalen a miles de actividades (un GPX de un entreno: ~40 KB).
 */
export const MAX_INFLATED = 50 * 1024 * 1024;
export const MAX_INFLATED_TOTAL = 250 * 1024 * 1024;
const TOO_BIG = 'Los archivos descomprimidos son demasiado grandes para importarlos (límite 50 MB por archivo, 250 MB en total). Divide el .zip en varios.';

/** Presupuesto compartido de una importación: `{ left }` se va gastando con cada descompresión. */
export const newInflateBudget = () => ({ left: MAX_INFLATED_TOTAL });

async function decompress(u8, format, budget) {
  if (typeof DecompressionStream === 'undefined') {
    throw new ImportError('Este navegador no puede descomprimir archivos: descomprímelo antes de importarlo.');
  }
  const limit = Math.min(MAX_INFLATED, budget ? budget.left : Infinity);
  const tooBig = new ImportError(TOO_BIG);
  try {
    const reader = new Blob([u8]).stream().pipeThrough(new DecompressionStream(format)).getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw tooBig;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    if (budget) budget.left -= total;
    return out;
  } catch (e) {
    throw e === tooBig ? e : new ImportError('El archivo comprimido está dañado o incompleto.');
  }
}

/** Descomprime un .gz. */
export function gunzip(input, budget) {
  return decompress(toU8(input), 'gzip', budget);
}

/** Descomprime datos 'deflate' sin cabecera (los de una entrada ZIP). */
export function inflateRaw(input, budget) {
  return decompress(toU8(input), 'deflate-raw', budget);
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
export async function zipRead(input, entry, budget) {
  const u8 = toU8(input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const lo = entry.localOffset;
  if (entry.encrypted) throw new ImportError('El archivo del .zip está protegido con contraseña.');
  if (entry.size > MAX_INFLATED) throw new ImportError(TOO_BIG);
  if (lo + 30 > u8.length || dv.getUint32(lo, true) !== SIG_LOC) throw new ImportError('El .zip está dañado.');
  const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
  const end = start + entry.compSize;
  if (end > u8.length) throw new ImportError('El .zip está incompleto.');
  const data = u8.subarray(start, end);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data, budget);
  throw new ImportError('El .zip usa una compresión no admitida: descomprímelo antes.');
}

/** Nombre sin carpetas: 'actividades/123.fit' → '123.fit'. */
export const baseName = (name) => String(name || '').split(/[\\/]/).filter(Boolean).pop() || String(name || '');

/** Entradas que no son archivos del usuario (carpetas, metadatos de macOS). */
export function isJunkEntry(entry) {
  const b = baseName(entry.name);
  return entry.dir || /(^|\/)__MACOSX\//.test(entry.name) || b.startsWith('._') || b === '.DS_Store';
}
