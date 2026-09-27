// views/cycle.js — #/cycle (ronda 5, docs/MEJORAS5.md §4). Vista provisional.
import { h, screen } from '../ui.js';

export function mountCycle(root) {
  const c = screen(root, { title: 'Ciclo', back: '#/today' });
  c.append(h('p.muted', 'Pantalla en construcción.'));
}
