# Ronda 11 — interpretar mejor, no ampliar

Objetivo: que Entreno tome mejores decisiones con lo que sabe, diga lo que NO sabe y proteja el historial a largo plazo.
No añade funciones por añadir. Rama de trabajo: `claude/mejoras-locales` (desde la última versión de la rama principal,
`ef2a2f9`). Nada de esto se ha publicado.

## 1 · Peso y energía (`js/analysis-weight.js`)

| Antes | Ahora |
|---|---|
| «Balance estimado ≈ +230 kcal/día» con solo 2 semanas de pesajes, también sin objetivo. | Con confianza baja o insuficiente **no hay balance ni ajuste de kcal**: se enseña el cambio observado (kg/semana y su margen del 95 %). |
| Un único número redondeado a 10 kcal. | Con confianza media o alta: un **rango** (el margen del 95 % del ritmo × 7700 / 7), redondeado a 50 kcal y rotulado «orientativo… no una medición». |
| «Probablemente estés ganando más grasa que músculo. Come 200–300 kcal menos» (con un −300/−200 fijo en el código). | La subida rápida medida sigue avisando (nivel «Atención»), pero «grasa» solo se dice con confianza media o más y ≥ 3 ejercicios; si no, se redacta como hipótesis (agua, glucógeno, sueño, fase de fuerza) y **sin cifra de kcal**. Desaparece el recorte fijo. |
| «Señal de un déficit demasiado agresivo» con 2 ejercicios. | Igual, solo con base sólida; si no, «puede ser un déficit alto, pero también fatiga, poco sueño…». |

Lo que no cambia: los rangos por objetivo, sexo y experiencia; los textos cuando el contexto explica el cambio (creatina,
vuelta a entrenar…); la proteína; las reglas de menores y mayores. La fórmula 7700 kcal/kg es la de siempre: solo se
limita CUÁNDO se muestra y cómo (rango, no número).

## 2 · Récords reales y estimados (`js/stats.js`, `goals-logic.js`, `summary-logic.js`)

- `enduranceRecords().run.best[X]` guarda solo marcas **completas** (`how:'full'`) o **mejores tramos medidos** (`how:'partial'`,
  de una carrera importada con parciales). Una extrapolación a ritmo medio de una tirada más larga va a
  `enduranceRecords().run.estimates[X]` (`estimated:true`), solo si mejora la marca real (o no hay ninguna).
- Las estimaciones **no cuentan como récord**, no son «marca anterior» en «Récords del periodo» y **no cumplen objetivos**
  de carrera. Un objetivo «10 km en < 45:00» ya no se cumple con 12 km a 4:24/km sin haber corrido 10 km.
- Progreso › Récords: fila aparte «5 km · estimación» (atenuada, distintivo «estimado», «a ritmo medio de una carrera de 8 km;
  no es un récord»). El informe para la IA las lista en su propia sección «ESTIMACIONES A RITMO MEDIO».
- Compatibilidad: es una vista derivada; no hay datos que migrar.

## 3 · Predicción y resistencia

- **Solo rodajes suaves** (`race-predict.isEasyRun`: subtipo rodaje/Z2/tirada larga, o sin subtipo y RPE ≤ 5): la predicción
  pasa a `status:'tentative'`, confianza «baja», código `easy` y un aviso («tómalo como un techo, no como una predicción»).
  Sin subtipo ni RPE no se supone que fuera suave.
- **80/20** (`analysis-training.js`): solo se comenta con ≥ 6 sesiones con tipo o esfuerzo, en ≥ 3 semanas distintas y ≥ 180
  min (antes 4 sesiones y 90 min).
- **Otras actividades** (baloncesto, clases de Educación Física, deporte libre…): no entran en el reparto suave/intenso (un RPE
  alto no las convierte en resistencia intensa); se cuentan aparte (`intensity.otherMin/otherCount`), bajan la confianza a
  «media» y el texto dice que su parte aeróbica no se conoce. La carga de «Otras» se desglosa en intermitente (baloncesto),
  explosiva (agilidad), movilidad y **sin clasificar** (`sportLoad().rows[other].mix`), también en el informe.

## 4 · Material y configuración (`SessionExercise.setup`)

Campo **opcional** de texto libre (≤ 40 caracteres) en cada ejercicio de sesión: «Hammer», «Polea alta», «Agarre neutro»,
«Cinturón», «Máquina asistida»…

- Comparación: `calc.setupKey` (sin mayúsculas, tildes ni espacios de más; `''` = sin especificar). **Récords** (`sessionPRs`,
  `exerciseHistory().prs`, resumen del periodo), **estancamiento y progreso** (`exerciseStream`), «última vez» y «frente a la
  anterior» solo miran la misma configuración. Cambiar de máquina deja una **referencia nueva**, no un récord falso ni un
  estancamiento falso. El 1RM (`setMetrics`) no cambia; en peso corporal el lastre y la asistencia también se comparan solo dentro
  de su configuración.
