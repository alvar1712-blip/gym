// ruler.js — regla horizontal táctil para el peso y las repeticiones del editor de series (Fase 6).
// Es un añadido al stepper: el número grande (se toca para teclear un valor exacto) y los botones −/+ siguen
// siendo la vía accesible y precisa; la regla es solo el gesto rápido (aria-hidden, sin tabulación).
// Nunca guarda nada por su cuenta: mientras se arrastra solo cambia lo que se ve; al soltar avisa UNA vez (onCommit).

const TICK_PX = 11; // separación entre marcas (una marca = un paso); 40→100 kg con paso 2,5 = 264 px
const MAJOR = 4; // marca larga cada 4 marcas (10 kg con paso 2,5); 5 para repeticiones

/**
 * Valor tras arrastrar `dx` píxeles desde `start`. La regla se mueve con el dedo: arrastrar a la derecha baja el valor.
 * Se suma un número ENTERO de pasos al valor de partida (nunca se redondea lo que no se toca: 41,25 sigue
 * siendo 41,25 hasta que se arrastra una marca entera) y se acota a [min, max].
 */
export function rulerValue(start, dx, { step = 1, tick = TICK_PX, min = 0, max = Infinity } = {}) {
  const base = start ?? (Number.isFinite(min) ? Math.max(min, 0) : 0);
  const k = Math.round(-dx / tick);
  const v = Math.round((base + k * step) * 1e4) / 1e4;
  return Math.min(max, Math.max(min, v));
}

/**
 * Añade la regla a un stepper.
 * @param {HTMLElement} el  stepper (con .getValue y el campo .stepper-field)
 * @param {{step:number, min?:number, max?:number, major?:number, setValue:(v:number)=>void, onCommit:(v:number)=>void}} o
 *   setValue solo cambia lo que se ve (el stepper repinta la regla); onCommit se llama una vez al soltar.
 * @returns {(v:number|null)=>void} paint: coloca la regla en un valor (el stepper la llama en cada cambio)
 */
export function mountRuler(el, { step, min = 0, max = Infinity, major = MAJOR, setValue, onCommit }) {
  const strip = document.createElement('div');
  strip.className = 'ruler';
  strip.setAttribute('aria-hidden', 'true');
  strip.style.setProperty('--tick', `${TICK_PX}px`);
  strip.style.setProperty('--major', `${TICK_PX * major}px`);
  const paint = (v) => {
    const i = (v ?? 0) / step; // marcas desde el 0: las marcas son absolutas, el indicador marca el valor exacto
    strip.style.setProperty('--x', `${TICK_PX / 2 - i * TICK_PX}px`);
    strip.style.setProperty('--xm', `${(TICK_PX * major) / 2 - i * TICK_PX}px`);
  };
  paint(el.getValue());
  // La regla vive DENTRO del campo del número (no suma altura: «Registrar» sigue a la vista en un iPhone SE) y el gesto
  // se escucha en todo el campo; un toque sin arrastrar sigue enfocando el número para teclear.
  const field = el.querySelector('.stepper-field');
  field.append(strip);

  let drag = null;
  field.addEventListener('dragstart', (ev) => ev.preventDefault());
  let swallow = false; // el clic que sigue a un arrastre se descarta (se limpia en el siguiente toque)
  field.addEventListener('click', (ev) => { if (swallow) { swallow = false; ev.preventDefault(); ev.stopPropagation(); } }, true);
  field.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    swallow = false;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, start: el.getValue(), moved: false, cur: el.getValue() };
    try { field.setPointerCapture(e.pointerId); } catch { /* sin captura: el movimiento fuera de la regla se pierde */ }
  });
  field.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 4) return;
    if (!drag.moved) { el.querySelector('input')?.blur(); getSelection()?.removeAllRanges(); } // sin teclado ni selección que el navegador intente arrastrar
    drag.moved = true;
    const v = rulerValue(drag.start, dx, { step, min, max });
    if (v === drag.cur) return;
    drag.cur = v;
    setValue(v); // solo pantalla: nada se guarda mientras se arrastra
  });
  const end = (commit) => (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.moved) { // el arrastre no cuenta como toque: ni abre el teclado ni deja el número seleccionado
      swallow = true;
    }
    if (commit && d.moved && d.cur !== d.start) onCommit(d.cur);
    else if (d.moved) setValue(d.start); // cancelado (el sistema se quedó el gesto): vuelve al valor de partida
  };
  field.addEventListener('pointerup', end(true));
  field.addEventListener('pointercancel', end(false));
  return paint;
}
