# Trabajar desde la nube y el móvil

## Guía para el titular (5 pasos)
1. App **Claude** en el móvil → **Code** → elige `gym` (Entreno) y la rama base.
2. Escribe qué quieres mejorar. Una cosa por sesión.
3. Sigue el progreso en la sesión; responde o corrige cuando quieras.
4. Abre la **pull request**; pestaña **Checks**: ✅ = comprobación de recursos y 861+ pruebas unitarias. Para probar flujos reales: Actions → CI → Run workflow → `e2e`. La URL de la demo sale en el resumen del check «Demo».
5. Pide cambios o pulsa **Merge**. **Fusionar en la rama de producción publica la app** en GitHub Pages: hazlo solo tras probar la demo.

## Producción vs demo
- Producción: `https://alvar1712-blip.github.io/gym/` (rama `claude/personal-training-mobile-app-e82j38`). El repositorio es **público**: todo el código es visible.
- Demo: `*.pages.dev` (Cloudflare), un origen distinto: su almacenamiento está vacío, nunca ve tus datos de producción.

## Activar la demo (una vez, gratis)
Igual que en ÁLVAR OS: cuenta Cloudflare gratuita, token con permiso **Cloudflare Pages · Edit**, secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en GitHub (Settings → Secrets → Actions). Proyecto: `entreno-demo`. Al ser público el código, la demo puede ser pública.

## Recomendado (una vez)
Protege la rama de producción: GitHub → Settings → Branches → regla sobre esa rama con «Require a pull request». Así ningún agente puede publicar por error con un push.

## Límites
Repo público: minutos de Actions gratuitos. Cloudflare Pages Free: 500 builds/mes (aquí solo subimos archivos). Claude web y Codex Cloud comparten la cuota de tu suscripción.

## Conectar GitHub (una vez)
Mismo procedimiento que en ÁLVAR OS (app de GitHub de Claude y Codex con acceso solo a `gym`). Importante: **elige siempre la rama `cloud/preparacion-nube`** como base; la rama de producción aún no contiene `AGENTS.md`. No hay script de setup que añadir (sin dependencias). Prueba segura: «Añade una prueba unitaria para una función pura sin cobertura, ejecuta `npm run check` y abre una PR».
