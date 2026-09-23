// Hand-written example fusions shown to the LLM. They are the single biggest
// lever on output quality, so each one demonstrates: a clear concept, the
// base power leading, the secondary reshaping it, a custom noun, a payoff
// moment, and visuals that look like the concept. Two examples that do not
// share powers or tower with the request are rotated into each prompt.
// Every example is validated and linted by the test suite.

import type { FusionSpec } from '../../effects/types.ts';

export interface PairExample {
  tower: string;
  powers: [string, string];
  spec: FusionSpec;
}

export const PAIR_EXAMPLES: PairExample[] = [
  {
    tower: 'arc',
    powers: ['frost', 'echo'],
    spec: {
      dsl: 1,
      concept: 'Frozen enemies become bells. Striking one makes every other bell in range ring with a delayed echo of the hit; shattering one tolls all the others twice. Each bell made this wave makes the final peal louder.',
      name: 'Glacial Carillon',
      flavor: 'Every frozen heart is a bell waiting to be struck.',
      vars: [{ id: 'toll', max: 12, reset: 'wave_start' }],
      statuses: [{
        id: 'bellfrost', name: 'Bellfrost', duration: 2.5, speed_mult: 0.35,
        on_expire: [
          { action: 'damage', to: 'target', amount: { mul: [{ dmg: 0.15 }, { var: 'toll' }] }, type: 'frost' },
          { action: 'vfx', effect: 'bell_toll', at: 'target', size: 0.8 },
        ],
        tint: 'base', icon: 'bell', overlay: 'shell', scale: 1.1, vfx: 'rime_glint',
      }],
      vfx: [
        {
          id: 'bell_toll', layers: [
            { kind: 'shape', shape: 'ring', count: 3, radius: [0.2, 1.4], thickness: 0.06, color: 'base', alpha: [1, 0], duration: 0.6 },
            { kind: 'particles', count: 10, shape: 'flake', direction: 'radial', speed: [1.5, 3.5], life: [0.3, 0.6], size: [0.12, 0.03], spin: 5, color: '#ffffff', outline: true },
          ],
        },
        { id: 'rime_glint', layers: [{ kind: 'orbiters', count: 3, radius: 0.45, size: 0.06, shape: 'star', color: '#ffffff', speed: 3, glow: true }] },
      ],
      rules: [
        { when: { event: 'on_hit' }, do: [{ action: 'apply_status', to: 'target', status: 'chill' }] },
        {
          when: { event: 'on_hit' }, if: [{ check: 'target_has_status', status: 'chill', min_stacks: 3 }],
          do: [
            { action: 'apply_status', to: 'target', status: 'bellfrost' },
            { action: 'remove_status', to: 'target', status: 'chill' },
            { action: 'add_var', var: 'toll', amount: 1 },
          ],
        },
        {
          when: { event: 'on_hit' }, if: [{ check: 'target_has_status', status: 'bellfrost' }, { check: 'cooldown', seconds: 0.5 }],
          do: [
            { action: 'damage', to: { select: 'with_status', status: 'bellfrost' }, amount: { dmg: 0.4 }, type: 'frost', delay: 0.3 },
            { action: 'vfx', effect: 'bell_toll', at: 'target', delay: 0.3 },
            { action: 'sound', preset: 'chime', pitch: 1.3, delay: 0.3 },
          ],
        },
        {
          when: { event: 'on_kill' }, if: [{ check: 'target_has_status', status: 'bellfrost' }],
          do: [
            { action: 'damage', to: { select: 'with_status', status: 'bellfrost' }, amount: { dmg: 0.5 }, type: 'frost', repeat: { times: 2, every: 0.4 } },
            { action: 'vfx', effect: 'bell_toll', at: 'point', size: 1.4 },
          ],
        },
      ],
      visual: {
        aura: 'snowfall', kill: 'shatter', impact: 'sparks',
        beam: { style: 'lightning', width: [0.12, 0.05], color: 'base', core: '#ffffff', glow: true, amplitude: 0.18 },
      },
      sound: { preset: 'zap', pitch: 1.3 },
    },
  },
  {
    tower: 'flame',
    powers: ['venom', 'gravity'],
    spec: {
      dsl: 1,
      concept: 'The flamethrower becomes a mist sprayer of green toxin. Enemies soaked in enough poison collapse into a swirling miasma well that drags the crowd in and keeps poisoning everything inside.',
      name: 'Miasma Maelstrom',
      flavor: 'Breathe in. Now come closer.',
      zones: [{
        id: 'well', shape: 'circle', radius: 1.1, duration: 2.5, speed_mult: 0.8,
        tick: { every: 0.5, do: [
          { action: 'apply_status', to: 'target', status: 'poison' },
          { action: 'pull', to: 'target', toward: 'point', strength: 0.15 },
        ] },
        style: 'vortex', color: 'base', vfx: 'miasma_swirl',
      }],
      vfx: [
        {
          id: 'miasma_swirl', layers: [
            { kind: 'particles', rate: 14, shape: 'soft', size: [0.35, 0.8], alpha: [0.35, 0], speed: [0.6, 1.2], life: [0.6, 1.0], direction: 'inward', emit_from: 'ring', radius: 1.1, color: 'base', color_end: 'secondary' },
            { kind: 'shape', shape: 'spiral', radius: [1.0, 1.0], thickness: 0.05, alpha: [0.5, 0.5], rotate: -5, duration: 1, color: 'secondary' },
          ],
        },
        {
          id: 'gas_pop', layers: [
            { kind: 'particles', count: 16, shape: 'bubble', direction: 'radial', speed: [1, 2.5], life: [0.4, 0.8], size: [0.08, 0.18], color: 'base', outline: true },
            { kind: 'shape', shape: 'circle', fill: true, radius: [0.3, 1.2], alpha: [0.45, 0], duration: 0.5, color: 'base' },
          ],
        },
      ],
      rules: [
        { when: { event: 'on_hit' }, do: [{ action: 'apply_status', to: 'target', status: 'poison' }] },
        {
          when: { event: 'on_hit' }, if: [{ check: 'target_has_status', status: 'poison', min_stacks: 6 }, { check: 'cooldown', seconds: 4 }],
          do: [
            { action: 'create_zone', zone: 'well', at: 'target' },
            { action: 'vfx', effect: 'gas_pop', at: 'target' },
            { action: 'sound', preset: 'warble', pitch: 0.7 },
          ],
        },
        {
          when: { event: 'on_kill' }, if: [{ check: 'target_has_status', status: 'poison' }],
          do: [{ action: 'explode', at: 'point', radius: 1, amount: { mul: [{ dmg: 0.1 }, { stacks: 'poison' }] }, type: 'toxic', vfx: 'gas_pop' }],
        },
      ],
      visual: {
        spray: { shape: 'soft', rate: 45, color: 'base', color_end: '#e8ffe0', size: [0.18, 0.7], alpha: [0.55, 0], speed: [2.5, 4], life: [0.35, 0.7], spread: 30, drag: 2 },
        aura: 'bubbles', kill: 'dissolve', body: 'core',
      },
      sound: { preset: 'hiss', pitch: 0.8 },
    },
  },
  {
    tower: 'rail',
    powers: ['radiance', 'executioner'],
    spec: {
      dsl: 1,
      concept: 'Each rail shot is a sunbeam that brands everything it passes through. Branded enemies that fall low are judged: a pillar of light executes them and brands their neighbours.',
      name: 'Solar Verdict',
      flavor: 'The sun does not miss, and it does not forgive.',
      statuses: [{
        id: 'sunbrand', name: 'Sunbrand', duration: 5, damage_taken_mult: 1.2,
        tint: 'base', icon: 'eye', overlay: 'glow', vfx: 'brand_halo',
      }],
      vfx: [
        { id: 'brand_halo', layers: [{ kind: 'shape', shape: 'ring', radius: [0.42, 0.42], thickness: 0.04, color: 'base', alpha: [0.8, 0.8], rotate: 2, duration: 1, dashed: true }] },
        {
          id: 'judgement', layers: [
            { kind: 'shape', shape: 'circle', fill: true, radius: [0.3, 0.6], alpha: [0.9, 0], duration: 0.5, color: 'base', glow: true },
            { kind: 'shape', shape: 'rays', sides: 10, radius: [0.4, 1.6], thickness: 0.06, alpha: [1, 0], duration: 0.45, color: '#ffffff' },
            { kind: 'particles', count: 20, shape: 'spark', direction: 'up', spread: 25, speed: [3, 7], life: [0.3, 0.6], size: [0.14, 0.03], emit_from: 'area', radius: 0.3, color: 'base', glow: true },
            { kind: 'shake', strength: 0.15, duration: 0.15 },
          ],
        },
      ],
      rules: [
        { when: { event: 'on_hit' }, do: [{ action: 'apply_status', to: 'target', status: 'sunbrand' }] },
        {
          when: { event: 'on_hit' }, if: [{ check: 'target_has_status', status: 'sunbrand' }, { check: 'target_hp_below', pct: 25 }],
          do: [
            { action: 'execute', to: 'target', below_pct: 25 },
            { action: 'explode', at: 'target', radius: 1.3, amount: { dmg: 0.5 }, type: 'arcane', vfx: 'judgement' },
            { action: 'apply_status', to: { select: 'all_in_radius', radius: 1.3 }, status: 'sunbrand' },
          ],
        },
        {
          when: { event: 'every', seconds: 4 },
          do: [{ action: 'reveal', to: 'all_in_range', duration: 4 }, { action: 'vfx', effect: 'brand_halo', at: 'self', size: 2 }],
        },
      ],
      visual: {
        beam: { style: 'solid', width: [0.3, 0.12], color: 'base', core: '#ffffff', glow: true, pulse: 0.3, duration: 0.3 },
        muzzle: 'flash', aura: 'sunrays', kill: 'pillar', body: 'eye',
      },
      sound: { preset: 'laser', pitch: 0.8 },
    },
  },
  {
    tower: 'mortar',
    powers: ['tide', 'rain'],
    spec: {
      dsl: 1,
      concept: 'Mortar shells land as crashing waves that shove the crowd back down the path. Every fourth shell summons a monsoon: raindrops fall around the impact and each drop washes enemies back again.',
      name: 'Monsoon Barrage',
      flavor: 'Forecast: heavy, with a chance of retreat.',
      projectiles: [{
        id: 'raindrop', motion: 'sky_drop', splash: 0.6, amount: { dmg: 0.35 }, type: 'frost',
        on_hit: [{ action: 'knockback', to: 'target', distance: 0.25 }],
        look: { shape: 'orb', color: 'secondary', glow: true, size: 1.2 }, impact: 'wave_crash',
      }],
      vfx: [
        {
          id: 'wave_crash', layers: [
            { kind: 'shape', shape: 'ring', count: 2, radius: [0.2, 1.4], thickness: 0.1, alpha: [0.9, 0], duration: 0.5, color: 'base' },
            { kind: 'particles', count: 18, shape: 'drop', direction: 'radial', speed: [2, 5], life: [0.3, 0.6], size: [0.12, 0.04], gravity: 6, color: 'base', color_end: '#ffffff', outline: true },
          ],
        },
        {
          id: 'stormcloud', layers: [
            { kind: 'particles', count: 10, shape: 'smoke', direction: 'random', speed: [0.2, 0.6], life: [0.8, 1.4], size: [0.5, 0.9], alpha: [0.5, 0], emit_from: 'area', radius: 1.2, color: '#8a9bb0' },
          ],
        },
      ],
      rules: [
        { when: { event: 'on_hit' }, if: [{ check: 'chance', p: 0.6 }], do: [{ action: 'knockback', to: 'target', distance: 0.5 }] },
        {
          when: { event: 'every_nth_attack', n: 4 },
          do: [
            { action: 'vfx', effect: 'stormcloud', at: 'target' },
            { action: 'fire_projectile', projectile: 'raindrop', from: 'target', aim: 'random', count: 5, spread: 360, delay: 0.8 },
            { action: 'sound', preset: 'whoosh', pitch: 0.7 },
          ],
        },
      ],
      visual: { impact: 'wave_crash', projectile: { shape: 'orb', trail: 'dots', trail_color: 'secondary' }, aura: 'ripples' },
      sound: { preset: 'thud', pitch: 0.9 },
    },
  },
];

