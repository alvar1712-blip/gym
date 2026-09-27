# Mejoras (ronda 5) — contrato

Pedidas por el usuario: (1) que deslizar desde el borde para volver no «se buguee» y todo vaya más fluido, con más
transición y un Liquid Glass más marcado; (2) análisis y recomendaciones «tipo IA» (peso, ejercicios, rendimiento
esperado, resistencia, recuperación), contrastados con la ciencia y adaptados a su perfil; (3) **modo mujer** (su novia
usará la app en su iPhone, con sus propios datos) con **seguimiento del ciclo** «bien incorporado».

Principios: la app sigue siendo gratis, sin servidor, sin cuentas y privada. **No hay IA de verdad (LLM) dentro**: el
«analista» es estadística + reglas basadas en evidencia que corre en el móvil, escrito en frases personalizadas; cada
frase lleva «¿Por qué?» (datos + regla) y **fuentes** (autor, año). Extra: «Copiar informe para tu IA» (texto para pegar
en ChatGPT/Claude). Tono prudente: rangos, «orientativo», nunca consejo médico; no se ve el espejo ni el % de grasa (se
usan peso + fuerza como pistas); no se registra comida (kcal y proteína en rangos orientativos).

Ya preparado (commit de andamiaje): rutas `#/analysis` (views/analysis.js · mountAnalysis), `#/cycle`
(views/cycle.js · mountCycle), `#/settings/profile` (views/settings.js · mountProfile), vistas provisionales; CSS
`css/analysis.css` y `css/cycle.css` enlazados y precacheados; IndexedDB **versión 2** con la store nueva `cycle`
(incluida sola en copias JSON e importación); `settings.profile` en `seed.defaultSettings()`; `js/profile.js`
(getProfile, isFemale, isHormonal, cycleEnabled, g(p, m, f), profileIncomplete, SEXES/GOALS/EXPERIENCES/CONTRACEPTION).

## 1. Deslizar para volver, fluidez y cristal (router.js, ui.js, app.css, app.js, index.html)
- **Gesto del sistema (iOS, borde izquierdo)**: el iPhone ya anima su «atrás» con una foto de la pantalla anterior; la
  app NO debe animar otra vez. Detectar: `hasUAVisualTransition` (popstate/hashchange si existe) **y** heurística propia
  (toque que empieza a ≤ 24 px del borde izquierdo y termina/mueve justo antes del popstate, ~1 s) → transición `none`.
- **Scroll por entrada del historial**: al volver, la pantalla aparece donde estaba (coincide con la foto del gesto).
  Mapa en memoria `__idx → scrollY` (+ sessionStorage), actualizado en scroll pasivo con rAF; **no** usar replaceState
  en cada scroll (Safari limita replaceState). Montajes asíncronos: restaurar al terminar el montaje.
- **Hojas y atrás**: con una hoja/diálogo abierto, «atrás» (gesto o botón) la cierra sin cambiar de pantalla (entrada
  de historial propia de la hoja, con cuidado con `depth`/`histIdx` y con acciones que navegan desde la hoja); como
  mínimo, toda hoja se cierra al cambiar de ruta. **Arrastrar hacia abajo** para cerrar hojas (sigue al dedo, cierra por
  distancia o velocidad, rebote hacia arriba).
- **Respuesta al toque sin falsos positivos**: clase `.is-pressed` por JS (tras ~50 ms sin moverse > 8 px; se quita al
  mover, soltar o cancelar) en vez de `:active` al hacer scroll o deslizar.
- **Más fluidez**: muelles con `linear()` (Safari 17.2+; alternativa cubic-bezier), píldora de pestañas «líquida» (se
  estira al moverse), hoja abierta → la pantalla de detrás se encoge un poco y redondea (efecto tarjeta; ojo con
  `position:fixed/sticky` dentro de elementos con transform), títulos grandes que pasan a título pequeño en la barra al
  hacer scroll (como Ajustes de iOS), aparición suave y escalonada del contenido al entrar (solo push, ≤ 6 elementos,
  ≤ 250 ms). Solo transform/opacity. `prefers-reduced-motion` → sin desplazamientos.
- **Cristal más marcado**: barras, cápsula de pestañas, hojas, avisos y pies flotantes con opacidad ~65–78 %,
  `backdrop-filter: blur(24–32px) saturate(180–200%)`, canto interior brillante, reflejo superior suave; en el iPhone el
  desenfoque es real (el Chromium de las pruebas no lo pinta en páginas largas: no subir la opacidad por eso). El texto
  de debajo nunca debe leerse (el desenfoque fuerte lo impide). Alternativas: `@supports not (backdrop-filter…)` y
  `prefers-reduced-transparency` → opaco. La refracción tipo lente de iOS 26 no existe en Safari web: se aproxima.

