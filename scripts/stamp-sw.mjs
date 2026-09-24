// Calcula VERSION de sw.js a partir del CONTENIDO de la app (ASSETS + el propio sw.js) y la escribe.
// Así cada publicación con cambios tiene una VERSION (y un nombre de caché) nueva y el iPhone la descarga.
//   node scripts/stamp-sw.mjs          → reescribe `const VERSION = 'v1-<hash>'` si ha cambiado
// scripts/check-assets.mjs usa computeVersion() para fallar si no se ha ejecutado.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_RE = /^const VERSION = '([^']*)';/m;

/** Archivos listados en ASSETS de sw.js (sin './'). */
export function listedAssets(swText) {
  return [...swText.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
}

/**
 * { current, expected }: VERSION escrita en sw.js y la que corresponde al contenido actual.
 * El hash cubre cada archivo de ASSETS (ruta + bytes) y sw.js con la línea de VERSION neutralizada.
 */
export function computeVersion(root = ROOT) {
  const swText = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const m = VERSION_RE.exec(swText);
  if (!m) throw new Error("sw.js no contiene la línea `const VERSION = '…';`");
  const hash = crypto.createHash('sha256');
  hash.update(swText.replace(VERSION_RE, "const VERSION = '';"));
  for (const f of [...new Set(listedAssets(swText))].sort()) {
    const file = path.join(root, f);
    hash.update(`\0${f}\0`);
    if (fs.existsSync(file)) hash.update(fs.readFileSync(file));
  }
  return { current: m[1], expected: `v1-${hash.digest('hex').slice(0, 10)}` };
}

export function stamp(root = ROOT) {
  const { current, expected } = computeVersion(root);
  if (current === expected) return { changed: false, version: current };
  const file = path.join(root, 'sw.js');
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace(VERSION_RE, `const VERSION = '${expected}';`));
  return { changed: true, version: expected, previous: current };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const r = stamp();
  console.log(r.changed ? `sw.js: VERSION ${r.previous} → ${r.version}` : `sw.js: VERSION ${r.version} (sin cambios)`);
}
