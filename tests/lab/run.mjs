// Entreno Lab — ejecutor. Uso (desde la raíz del repo):
//   node tests/lab/run.mjs [--seed 1] [--extra 0] [--only node|browser] [--profile p01] [--out tests/lab/out]
// Genera out/informe.md (legible) y out/resultados.json (estructurado). Nada de esto toca la app publicada ni datos reales:
// los historiales son sintéticos y cada perfil del navegador usa un contexto con IndexedDB propio y vacío.
process.env.TZ = 'Europe/Madrid'; // los instantes de los historiales se calculan en este huso; igual en toda máquina
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES, generateProfiles } from './profiles.mjs';
import { generateHistory, buildBackup, screenData } from './history.mjs';
import { NODE_SCENARIOS } from './scenarios-node.mjs';
import { FINDINGS, STATIC_FINDINGS } from './findings.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const seed = Number(arg('seed', 1));
const extra = Number(arg('extra', 0));
const only = arg('only', 'all');
const filter = arg('profile', '');
const outDir = path.resolve(arg('out', path.join(path.dirname(fileURLToPath(import.meta.url)), 'out')));
fs.mkdirSync(outDir, { recursive: true });

const profiles = [...PROFILES, ...(extra ? generateProfiles(seed, extra) : [])].filter((p) => !filter || p.id.startsWith(filter));
const results = []; // { scenario, area, title, level, profile|null, ok, failures[], ms, metrics }
const started = new Date();

async function runNode() {
  for (const sc of NODE_SCENARIOS) {
    const targets = sc.scope === 'global' ? [null] : profiles;
    for (const p of targets) {
      const t0 = performance.now();
      const metrics = {};
      let failures;
      try {
        let ctx = { metrics };
        if (p) { const h = generateHistory(p, { seed }); ctx = { profile: p, h, data: screenData(h), backup: buildBackup(h), metrics }; }
        failures = await sc.run(ctx);
      } catch (e) { failures = [`El propio escenario lanzó una excepción: ${e.stack?.split('\n').slice(0, 2).join(' ')}`]; }
      results.push({ scenario: sc.id, area: sc.area, title: sc.title, level: 'node', profile: p?.id ?? null, ok: failures.length === 0, failures, ms: Math.round(performance.now() - t0), metrics });
    }
  }
}

async function runBrowser() {
  let mod;
  try { mod = await import('./scenarios-browser.mjs'); } catch (e) { return { skipped: `No se pudo cargar Playwright: ${e.message.split('\n')[0]}` }; }
  return mod.runBrowserScenarios({ profiles, seed, results });
}

let browserNote = only === 'node' ? { skipped: 'No solicitado (--only node)' } : null;
if (only !== 'browser') await runNode();
if (only !== 'node') browserNote = await runBrowser();

// ---------- hallazgos ----------
const failed = new Map(); // scenario → [{profile, failures}]
for (const r of results) if (!r.ok) { if (!failed.has(r.scenario)) failed.set(r.scenario, []); failed.get(r.scenario).push(r); }
const findings = [...failed].map(([id, rs]) => {
  const meta = FINDINGS[id] || {};
  return { id: meta.id || `F-${id}`, scenario: id, class: meta.class || 'A', severity: meta.severity || 'media', category: meta.category || rs[0].area, title: meta.title || rs[0].title,
    profiles: rs.map((r) => r.profile).filter(Boolean), steps: meta.steps || [], expected: meta.expected || rs[0].title, observed: rs.slice(0, 4).flatMap((r) => r.failures.slice(0, 2).map((f) => `${r.profile ? `[${r.profile}] ` : ''}${f}`)),
    evidence: meta.evidence || `tests/lab/out/resultados.json (escenario ${id})`, confidence: meta.confidence || 'alta', files: meta.files || [], fix: meta.fix || '', priority: meta.priority || 'media' };
});

