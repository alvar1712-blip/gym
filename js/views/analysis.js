// views/analysis.js — #/analysis (ronda 5, docs/MEJORAS5.md §3). Vista provisional.
import { h, screen } from '../ui.js';

export function mountAnalysis(root) {
  const c = screen(root, { title: 'Análisis', back: '#/progress' });
  c.append(h('p.muted', 'Pantalla en construcción.'));
}
