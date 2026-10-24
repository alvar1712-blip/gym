// Ronda 11 (bloque 5): sello de integridad de las copias y «Comprobar copia». El sello (SHA-256 del bloque `data`) detecta
// archivos truncados, dañados o modificados; las copias anteriores sin sello se aceptan igual y se dice que no se pueden
// comprobar. Nada de esto escribe datos. Pruebas con los vectores oficiales de SHA-256 y con node:crypto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../../js/sha256.js';
import {
  buildBackupObject, buildBackupFile, verifyBackupIntegrity, describeBackup, parseBackupText, INTEGRITY_ALGORITHM,
} from '../../js/backup.js';

const sample = () => ({
  app: 'entreno', format: 2, appVersion: 'test', exportedAt: '2026-10-01T10:00:00.000Z',
  data: {
    meta: [{ id: 'app', createdAt: 1 }, { id: 'settings', lastBackupAt: null, profile: { sex: 'male' } }],
    exercises: [{ id: 'e1', name: 'Press de pecho — ñandú', custom: true }],
    templates: [], plan: [], bodyweight: [{ id: '2026-09-30', kg: 80.4 }], checkins: [], goals: [], cycle: [], context: [], pastRecords: [], races: [],
    sessions: [
      { id: 's1', kind: 'strength', date: '2026-09-29', status: 'done', exercises: [{ id: 'x', exerciseId: 'e1', setup: 'Polea alta', sets: [{ id: 'st', weight: 60, reps: 8, done: true }] }] },
      { id: 's2', kind: 'run', date: '2026-09-30', status: 'done', distanceKm: 8.2, movingSec: 2700 },
    ],
  },
});