const total = results.length; const passed = results.filter((r) => r.ok).length;
const byScenario = [...new Map(results.map((r) => [r.scenario, r])).values()];
const summary = { generatedAt: started.toISOString(), seed, profiles: profiles.length, scenarios: byScenario.length, runs: total, passed, failed: total - passed, browser: browserNote };
fs.writeFileSync(path.join(outDir, 'resultados.json'), JSON.stringify({ summary, findings, staticFindings: STATIC_FINDINGS, results }, null, 1));

const L = [];
L.push(`# Informe de Entreno Lab`, '', `Generado: ${started.toISOString()} · semilla ${seed} · ${profiles.length} perfiles sintéticos · hoy simulado = 2026-10-15`, '');
L.push('## Qué se ejecutó realmente', '');
L.push(`- Escenarios distintos ejecutados: **${summary.scenarios}**; ejecuciones (escenario × perfil): **${total}**; superadas **${passed}**, con fallo **${total - passed}**.`);
L.push(`- Nivel 1 (Node, lógica real de la app sobre historiales sintéticos): ${results.filter((r) => r.level === 'node').length} ejecuciones.`);
L.push(`- Nivel 2 (navegador Playwright, ${browserNote?.engine || 'no ejecutado'}): ${results.filter((r) => r.level === 'browser').length} ejecuciones.${browserNote?.skipped ? ` **No ejecutado:** ${browserNote.skipped}` : ''}`);
if (browserNote?.engine) L.push(`- Motor: ${browserNote.engine}, emulación de iPhone (viewport/táctil). **No es un iPhone físico ni Safari real.**`);
L.push('', '## Resultados por escenario', '', '| Escenario | Área | Título | Perfiles ok/total | Estado |', '|---|---|---|---|---|');
for (const s of byScenario) {
  const rs = results.filter((r) => r.scenario === s.scenario); const ok = rs.filter((r) => r.ok).length;
  L.push(`| ${s.scenario} | ${s.area} | ${s.title} | ${ok}/${rs.length} | ${ok === rs.length ? 'OK' : 'FALLO'} |`);
}
const order = { alta: 0, media: 1, baja: 2 };
L.push('', '## Hallazgos', '', 'Clases: **A** error confirmado · **B** riesgo técnico · **C** hipótesis UX · **D** mejora propuesta · **E** limitación del laboratorio.', '');
for (const cls of ['A', 'B', 'C', 'D', 'E']) {
  const list = [...findings.filter((f) => f.class === cls), ...STATIC_FINDINGS.filter((f) => f.class === cls)].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
  if (!list.length) continue;
  L.push(`### Clase ${cls}`, '');
  for (const f of list) {
    L.push(`#### ${f.id} · ${f.title}`, '', `- **Categoría:** ${f.category} · **Gravedad:** ${f.severity} · **Confianza:** ${f.confidence} · **Prioridad recomendada:** ${f.priority}`);
    if (f.profiles?.length) L.push(`- **Perfiles afectados (${f.profiles.length}):** ${f.profiles.join(', ')}`);
    if (f.steps?.length) L.push('- **Pasos para reproducir:**', ...f.steps.map((s, i) => `  ${i + 1}. ${s}`));
    L.push(`- **Esperado:** ${f.expected}`);
    if (f.observed?.length) L.push('- **Observado:**', ...f.observed.map((o) => `  - ${o}`));
    if (f.evidence) L.push(`- **Evidencia:** ${f.evidence}`);
    if (f.files?.length) L.push(`- **Relacionado:** ${f.files.join(', ')}`);
    if (f.fix) L.push(`- **Propuesta:** ${f.fix}`);
    L.push('');
  }
}
const perf = results.filter((r) => r.metrics?.analysisMs != null).sort((a, b) => b.metrics.analysisMs - a.metrics.analysisMs).slice(0, 5);
if (perf.length) L.push('## Rendimiento del análisis (Node, no representa un iPhone)', '', ...perf.map((r) => `- ${r.profile}: ${r.metrics.analysisMs} ms`), '');
fs.writeFileSync(path.join(outDir, 'informe.md'), L.join('\n'));
console.log(`Entreno Lab: ${passed}/${total} ejecuciones superadas · ${findings.length} hallazgos · ${path.join(outDir, 'informe.md')}`);
