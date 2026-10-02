# Mejoras (ronda 6) — contexto del usuario · contrato

Idea central: **DATO → CONTEXTO → INTERPRETACIÓN → CONFIANZA → RECOMENDACIÓN**, sin precisión falsa: con datos
insuficientes se dice; recomendaciones conservadoras, explicables y basadas en los datos personales. Evoluciona la
arquitectura existente (nada de reescrituras); todo sigue local, sin cuentas ni servidor y sin conexión.

## Fases
| Fase | Contenido |
|---|---|
| 0 | WebKit (motor de Safari) en Playwright junto a Chromium; `scripts/perf-startup.cjs` y medición base |
| A | IndexedDB v3 (`context`, `pastRecords`, `races`), copia formato 2, perfil ampliado, contexto (fases + hechos, también anteriores a la app), onboarding |
| B | Check-in ampliado (< 10 s: estrés, agujetas por zona 0–10 con el mapa corporal, dolor/molestia) y marcas históricas |
| C | `confidence.js` común + insight ampliado (observación, contexto, interpretación, confianza, recomendación, evidencia) |
| D | Volumen con contexto, vuelta/recuperación de marcas, modo híbrido, carga por deporte |
| E | Eventos deportivos (`races`, enlazables a un objetivo de resistencia) |
| F | Informe para IA (contexto, cambios recientes, datos con baja confianza) |
| G | Caché persistente: antes, comparar contadores de revisión con otras estrategias y elegir la más robusta (corrección > ms) |
| H | Flujos en WebKit + checklist manual en iPhone real + regresión completa |

Tras cada fase: pruebas relevantes + unitarias completas, compatibilidad con datos antiguos, resumen y commit.

## Decisiones del usuario
- `races` es un almacén propio, enlazado opcionalmente con `goals` (`goalId`); el modelo de objetivos no cambia.
- Edad: `profile.birthDate` completa ('YYYY-MM-DD'), opcional; perfiles y copias sin ella siguen funcionando
  (edad desconocida → reglas de adulto general, sin suposiciones).
- Agujetas antiguas (`checkins.soreness` 1–3): no se convierten a 0–10 ni se les inventa zona; solo cuentan como
  indicador general histórico.
- Caché (fase G): estudiar primero contadores de revisión por dominio guardados en `meta` (cada alta/cambio/borrado
  incrementa; el resultado guarda las revisiones con que se calculó) frente a otras opciones.
- La línea temporal de contexto admite hechos anteriores a la app con fecha aproximada («Verano 2026: entrenamiento
  irregular», «Peso habitual previo: 75 kg»).

## Fase A — modelo de datos

### IndexedDB v3 (`js/db.js`)
Solo se AÑADEN almacenes (keyPath `id`); `onupgradeneeded` crea los que falten y no toca los existentes. No hay
reescritura de registros: los campos nuevos son opcionales y se completan al leer (`getProfile`, `normalizeContext`…).

- `context` — línea temporal del usuario. Dos clases en el mismo almacén (se consultan juntas):
  ```
  Fase:  { id:'ctx_…', kind:'phase', type, start:DateApprox, end:DateApprox|null, title?, text, goalIds:[], sports:[],
           notes, createdAt, updatedAt }
  Hecho: { id:'ctx_…', kind:'event', type, date:DateApprox, text, value?:{ kg? }, notes, createdAt, updatedAt }
  DateApprox = { date:'YYYY-MM-DD', precision:'day'|'month'|'season'|'year' }
  ```
  `date` es el primer día del periodo indicado (mes → día 1; estación → primer día de la estación; año → 1 ene);
  `precision` dice cómo mostrarlo («ago 2026», «verano 2026») y cuánto margen tiene al analizar. Fase sin `end` =
  vigente. Tipos de fase: `gain`, `deficit`, `maintain`, `recomp`, `return` (vuelta tras parón), `recondition`,
  `prep_5k`, `prep_10k`, `prep_half`, `prep_marathon`, `prep_cycling`, `hybrid`, `deload`, `illness`, `injury`,
  `travel`, `stress`, `custom`. Tipos de hecho: `creatine_start`, `creatine_stop`, `gym_return`, `holidays`, `illness`,
  `routine_change`, `nutrition_change`, `injury`, `usual_weight` (con `value.kg`), `weight_note` (con `value.kg`), `other`.
