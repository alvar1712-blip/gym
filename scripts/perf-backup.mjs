// Mide el coste del sello de integridad y de «Comprobar copia» con historiales extensos (datos sintéticos de
// tests/realistic-data.mjs: fuerza 4 días/semana con check-ins, carrera, bici, pesajes diarios, ciclo…).
// Uso: node scripts/perf-backup.mjs [mediana de N repeticiones, por defecto 7]
// Compara, por tamaño de historial: exportar como antes (buildBackupObject + JSON.stringify) y exportar con sello
// (buildBackupFile), y comprobar un archivo (JSON.parse + validación estructural + sello). Los tiempos son de Node en
// esta máquina: sirven para comparar, no como valor absoluto en un iPhone.
import { buildBackupObject, buildBackupFile, verifyBackupIntegrity, parseBackupText } from '../js/backup.js';
import { SEED_EXERCISES, SEED_TEMPLATES, defaultSettings } from '../js/seed.js';
import { realisticData } from '../tests/realistic-data.mjs';

const N = Number(process.argv[2]) || 7;
const today = '2026-10-07';
const now = Date.parse('2026-10-07T12:00:00Z');
const exercises = new Map(SEED_EXERCISES.map((e) => [e.id, { custom: false, archived: false, ...e }]));
const templates = SEED_TEMPLATES.map((t, i) => ({ order: i, ...t }));
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };
const ms = (v) => `${v.toFixed(0).padStart(5)} ms`;

console.log(`mediana de ${N} repeticiones (Node ${process.version})\n`);
console.log('historial   registros   tamaño     exportar antes   exportar con sello   comprobar archivo');
for (const [label, months] of [['3 meses', 3], ['1 año', 12], ['2 años', 24], ['5 años', 60], ['10 años', 120]]) {
  const d = realisticData({ months, today, now, templates, exercises });
  const data = {
    meta: [{ id: 'app', createdAt: 1 }, { id: 'settings', ...defaultSettings(), profile: d.profile }],
    exercises: [...exercises.values()], templates, sessions: d.sessions, plan: [], bodyweight: d.bodyweight, checkins: d.checkins,
    goals: d.goals, cycle: d.cycle, context: d.context, pastRecords: d.pastRecords, races: d.races,
  };
  const exported = () => ({ app: 'entreno-pwa', format: 2, appVersion: 'perf', exportedAt: new Date(now).toISOString(), data });
  const records = Object.values(data).reduce((t, l) => t + l.length, 0);
  let sizeA = 0; let sizeB = 0; let text = '';
  const before = []; const after = []; const check = [];
  for (let i = 0; i < N; i++) {
    before.push(time(() => { sizeA = JSON.stringify(buildBackupObject(exported(), now)).length; }));
    after.push(time(() => { text = buildBackupFile(exported(), now).text; sizeB = text.length; }));
    check.push(time(() => {
      const r = parseBackupText(text, (o) => ({ ok: Array.isArray(o?.data?.sessions) }));
      if (!r.ok || verifyBackupIntegrity(r.backup).status !== 'verified') throw new Error('el sello no se verificó');
    }));
  }
  const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
  console.log(`${label.padEnd(10)} ${String(records).padStart(9)}   ${mb(sizeB).padStart(8)}   ${ms(median(before))}       ${ms(median(after))}          ${ms(median(check))}`);
  if (sizeB - sizeA > 400) throw new Error(`el sello añade ${sizeB - sizeA} bytes (debería ser ~200)`);
}
console.log('\nEl sello añade ~200 bytes al archivo.');
