// Escenarios de NIVEL 1 (Node): historiales sintéticos × lógica real de Entreno (js/*.js), sin navegador.
// Cada escenario: { id, area, title, scope:'profile'|'global', run(ctx) → string[] } donde cada texto devuelto es un
// FALLO observado (lista vacía = superado). `ctx` = { profile, h (historial), data (forma de pantallas), backup }.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildAnalysis } from '../../js/analysis.js';
import { weeklyInsights, keyMessages } from '../../js/insights.js';
import { weekFocus } from '../../js/focus.js';
import { reportText } from '../../js/analysis-report.js';
import { buildBackupFile, parseBackupText, verifyBackupIntegrity, strengthCsv, cardioCsv } from '../../js/backup.js';
import { validateBackup } from '../../js/store.js';
import { sessionPRs, setMetrics, isWorkSet, setupKey } from '../../js/calc.js';
import { strengthRecords } from '../../js/stats.js';
import { readActivityFile } from '../../js/import-parse.js';
import { itemFromEntry, itemRecord, findDuplicate } from '../../js/import-logic.js';
import { TODAY, EXERCISES } from './history.mjs';

const shown = (m) => [m.title, m.text, m.parts?.observation, m.parts?.interpretation, m.parts?.recommendation].filter(Boolean).join(' ');
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

function screens(data) {
  const weekly = weeklyInsights(data, TODAY);
  const a = buildAnalysis(data, TODAY);
  const focus = weekFocus({ weekly: keyMessages(weekly, 6), analysis: a.keyPoints });
  const msgs = [...weekly.info, ...weekly.suggestions, ...a.all, ...focus.items].filter(Boolean);
  return { weekly, a, focus, msgs, report: reportText(a, { includeCycle: true }) };
}

/** GPX sintético de una actividad (puntos cada 30 s en línea recta) para probar la importación sin archivos reales. */
function gpx({ startedAt, km, sec, type = 'running' }) {
  const n = Math.max(2, Math.round(sec / 30));
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const lat = 40 + (km / 111.32) * (i / n);
    return `<trkpt lat="${lat.toFixed(6)}" lon="-3.700000"><ele>650</ele><time>${new Date(startedAt + (sec * 1000 * i) / n).toISOString()}</time></trkpt>`;
  }).join('');
  return `<?xml version="1.0"?><gpx version="1.1" creator="entreno-lab" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Lab</name><type>${type}</type><trkseg>${pts}</trkseg></trk></gpx>`;
}

