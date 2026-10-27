// run-unit.mjs — ejecuta las pruebas unitarias sin depender de que el shell expanda el glob (cmd y PowerShell no lo
// hacen: `node --test 'tests/unit/*.test.mjs'` ejecutaba 0 pruebas en Windows). Falla si no hay archivos de prueba,
// si no se ejecuta ninguna prueba o si alguna falla.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'unit');
const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(dir, f));
if (!files.length) {
  console.error(`No hay pruebas unitarias en ${dir}`);
  process.exit(1);
}
const r = spawnSync(process.execPath, ['--test', ...files], { encoding: 'utf8', maxBuffer: 1 << 28 });
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
const ran = Number(/^ℹ tests (\d+)/m.exec(r.stdout)?.[1] ?? 0);
if (!ran) {
  console.error('No se ha ejecutado ninguna prueba.');
  process.exit(1);
}
process.exit(r.status ?? 1);