## 2. Perfil (settings.profile) y modo mujer
`#/settings/profile`: Sexo (Hombre/Mujer), Objetivo (Ganar músculo / Perder grasa / Mantener / Rendimiento),
Experiencia (Principiante / Intermedio / Avanzado); en modo mujer además: Seguimiento del ciclo (sí/no), Anticonceptivo
(lista de `profile.CONTRACEPTION`), duración típica del ciclo y de la regla (hasta tener datos), «Incluir el ciclo en el
informe para tu IA» (no por defecto). Se entra desde Ajustes (fila «Perfil» arriba) y desde la tarjeta de Hoy «Completa
tu perfil (30 s)» (si falta sexo, objetivo o experiencia y no se ha descartado).
Modo mujer cambia: análisis del peso (ciclo), rangos de ganancia algo más prudentes, avisos de energía baja más
sensibles (con el ciclo), referencias de fuerza de mujeres, textos en femenino (`g(p, m, f)`), y activa el ciclo.
No cambia (la evidencia es igual): proteína 1,6–2,2 g/kg, rangos de series por músculo, cálculo de tiempos de carrera.

## 3. Análisis («tu analista»)
Tipos comunes (todas las funciones son PURAS, sin store/ui; «hoy» inyectable):
```
Insight = { id, area:'weight'|'strength'|'endurance'|'recovery'|'cycle'|'forecast', level:'good'|'neutral'|'warn'|'info',
  priority: 0..100 (más alto = más importante para el resumen), title, text,
  why: { rule, data:[{ label, value }] }, sources: [{ short:'Morton et al., 2018', detail:'Br J Sports Med · meta-análisis …' }],
  action?: { label, href } }
Profile = profile.getProfile(settings)
```
### 3a. `js/analysis-weight.js` — `analyzeWeight(input)`
`input = { bodyweight:[{ id:'YYYY-MM-DD', kg }], today, profile, strength?: { trendPctPerWeek, n } | null,
endurance?: { weeklyMinutes4w } | null, cycle?: CycleInfo | null }` →
`{ ok, reason?, trend:{ points:[{ date, kg, trendKg }], currentKg, ratePerWeekKg, ratePerWeekPct, windowDays, n },
target:{ minPct, maxPct, label } | null, status:'below'|'in'|'above'|'insufficient'|'no_goal',
kcalPerDay:{ estimate, suggestion:{ min, max } | null }, proteinG:{ min, max }, insights:Insight[],
goalSuggestion?: { targetKg, byFrom, byTo, title } }`.
- Tendencia: media móvil exponencial (≈ 10 días; mujer: ritmo sobre ≥ 4 semanas, un ciclo) + pendiente robusta; ruido
  diario normal 0,5–1,5 kg; < 8 pesajes o < 14 días → `insufficient` con consejo (pesarse por la mañana, 3–4/sem).
- Rangos por objetivo (% del peso/semana): ganar músculo — hombre principiante/intermedio 0,25–0,5, avanzado 0,1–0,25;
  mujer principiante/intermedia 0,2–0,4, avanzada 0,1–0,2 (orientativo: mismo % supone menos masa magra absoluta);
  perder grasa 0,5–1,0 (con mucha resistencia o mujer, recomendar la mitad baja); mantener y rendimiento ±0,25.
- Cruce con la fuerza: peso ↑ y fuerza ↑ → bien; peso ↑ rápido y fuerza plana → probablemente más grasa; peso ↓ y
  fuerza ↓ → déficit agresivo. Mensajes del tipo «Subes 0,3 kg/sem (0,4 %): dentro del rango… Si en el espejo no notas
  que acumulas grasa, vas bien» / «Subes poco para ganar músculo: prueba ~150–250 kcal más al día y revisa en 3 semanas».
- kcal/día ≈ ritmo kg/sem × 7700 / 7 (aproximación). Proteína: 1,6–2,2 g/kg/día (en déficit, hacia 2,2+).
- Energía baja (REDs): pérdida > 1 %/sem, o pérdida con muchos minutos de resistencia; en mujer, además, reglas
  ausentes/retrasadas (del CycleInfo) → aviso claro de consultar a un profesional.
- Mujer con CycleInfo: marcar pesajes en fase lútea tardía / días 1–3 de la regla como «posible retención de líquidos»,
  y comparar preferentemente fases equivalentes; nunca alarmar por un pico en esos días.
