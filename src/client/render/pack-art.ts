// Card pack art: a foil pouch in the pack's colour with diagonal stripes and a
// diep-style emblem. Better packs get a finish on top (see `packArt` and the
// .packart styles): a light sweep (shiny), a rainbow foil (holographic), or a
// gold bloom with sparkles (radiant). A Family Pack takes its family's colour
// and sign.

import type { PackDef } from '../../content/packs.ts';
import type { PowerDef } from '../../sim/types.ts';
import { shade } from '../../content/colors.ts';
import { h } from '../ui/dom.ts';
import { fillStroke, outlinedText, polyPath, starPath, roundRectPath, circlePath } from './draw.ts';

type G = CanvasRenderingContext2D;

export const FAMILY_COLOR: Record<PowerDef['family'], string> = {
  elements: '#ff7a45', forms: '#8fb8ff', tempo: '#b0a0ff', fortune: '#ffcf40', matter: '#5fbf62',
};

function familySign(g: G, family: PowerDef['family'], cx: number, cy: number, r: number, lw: number): void {
  switch (family) {
    case 'elements': // a flame
      g.beginPath();
      g.moveTo(cx, cy - r * 1.2);
      g.bezierCurveTo(cx + r * 0.9, cy - r * 0.2, cx + r * 0.9, cy + r * 0.9, cx, cy + r * 0.9);
      g.bezierCurveTo(cx - r * 0.9, cy + r * 0.9, cx - r * 0.9, cy - r * 0.2, cx, cy - r * 1.2);
      fillStroke(g, '#ffe45c', lw);
      break;
    case 'forms': // a ring with an orbiting dot
      circlePath(g, cx, cy, r * 0.8);
      g.strokeStyle = '#ffffff';
      g.lineWidth = lw * 2.2;
      g.stroke();
      circlePath(g, cx + r * 0.8, cy - r * 0.2, r * 0.3);
      fillStroke(g, '#ffe869', lw);
      break;
    case 'tempo': // a clock
      circlePath(g, cx, cy, r);
      fillStroke(g, '#ffffff', lw);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx, cy - r * 0.7);
      g.moveTo(cx, cy);
      g.lineTo(cx + r * 0.5, cy + r * 0.1);
      g.strokeStyle = '#555';
      g.lineWidth = lw;
      g.lineCap = 'round';
      g.stroke();
      break;
    case 'fortune': // a coin with a sparkle
      circlePath(g, cx, cy, r);
      fillStroke(g, '#ffe869', lw);
      starPath(g, cx, cy, r * 0.6, 4, -Math.PI / 2, 0.3);
      fillStroke(g, '#ffffff', lw * 0.7);
      break;
    case 'matter': // a leaf
      g.beginPath();
      g.moveTo(cx - r, cy + r * 0.8);
      g.quadraticCurveTo(cx - r * 0.9, cy - r * 1.1, cx + r, cy - r * 0.9);
      g.quadraticCurveTo(cx + r * 0.9, cy + r * 0.9, cx - r, cy + r * 0.8);
      fillStroke(g, '#b5e61d', lw);
      g.beginPath();
      g.moveTo(cx - r * 0.8, cy + r * 0.6);
      g.lineTo(cx + r * 0.6, cy - r * 0.6);
      g.strokeStyle = shade('#b5e61d', 0.55);
      g.lineWidth = lw * 0.8;
      g.stroke();
      break;
  }
}

