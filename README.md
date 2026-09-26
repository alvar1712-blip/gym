# Entreno

App web (PWA) de entrenamiento de **fuerza y resistencia** para iPhone, instalable en la pantalla de inicio.
Gratis, sin servidor, sin cuentas, sin IA. Funciona sin conexión. Los datos se guardan en el propio iPhone (IndexedDB)
con copias de seguridad en JSON y exportación CSV.

- 📱 **Cómo publicarla y añadirla al iPhone:** [docs/GUIA.md](docs/GUIA.md)
- 📋 Requisitos del encargo: [docs/REQUISITOS.md](docs/REQUISITOS.md)
- 🧩 Arquitectura y contrato entre módulos: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Qué hace
- Registro de fuerza en el gimnasio con una mano: series prellenadas con la última vez (1 toque por serie), RIR, tipos de
  serie, récords al momento, duración automática, guardado inmediato y reanudación si se cierra la app.
- Plantillas editables (rutina precargada D1–D6), superseries/circuitos, alternativas por ejercicio.
- Calendario con semana tipo y cambios por semana concreta (mover, sustituir, marcar estado).
- Carrera, bici, natación y otras actividades (campos tipo Strava), carga = minutos × esfuerzo percibido.
- Peso corporal con media móvil de 7 días y tendencia.
- Biblioteca de ejercicios con músculos principales/secundarios y patrón de movimiento.
- Progreso: gráficas SVG propias (sin librerías) con selector de periodo y valor exacto al tocar: peso máximo, 1RM
  estimado (Epley con reps + RIR), mejor serie y volumen por ejercicio; series por músculo frente a su rango; volumen y
  carga semanales; km, ritmo y velocidad; peso corporal; adherencia; récords de fuerza y de resistencia.
- Panel semanal: primero información y después sugerencias (doble progresión, avisos prudentes de carga y km, semana de
  descarga), cada una con su «¿Por qué?» y los datos concretos que la generan; umbrales editables en Ajustes.
- Check-in opcional (sueño, energía, agujetas) y objetivos de fuerza, resistencia y peso con estimación en rango de fechas.

## Desarrollo
Sin dependencias ni compilación. Para probar en local:

```bash
node tests/serve.mjs 8080            # abre http://127.0.0.1:8080/
node scripts/check-assets.mjs        # sw.js precachea todos los archivos
node --test 'tests/unit/*.test.mjs'  # pruebas unitarias
NODE_PATH=$(npm root -g) node --test 'tests/e2e/*.test.cjs'   # E2E (Playwright + Chromium, iPhone 13)
```

Antes de publicar, ejecuta `node scripts/stamp-sw.mjs` (o `npm run stamp`); `node scripts/check-assets.mjs` falla si
`VERSION` no corresponde al contenido (si `VERSION` no cambia, los iPhone no descargan la versión nueva).