test('SHA-256: vectores oficiales y coincidencia con node:crypto (UTF-8 y todos los tamaños de relleno)', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.equal(sha256Hex('a'.repeat(1000000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  for (let n = 0; n <= 200; n++) {
    const s = 'ñ€x'.repeat(n).slice(0, n * 2);
    assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'), `longitud ${n}`);
  }
  const bytes = new Uint8Array(1234).map((_, i) => (i * 31) & 255);
  assert.equal(sha256Hex(bytes), createHash('sha256').update(bytes).digest('hex'));
});

test('buildBackupFile: el mismo contenido que buildBackupObject más un sello; JSON válido y con claves en su orden', () => {
  const ex = sample();
  const obj = buildBackupObject(ex, 1000);
  const { text } = buildBackupFile(sample(), 1000);
  const parsed = JSON.parse(text);
  const { integrity, ...rest } = parsed;
  assert.deepEqual(rest, JSON.parse(JSON.stringify(obj)), 'sin el sello, idéntica a la copia de siempre (las apps antiguas la leen igual)');
  assert.deepEqual(Object.keys(parsed), ['app', 'format', 'appVersion', 'exportedAt', 'data', 'integrity']);
  assert.equal(parsed.format, 2, 'el formato no cambia: el sello es un campo opcional');
  assert.equal(integrity.algorithm, INTEGRITY_ALGORITHM);
  assert.equal(integrity.hash, createHash('sha256').update(JSON.stringify(parsed.data), 'utf8').digest('hex'));
  assert.deepEqual(integrity.stores, { meta: 2, exercises: 1, templates: 0, plan: 0, bodyweight: 1, checkins: 0, goals: 0, cycle: 0, context: 0, pastRecords: 0, races: 0, sessions: 2 });
  assert.equal(parsed.data.meta[1].lastBackupAt, 1000, 'la fecha de la copia va dentro, como siempre');
});

test('integridad: comprobada, sin sello (copia anterior), modificada y algoritmo desconocido', () => {
  const { text } = buildBackupFile(sample(), 1000);
  const ok = verifyBackupIntegrity(JSON.parse(text));
  assert.equal(ok.status, 'verified');
  // Reformateada (otro programa, sangrías): el contenido es el mismo y sigue comprobada
  assert.equal(verifyBackupIntegrity(JSON.parse(JSON.stringify(JSON.parse(text), null, 2))).status, 'verified');
  // Copia anterior a la ronda 11: válida pero sin forma de comprobarla
  const { integrity, ...legacy } = JSON.parse(text);
  assert.equal(verifyBackupIntegrity(legacy).status, 'unsealed');
  assert.ok(parseBackupText(JSON.stringify(legacy), () => ({ ok: true })).ok, 'se acepta igual');
  // Modificada: un peso cambiado, una sesión quitada
  const edited = JSON.parse(text);
  edited.data.sessions[0].exercises[0].sets[0].weight = 600;
  const m1 = verifyBackupIntegrity(edited);
  assert.equal(m1.status, 'mismatch');
  assert.deepEqual(m1.diffs, [], 'mismo número de registros: cambió el contenido');
  const cut = JSON.parse(text);
  cut.data.sessions.pop();
  const m2 = verifyBackupIntegrity(cut);
  assert.equal(m2.status, 'mismatch');
  assert.deepEqual(m2.diffs, [{ store: 'sessions', label: 'Sesiones', expected: 2, actual: 1 }]);
  // Algoritmo que esta versión no conoce: ni se afirma ni se descarta
  const other = JSON.parse(text);
  other.integrity.algorithm = 'blake3';
  assert.equal(verifyBackupIntegrity(other).status, 'unsupported');
});

test('describeBackup: qué contiene, de cuándo es, su formato y qué se pudo comprobar (estructura frente a integridad)', () => {
  const { text } = buildBackupFile(sample(), Date.parse('2026-10-01T10:00:00.000Z'));
  const parsed = JSON.parse(text);
  const sealed = describeBackup(parsed, verifyBackupIntegrity(parsed));
  assert.equal(sealed.status, 'verified');
  assert.match(sealed.headline, /integridad comprobada/i);
  assert.equal(sealed.counts.strength, 1);
  assert.equal(sealed.counts.activities, 1);
  assert.equal(sealed.firstDate, '2026-09-29');
  assert.equal(sealed.lastDate, '2026-09-30');
  assert.equal(sealed.format, 2);
  assert.deepEqual(sealed.missingSections, []);
  assert.ok(sealed.notes.some((n) => /no ha cambiado ni escrito nada/i.test(n)), 'dice que no toca datos');

  const { integrity, ...legacyObj } = parsed;
  const unsealed = describeBackup(legacyObj, verifyBackupIntegrity(legacyObj));
  assert.equal(unsealed.status, 'unsealed');
  assert.match(unsealed.headline, /estructura válida/i);
  assert.match(unsealed.headline, /sin sello|no se puede comprobar/i);

  const bad = JSON.parse(text);
  bad.data.sessions.pop();
  const mismatch = describeBackup(bad, verifyBackupIntegrity(bad));
  assert.equal(mismatch.status, 'mismatch');
  assert.match(mismatch.headline, /no coincide/i);
  assert.ok(mismatch.notes.some((n) => /Sesiones: el sello dice 2 y el archivo trae 1/.test(n)));

  // Formato 1: sin las secciones de la ronda 6
  const v1 = { app: 'entreno', format: 1, data: { meta: [{ id: 'settings' }], exercises: [], templates: [], sessions: [], plan: [], bodyweight: [], checkins: [], goals: [] } };
  const d1 = describeBackup(v1, verifyBackupIntegrity(v1));
  assert.equal(d1.format, 1);
  assert.deepEqual(d1.missingSections.map((s) => s.store), ['context', 'pastRecords', 'races']);
});

test('SHA-256 propio frente a Web Crypto (el nativo de los navegadores): Unicode, emoji, límites de bloque y archivos grandes', async () => {
  const hex = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const enc = new TextEncoder();
  const cases = ['', 'ñandú — Ünïcödé', '日本語のテキスト', '🏋️‍♂️💪🏃‍♀️ astral', 'a\u0000b�c', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), '€'.repeat(1000)];
  for (const s of cases) assert.equal(sha256Hex(s), await hex(enc.encode(s)), JSON.stringify(s).slice(0, 30));
  // Grande: 24 MB de JSON realista (con acentos y emoji) y 24 MB de bytes aleatorios deterministas
  const row = JSON.stringify({ id: 's1', name: 'Sentadilla búlgara 🏋️', note: 'Más peso — ñ', sets: [60, 8, 1.5, null, true] });
  const big = Array.from({ length: Math.ceil(24e6 / row.length) }, () => row).join(',');
  assert.equal(sha256Hex(big), await hex(enc.encode(big)), 'JSON de ~24 MB');
  const bytes = new Uint8Array(24e6);
  let x = 123456789;
  for (let i = 0; i < bytes.length; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; bytes[i] = x >>> 24; }
  assert.equal(sha256Hex(bytes), await hex(bytes), '24 MB de bytes');
});
