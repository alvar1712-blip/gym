# Entreno — instrucciones para agentes (local y nube)

PWA personal de entrenamiento (JavaScript sin compilar: `js/`, `css/`, `sw.js`; datos en IndexedDB del navegador). Contexto: `docs/ESTADO.md`, `docs/ARCHITECTURE.md`, `docs/REQUISITOS.md`, `docs/PRUEBAS.md`.

## Producción: no tocar
- La rama `claude/personal-training-mobile-app-e82j38` es **producción** (GitHub Pages, repositorio público). Un push a ella publica. **Nunca** hacer push ni merge ahí.
- Trabaja siempre en una rama nueva (`cloud/<tema>`) y abre una pull request contra producción. **No fusiones**: lo decide el titular.
- Un cambio en `js/`, `css/` o `sw.js` cambia la app publicada al fusionarse: ejecuta `npm run stamp` y deja el sello del service worker actualizado.

## Entorno y pruebas (Node 24, sin dependencias que instalar)
- `npm run check` — comprobación de recursos + pruebas unitarias (861). **Obligatorio antes de cada commit**.
- `npm run serve` — sirve la app en http://localhost:8080 (para mirarla, no hace falta para las pruebas unitarias).
- E2E (Playwright, lentas): `npm i -g playwright && npx playwright install --with-deps chromium && npm run e2e`. Solo si el cambio toca interfaz o flujos; en GitHub también se lanzan a mano (Actions > CI > Run workflow > e2e).
- No hay instalación: no existe `npm install` que hacer.

## Reglas inamovibles
- Persistencia, copias de seguridad, importaciones y registro de series no se debilitan. Todo arreglo de un fallo lleva una prueba que fallaba antes.
- Datos personales: ninguno en el repositorio ni en pruebas; usa datos sintéticos (`tests/realistic-data.mjs`). Nunca claves ni credenciales.
- No sustituir funciones existentes por prototipos. Cambios pequeños y verificables.
- Cero gasto: no activar APIs ni servicios de pago.

## Al terminar
Describe en la PR: qué cambia, qué pruebas pasaron (con el recuento) y qué no se pudo comprobar. Actualiza `docs/ESTADO.md` si cambia el estado del proyecto.

## Revisión cruzada con Codex
El plugin `codex` es local: **no está disponible en sesiones de la nube**. En la nube, la revisión se hace con una segunda sesión (Codex Cloud o un agente revisor) leyendo la PR en solo lectura.
