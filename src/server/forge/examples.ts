// Hand-written example fusions shown to the LLM. They are the single biggest
// lever on output quality, so each one demonstrates what we want from a pair:
// one concrete cause and effect in 2 or 3 rules, the base power leading, the
// secondary reshaping it, a short concept that explains it in play with its
// numbers in braces, a 1-2 word name that says what it does, a few numbers
// that grow with level, and visuals that look like the idea. (`scaling` is
// shown to the model inline as {"lvl": base, "per": step} marks.) Two examples that do not
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
      concept: "Hits chill. At {3} Chill, enemies become Ice Bells ({50%} slower, {2.5}s); a bell's death rings all bells twice for {dmg 0.5}.",
      name: 'Ice Bells',
      flavor: 'Hear that? Ice.',
      statuses: [{
        id: 'bellfrost', name: 'Ice Bell', duration: 2.5, speed_mult: 0.5,
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
          ],
        },
        {
          when: { event: 'on_kill' }, if: [{ check: 'target_has_status', status: 'bellfrost' }],
          do: [
            { action: 'damage', to: { select: 'with_status', status: 'bellfrost' }, amount: { dmg: 0.5 }, type: 'frost', repeat: { times: 2, every: 0.4 } },
            { action: 'vfx', effect: 'bell_toll', at: 'point', size: 1.4 },
            { action: 'sound', preset: 'chime', pitch: 1.3 },
          ],
        },
      ],
      visual: {
        aura: 'snowfall', kill: 'shatter', impact: 'sparks',
        beam: { style: 'lightning', width: [0.12, 0.05], color: 'base', core: '#ffffff', glow: true, amplitude: 0.18 },
      },
      sound: { preset: 'zap', pitch: 1.3 },
      scaling: [{ path: 'statuses[0].duration', per: 0.2 }, { path: 'statuses[0].speed_mult', per: -0.02 }],
    },
  },
  {
    tower: 'flame',
    powers: ['venom', 'gravity'],
    spec: {
      dsl: 1,
      concept: 'Sprays poison. At {6} Poison, an enemy becomes a {1.1}-tile well for {2.5}s that poisons and pulls in everything nearby.',
      name: 'Poison Well',
      flavor: 'Breathe in. Come closer.',
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
      scaling: [{ path: 'zones[0].duration', per: 0.25 }, { path: 'zones[0].radius', per: 0.08 }],
    },
  },
  {
    tower: 'rail',
    powers: ['radiance', 'executioner'],
    spec: {
      dsl: 1,
      concept: 'Shots brand enemies to take {20%} more damage. Branded enemies under {25%} HP are executed in a burst of light for {dmg 0.5}.',
      name: 'Judgment Beam',
      flavor: 'The sun does not forgive.',
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
      scaling: [{ path: 'rules[1].if[1].pct', per: 1 }, { path: 'rules[1].do[0].below_pct', per: 1 }, { path: 'statuses[0].damage_taken_mult', per: 0.02 }],
    },
  },
  {
    tower: 'mortar',
    powers: ['tide', 'rain'],
    spec: {
      dsl: 1,
      concept: 'Shells have a {60%} chance to shove enemies back. Every {4}th shell brings {5} raindrops that push and hit for {dmg 0.35}.',
      name: 'Flood Shells',
      flavor: 'Forecast: retreat.',
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
      scaling: [{ path: 'rules[0].if[0].p', per: 0.02 }, { path: 'rules[1].do[1].count', per: 0.34 }],
    },
  },
];

export const TRIPLE_EXAMPLE: { tower: string; powers: [string, string, string]; spec: FusionSpec } = {
  tower: 'arc',
  powers: ['frost', 'echo', 'storm'],
  spec: {
    ...PAIR_EXAMPLES[0].spec,
    concept: 'Hits chill. At {3} Chill, enemies become Ice Bells ({50%} slower, {2.5}s); when a bell thaws, lightning jumps to {2} others for {dmg 0.4}.',
    name: 'Thunder Bells',
    flavor: 'The last note is thunder.',
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
    scaling: [...PAIR_EXAMPLES[0].spec.scaling!, { path: 'rules[3].do[0].to.n', per: 0.2 }],
  },
};
