// Card pack art: a foil pouch in the pack's colour with diagonal stripes and a
// diep-style emblem (triangle / square / prism / star).

import type { PackDef } from '../../content/packs.ts';
import { shade } from '../../content/colors.ts';
import { fillStroke, outlinedText, polyPath, starPath, roundRectPath } from './draw.ts';

export function drawPackArt(def: PackDef, w: number, hgt: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * dpr);
  c.height = Math.round(hgt * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${hgt}px`;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const lw = Math.max(2, w * 0.035);
  // Body.
  roundRectPath(g, lw, lw, w - lw * 2, hgt - lw * 2, w * 0.1);
  const grad = g.createLinearGradient(0, 0, w, hgt);
  grad.addColorStop(0, shade(def.color, 1.15 > 1 ? 1 : 1));
  grad.addColorStop(1, shade(def.color, 0.78));
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  // Diagonal foil stripes.
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.lineWidth = w * 0.06;
  for (let d = -hgt; d < w + hgt; d += w * 0.16) {
    g.beginPath();
    g.moveTo(d, 0);
    g.lineTo(d - hgt, hgt);
    g.stroke();
  }
  // Crimped top and bottom.
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 0, w, hgt * 0.09);
  g.fillRect(0, hgt * 0.91, w, hgt * 0.09);
  g.restore();
  roundRectPath(g, lw, lw, w - lw * 2, hgt - lw * 2, w * 0.1);
  g.strokeStyle = shade(def.color, 0.6);
  g.lineWidth = lw;
  g.stroke();
  // Emblem.
  const cx = w / 2, cy = hgt * 0.45, r = w * 0.24;
  g.lineJoin = 'round';
  switch (def.emblem) {
    case 'triangle':
      polyPath(g, cx, cy, r * 1.15, 3, -Math.PI / 2);
      fillStroke(g, '#fc7677', lw);
      break;
    case 'square':
      polyPath(g, cx, cy, r * 1.1, 4, Math.PI / 4 + 0.2);
      fillStroke(g, '#ffe869', lw);
      break;
    case 'prism': {
      polyPath(g, cx - r * 0.2, cy + r * 0.15, r, 3, -Math.PI / 2);
      fillStroke(g, '#ffffff', lw);
      const cols = ['#fc7677', '#ffe869', '#85e37d', '#00b2e1', '#bf7ff5'];
      cols.forEach((col, i) => {
        g.beginPath();
        g.moveTo(cx + r * 0.25, cy + r * 0.05);
        g.lineTo(cx + r * 1.25, cy - r * 0.45 + i * r * 0.28);
        g.strokeStyle = col;
        g.lineWidth = lw * 0.9;
        g.stroke();
      });
      break;
    }
    case 'star':
      starPath(g, cx, cy, r * 1.25, 5, -Math.PI / 2, 0.48);
      fillStroke(g, '#ffffff', lw);
      break;
  }
  outlinedText(g, def.name.replace(' Pack', '').toUpperCase(), w / 2, hgt * 0.8, Math.max(9, w * 0.14));
  return c;
}
