// Built-in visual effects, written in the same VFX language the LLM uses.
// They double as defaults for the base game and as examples in the prompt.

import type { VfxDef, VfxLayer } from './types.ts';

const v = (id: string, ...layers: VfxLayer[]): VfxDef => ({ id, layers });

export const BUILTIN_VFX_LIST: VfxDef[] = [
  // ---- one-shot impacts / bursts
  v('pop', { kind: 'shape', shape: 'circle', fill: true, radius: [0.08, 0.32], alpha: [0.8, 0], duration: 0.18, color: 'damage' }),
  v('ring', { kind: 'shape', shape: 'ring', radius: [0.1, 0.8], thickness: 0.06, alpha: [1, 0], duration: 0.35, color: 'base' }),
  v('burst', {
    kind: 'particles', count: 10, shape: 'square', size: [0.09, 0.02], speed: [2, 5], life: [0.2, 0.45],
    direction: 'radial', spread: 360, drag: 3, outline: true, color: 'damage',
  }),
  v('sparks', {
    kind: 'particles', count: 12, shape: 'spark', size: [0.14, 0.04], speed: [4, 9], life: [0.1, 0.3],
    direction: 'radial', spread: 360, glow: true, color: 'base', color_end: '#ffffff',
  }),
  v('shatter', {
    kind: 'particles', count: 9, shape: 'shard', size: [0.15, 0.06], speed: [2, 5], life: [0.35, 0.6],
    direction: 'radial', spread: 360, spin: 8, drag: 2, outline: true, color: 'base',
  }),
  v('implode',
    { kind: 'shape', shape: 'ring', radius: [1.0, 0.05], thickness: 0.08, alpha: [0.2, 1], duration: 0.3, color: 'base' },
    { kind: 'particles', count: 14, shape: 'circle', size: [0.08, 0.02], speed: [2, 3], life: [0.25, 0.35], direction: 'inward', emit_from: 'ring', radius: 1.0, color: 'base', glow: true },
  ),
  v('shockwave',
    { kind: 'shape', shape: 'ring', radius: [0.2, 2.0], thickness: 0.16, alpha: [0.9, 0], duration: 0.4, color: 'base' },
    { kind: 'shake', strength: 0.25, duration: 0.2 },
  ),
  v('splash',
    { kind: 'particles', count: 14, shape: 'drop', size: [0.1, 0.03], speed: [1.5, 4], life: [0.3, 0.55], direction: 'radial', spread: 360, gravity: 6, color: 'base', outline: true },
    { kind: 'shape', shape: 'ring', radius: [0.1, 0.6], thickness: 0.05, alpha: [0.8, 0], duration: 0.3, color: 'base' },
  ),
  v('glyph', { kind: 'shape', shape: 'glyph', sides: 6, radius: [0.45, 0.7], thickness: 0.05, alpha: [1, 0], rotate: 3, duration: 0.8, color: 'base', glow: true }),
  v('flash', { kind: 'shape', shape: 'circle', fill: true, radius: [0.45, 0.8], alpha: [0.9, 0], duration: 0.15, color: '#ffffff', glow: true }),
  v('puff', {
    kind: 'particles', count: 6, shape: 'smoke', size: [0.15, 0.45], speed: [0.3, 1.2], alpha: [0.6, 0], life: [0.35, 0.8],
    direction: 'aim', spread: 70, drag: 2, color: '#dddddd',
  }),
  v('lightning', { kind: 'beam', style: 'lightning', width: [0.09, 0.06], color: 'damage', core: '#ffffff', glow: true, amplitude: 0.25, flicker: 0.5, duration: 0.18 }),
  v('laser', { kind: 'beam', style: 'solid', width: [0.3, 0.22], color: 'base', core: '#ffffff', glow: true, pulse: 0.3, duration: 0.25 }),
  v('tether', { kind: 'beam', style: 'dashed', width: [0.05, 0.05], color: 'base', scroll: 6, duration: 1 }),
  v('crack', { kind: 'beam', style: 'zigzag', width: [0.07, 0.02], color: '#555555', amplitude: 0.15, frequency: 6, duration: 0.8 }),
  v('pillar',
    { kind: 'shape', shape: 'circle', fill: true, radius: [0.35, 0.5], alpha: [0.8, 0], duration: 0.5, color: 'base', glow: true },
    { kind: 'particles', count: 16, shape: 'spark', size: [0.12, 0.03], speed: [2, 5], life: [0.3, 0.6], direction: 'up', spread: 30, emit_from: 'area', radius: 0.3, color: 'base', glow: true },
  ),
  v('spiral', { kind: 'shape', shape: 'spiral', radius: [0.2, 1.2], thickness: 0.05, alpha: [1, 0], rotate: 6, duration: 0.6, color: 'base' }),
  v('rays', { kind: 'shape', shape: 'rays', sides: 8, radius: [0.3, 1.1], thickness: 0.05, alpha: [1, 0], duration: 0.35, color: 'base' }),
  v('text', { kind: 'text', text: '!', color: 'base', size: 0.5, duration: 0.9 }),
  v('shake', { kind: 'shake', strength: 0.35, duration: 0.25 }),
  v('mist', {
    kind: 'particles', count: 12, shape: 'soft', size: [0.25, 0.75], alpha: [0.45, 0], speed: [1, 3], life: [0.5, 1.1],
    direction: 'aim', spread: 40, drag: 2, color: 'base',
  }),
  v('heal',
    { kind: 'particles', count: 8, shape: 'triangle', size: [0.1, 0.03], speed: [0.8, 1.6], life: [0.4, 0.7], direction: 'up', spread: 50, emit_from: 'area', radius: 0.3, color: '#85e37d', outline: true },
    { kind: 'shape', shape: 'ring', radius: [0.2, 0.6], thickness: 0.04, alpha: [0.8, 0], duration: 0.4, color: '#85e37d' },
  ),
  v('confetti', {
    kind: 'particles', count: 18, shape: 'square', size: [0.1, 0.06], speed: [2, 5], life: [0.5, 0.9],
    direction: 'radial', spread: 360, gravity: 5, spin: 10, drag: 1, outline: true, color: 'base', color_end: 'tertiary',
  }),
  v('ghost_rise', {
    kind: 'particles', count: 2, shape: 'circle', size: [0.3, 0.45], alpha: [0.5, 0], speed: [0.8, 1.2], life: [0.6, 0.8],
    direction: 'up', spread: 10, color: '#ffffff', outline: true,
  }),
  v('dissolve', {
    kind: 'particles', count: 16, shape: 'square', size: [0.07, 0.01], speed: [0.2, 0.9], life: [0.4, 0.9],
    direction: 'random', emit_from: 'area', radius: 0.25, color: 'base',
  }),
  // ---- continuous (used as auras / status looks / zone fills / emitters)
  v('halo', { kind: 'shape', shape: 'ring', radius: [0.62, 0.62], thickness: 0.05, alpha: [0.5, 0.5], duration: 1, color: 'base', dashed: true, rotate: 0.6 }),
  v('pulse', { kind: 'shape', shape: 'ring', radius: [0.4, 1.0], thickness: 0.05, alpha: [0.6, 0], duration: 1.2, color: 'base' }),
  v('motes', { kind: 'orbiters', count: 5, radius: 0.62, size: 0.07, shape: 'circle', speed: 2, color: 'base', glow: true }),
  v('rotor', { kind: 'shape', shape: 'polygon', sides: 3, radius: [0.7, 0.7], thickness: 0.04, alpha: [0.55, 0.55], rotate: 2, duration: 1, dashed: true, color: 'base' }),
  v('ripples', { kind: 'shape', shape: 'ring', count: 3, radius: [0.3, 1.2], thickness: 0.04, alpha: [0.45, 0], duration: 1.5, color: 'base' }),
  v('flicker', {
    kind: 'particles', rate: 12, shape: 'spark', size: [0.08, 0.02], speed: [0.5, 1.5], life: [0.2, 0.4],
    direction: 'random', emit_from: 'ring', radius: 0.5, glow: true, color: 'base',
  }),
  v('sunrays', { kind: 'shape', shape: 'rays', sides: 12, radius: [0.6, 0.85], thickness: 0.04, alpha: [0.35, 0.35], rotate: 0.8, duration: 1, color: 'base' }),
  v('embers', {
    kind: 'particles', rate: 8, shape: 'square', size: [0.07, 0.02], speed: [0.1, 0.4], life: [0.6, 1.2],
    direction: 'up', gravity: -1.5, emit_from: 'area', radius: 0.45, color: '#ff7a45', color_end: '#ffe45c', glow: true,
  }),
  v('snowfall', {
    kind: 'particles', rate: 6, shape: 'flake', size: [0.1, 0.05], speed: [0.1, 0.3], life: [0.8, 1.4],
    direction: 'down', gravity: 0.4, spin: 2, emit_from: 'area', radius: 0.5, color: '#e8fbff', outline: true,
  }),
  v('bubbles', {
    kind: 'particles', rate: 5, shape: 'bubble', size: [0.05, 0.12], speed: [0.1, 0.3], life: [0.6, 1.1],
    direction: 'up', gravity: -1, emit_from: 'area', radius: 0.45, color: 'base', outline: true,
  }),
  v('static', {
    kind: 'particles', rate: 10, shape: 'spark', size: [0.1, 0.03], speed: [2, 4], life: [0.05, 0.12],
    direction: 'random', emit_from: 'ring', radius: 0.5, glow: true, color: '#ffe45c',
  }),
  v('smoke', {
    kind: 'particles', rate: 5, shape: 'smoke', size: [0.2, 0.6], alpha: [0.4, 0], speed: [0.1, 0.4], life: [0.8, 1.4],
    direction: 'up', gravity: -0.5, color: '#888888',
  }),
  v('stars', {
    kind: 'particles', rate: 4, shape: 'star', size: [0.12, 0.02], speed: [0.2, 0.6], life: [0.5, 0.9],
    direction: 'random', emit_from: 'area', radius: 0.5, spin: 3, glow: true, color: 'base',
  }),
  v('petals', {
    kind: 'particles', rate: 5, shape: 'petal', size: [0.12, 0.08], speed: [0.3, 0.8], life: [0.8, 1.4],
    direction: 'random', gravity: 0.6, spin: 3, emit_from: 'area', radius: 0.5, color: 'base', outline: true,
  }),
  v('drip', {
    kind: 'particles', rate: 4, shape: 'drop', size: [0.08, 0.05], speed: [0.2, 0.4], life: [0.4, 0.7],
    direction: 'down', gravity: 3, emit_from: 'area', radius: 0.25, color: 'base', outline: true,
  }),
  v('vortex',
    { kind: 'shape', shape: 'spiral', radius: [0.9, 0.9], thickness: 0.05, alpha: [0.45, 0.45], rotate: -4, duration: 1, color: 'base' },
    { kind: 'particles', rate: 10, shape: 'circle', size: [0.06, 0.02], speed: [0.8, 1.4], life: [0.4, 0.6], direction: 'inward', emit_from: 'ring', radius: 0.9, color: 'base' },
  ),
];

export const BUILTIN_VFX = new Map(BUILTIN_VFX_LIST.map((d) => [d.id, d]));
export const BUILTIN_VFX_IDS = BUILTIN_VFX_LIST.map((d) => d.id);