- `goalSuggestion` para crear un objetivo de peso con un toque (`#/goal/new?kind=bodyweight&target=…`).
### 3b. `js/analysis-training.js` — fuerza, resistencia y recuperación
- `analyzeStrength(data, { profile, today })` → `{ exercises:[{ exerciseId, name, sessions, e1rmNow, ratePctPerWeek,
  status:'fast'|'good'|'stalled'|'down'|'insufficient', lastPrDate, forecast:[{ weeks, date, low, mid, high }] }],
  summary:{ trendPctPerWeek (mediana de los principales), improving, stalled, down }, insights }`. Pendiente robusta
  (Theil–Sen) del mejor 1RM estimado por sesión en 6–12 semanas (≥ 4 sesiones en ≥ 3 semanas); umbrales orientativos
  por experiencia (principiante bien ≥ 0,75 %/sem, rápido ≥ 1,5; intermedio ≥ 0,25 / ≥ 0,75; avanzado ≥ 0,1 / ≥ 0,4;
  estancado con `settings.stall`); previsión a 4 y 8 semanas con rendimientos decrecientes y rango de los residuos
  («si sigues así»). Estancamientos → qué probar (rango de reps, +1 serie si el músculo está bajo su rango, descarga si
  hay fatiga, sueño/proteína).
- `analyzeEndurance(data, { profile, today })` → `{ fitness:[{ weekStart, pred5kSec }], intensity:{ easyMin, hardMin,
  easyShare, weeks }, interference:[{ date, text }], insights }`: tendencia de forma (reusa `race-predict.js`), reparto
  suave/intenso de las 4 últimas semanas (subtipos: z2/long/easy/route → suave; intervals/tempo/race → intenso; sin
  subtipo, RPE ≤ 5 suave) frente a ~80/20, carrera/intervalos intensos el día antes de pierna → sugerencia.
- `analyzeRecovery(data, { profile, today, cycle })` → `{ insights }`: sueño/energía del check-in frente al rendimiento
  relativo (≥ 8 check-ins con sesión); con CycleInfo, lo que dice SU historial por fase (sin generalizar).
### 3c. `js/analysis.js` (orquestador) y `js/analysis-report.js`
`buildAnalysis(data, today)` (data = `progress-ui.dataFromStore(today)` + `checkins` + `cycleDays`) → `{ profile,
weight, strength, endurance, recovery, cycle, keyPoints: Insight[] (3 de mayor prioridad, variados), all: Insight[] }`.
`reportText(analysis, { includeCycle })` → texto en español para pegar en una IA (perfil, peso, fuerza, resistencia,
recuperación, ciclo si se permite, y una pregunta final). UI: `#/analysis` (tarjetas Resumen, Peso, Fuerza, Resistencia,
Recuperación, Ciclo si procede, Próximas semanas, botón «Copiar informe para tu IA» con portapapeles/compartir),
tarjeta «Tu análisis» (2–3 puntos) en Hoy y en el panel semanal, acceso «Análisis» en Progreso.

## 4. Ciclo menstrual (modo mujer)
Store `cycle`: un registro por día anotado `{ id:'YYYY-MM-DD', flow:'none'|'spotting'|'light'|'medium'|'heavy',
symptoms:[ids], notes, createdAt, updatedAt }` (síntomas: cramps, bloating, headache, fatigue, low_mood, breast,
acne, cravings, bad_sleep, back_pain). Una regla = días seguidos con flow ≥ light (se admite 1 día de hueco).
`js/cycle-logic.js` (PURO):
- `periodsFromDays(days)` → `[{ start, end, lengthDays, heavyDays }]`
- `cycleInfo(days, profile, today)` → `CycleInfo = { enabled, hormonal, periods, cycles:[{ start, lengthDays,
  periodDays }], avgCycle, sdCycle, avgPeriod, regular, current:{ day, phase, phaseLabel, estimated } | null,
  next:{ start, from, to } | null, lateDays, alerts: Insight[] }`. Fases (ciclo natural, estimadas): menstrual (días de
  regla), folicular, ovulación aprox. (≈ ciclo − 14 ± 2), lútea, premenstrual (≈ 5 días antes). Con anticonceptivo
  hormonal no hay fases naturales: solo sangrados y síntomas (`phase:null`, mensaje explicativo).
- `phaseForDate(info, date)`, `phaseStats(info, data)` (medias por fase de SU historial: energía/sueño del check-in,
  RPE, rendimiento relativo de fuerza, desvío del peso respecto a su tendencia, síntomas frecuentes; solo con ≥ 2
  ciclos completos).
- Alertas con evidencia: ciclo fuera de 24–38 días o variación > 7–9 días (FIGO), regla retrasada > 7 días (si puede
  haber embarazo, test), sin regla ≥ 90 días (amenorrea → consultar; relación con energía baja/REDs), reglas abundantes
  frecuentes → hierro/ferritina con su médico si hay cansancio.
