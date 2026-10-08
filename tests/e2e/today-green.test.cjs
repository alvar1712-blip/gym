// Ronda 8 (A3): menos verde en Hoy. El verde (acento) queda para la acción principal («Empezar» / «Continuar»), lo
// seleccionado (el día de hoy en la mini semana, el check-in) y los estados positivos (stateTag «Subir peso», la
// barra de progreso de un objetivo). Los enlaces secundarios («Ver ciclo», «Importar desde un archivo», «Ver todo»,
// «Calendario», «Panel semanal»…) y los datos neutros (el cronómetro, «Ahora: …», el próximo evento) van en texto
// normal o secundario. Antes había once textos verdes y dos botones verdes («Empezar» y «Guardar» del peso).
// Con datos realistas, antes de entrenar y con una sesión abierta; Chromium y WebKit. Fuera de Hoy, los mismos
// componentes no cambian (el resumen de objetivos de Progreso sigue con su enlace en verde).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/today-green.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, engineAvailable } = require('./helpers.cjs');
const { seedRealistic } = require('./realistic-data.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const TODAY = '2026-10-07';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();

/** Lo que puede ir en verde en Hoy (acción principal, selección, estado positivo). */
const ALLOWED = [
  '.btn-primary', // la acción principal (y su icono)
  '.today-week-day.is-today', '.today-week-day.is-today *', // hoy, en la mini semana (selección)
  '.state-ok', '.state-ok *', '.state-progress', '.state-progress *', '.state-pr', '.state-pr *', // estados positivos
  '.seg-btn.active', '.seg-btn.active *', '[aria-pressed="true"]', '[aria-pressed="true"] *', '[aria-checked="true"]', '[aria-checked="true"] *', // selección
  '.today-active.card-accent', // el borde de «Sesión en curso» (manda en Hoy)
];

/** Elementos de la pantalla con el color de acento en el texto, el fondo o el borde, que no están permitidos. */
function greenInventory(allowed) {
  const probe = document.createElement('div');
  probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  document.body.append(probe);
  const acc = getComputedStyle(probe).color;
  probe.remove();
  const bad = [];
  let primaries = 0;
  for (const el of document.querySelectorAll('#view .content *')) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || el.closest('[hidden]')) continue;
    if (cs.backgroundColor === acc && el.matches('.btn, button')) primaries++;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const green = (own && cs.color === acc) || (el.matches('svg.icon') && cs.color === acc) || cs.backgroundColor === acc
      || (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopColor === acc);
    if (green && !allowed.some((s) => el.matches(s))) {
      bad.push(`${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).trim().split(/\s+/).join('.')} «${(el.textContent || '').trim().slice(0, 40)}»`);
    }
  }
  return { bad, primaries };
}

async function run(browser) {
  for (const activeSession of [false, true]) {
    const app = await openApp({ browser, beforeLoad: async (page) => { await page.context().clock.install({ time: madrid(TODAY) }); } });
    const { page } = app;
    try {
      await seedRealistic(page, { months: 6, female: true, activeSession });
      await go(page, '#/calendar');
      await go(page, '#/today');
      await page.waitForFunction(() => document.querySelector('.today-extra')?.dataset.ready === '1');
      await page.waitForSelector('.cyc-today-link'); // la tarjeta del ciclo se carga aparte
      const when = activeSession ? 'con sesión abierta' : 'antes de entrenar';
      // Están todos los enlaces y datos que antes iban en verde (si faltara alguno, la prueba no probaría nada)
      for (const sel of ['.cyc-today-link', '.today-context', '.today-race', '.today-import', '.bwq-link', '.today-weekcard .cal-link-btn', '.focus-link', '.goal-sum-link', activeSession ? '.today-clock' : '.today-plan .cal-link-btn']) {
        assert.ok(await page.locator(sel).first().isVisible(), `${when}: falta ${sel}`);
      }
      const { bad, primaries } = await page.evaluate(greenInventory, ALLOWED);
      assert.deepStrictEqual(bad, [], `${when}: verde fuera de la acción principal, la selección o un estado positivo:\n${bad.join('\n')}`);
      assert.strictEqual(primaries, 1, `${when}: un solo botón verde (${activeSession ? '«Continuar»' : '«Empezar»'})`);
      assert.match(await page.locator('#view .content .btn-primary').first().innerText(), activeSession ? /Continuar/ : /Empezar/);
      // Los enlaces secundarios siguen siendo botones de 44 px
      for (const h of await page.locator('.today .cal-link-btn, .today .bwq-link, .today .goal-sum-link').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
        assert.ok(h >= 43.5, `enlace de ${h} px`);
      }
      // Fuera de Hoy no cambia: el resumen de objetivos de Progreso conserva su enlace en verde
      if (!activeSession) {
        await go(page, '#/progress');
        await page.waitForSelector('.goal-sum-link');
        const [c, acc] = await page.evaluate(() => {
          const p = document.createElement('div');
          p.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
          document.body.append(p);
          const a = getComputedStyle(p).color;
          p.remove();
          return [getComputedStyle(document.querySelector('.goal-sum-link')).color, a];
        });
        assert.strictEqual(c, acc, 'Progreso no cambia');
      }
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  }
}

test('Hoy: verde solo en la acción principal, la selección y los estados positivos', () => run('chromium'));
test('WebKit: Hoy, verde solo en la acción principal, la selección y los estados positivos', { skip: skipWebkit }, () => run('webkit'));