export const NODE_SCENARIOS = [
  { id: 'N01', area: 'Almacenamiento', title: 'La copia JSON del historial es válida, lleva sello y detecta una modificación', scope: 'profile',
    run({ backup }) {
      const out = [];
      const v = validateBackup(backup);
      if (!v.ok) return [`validateBackup rechaza la copia: ${v.error}`];
      const { text } = buildBackupFile(backup);
      const p = parseBackupText(text, validateBackup);
      if (!p.ok) return [`parseBackupText: ${p.error}`];
      if (verifyBackupIntegrity(p.backup).status !== 'verified') out.push('el sello no sale «verified» en una copia recién creada');
      const bad = JSON.parse(text);
      const s = bad.data.sessions.find((x) => x.kind === 'strength');
      if (s) { s.exercises[0].sets[0].weight = (s.exercises[0].sets[0].weight || 0) + 1; if (verifyBackupIntegrity(bad).status !== 'mismatch') out.push('una serie modificada no rompe el sello'); }
      return out;
    } },
  { id: 'N02', area: 'Almacenamiento', title: 'Ida y vuelta de la copia sin pérdida de registros', scope: 'profile',
    run({ backup }) {
      const { text } = buildBackupFile(backup);
      const back = JSON.parse(text).data;
      const norm = (k, v) => JSON.stringify(k === 'meta' ? v.map(({ lastBackupAt, ...x }) => x) : v); // exportar sella lastBackupAt a propósito
      return Object.keys(backup.data).filter((k) => norm(k, back[k]) !== norm(k, backup.data[k])).map((k) => `la sección «${k}» cambia tras exportar y leer`);
    } },
  { id: 'N03', area: 'Progreso', title: 'Hoy, panel semanal, análisis e informe no fallan ni muestran NaN/undefined/Infinity con datos extremos', scope: 'profile',
    run({ data }) {
      let s;
      try { s = screens(data); } catch (e) { return [`excepción: ${e.message}`]; }
      const out = [];
      for (const m of s.msgs) { const t = shown(m); if (/NaN|undefined|Infinity|\[object/.test(t)) out.push(`mensaje ${m.id}: «${t.slice(0, 120)}»`); }
      if (/NaN|undefined|Infinity|\[object/.test(s.report)) out.push(`informe para IA contiene ${s.report.match(/NaN|undefined|Infinity|\[object/)[0]}`);
      return out;
    } },
  { id: 'N04', area: 'Progreso', title: 'El análisis no modifica sus entradas y es repetible', scope: 'profile',
    run({ data }) {
      const snap = (d) => JSON.stringify({ s: d.sessions, b: d.bodyweight, g: d.goals, r: d.races, c: d.checkins });
      const before = snap(data);
      const a1 = JSON.stringify(buildAnalysis(data, TODAY).all.map(shown));
      const out = [];
      if (snap(data) !== before) out.push('buildAnalysis modifica los datos de entrada');
      if (JSON.stringify(buildAnalysis(data, TODAY).all.map(shown)) !== a1) out.push('dos ejecuciones seguidas dan mensajes distintos');
      return out;
    } },
  { id: 'N05', area: 'Progreso', title: 'Coherencia entre pantallas: «sin señales de descarga» no convive con «descarga»', scope: 'profile',
    run({ data }) {
      let s; try { s = screens(data); } catch { return []; } // la excepción ya la cuenta N03
      const none = s.weekly.suggestions.some((m) => m.id === 'deload-none');
      if (!none) return [];
      const bad = s.msgs.filter((m) => !/^deload|^checkins$/.test(m.id || '') && /descarga|semana más suave/i.test(shown(m)));
      return bad.map((m) => `«${m.id}»: ${shown(m).slice(0, 100)}`);
    } },
  { id: 'N06', area: 'Fuerza', title: 'Un material/configuración nuevo no genera falsos récords', scope: 'profile',
    run({ h }) {
      const out = [];
      const strength = h.sessions.filter((s) => s.kind === 'strength').sort((a, b) => (a.date < b.date ? -1 : 1));
      const seen = new Set();
      const bw = () => 75;
      for (const s of strength) {
        const prs = sessionPRs(s, strength, EXERCISES, bw);
        for (const se of s.exercises) {
          const key = `${se.exerciseId}|${setupKey(se.setup)}`;
          if (!seen.has(key)) {
            const hasBefore = strength.some((x) => x.date < s.date && x.exercises.some((e) => e.exerciseId === se.exerciseId && setupKey(e.setup) === setupKey(se.setup)));
            const falsePr = se.sets.filter((x) => prs.has(x.id));
            if (!hasBefore && falsePr.length) out.push(`${s.date} ${se.exName} [${se.setup || 'sin config.'}]: récord en primera sesión con esa configuración`);
          }
          seen.add(key);
        }
      }
      const byEx = new Map();
      for (const se of strength.flatMap((s) => s.exercises)) { if (se.sets.some(isWorkSet)) { if (!byEx.has(se.exerciseId)) byEx.set(se.exerciseId, new Set()); byEx.get(se.exerciseId).add(setupKey(se.setup)); } }
      const recs = strengthRecords({ sessions: h.sessions, exercises: EXERCISES, bodyweight: h.bodyweight, settings: {}, pastRecords: [] });
      for (const [id, setups] of byEx) if (setups.size > 1) {
        const n = recs.filter((r) => r.exerciseId === id).length;
        if (n < setups.size) out.push(`${id}: ${setups.size} configuraciones y solo ${n} récord(s) separados`);
      }
      return out;
    } },
  { id: 'N07', area: 'Fuerza', title: 'Un dato absurdo (peso ×10, 100 reps) no se convierte en récord histórico', scope: 'profile',
    run({ h }) {
      const out = [];
      const recs = strengthRecords({ sessions: h.sessions, exercises: EXERCISES, bodyweight: h.bodyweight, settings: {}, pastRecords: [] });
      for (const r of recs) {
        const sets = h.sessions.filter((s) => s.kind === 'strength').flatMap((s) => s.exercises.filter((e) => e.exerciseId === r.exerciseId).flatMap((e) => e.sets.filter(isWorkSet)));
        const med = median(sets.map((x) => x.weight).filter((w) => w > 0));
        const top = r.bestWeight?.value;
        if (finite(top) && med && top > med * 4) out.push(`${r.name}: récord de peso ${top} kg (${r.bestWeight.date}) frente a mediana ${med} kg`);
      }
      return out;
    } },
  { id: 'N08', area: 'Fuerza', title: 'e1RM solo para 1–12 repeticiones y siempre finito', scope: 'profile',
    run({ h }) {
      const out = [];
      for (const s of h.sessions.filter((x) => x.kind === 'strength')) for (const se of s.exercises) for (const set of se.sets) {
        const m = setMetrics(set, EXERCISES.get(se.exerciseId), 75);
        if (m.e1rm != null && !finite(m.e1rm)) out.push(`${s.date} ${se.exName}: e1rm no finito`);
        if (m.e1rm != null && m.reps > 12) out.push(`${s.date} ${se.exName}: e1rm con ${m.reps} reps`); // m.reps = las que usa la app (unilateral: el lado menor)
      }
      return out.slice(0, 5);
    } },
  { id: 'N09', area: 'Resistencia', title: 'Un GPX de una actividad ya registrada se detecta como duplicado', scope: 'profile',
    async run({ h }) {
      const runs = h.sessions.filter((s) => s.kind === 'run' && s.distanceKm > 1 && s.movingSec > 0);
      if (!runs.length) return [];
      const a = runs[Math.floor(runs.length / 2)];
      const entries = await readActivityFile('lab.gpx', Buffer.from(gpx({ startedAt: a.startedAt, km: a.distanceKm, sec: a.movingSec })));
      if (!entries[0]?.summary) return [`GPX sintético no se pudo leer: ${entries[0]?.error}`];
      const rec = itemRecord({ ...itemFromEntry(entries[0], { today: TODAY }), selected: true }, { id: 'tmp', now: 0 });
      return findDuplicate(rec, h.sessions) ? [] : [`GPX del ${a.date} (${a.distanceKm} km) no se reconoce como duplicado (tipo importado: ${rec.kind})`];
    } },
  { id: 'N10', area: 'Resistencia', title: 'Archivos corruptos o truncados no lanzan excepciones', scope: 'global',
    async run() {
      const out = [];
      const good = gpx({ startedAt: Date.parse('2026-10-01T10:00:00Z'), km: 5, sec: 1800 });
      for (const [name, bytes] of [['vacio.gpx', Buffer.alloc(0)], ['cortado.gpx', Buffer.from(good.slice(0, 400))], ['basura.fit', Buffer.from('no es un fit')], ['x.zip', Buffer.from('PK\x03\x04roto')], ['x.gz', Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0])], ['texto.txt', Buffer.from('hola')]]) {
        try { const e = await readActivityFile(name, bytes); if (!e.length) out.push(`${name}: sin respuesta`); } catch (e) { out.push(`${name}: lanza ${e.message}`); }
      }
      return out;
    } },
  { id: 'N11', area: 'Almacenamiento', title: 'Exportar CSV con historial completo no falla y no pierde filas', scope: 'profile',
    run({ h }) {
      try {
        const csv = strengthCsv(h.sessions.filter((s) => s.kind === 'strength'), EXERCISES, {}, { bodyweight: h.bodyweight });
        const rows = csv.split('\r\n').filter(Boolean).length - 1;
        const sets = h.sessions.filter((s) => s.kind === 'strength').reduce((n, s) => n + s.exercises.reduce((m, e) => m + e.sets.filter((x) => x.done).length, 0), 0);
        cardioCsv(h.sessions.filter((s) => s.kind !== 'strength'));
        return rows >= sets ? [] : [`CSV de fuerza con ${rows} filas para ${sets} series hechas`];
      } catch (e) { return [`excepción: ${e.message}`]; }
    } },
  { id: 'N12', area: 'Progreso', title: 'Menores no reciben kcal/déficit; mayores de 65 no pasan de 250 kcal', scope: 'profile',
    run({ profile, data }) {
      let s; try { s = screens(data); } catch { return []; }
      const txt = [...s.msgs.map(shown), s.report].join('\n');
      if (profile.age < 18 && /kcal|déficit|superávit/i.test(txt)) return [`perfil de ${profile.age} años con texto calórico: «${txt.match(/.{30}(kcal|déficit|superávit).{30}/i)?.[0]}»`];
      if (profile.age > 65) { const big = [...txt.matchAll(/(\d[\d.]*)\s*kcal/g)].map((m) => Number(m[1].replace('.', ''))).filter((n) => n > 250); if (big.length) return [`mayor de 65 con ajuste de ${big[0]} kcal`]; }
      return [];
    } },
  { id: 'N13', area: 'Rendimiento', title: 'Historial largo: análisis completo en menos de 4 s (en Node)', scope: 'profile',
    run({ data, metrics }) {
      const t0 = performance.now();
      try { screens(data); } catch { return []; }
      const ms = Math.round(performance.now() - t0);
      metrics.analysisMs = ms;
      return ms > 4000 ? [`${ms} ms con ${data.sessions.length} sesiones`] : [];
    } },
  { id: 'N14', area: 'Casos límite', title: 'Fechas y zonas horarias: addDays/weekStart/dow/tsFromDate coherentes en 5 husos durante 2024–2027', scope: 'global',
    run() {
      const out = [];
      for (const tz of ['Europe/Madrid', 'Pacific/Auckland', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Kolkata']) {
        const r = spawnSync(process.execPath, [fileURLToPath(new URL('./tz-child.mjs', import.meta.url))], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
        if (r.status !== 0) out.push(`${tz}: ${(r.stdout + r.stderr).trim().split('\n').slice(0, 3).join(' | ')}`);
      }
      return out;
    } },
];
