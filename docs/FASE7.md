# Fase 7 — Sesión activa rediseñada

## Problema
La serie abierta mostraba a la vez peso, repeticiones, RIR, registrar, tipo (Calent./Efectiva/Al fallo/Drop), nota y quitar: una
pantalla entera de formulario. La regla de la fase 6 era una franja de 14 px dentro del campo y, en iPhone, el dedo sobre el
`<input>` no llegaba a la regla (6b: el gesto lo recibe ahora un elemento que no es un campo de texto).

## Decisiones de producto (del propietario, no se vuelven a preguntar)
Sistema híbrido (hechas compactas, siguiente destacada, historial accesible, editar anteriores), regla horizontal grande, avance
automático **sin registrar solo**, RIR siempre visible (sin regla), **sin temporizador de descanso**, controles raros fuera de la
superficie, sin imágenes/vídeos ni sustituciones avanzadas. Se prefiere una composición con scroll natural a un formulario comprimido.

## Comparación con openGym (ideas, no código: AGPL-3.0)
Filas compactas para lo hecho y un único editor grande para lo pendiente; acciones secundarias agrupadas en un menú; historial por
ejercicio a un toque dentro del entrenamiento; progresión explicable y calculadora de discos orientativa. Entreno conserva su
identidad (oscuro, verde lima), su arquitectura ligera y sus reglas (doble progresión, estancamiento, confianza) que ya eran más ricas.

## Qué cambia
- **Serie abierta** (`session-view-card.js` `renderEditor`): cabecera «SERIE n · [+ Calent.] · ⋯», peso con −/número grande/+ y regla
  de 54 px con cifras y aguja, repeticiones con regla de 42 px, RIR (Fallo, 0–5) a todo el ancho y «Registrar». Un único acento verde.
- **Regla** (`ruler.js`): sigue al dedo píxel a píxel, el valor salta de paso en paso, no guarda hasta soltar, un toque enfoca el
  número, `touch-action: pan-y`. **Paso por ejercicio**: `min(2,5; incremento de progresión del ejercicio)` (aislamiento 1 kg, resto
  2,5 kg; sale de Ajustes → incrementos, sin configuración nueva). Un valor fuera de rejilla (41,25) se conserva hasta arrastrar una marca.
- **Menú ⋯ de la serie**: Calentamiento · Serie efectiva · Al fallo · Drop set · Nota · Quitar/Borrar. Mismos datos (`type`, `rir:'F'`);
  nada se borra: los drop sets antiguos se ven (insignia «Drop») y se editan. «Fallo» sigue siendo una opción del RIR (semántica intacta).
- **Avance**: registrar pliega la fila (destello breve, nada con «reducir movimiento») y la siguiente pendiente se abre con sus valores;
  la pantalla coloca el editor entero si cabe, y si no manda «Registrar» (`revealEditor`).
- **Contexto**: «Objetivo · Siguiente paso», «Última vez», y **«Hoy»** (`progression.todayPlan`): si toca subir, peso+incremento y base
  del rango; si toca mantener, mismo peso y una repetición más (hasta el tope). Sin propuesta en estancamiento, datos ambiguos, peso
  corporal o sin rango. «Usar» la pasa a la serie abierta; nunca se registra ni se guarda una rutina.
- **Historial** (`session-history.js`): botón en la cabecera del ejercicio → hoja con últimas sesiones, evolución del peso máximo
  (`charts.sparkline`) y enlace al progreso completo. Lee `stats.exerciseHistory`; no guarda nada.
- **Discos** (`plates.js` puro + `plates-view.js`): barra y discos por lado con supuestos explícitos (barra 20/15/10 kg, discos 25–1,25
  kg), avisa si no se puede montar exacto. Solo orientativo, solo en ejercicios `weight_reps`.
- **Resumen final**: «Entrenamiento completado», cuatro datos (duración, series de trabajo, ejercicios, volumen) y reparto del volumen por
  ejercicio con la advertencia de que no mide fuerza. Récords y comparación con la sesión equivalente, como antes.

## Compatibilidad
Sin cambios de IndexedDB, de formato de copia JSON, de récords ni de cálculos. No hay tema claro en la app (solo oscuro).

## Pruebas
Unitarias: `plates.test.mjs`, `today-plan.test.mjs` (+ las existentes, 857). E2E (Chromium y WebKit): `fase7.test.cjs` (flujo completo),
`ruler-touch.test.cjs` (toque real por CDP en Chromium; en WebKit PointerEvent táctil sobre el elemento que recibiría el dedo),
`register-visible`, `session`, `checkin`, `ruler`. Los tests que exigían «Registrar a la vista sin desplazar» en 375×667 se adaptaron: el
editor con reglas no cabe sin desplazar (decisión del propietario); siguen exigiendo que quede entero, tocable y no tapado tras colocarlo.
En WebKit de este PC las hojas solo son clicables con el viewport emulado por defecto (problema de entorno previo).

## Pendiente / límites
Safari físico sin verificar (arrastre, teclado numérico, gestos de borde). Sin tema claro. Incremento por material (mancuerna/máquina)
no modelado: no hay campo de material en los ejercicios.