export const TRIPLE_EXAMPLE: { tower: string; powers: [string, string, string]; spec: FusionSpec } = {
  tower: 'arc',
  powers: ['frost', 'echo', 'storm'],
  spec: {
    ...PAIR_EXAMPLES[0].spec,
    concept: 'Frozen enemies become bells that echo every strike to the others. Storm adds the thunder: when a bell thaws it cracks open and hurls lightning at two nearby enemies.',
    name: 'Thunder-Rung Carillon',
    flavor: 'The last note is always thunder.',
    vfx: [
      ...PAIR_EXAMPLES[0].spec.vfx!,
      {
        id: 'thunder_peal', layers: [
          { kind: 'shape', shape: 'star', sides: 5, radius: [0.2, 1.1], thickness: 0.07, color: 'tertiary', alpha: [1, 0], rotate: 4, duration: 0.4, glow: true },
          { kind: 'particles', count: 12, shape: 'spark', direction: 'radial', speed: [4, 8], life: [0.1, 0.3], size: [0.14, 0.04], color: 'tertiary', glow: true },
        ],
      },
    ],
    rules: [
      ...PAIR_EXAMPLES[0].spec.rules,
      {
        when: { event: 'on_status_expired', status: 'bellfrost' },
        do: [
          { action: 'damage', to: { select: 'chain', n: 2, range: 2.2 }, amount: { dmg: 0.4 }, type: 'shock' },
          { action: 'vfx', effect: 'thunder_peal', at: 'target' },
        ],
      },
    ],
    visual: { ...PAIR_EXAMPLES[0].spec.visual, beam: { ...PAIR_EXAMPLES[0].spec.visual!.beam!, core: 'tertiary' } },
  },
};
