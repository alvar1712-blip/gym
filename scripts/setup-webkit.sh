#!/bin/sh
# Instala el navegador WebKit de Playwright (el motor de Safari) y sus bibliotecas del sistema, para
# `npm run e2e:webkit`. Una vez por máquina; no toca Chromium. Necesita red (y permisos de apt en Linux).
set -e
PW="$(npm root -g)/playwright/cli.js"
node "$PW" install webkit
node "$PW" install-deps webkit