function emblem(g: G, def: PackDef, cx: number, cy: number, r: number, lw: number, family?: PowerDef['family']): void {
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
      ['#fc7677', '#ffe869', '#85e37d', '#00b2e1', '#bf7ff5'].forEach((col, i) => {
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
    case 'gear': {
      const teeth = 8;
      g.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2;
        const rr = i % 2 ? r * 0.8 : r * 1.1;
        g.lineTo(cx + Math.cos(a - 0.12) * rr, cy + Math.sin(a - 0.12) * rr);
        g.lineTo(cx + Math.cos(a + 0.12) * rr, cy + Math.sin(a + 0.12) * rr);
      }
      g.closePath();
      fillStroke(g, '#d9dee6', lw);
      circlePath(g, cx, cy, r * 0.35);
      fillStroke(g, shade(def.color, 0.8), lw);
      break;
    }
    case 'family':
      familySign(g, family ?? 'elements', cx, cy, r, lw);
      break;
    case 'dice': {
      g.save();
      g.translate(cx, cy);
      g.rotate(-0.25);
      roundRectPath(g, -r, -r, r * 2, r * 2, r * 0.3);
      fillStroke(g, '#ffffff', lw);
      for (const [dx, dy] of [[-0.5, -0.5], [0.5, 0.5], [0, 0], [0.5, -0.5], [-0.5, 0.5]]) {
        circlePath(g, dx * r, dy * r, r * 0.16);
        g.fillStyle = '#c0392b';
        g.fill();
      }
      g.restore();
      break;
    }
    case 'twin':
      for (const [dx, col] of [[-0.45, '#85e37d'], [0.45, '#00b2e1']] as [number, string][]) {
        g.save();
        g.translate(cx + dx * r, cy);
        g.rotate(dx * 0.4);
        roundRectPath(g, -r * 0.55, -r * 0.8, r * 1.1, r * 1.6, r * 0.15);
        fillStroke(g, col, lw);
        g.restore();
      }
      break;
    case 'crown': {
      g.beginPath();
      g.moveTo(cx - r * 1.1, cy + r * 0.7);
      g.lineTo(cx - r * 1.2, cy - r * 0.6);
      g.lineTo(cx - r * 0.55, cy);
      g.lineTo(cx, cy - r * 0.95);
      g.lineTo(cx + r * 0.55, cy);
      g.lineTo(cx + r * 1.2, cy - r * 0.6);
      g.lineTo(cx + r * 1.1, cy + r * 0.7);
      g.closePath();
      fillStroke(g, '#fff3a8', lw);
      for (const x of [-0.55, 0, 0.55]) {
        circlePath(g, cx + x * r, cy + r * 0.35, r * 0.13);
        g.fillStyle = ['#fc7677', '#00b2e1', '#85e37d'][Math.round(x / 0.55) + 1];
        g.fill();
      }
      break;
    }
  }
}

export function drawPackArt(def: PackDef, w: number, hgt: number, family?: PowerDef['family']): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * dpr);
  c.height = Math.round(hgt * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${hgt}px`;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const color = def.perk === 'family' && family ? FAMILY_COLOR[family] : def.color;
  const lw = Math.max(2, w * 0.035);
  // Body.
  roundRectPath(g, lw, lw, w - lw * 2, hgt - lw * 2, w * 0.1);
  const grad = g.createLinearGradient(0, 0, w, hgt);
  grad.addColorStop(0, def.tier >= 3 ? '#fff0a0' : color);
  grad.addColorStop(def.tier >= 3 ? 0.5 : 1, shade(color, def.tier >= 3 ? 1 : 0.78));
  if (def.tier >= 3) grad.addColorStop(1, shade(color, 0.7));
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
  g.strokeStyle = def.tier >= 3 ? '#b07800' : shade(color, 0.6);
  g.lineWidth = lw;
  g.stroke();
  emblem(g, def, w / 2, hgt * 0.45, w * 0.24, lw, family);
  const label = def.perk === 'family' && family ? family : def.name.replace(' Pack', '');
  outlinedText(g, label.toUpperCase(), w / 2, hgt * 0.8, Math.max(9, Math.min(w * 0.14, (w * 1.3) / Math.max(4, label.length))));
  return c;
}

/**
 * The pack as a page element: its art plus the finish its tier earns. The
 * finish layer sits exactly over the pouch (same inset and corner radius).
 */
export function packArt(def: PackDef, w: number, hgt: number, family?: PowerDef['family']): HTMLElement {
  const lw = Math.max(2, w * 0.035);
  const inset = { left: `${lw}px`, top: `${lw}px`, right: `${lw}px`, bottom: `${lw}px`, borderRadius: `${w * 0.1}px` };
  return h('div', { class: `packart t${def.tier}`, style: { width: `${w}px`, height: `${hgt}px` } },
    drawPackArt(def, w, hgt, family),
    def.tier > 0 ? h('span', { class: 'finish', style: inset }) : null,
    def.tier >= 3 ? h('span', { class: 'sparkles', style: inset }) : null,
  );
}