- `pastRecords` — marcas históricas manuales (fase B): `{ id, exerciseId, weight, reps, date:DateApprox|null, note,
  createdAt, updatedAt }`. Separadas de los récords calculados (`stats.js`).
- `races` — eventos deportivos (fase E): `{ id, name, type, date, distanceKm, targetSec|null, priority, note,
  goalId|null, createdAt, updatedAt }`.

#### Fases simultáneas y datos estructurados (cierre de la fase A)
- Pueden estar vigentes varias fases a la vez (p. ej. ganancia muscular + preparación 10K + exámenes). Cada tipo de fase
  tiene un `aspect`: `body` (composición), `training` (parón, vuelta, descarga), `sport` (preparaciones, híbrido),
  `life` (enfermedad, lesión, viaje, estrés) o `custom`.
- `contextOn(list, date)` → TODAS las fases vigentes (de la más reciente a la más antigua; a igualdad, la última creada).
- `contextSummary(list, date)` → lo que recibirá el análisis: `phases`, `byAspect`, `types` (Set), `events` del día,
  `usualWeight` y `weights` (`weightReferences`: peso habitual y pesos en una fecha como números con su rango de
  fechas y precisión). Ningún cálculo lee números del texto libre: los hechos de peso guardan `kg` (20–400) aparte del
  texto. Si más adelante otro hecho necesita un número (p. ej. una dosis), tendrá su campo propio y validado, no un
  «valor + unidad» genérico.
- Hoy: una sola línea. Una fase: «Vuelta tras vacaciones o parón · desde sep 2026»; varias: sus nombres
  («Exámenes o época de estrés · Preparación 10K · Ganancia muscular», hasta 3 y «+N»). «Ahora» (en #/context) las
  lista todas.

### Copias (`store.js`)
`BACKUP_FORMAT` pasa a 2: la app nueva acepta copias 1 y 2 (en una copia 1 los almacenes nuevos llegan vacíos); una
versión antigua de la app rechaza la copia 2 («versión más nueva») en vez de perder en silencio los datos nuevos.
Restaurar sustituye todo. Si la copia no trae una sección nueva (copia de formato 1) y en el iPhone hay datos en ella,
la confirmación lo dice antes de «Sustituir todo» (`backup.lostSectionsWarning`): «Esta copia se hizo con una versión
anterior de la app y no contiene contexto, marcas históricas ni eventos deportivos. Al restaurarla se borrará lo que
tienes ahora en esa sección: 2 apuntes de contexto.»

### Perfil (`settings.profile`, `js/profile.js`)
Campos nuevos (todos opcionales): `birthDate`, `secondaryGoals:[]`, `sports:[]`, `limitations` (texto),
`weeklyFrequency` (días/semana), `onboardedAt` (ms). Grupo de edad: `minor` (< 18), `adult`, `senior` (≥ 65) o
`unknown` sin fecha. Los días habituales salen de la semana tipo (no se duplican en el perfil).

### Onboarding (`#/welcome`, `js/views/welcome.js`)
- Perfil nuevo (`isNewProfile`: sin sexo, objetivo ni experiencia y sin `onboardedAt`): la tarjeta de Hoy «Completa tu
  perfil (30 s)» (misma posición y textos) lleva a la bienvenida: 3 pasos saltables (Sobre ti · Tu entrenamiento ·
  Ahora mismo). Cada respuesta se guarda al momento; «Listo» o «Saltar y terminar» marcan `onboardedAt` y, si se eligió
  una fase, la crean en `context` (desde el mes actual). Nunca se abre sola.
- Perfil a medias o ya pasado por la bienvenida: «Completar» lleva a `#/settings/profile`, como antes.
- Usuarios existentes con el perfil básico completo: Hoy no cambia; invitación discreta en Análisis
  («Completa tu perfil para mejorar el análisis (…)», `.an-profile-more`) hasta que añadan fecha de nacimiento,
  deportes y días por semana. Los campos nuevos están en `#/settings/profile` (fecha de nacimiento, otros objetivos,
  qué practicas, días por semana, molestias) con acceso a «Tu contexto».

### Contexto en la interfaz
- `#/context` (lista: «Ahora» + historial), `#/context/new?kind=phase|event`, `#/context/:id` (editar, borrar con
  deshacer). Fechas: Día (selector de fecha) · Mes · Estación · Año (desplegables, la rueda de iOS).
- Entradas: Ajustes (fila «Tu contexto» bajo Perfil), Perfil, Hoy (una sola línea «Ahora: …» si hay una fase vigente).
