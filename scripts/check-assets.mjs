// Comprueba que sw.js precachea TODOS los archivos de la app (y que existen).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const listed = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
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
console.log(`OK: ${listed.length} archivos precacheados.`);
