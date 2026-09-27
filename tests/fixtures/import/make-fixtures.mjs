// make-fixtures.mjs — escribe los archivos de ejemplo de la importación en esta carpeta.
// Ejecutar: node tests/fixtures/import/make-fixtures.mjs   (los archivos generados se guardan en el repositorio)
//   carrera.gpx        carrera dom 20 sep 2026 08:00, 5 km, 25 min en movimiento + 2 min parado (GPX Garmin, hr/cad)
//   carrera.gpx.gz     la misma, comprimida
//   bici.tcx           bici lun 21 sep 2026 18:00, 20 km en 45 min (TCX con 2 vueltas, FC, cadencia y vatios)
//   ruta.fit           senderismo sáb 19 sep 2026 10:00 (FIT: marcas comprimidas, campos de desarrollador, sesión big endian)
//   ruta-garmin.zip    «Exportar original» de Garmin Connect: un .zip con 1234567890_ACTIVITY.fit (el mismo senderismo)
//   sin-deporte.gpx    paseo corto sin tipo ni nombre reconocible (hay que elegir el deporte)
//   notas.txt          archivo que no es una actividad
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleRun, sampleRide, sampleHike, makeTrack, gpxFromPoints, tcxFromPoints, buildFitActivity, makeZip, gzip } from './builders.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const write = (name, data) => {
  fs.writeFileSync(path.join(dir, name), data);
  console.log(`${name}: ${fs.statSync(path.join(dir, name)).size} bytes`);
};

export function fixtureFiles() {
  const run = sampleRun();
  const runGpx = gpxFromPoints(run.points, { type: 'running', name: 'Carrera de mañana' });
  const ride = sampleRide({ stepSec: 30 }); // un punto cada 30 s: archivo de ejemplo más pequeño
  const rideTcx = tcxFromPoints(ride.points, { sport: 'Biking', laps: 2 });
  const hike = sampleHike();
  const hikeFit = buildFitActivity({
    points: hike.points, sport: 17, subSport: 0, name: 'Hike',
    session: { hrAvg: 121, hrMax: 152, cadence: 56, ascent: 598, descent: 601, maxAltM: 1502 },
  });
  const walk = makeTrack({
    start: Date.UTC(2026, 8, 22, 17, 30, 0), stepSec: 30, ele: 640, seed: 9,
    phases: [{ sec: 600, speed: 1.3, climb: 0 }],
  });
  const walkGpx = gpxFromPoints(walk.points, { type: '', name: 'Actividad', extensions: false });
  return {
    'carrera.gpx': runGpx,
    'carrera.gpx.gz': gzip(runGpx),
    'bici.tcx': rideTcx,
    'ruta.fit': hikeFit,
    'ruta-garmin.zip': makeZip([{ name: '1234567890_ACTIVITY.fit', data: hikeFit, method: 8 }]),
    'sin-deporte.gpx': walkGpx,
    'notas.txt': 'Esto no es una actividad.\n',
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  for (const [name, data] of Object.entries(fixtureFiles())) write(name, data);
}
