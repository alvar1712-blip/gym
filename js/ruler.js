// ruler.js — regla horizontal táctil para el peso y las repeticiones del editor de series (Fase 6, rehecha en 6b).
// Es un añadido al stepper: el número grande (se toca para teclear un valor exacto) y los botones −/+ siguen
// siendo la vía accesible y precisa; la regla es solo el gesto rápido (aria-hidden, sin tabulación).
// Nunca guarda nada por su cuenta: mientras se arrastra solo cambia lo que se ve; al soltar avisa UNA vez (onCommit).
//
// Por qué un elemento propio y el <input> fuera del camino: en iPhone el dedo que empieza sobre un <input> de texto lo
// gestiona Safari (cursor, selección, lupa) y el arrastre nunca llegaba a la regla. Ahora el gesto se escucha en la franja
// de la regla y en el campo del número, y el <input> no recibe el toque (CSS `.has-ruler`): un toque sin arrastre lo
// enfoca este módulo, dentro del propio gesto del usuario, que es lo que Safari exige para abrir el teclado.

const TICK_PX = 11; // separación entre marcas (una marca = un paso); 40→100 kg con paso 2,5 = 264 px
const MAJOR = 4; // marca larga con cifra cada 4 marcas (10 kg con paso 2,5); 5 para repeticiones
const NUMS = 9; // cifras repartidas a cada lado del centro (sobran: la regla enmascara los bordes)

/**
 * Valor tras arrastrar `dx` píxeles desde `start`. La regla se mueve con el dedo: arrastrar a la derecha baja el valor.
 * Se suma un número ENTERO de pasos al valor de partida (nunca se redondea lo que no se toca: 41,25 sigue
 * siendo 41,25 hasta que se arrastra una marca entera) y se acota a [min, max].
 */
export function rulerValue(start, dx, { step = 1, tick = TICK_PX, min = 0, max = Infinity } = {}) {
  const base = start ?? (Number.isFinite(min) ? Math.max(min, 0) : 0);
  const k = Math.round(-dx / tick);
  if (start == null && k === 0) return null; // un roce no convierte un campo vacío en un 0 guardado
  const v = Math.round((base + k * step) * 1e4) / 1e4;
  return Math.min(max, Math.max(min, v));
}

const fmt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');

/**
 * Añade la regla a un stepper.
 * @param {HTMLElement} el  stepper (con .getValue y el campo .stepper-field)
 * @param {{step:number, min?:number, max?:number, major?:number, setValue:(v:number)=>void, onCommit:(v:number)=>void}} o
 *   setValue solo cambia lo que se ve (el stepper repinta la regla); onCommit se llama una vez al soltar.
 * @returns {(v:number|null)=>void} paint: coloca la regla en un valor (el stepper la llama en cada cambio)
 */
export function mountRuler(el, { step, min = 0, max = Infinity, major = MAJOR, setValue, onCommit }) {
  const strip = document.createElement('div');
  strip.className = step === 1 ? 'ruler ruler-sm' : 'ruler'; // repeticiones (paso 1): franja baja, sin cifras
  strip.setAttribute('aria-hidden', 'true');
  strip.style.setProperty('--tick', `${TICK_PX}px`);
  strip.style.setProperty('--major', `${TICK_PX * major}px`);
  const nums = Array.from({ length: 2 * NUMS + 1 }, () => strip.appendChild(Object.assign(document.createElement('span'), { className: 'ruler-num' })));
  const paint = (v) => {
    const i = (v ?? 0) / step; // marcas desde el 0: las marcas son absolutas, la aguja marca el valor exacto
    strip.style.setProperty('--x', `${TICK_PX / 2 - i * TICK_PX}px`);
    strip.style.setProperty('--xm', `${(TICK_PX * major) / 2 - i * TICK_PX}px`);
    const m0 = Math.round(i / major);
    nums.forEach((n, k) => {
      const m = m0 + k - NUMS;
      const val = m * major * step;
      const off = (m * major - i) * TICK_PX;
      n.style.visibility = val < Math.max(min, 0) || val > max || Math.abs(off) < TICK_PX * 1.2 ? 'hidden' : '';
      n.style.left = `calc(50% + ${off}px)`;
      n.textContent = fmt(val);
    });
  };
  paint(el.getValue());
  const field = el.querySelector('.stepper-field');
  el.classList.add('has-ruler');
  if (step === 1) el.classList.add('has-ruler-sm');
  field.append(strip);
  const input = el.querySelector('input');

  let drag = null;
  let swallow = false; // el clic que sigue a un arrastre se descarta (se limpia en el siguiente toque)
  const tap = (ev) => {
    if (swallow) { swallow = false; ev.preventDefault(); ev.stopPropagation(); return; }
    if (ev.currentTarget === field) input.focus(); // toque sin arrastre sobre el número: teclado para el valor exacto
  };
  const down = (e) => {
    if (e.button > 0 || drag) return; // un segundo dedo no pisa el arrastre en curso
    swallow = false;
    drag = { id: e.pointerId, x: e.clientX, start: el.getValue(), moved: false, cur: el.getValue() };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* sin captura: el movimiento fuera de la regla se pierde */ }
  };
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 4) return;
    if (!drag.moved) { input.blur(); getSelection()?.removeAllRanges(); } // sin teclado ni selección que el navegador intente arrastrar
    drag.moved = true;
    const v = rulerValue(drag.start, dx, { step, min, max });
    if (v === drag.cur) return;
    drag.cur = v;
    setValue(v); // solo pantalla: nada se guarda mientras se arrastra
  };
  const end = (commit) => (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.moved) swallow = true; // el arrastre no cuenta como toque: ni abre el teclado ni deja el número seleccionado
    if (commit && d.moved && d.cur !== d.start) onCommit(d.cur);
    else if (d.moved) setValue(d.start); // cancelado (el sistema se quedó el gesto): vuelve al valor de partida
  };
  for (const t of [field, strip]) {
    t.addEventListener('dragstart', (ev) => ev.preventDefault());
    t.addEventListener('contextmenu', (ev) => ev.preventDefault()); // pulsación larga: sin menú ni lupa
    t.addEventListener('click', tap, true);
    t.addEventListener('pointerdown', down);
    t.addEventListener('pointermove', move);
    t.addEventListener('pointerup', end(true));
    t.addEventListener('pointercancel', end(false));
  }
  return paint;
}
