// diep.io-inspired palette: flat pastel fills with a darker outline of the same hue.

import type { DamageType } from '../effects/types.ts';

export const PAL = {
  bg: '#cdcdcd',
  grid: 'rgba(0, 0, 0, 0.075)',
  outside: '#b8b8b8',
  path: '#c1c1c1',
  pathEdge: '#b0b0b0',
  blue: '#00b2e1',
  red: '#f14e54',
  barrel: '#999999',
  square: '#ffe869',
  triangle: '#fc7677',
  pentagon: '#768dfc',
  crasher: '#f177dd',
  green: '#00e16e',
  purple: '#bf7ff5',
  orange: '#ffa94d',
  hpBg: '#555555',
  hpFill: '#85e37d',
  shield: '#8efffb',
  text: '#ffffff',
  textStroke: '#333333',
  gold: '#ffe869',
};

export const DAMAGE_COLORS: Record<DamageType, string> = {
  kinetic: '#b0b0b0',
  fire: '#ff7a45',
  frost: '#6fd6ff',
  shock: '#ffe45c',
  toxic: '#8be15b',
  arcane: '#c381ff',
};

/** Darken a #rrggbb colour by factor f (diep outlines are ~0.75x). */
export function shade(hex: string, f = 0.75): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return '#' + ((1 << 24) | (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b)).toString(16).slice(1);
}

/** Mix two #rrggbb colours. */
export function mix(a: string, b: string, t: number): string {
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((na >> s) & 255) * (1 - t) + ((nb >> s) & 255) * t);
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}

export function isHex(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}
