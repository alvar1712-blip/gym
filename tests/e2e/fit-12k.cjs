// FIT sintético de una carrera de 12,4 km a 1 Hz (compartido por las pruebas E2E de parciales y récords):
// 3 km a 5:30, 5 km a 4:58 (24:50) y 4,4 km a 5:30, con autovueltas de 1 km. Tiempo total 1:05:32.
const path = require('path');
const { pathToFileURL } = require('url');

async function fit12kBuffer() {
  const B = await import(pathToFileURL(path.join(__dirname, '..', 'fixtures', 'import', 'builders.mjs')).href);
  const run = B.makeTrack({
    start: Date.UTC(2026, 8, 20, 6, 0, 0), stepSec: 1, heading: 30, seed: 4,
    phases: [
      { sec: 990, speed: 3000 / 990, hr: 148, cad: 84 },
      { sec: 1490, speed: 5000 / 1490, hr: 165, cad: 88 },
      { sec: 1452, speed: 4400 / 1452, hr: 152, cad: 84 },
    ],
  });
  const pts = run.points;
  const starts = [];
  for (let km = 0; km * 1000 < run.distanceM - 1; km++) starts.push(pts.findIndex((p) => p.dist >= km * 1000 - 1e-6));
  const laps = starts.map((i, k) => {
    const j = starts[k + 1] ?? pts.length - 1;
    const sec = (pts[j].t - pts[i].t) / 1000;
    return { start: pts[i].t, elapsedSec: sec, timerSec: sec, distanceM: pts[j].dist - pts[i].dist };
  });
  return Buffer.from(B.buildFitActivity({ points: pts, sport: 1, laps }));
}

module.exports = { fit12kBuffer };
