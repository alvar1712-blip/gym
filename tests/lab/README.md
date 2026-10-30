# Entreno Lab

Laboratorio de usuarios sintéticos para Entreno. Vive solo en `tests/lab/`: no añade nada a la app, no toca tu historial ni la
app publicada y no usa servicios externos ni de pago.

## Qué hace

1. **Perfiles** (`profiles.mjs`): 20 perfiles ficticios (edad, experiencia, deportes, regularidad, parones, errores de registro,
   accesibilidad, pantalla…) y `generateProfiles(semilla, n)` para crear 100, 300 o más sin escribir archivos.
2. **Historiales** (`history.mjs`): a partir de un perfil y una semilla genera sesiones, actividades, pesajes, check-ins,
   objetivos y eventos con el **esquema real** de Entreno. Mismo perfil + misma semilla = mismos datos.
3. **Nivel 1, Node** (`scenarios-node.mjs`): ejecuta la lógica real de la app (`js/*.js`) sobre esos historiales: copias y sello,
   récords por material, e1RM, análisis y mensajes, duplicados de importación, archivos corruptos, CSV, husos horarios.
4. **Nivel 2, navegador** (`scenarios-browser.mjs`): abre la PWA real en Chromium (emulación de iPhone 13) con un contexto nuevo
   por perfil (IndexedDB vacío), restaura el historial como lo haría «Restaurar copia» y comprueba persistencia, recarga,
   copia/restauración, sesión abierta, fallo de almacenamiento, teclado, movimiento reducido, zona horaria y tamaños táctiles.
5. **Informe** (`run.mjs`): `out/informe.md` (legible) y `out/resultados.json` (estructurado). Los hallazgos van clasificados
   A error confirmado · B riesgo técnico · C hipótesis UX · D mejora propuesta · E limitación del laboratorio
   (metadatos en `findings.mjs`).

Qué está automatizado, qué lo cubren las pruebas existentes y qué queda pendiente: `CATALOGO.md`.

## Ejecutarlo en Windows (PowerShell, desde la raíz del repo)

Solo lógica (Node, sin navegador; unos 20 s):

```powershell
node tests/lab/run.mjs --only node
```

Completo (necesita Playwright con Chromium; unos 2–3 min con 20 perfiles). Playwright no es una dependencia del proyecto: si no
lo tienes global, instálalo en una carpeta aparte y apunta a ella:

```powershell
mkdir $env:USERPROFILE\pw; cd $env:USERPROFILE\pw; npm i playwright; $env:PLAYWRIGHT_BROWSERS_PATH="$PWD\browsers"; npx playwright install chromium
cd C:\Users\Usuario\Documents\GitHub\gym
$env:NODE_PATH="$env:USERPROFILE\pw\node_modules"; $env:PLAYWRIGHT_BROWSERS_PATH="$env:USERPROFILE\pw\browsers"
node tests/lab/run.mjs
```

Sin Playwright, el nivel 2 se omite y el informe lo dice (no lo da por superado).

Opciones: `--seed 7` (otra semilla: otros historiales), `--extra 100` (añade 100 perfiles generados con esa semilla),
`--profile p09` (solo los perfiles cuyo id empieza así), `--only node|browser`, `--out carpeta`.
Motor: `$env:LAB_BROWSER='webkit'` usa WebKit de Playwright (no es Safari de iOS).

Pruebas del propio laboratorio (generador determinista y válido): `node --test tests/lab/lab.test.mjs`.

## Ampliar

- **Más perfiles**: `--extra N`, o un objeto nuevo en `PROFILES` (`profiles.mjs` documenta los campos).
- **Un escenario nuevo**: añade un objeto a `NODE_SCENARIOS` o `BROWSER_SCENARIOS` con `run()` que devuelva la lista de fallos
  observados (vacía = superado). Si falla, el informe crea un hallazgo; dale título, pasos y propuesta en `findings.mjs`
  con la clase que realmente demuestra (un fallo que depende de una decisión de producto no es «A»).
- **Capa opcional de IA**: no incluida. Si algún día se quiere, debe leer `resultados.json` y proponer hipótesis C/D, nunca
  convertir una opinión en un fallo; los fallos A siempre salen de una comprobación que falla.

## Seguridad

Todo es sintético; los contextos de navegador son nuevos y se destruyen; el servidor es `tests/serve.mjs` en 127.0.0.1;
nunca se visita GitHub Pages. Un rollback de código no revierte IndexedDB: por eso el laboratorio no usa nunca tu perfil de
navegador.