- **Historial anterior**: no se toca ni se inventa (sin campo = `''`). Si quieres que una sesión antigua cuente con la nueva
  configuración, edítala (la configuración se cambia también en sesiones pasadas). Los objetivos de fuerza y las marcas
  históricas manuales siguen mirando todo el historial.
- Uso: ⋯ › «Material o configuración» (o el chip bajo el nombre) abre una hoja con las usadas con ese ejercicio (la más
  reciente primero, sin duplicados) y un campo de texto; la sesión siguiente hereda la configuración habitual y prellena con la
  última vez de la misma. Cambiar de ejercicio pone la habitual del nuevo.
- Récords: con varias configuraciones, una tarjeta por configuración. Copia JSON: **sin cambio de formato** (campo opcional;
  una app antigua lo conserva sin leerlo). CSV de fuerza: columna «Configuración» **al final**.

## 5 · Copias: sello de integridad y «Comprobar copia»

- La copia lleva `integrity: { algorithm:'sha256', hash, stores }` después de `data` (SHA-256 del texto JSON de `data` y registros por
  sección). Formato 2 sin cambios: una app antigua lo ignora; una copia antigua sin sello se acepta y se dice que no se puede
  comprobar. SHA-256 síncrono propio (`js/sha256.js`, vectores oficiales): en iOS la hoja de compartir no admite un `await` antes.
- Ajustes › Copias y datos › **Comprobar copia**: solo lectura; explica qué contiene, de cuándo es, su formato y distingue
  estructura válida / integridad comprobada / sin sello / el sello no coincide (con qué secciones difieren). No escribe nada
  (datos, ajustes, fecha de última copia, punto de restauración).
- Importar avisa si el sello no coincide, antes de sustituir nada.
- Coste medido (`node scripts/perf-backup.mjs`, mediana de 7, Node en este PC; un iPhone será más lento):

| Historial | Archivo | Exportar antes | Exportar con sello | Comprobar |
|---|---|---|---|---|
| 3 meses | 0,33 MB | 3 ms | 7 ms | 9 ms |
| 1 año | 1,37 MB | 10 ms | 26 ms | 35 ms |
| 2 años | 2,74 MB | 19 ms | 53 ms | 69 ms |
| 5 años | 6,75 MB | 45 ms | 128 ms | 177 ms |
| 10 años | 13,5 MB | 89 ms | 264 ms | 357 ms |

## 6 · Análisis semanal

Medición (`node scripts/measure-recommendations.mjs`, datos sintéticos 6 y 12 meses, hombre/mujer, adulto/menor): el panel da
~11 mensajes (~390 palabras); «Tu análisis», ~23 (~1500); de los 6 temas del panel, 4 los repite el analista; de ~8 avisos del
analista, ~3 tienen confianza baja o insuficiente. «Lo importante esta semana» ya elegía un mensaje por tema (Hoy: 2–3), pero ignoraba
la confianza. Ahora la confianza ajusta el orden sin esconder nada (ver commit); un aviso con poca base no prescribe «Reduce/Añade
series» (paso: reevaluar).

## 7 · Migraciones (aplazado a propósito)

No hay un sistema general de migraciones: no hace falta todavía (todo lo de esta ronda es aditivo y opcional). Cuando haga falta
(una clave que cambia de forma, no un campo nuevo):

1. Subir `meta.app.schema` (hoy 1) y escribir una función `migrate_N_to_M(data)` **pura** por salto, en orden, idempotente.
2. Antes de la primera, crear el punto de restauración (`store.createRestorePoint('migrate')`, ya verifica la copia releída).
3. Aplicarlas en UNA transacción (`db.putStores`/`replaceAll`), y las copias importadas pasarlas por las mismas funciones
   (`format` de la copia → `schema`).
4. No subir `DB_VERSION` salvo para añadir un almacén; una app más antigua que abra una base más nueva falla con `VersionError`
   («No se pudo abrir el almacenamiento»), y los datos siguen intactos.
5. Una prueba por salto con una base/copia real de la versión anterior (ver `tests/e2e/migration.test.cjs`).

## Verificación y entorno

Ver el informe final de la ronda (resultados de las baterías). Nota de entorno: en esta máquina Windows `core.autocrlf=true`, así
que el sello del service worker (`sw.js` VERSION) no coincide con el contenido (se calcula sobre bytes con CRLF): ejecutar
`npm run stamp` **solo** en una copia con finales de línea LF antes de publicar. No se ha estampado ni publicado nada.