UI (`#/cycle`): estado actual (día y fase estimada con anillo/línea del ciclo, próxima regla con rango), botones «Me ha
venido hoy» / «Registrar día» (hoja: sangrado + síntomas + notas), calendario mensual (días de regla anotados, regla
prevista punteada, ovulación aproximada con aviso «no válido como anticonceptivo»), historial de ciclos (duraciones,
gráfica), «Cómo te afecta» (`phaseStats`, con la nota de la evidencia: en promedio la fase afecta poco al rendimiento;
se entrena según cómo te sientas) y alertas. Tarjeta de Hoy (`cycleTodayCard()` exportada por views/cycle.js): «Día 12 ·
fase folicular (estimada) · próxima regla ~3–5 oct» + botón rápido. Marcas discretas en el calendario de la app y en la
gráfica de peso (días de regla). Datos sensibles: solo en el iPhone (y en la copia JSON que ella decida).

## 5. Fuentes permitidas (citar solo estas o equivalentes igual de sólidas; `short` + `detail`)
- Morton RW et al., 2018 · Br J Sports Med · meta-análisis: proteína ≥ 1,6 g/kg/día (IC hasta ~2,2).
- Jäger R et al., 2017 · J Int Soc Sports Nutr · posición ISSN sobre proteína (1,4–2,0 g/kg/día).
- Iraki J et al., 2019 · Sports · volumen fuera de temporada: ganar ~0,25–0,5 % del peso/semana.
- Helms ER, Aragon AA, Fitschen PJ, 2014 · J Int Soc Sports Nutr · pérdida de 0,5–1 %/semana para conservar músculo.
- Garthe I et al., 2011 · Int J Sport Nutr Exerc Metab · pérdida lenta (0,7 %/sem) mejor que rápida (1,4 %/sem).
- Hall KD, 2008 · Int J Obes · la regla de 3500 kcal/lb (≈ 7700 kcal/kg) es una aproximación.
- Mountjoy M et al., 2023 · Br J Sports Med · consenso COI sobre REDs (energía baja; la alteración menstrual es señal clave).
- Schoenfeld BJ, Ogborn D, Krieger JW, 2017 · J Sports Sci · dosis-respuesta: ≥ 10 series/semana por músculo.
- Roberts BM, Nuckols G, Krieger JW, 2020 · J Strength Cond Res · mujeres y hombres ganan parecido en relativo.
- Seiler S, 2010 · Int J Sports Physiol Perform · distribución de intensidad (~80 % suave).
- Schumann M et al., 2022 · Sports Med · entrenamiento concurrente: la fuerza máxima y la hipertrofia apenas se resienten;
  la potencia sí, sobre todo en la misma sesión. Eddens L et al., 2018 · Sports Med · fuerza antes de resistencia si van juntas.
- Knowles OE et al., 2018 · J Sci Med Sport · dormir poco reduce la fuerza en ejercicios compuestos.
- McNulty KL et al., 2020 · Sports Med · meta-análisis: la fase del ciclo afecta de forma trivial y variable al rendimiento;
  enfoque individual. Colenso-Semple LM et al., 2023 · Front Sports Act Living · sin efecto claro de la fase en fuerza
  ni adaptaciones. Elliott-Sale KJ et al., 2020 · Sports Med · anticonceptivos orales y rendimiento (efecto trivial).
- White CP, Hitchcock CL, Vigna YM, Prior JC, 2011 · Obstet Gynecol Int · retención de líquidos a lo largo del ciclo
  (máxima el primer día de regla).
- Fraser IS / Munro MG et al. (FIGO), 2018 · Int J Gynaecol Obstet · ciclo normal 24–38 días, variación ≤ 7–9 días.
- Pedlar CR et al., 2018 · Eur J Sport Sci · hierro en la mujer deportista; Bruinvels G et al., 2016 · Br J Sports Med ·
  sangrado menstrual abundante frecuente en mujeres que hacen ejercicio.

## Propietarios en esta ronda
| Parte | Archivos |
|---|---|
| fluidez (§1) | js/router.js, js/ui.js, css/app.css, js/app.js (sin tocar la tabla de rutas), index.html, tests/e2e/gestures.test.cjs, tests/e2e/transitions.test.cjs |
| peso (§3a) | js/analysis-weight.js, tests/unit/analysis-weight.test.mjs |
| entrenamiento (§3b) | js/analysis-training.js, tests/unit/analysis-training.test.mjs |
| ciclo (§4) | js/cycle-logic.js, js/views/cycle.js, css/cycle.css, js/views/calendar.js y css/calendar.css (marcas), js/views/bodyweight.js y js/charts.js (marcas en la gráfica), tests/unit/cycle.test.mjs, tests/e2e/cycle.test.cjs |
| analista y perfil (§2, §3c; segunda tanda) | js/analysis.js, js/analysis-report.js, js/views/analysis.js, css/analysis.css, js/views/settings.js, js/views/today.js, js/views/weekly.js, js/views/progress.js, js/views/goals.js (objetivo desde recomendación), textos en femenino en las vistas, tests/unit/analysis.test.mjs, tests/e2e/analysis.test.cjs, tests/e2e/profile.test.cjs |
