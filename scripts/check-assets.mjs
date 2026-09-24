// Comprueba que sw.js precachea TODOS los archivos de la app (y que existen), y que VERSION corresponde
// al contenido actual (si no, los iPhone con la app instalada no reciben los cambios).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, listedAssets, computeVersion } from './stamp-sw.mjs';

const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const listed = listedAssets(sw);
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name).split(path.sep).join('/')]);
const needed = ['index.html', 'manifest.json', ...walk('js'), ...walk('css'), ...walk('icons')];
const missing = needed.filter((f) => !listed.includes(f));
const ghost = listed.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missing.length || ghost.length) {
  if (missing.length) console.error('Faltan en ASSETS de sw.js:', missing);
  if (ghost.length) console.error('Listados en sw.js pero no existen:', ghost);
  process.exit(1);
}
const { current, expected } = computeVersion();
if (current !== expected) {
  console.error(`VERSION de sw.js desactualizada (${current}; el contenido corresponde a ${expected}).`);
  console.error('Ejecuta: node scripts/stamp-sw.mjs');
  process.exit(1);
}
console.log(`OK: ${listed.length} archivos precacheados · VERSION ${current}.`);
