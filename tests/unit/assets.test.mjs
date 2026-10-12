// El service worker precachea TODOS los archivos de la app y su VERSION corresponde al contenido (scripts/check-assets.mjs).
// Si falta uno, la app instalada no lo tiene sin conexión; si VERSION no cambia, el iPhone no recibe los cambios.
// (Regresión: icons/mark.svg, el símbolo de la pantalla de arranque, quedó fuera de la lista.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('sw.js precachea todos los archivos y su VERSION está al día', () => {
  const script = fileURLToPath(new URL('../../scripts/check-assets.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
