// views/focus-item.js — Una conclusión de «Lo importante esta semana» (Hoy) y del «Resumen» de Análisis como tarjeta
// plegable (docs/PULIDO.md §33). Plegada se entiende en dos segundos: un icono discreto del nivel, el título (lo que
// pasa) y una línea con qué hacer (y «confianza baja» si lo es). Desplegada, lo demás que ya existía: el texto en
// párrafos cortos, la confianza, el «¿Por qué?» y el acceso al detalle. No decide nada: pinta un FocusItem de
// js/focus.js (weekFocus), con el mismo título, texto y paso siguiente que antes, sin perder ni repetir información.
//
// Interacción (patrón «disclosure» de WAI-ARIA): la cabecera entera es un <button> dentro del encabezado, con
// aria-expanded y aria-controls; el panel plegado es `inert` (ni se tabula ni lo lee VoiceOver). La animación es de
// CSS: grid-template-rows 0fr → 1fr (sin medir alturas con JS), el contenido aparece con opacidad y el chevron gira;
// con «Reducir movimiento», sin transiciones. Lo abierto se recuerda mientras dura la app (un repintado de Hoy no lo
// cierra), nunca en los datos.
import { h, icon, stateTag, whyBox } from '../ui.js';
import { whyContent } from './weekly.js';
import { shortParagraphs } from '../focus.js';

/** Icono del nivel (nunca solo color: cada nivel tiene su forma) y su nombre para VoiceOver. */
const LEVEL = {
  warn: { icon: 'alert', label: 'Atención' },
  good: { icon: 'check', label: 'Bien' },
  up: { icon: 'arrow-up', label: 'Subir peso' },
  neutral: { icon: 'info', label: 'Info' },
  info: { icon: 'info', label: 'Info' },
};
const OPEN_MS = 260; // = la transición de css/weekly.css (.focus-panel)

/** Claves abiertas en esta sesión de la app (`scope:key`). */
const openKeys = new Set();
let seq = 0;

/** Nivel visual de un punto: «sube el peso» es un paso, no un aviso. */
const levelKey = (it) => (it.step === 'up' ? 'up' : LEVEL[it.level] ? it.level : 'info');

/**
 * @param {object} it  FocusItem (js/focus.js) — key, id, level, title, text, why, confidence, step, stepLabel…
 * @param {{ main?: boolean, scope: string, dataset?: object, className?: string, stepClass?: string,
 *           more?: HTMLElement|null }} opts
 *   scope: 'today' | 'analysis' (lo abierto se recuerda por pantalla); className/stepClass: clases de la pantalla
 *   (Análisis conserva .an-key/.an-key-step); more: acceso al detalle al final del panel.
 */
export function focusItem(it, { main = false, scope, dataset = {}, className = '', stepClass = '', more = null }) {
  const lv = levelKey(it);
  const meta = LEVEL[lv];
  const id = `fi-${scope}-${++seq}`;
  const memo = `${scope}:${it.key}`;
  const low = it.confidence && (it.confidence.level === 'low' || it.confidence.level === 'insufficient');

  const toggle = h('button.focus-toggle', { type: 'button', id: `${id}-h`, 'aria-expanded': 'false', 'aria-controls': `${id}-p` },
    h(`span.focus-ico.focus-ico-${lv}`, { 'aria-hidden': 'true' }, icon(meta.icon, main ? 20 : 18)),
    h('span.focus-hd',
      h('span.sr-only', `${meta.label}: `),
      h('span.focus-title', it.title),
      // Lo que hay que hacer, siempre a la vista (también plegada); la incertidumbre, si la hay, va con ello
      h(`span.focus-step${stepClass ? `.${stepClass}` : ''}`,
        h('span.sr-only', 'Qué hacer: '),
        h('span.focus-step-txt', it.stepLabel),
        low ? h('span.focus-low', ` · ${it.confidence.label.toLowerCase()}`) : null)),
    h('span.focus-chev', { 'aria-hidden': 'true' }, icon('chevron-down', 20)));

  const paras = shortParagraphs(it.text);
  const body = h('div.focus-body',
    paras.length ? h('div.focus-text', paras.map((p) => h('p', p))) : null,
    // La confianza baja ya va en la cabecera («· confianza baja»): dentro, solo las demás, para no repetirla
    it.confidence && !low ? h('div.focus-meta', stateTag(`conf-${it.confidence.level}`, it.confidence.label, { small: true })) : null,
    it.why && it.why.rule ? whyBox(whyContent(it.why)) : null,
    more);
  const panel = h('div.focus-panel', { id: `${id}-p`, role: 'region', 'aria-labelledby': `${id}-h` }, body);

  const li = h(`li.focus-item${main ? '.focus-main' : ''}${className ? `.${className.trim().split(/\s+/).join('.')}` : ''}`, {
    dataset: { key: it.key, id: it.id, topic: it.topic, level: it.level, step: it.step, source: it.source, ...dataset },
  }, h(main ? 'h3.focus-h' : 'h4.focus-h', toggle), panel);

  let settle = 0;
  function set(open, { animate = true } = {}) {
    li.dataset.open = open ? '1' : '';
    toggle.setAttribute('aria-expanded', String(open));
    panel.inert = !open;
    if (open) openKeys.add(memo); else openKeys.delete(memo);
    // Abierta y quieta: sin recorte (el anillo de foco del «¿Por qué?» no se corta); durante la animación, recortada
    clearTimeout(settle);
    li.classList.remove('is-settled');
    if (open) {
      if (animate) settle = setTimeout(() => li.classList.add('is-settled'), OPEN_MS + 40);
      else li.classList.add('is-settled');
    }
  }
  toggle.addEventListener('click', () => set(li.dataset.open !== '1'));
  set(openKeys.has(memo), { animate: false });
  return li;
}
