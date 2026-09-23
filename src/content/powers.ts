// The 40 powers. Each is a complete spec in the same effect language the LLM
// writes, so a single socketed power never needs the LLM, and the LLM sees
// real examples of how the language is used.

import type { PowerDef } from '../sim/types.ts';
import type { FusionSpec, Rule } from '../effects/types.ts';

type P = Omit<PowerDef, 'spec'> & { spec: Omit<FusionSpec, 'dsl' | 'name'> & { name?: string } };

const onHit = (...r: Rule['do']): Rule => ({ when: { event: 'on_hit' }, do: r });

const RAW: P[] = [
  // ------------------------------------------------------------ Elements
  {
    id: 'ember', name: 'Ember', family: 'elements', color: '#ff7a45', icon: 'Em', tags: ['fire', 'dot', 'burn'],
    blurb: 'Hits set enemies on fire (Burn).', adj: 'Smoldering', noun: 'Cinder',
    spec: {
      concept: 'Every hit sets the enemy on fire.', flavor: 'Everything burns eventually.',
      rules: [onHit({ action: 'apply_status', to: 'target', status: 'burn' })],
      visual: { aura: 'embers', impact: 'burst', projectile: { trail: 'ribbon', trail_color: '#ffe45c' } },
      sound: { preset: 'hiss', pitch: 1.1 },
    },
  },
  {
    id: 'frost', name: 'Frost', family: 'elements', color: '#6fd6ff', icon: 'Fr', tags: ['cold', 'slow', 'freeze'],
    blurb: 'Hits Chill. At 4 Chill stacks the enemy Freezes.', adj: 'Frozen', noun: 'Rime',
    spec: {
      concept: 'Hits chill; enough chill freezes solid.', flavor: 'Slow, slower, still.',
      rules: [
        onHit({ action: 'apply_status', to: 'target', status: 'chill' }),
        {
          when: { event: 'on_hit' }, if: [{ check: 'target_has_status', status: 'chill', min_stacks: 4 }],
          do: [
            { action: 'apply_status', to: 'target', status: 'freeze', duration: 0.8 },
            { action: 'remove_status', to: 'target', status: 'chill' },
            { action: 'vfx', effect: 'shatter', at: 'target' },
          ],
        },
      ],
      visual: { aura: 'snowfall', impact: 'shatter', projectile: { shape: 'shard' } },
      sound: { preset: 'chime', pitch: 1.4 },
    },
  },
  {
    id: 'storm', name: 'Storm', family: 'elements', color: '#ffe45c', icon: 'St', tags: ['shock', 'chain', 'multi'],
    blurb: 'Hits arc to one more nearby enemy for 60% damage.', adj: 'Crackling', noun: 'Tempest',
    spec: {
      concept: 'Hits leap to a second enemy as lightning.', flavor: 'The sky remembers every target.',
      rules: [onHit({ action: 'damage', to: { select: 'chain', n: 1, range: 2 }, amount: { dmg: 0.6 }, type: 'shock' })],
      visual: { aura: 'static', impact: 'sparks' },
      sound: { preset: 'zap' },
    },
  },
  {
    id: 'venom', name: 'Venom', family: 'elements', color: '#8be15b', icon: 'Ve', tags: ['toxic', 'dot', 'stack'],
    blurb: 'Hits add a stack of Poison (stacks up to 10).', adj: 'Venomous', noun: 'Fang',
    spec: {
      concept: 'Every hit injects stacking poison.', flavor: 'It is not the bite. It is the waiting.',
      rules: [onHit({ action: 'apply_status', to: 'target', status: 'poison' })],
      visual: { aura: 'bubbles', impact: 'splash', projectile: { trail: 'dots' } },
      sound: { preset: 'hiss', pitch: 0.8 },
    },
  },
  {
    id: 'stone', name: 'Stone', family: 'elements', color: '#bba58a', icon: 'So', tags: ['earth', 'stun', 'heavy'],
    blurb: '+50% damage to armored enemies. 10% chance to Stun.', adj: 'Granite', noun: 'Boulder',
    spec: {
      concept: 'Heavy hits that crack armor and sometimes stun.', flavor: 'Mountains do not negotiate.',
      rules: [
        { when: { event: 'on_hit' }, if: [{ check: 'target_is', trait: 'armored' }], do: [{ action: 'damage', to: 'target', amount: { dmg: 0.5 }, type: 'kinetic' }] },
        {
          when: { event: 'on_hit' }, if: [{ check: 'chance', p: 0.1 }],
          do: [{ action: 'apply_status', to: 'target', status: 'stun', duration: 0.5 }, { action: 'vfx', effect: 'shatter', at: 'target' }],
        },
      ],
      visual: { body: 'shell', impact: 'shatter', projectile: { shape: 'square', size: 1.2 } },
      sound: { preset: 'thud' },
    },
  },
  {
    id: 'tide', name: 'Tide', family: 'elements', color: '#4fa0ff', icon: 'Ti', tags: ['water', 'pushback', 'flow'],
    blurb: '35% chance on hit to push the enemy back along the path.', adj: 'Surging', noun: 'Tide',
    spec: {
      concept: 'Hits wash enemies back the way they came.', flavor: 'The shore always wins.',
      rules: [{
        when: { event: 'on_hit' }, if: [{ check: 'chance', p: 0.35 }],
        do: [{ action: 'knockback', to: 'target', distance: 0.4 }, { action: 'vfx', effect: 'splash', at: 'target' }],
      }],
      visual: { aura: 'ripples', projectile: { trail: 'ribbon' } },
      sound: { preset: 'whoosh' },
    },
  },
  {
    id: 'radiance', name: 'Radiance', family: 'elements', color: '#fff3a8', icon: 'Ra', tags: ['light', 'mark', 'reveal'],
    blurb: 'Hits Mark enemies: +15% damage taken from everything, and stealth revealed.', adj: 'Radiant', noun: 'Dawn',
    spec: {
      concept: 'Light that marks enemies for everyone.', flavor: 'Nothing hides at noon.',
      rules: [onHit({ action: 'apply_status', to: 'target', status: 'mark' })],
      visual: { aura: 'sunrays', impact: 'rays', projectile: { glow: true } },
      sound: { preset: 'chime' },
    },
  },
  {
    id: 'void', name: 'Void', family: 'elements', color: '#9466ea', icon: 'Vo', tags: ['void', 'death', 'implode'],
    blurb: 'Enemies it kills implode for 80% arcane damage nearby.', adj: 'Hollow', noun: 'Abyss',
    spec: {
      concept: 'Kills collapse into small black holes.', flavor: 'What falls in stays in.',
      rules: [{ when: { event: 'on_kill' }, do: [{ action: 'explode', at: 'point', radius: 1.2, amount: { dmg: 0.8 }, type: 'arcane', vfx: 'implode' }] }],
      visual: { aura: 'vortex', kill: 'implode' },
      sound: { preset: 'warble', pitch: 0.7 },
    },
  },
  // ------------------------------------------------------------ Forms
  {
    id: 'split', name: 'Split', family: 'forms', color: '#ff9ecf', icon: 'Sp', tags: ['multi', 'spread'],
    blurb: 'Every attack also fires 2 homing bullets (50% damage).', adj: 'Forked', noun: 'Fork',
    spec: {
      concept: 'Each attack splinters into extra shots.', flavor: 'Why choose one target?',
      rules: [{ when: { event: 'on_attack' }, do: [{ action: 'fire_projectile', projectile: 'bullet', aim: 'target', count: 2, spread: 50 }] }],
      visual: { muzzle: 'puff' },
    },
  },
  {
    id: 'pierce', name: 'Pierce', family: 'forms', color: '#c8c8c8', icon: 'Pi', tags: ['line', 'pierce'],
    blurb: 'Projectiles pass through 2 more enemies. Every 3rd hit deals +25%.', adj: 'Piercing', noun: 'Lance',
    spec: {
      concept: 'Shots punch clean through.', flavor: 'In one side, out the other, into the next.',
      stats: { pierce: 2 },
      rules: [{ when: { event: 'on_hit' }, if: [{ check: 'every_nth', n: 3 }], do: [{ action: 'damage', to: 'target', amount: { dmg: 0.25 } }] }],
      visual: { projectile: { shape: 'needle', trail: 'line' } },
    },
  },
  {
    id: 'ricochet', name: 'Ricochet', family: 'forms', color: '#9fe6a0', icon: 'Rc', tags: ['bounce', 'chain'],
    blurb: '50% chance on hit to bounce a bullet to another enemy.', adj: 'Ricocheting', noun: 'Carom',
    spec: {
      concept: 'Hits bounce off toward the next enemy.', flavor: 'Physics, but rude.',
      rules: [{
        when: { event: 'on_hit' }, if: [{ check: 'chance', p: 0.5 }],
        do: [{ action: 'fire_projectile', projectile: 'bullet', from: 'target', aim: 'nearest_other' }],
      }],
      visual: { impact: 'sparks' },
    },
  },
  {
    id: 'boomerang', name: 'Boomerang', family: 'forms', color: '#ffc36b', icon: 'Bo', tags: ['return', 'loop'],
    blurb: 'Every 2nd attack throws a boomerang that hits on the way out and back.', adj: 'Returning', noun: 'Crescent',
    spec: {
      concept: 'Blades that fly out and come home.', flavor: 'It always comes back. Usually.',
      projectiles: [{
        id: 'rang', motion: 'boomerang', speed: 8, lifetime: 2, pierce: 10, amount: { dmg: 0.6 },
        look: { shape: 'crescent', spin: true, trail: 'ghost' },
      }],
      rules: [{ when: { event: 'every_nth_attack', n: 2 }, do: [{ action: 'fire_projectile', projectile: 'rang', aim: 'target' }] }],
      sound: { preset: 'whoosh', pitch: 1.3 },
    },
  },
  {
    id: 'orbit', name: 'Orbit', family: 'forms', color: '#8fb8ff', icon: 'Or', tags: ['orbit', 'persistent'],
    blurb: 'Keeps glowing orbs circling the tower, hitting what they touch.', adj: 'Orbiting', noun: 'Satellite',
    spec: {
      concept: 'Moons circle the tower and grind enemies.', flavor: 'Gravity with opinions.',
      projectiles: [{
        id: 'moon', motion: 'orbit', speed: 3, lifetime: 12, pierce: 10, amount: { dmg: 0.5 },
        look: { shape: 'orb', glow: true, trail: 'ghost' },
      }],
      rules: [
        { when: { event: 'on_wave_start' }, do: [{ action: 'fire_projectile', projectile: 'moon', from: 'self', aim: 'random', count: 2, spread: 360 }] },
        { when: { event: 'every', seconds: 6 }, do: [{ action: 'fire_projectile', projectile: 'moon', from: 'self', aim: 'random' }] },
      ],
      visual: { aura: 'halo' },
    },
  },
  {
    id: 'cluster', name: 'Cluster', family: 'forms', color: '#ff8f6b', icon: 'Cl', tags: ['burst', 'spawn'],
    blurb: 'Every 2nd hit scatters 3 bomblets around the target.', adj: 'Scattering', noun: 'Cluster',
    spec: {
      concept: 'Impacts burst into little bombs.', flavor: 'One became three became trouble.',
      projectiles: [{
        id: 'bomblet', motion: 'lob', speed: 5, lifetime: 1.2, splash: 0.6, amount: { dmg: 0.35 },
        look: { shape: 'circle', size: 0.7 }, impact: 'pop',
      }],
      rules: [{
        when: { event: 'on_hit' }, if: [{ check: 'every_nth', n: 2 }],
        do: [{ action: 'fire_projectile', projectile: 'bomblet', from: 'target', aim: 'random', count: 3, spread: 360 }],
      }],
    },
  },
  {
    id: 'nova', name: 'Nova', family: 'forms', color: '#ffe08a', icon: 'No', tags: ['ring', 'pulse', 'area'],
    blurb: 'Every 4th attack releases a pulse around the tower (80% damage).', adj: 'Blazing', noun: 'Nova',
    spec: {
      concept: 'The tower periodically erupts in a ring of force.', flavor: 'Personal space, enforced.',
      rules: [{ when: { event: 'every_nth_attack', n: 4 }, do: [{ action: 'explode', at: 'self', radius: 1.8, amount: { dmg: 0.8 }, vfx: 'shockwave' }] }],
      visual: { aura: 'pulse' },
      sound: { preset: 'boom', pitch: 1.3 },
    },
  },
  {
    id: 'rain', name: 'Rain', family: 'forms', color: '#9ad7ff', icon: 'Rn', tags: ['sky', 'random', 'area'],
    blurb: 'Every 2.5 s, two strikes fall from the sky on enemies in range (120% damage).', adj: 'Falling', noun: 'Deluge',
    spec: {
      concept: 'Strikes rain down from above.', flavor: 'Look up. Too late.',
      projectiles: [{
        id: 'drop', motion: 'sky_drop', splash: 0.7, amount: { dmg: 1.2 },
        look: { shape: 'orb', glow: true }, impact: 'splash',
      }],
      rules: [{ when: { event: 'every', seconds: 2.5 }, do: [{ action: 'fire_projectile', projectile: 'drop', aim: 'random', count: 2 }] }],
    },
  },
  // ------------------------------------------------------------ Tempo
  {
    id: 'haste', name: 'Haste', family: 'tempo', color: '#7dffb0', icon: 'Ha', tags: ['speed'],
    blurb: '+30% attack speed. Kills give +15% more for 2 s.', adj: 'Hasty', noun: 'Rush',
    spec: {
      concept: 'Faster, and faster still after a kill.', flavor: 'Blink and you missed it.',
      stats: { rate_mult: 1.3 },
      rules: [{ when: { event: 'on_kill' }, do: [{ action: 'modify_tower', to: 'self', stat: 'rate', mult: 1.15, duration: 2 }] }],
      visual: { aura: 'motes', muzzle: 'sparks' },
    },
  },
  {
    id: 'echo', name: 'Echo', family: 'tempo', color: '#b0a0ff', icon: 'Ec', tags: ['repeat', 'delay'],
    blurb: 'Every attack repeats 0.4 s later at 50% damage.', adj: 'Echoing', noun: 'Echo',
    spec: {
      concept: 'Every attack happens twice.', flavor: 'Once more, with feeling.',
      rules: [{ when: { event: 'on_attack' }, do: [{ action: 'repeat_attack', mult: 0.5, delay: 0.4 }] }],
      visual: { muzzle: 'ring', aura: 'ripples' },
    },
  },
  {
    id: 'overcharge', name: 'Overcharge', family: 'tempo', color: '#ffef5c', icon: 'Oc', tags: ['nth', 'burst'],
    blurb: 'Every 5th attack also deals +200% damage to its target.', adj: 'Overcharged', noun: 'Surge',
    spec: {
      concept: 'Power builds up and discharges on every fifth attack.', flavor: 'Warning: capacitor full.',
      rules: [{
        when: { event: 'every_nth_attack', n: 5 },
        do: [
          { action: 'damage', to: 'target', amount: { dmg: 2 } },
          { action: 'vfx', effect: 'flash', at: 'target' },
          { action: 'sound', preset: 'boom', pitch: 1.5 },
        ],
      }],
      visual: { aura: 'static' },
    },
  },
  {
    id: 'momentum', name: 'Momentum', family: 'tempo', color: '#ff9d5c', icon: 'Mo', tags: ['ramp', 'sustain'],
    blurb: 'Attack speed ramps up while firing nonstop (+35% at 10 attacks, +80% at 20); resets when idle.', adj: 'Relentless', noun: 'Momentum',
    spec: {
      concept: 'The longer it fires, the faster it gets.', flavor: 'An object in motion stays furious.',
      vars: [{ id: 'heat', max: 20, reset: 'idle' }],
      rules: [
        { when: { event: 'on_attack' }, do: [{ action: 'add_var', var: 'heat', amount: 1 }] },
        { when: { event: 'on_attack' }, if: [{ check: 'var_at_least', var: 'heat', value: 10 }], do: [{ action: 'modify_tower', to: 'self', stat: 'rate', mult: 1.35, duration: 1 }] },
        { when: { event: 'on_attack' }, if: [{ check: 'var_at_least', var: 'heat', value: 20 }], do: [{ action: 'modify_tower', to: 'self', stat: 'rate', mult: 1.35, duration: 1 }] },
      ],
      visual: { aura: 'rotor' },
    },
  },
  {
    id: 'patience', name: 'Patience', family: 'tempo', color: '#9fd0ff', icon: 'Pa', tags: ['charge', 'idle', 'burst'],
    blurb: 'After 2 s without attacking, its next attack deals +300% damage.', adj: 'Patient', noun: 'Vigil',
    spec: {
      concept: 'Waits, gathers, strikes.', flavor: 'The first shot is the one that counts.',
      vars: [{ id: 'charge', max: 1 }],
      rules: [
        { when: { event: 'on_idle', seconds: 2 }, do: [{ action: 'set_var', var: 'charge', value: 1 }, { action: 'vfx', effect: 'glyph', at: 'self' }] },
        {
          when: { event: 'on_attack' }, if: [{ check: 'var_at_least', var: 'charge', value: 1 }],
          do: [
            { action: 'damage', to: 'target', amount: { dmg: 3 } },
            { action: 'set_var', var: 'charge', value: 0 },
            { action: 'vfx', effect: 'pillar', at: 'target' },
          ],
        },
      ],
      visual: { aura: 'halo' },
    },
  },
  {
    id: 'stasis', name: 'Stasis', family: 'tempo', color: '#a0f0ff', icon: 'Sx', tags: ['time', 'store', 'burst'],
    blurb: '8% chance to freeze an enemy in time; half the damage it takes is stored and released doubled.', adj: 'Timeless', noun: 'Stasis',
    spec: {
      concept: 'Freezes enemies in time and bills them later.', flavor: 'Time is a debt.',
      statuses: [{
        id: 'stasis', name: 'Stasis', duration: 1.2, hard_cc: true, stores_damage: 0.5,
        on_expire: [{ action: 'damage', to: 'target', amount: { add: [{ dmg: 0.3 }, { mul: [{ stored: true }, 2] }] } }, { action: 'vfx', effect: 'shatter', at: 'target' }],
        tint: '#a0f0ff', overlay: 'shell', icon: 'spiral',
      }],
      rules: [{ when: { event: 'on_hit' }, if: [{ check: 'chance', p: 0.08 }], do: [{ action: 'apply_status', to: 'target', status: 'stasis' }] }],
      visual: { aura: 'halo' },
    },
  },
  {
    id: 'rewind', name: 'Rewind', family: 'tempo', color: '#d0a0ff', icon: 'Rw', tags: ['time', 'pushback'],
    blurb: '6% chance on hit to send the enemy back to where it was 2 s ago.', adj: 'Rewinding', noun: 'Rewind',
    spec: {
      concept: 'Hits sometimes undo the last two seconds.', flavor: 'Let us try that again.',
      rules: [{
        when: { event: 'on_hit' }, if: [{ check: 'chance', p: 0.06 }],
        do: [{ action: 'rewind_position', to: 'target', seconds: 2 }, { action: 'vfx', effect: 'spiral', at: 'target' }],
      }],
      visual: { aura: 'rotor' },
    },
  },
  {
    id: 'metronome', name: 'Metronome', family: 'tempo', color: '#ffc0e0', icon: 'Me', tags: ['rhythm', 'sync', 'global'],
    blurb: 'Every 2 s, on the shared beat, deals double damage for half a second.', adj: 'Rhythmic', noun: 'Cadence',
    spec: {
      concept: 'Strikes hardest on the beat that every tower shares.', flavor: 'Tick. Tick. Tick. BOOM.',
      rules: [{
        when: { event: 'on_beat', n: 4 },
        do: [{ action: 'modify_tower', to: 'self', stat: 'damage', mult: 2, duration: 0.5 }, { action: 'vfx', effect: 'ring', at: 'self' }],
      }],
      visual: { aura: 'pulse' },
      sound: { preset: 'pluck' },
    },
  },
  // ------------------------------------------------------------ Fortune
  {
    id: 'precision', name: 'Precision', family: 'fortune', color: '#ff5c5c', icon: 'Pr', tags: ['crit', 'luck'],
    blurb: '20% chance to critically hit for 250% damage.', adj: 'Precise', noun: 'Needle',
    spec: {
      concept: 'Finds the weak spot.', flavor: 'Measure twice, shoot once.',
      stats: { crit_chance: 0.2, crit_mult: 2.5 },
      rules: [{ when: { event: 'on_crit' }, do: [{ action: 'vfx', effect: 'sparks', at: 'target' }] }],
      visual: { projectile: { shape: 'needle' } },
    },
  },
  {
    id: 'greed', name: 'Greed', family: 'fortune', color: '#ffd700', icon: 'Gr', tags: ['gold', 'economy'],
    blurb: 'Kills drop +2 gold (capped per wave).', adj: 'Gilded', noun: 'Hoard',
    spec: {
      concept: 'Kills pay extra.', flavor: 'Every square has a price.',
      rules: [{ when: { event: 'on_kill' }, do: [{ action: 'grant_gold', amount: 2 }] }],
      visual: { kill: 'confetti', aura: 'stars' },
      sound: { preset: 'pluck', pitch: 1.6 },
    },
  },
  {
    id: 'executioner', name: 'Executioner', family: 'fortune', color: '#c0392b', icon: 'Ex', tags: ['execute', 'threshold'],
    blurb: 'Instantly kills non-boss enemies below 12% HP.', adj: 'Merciless', noun: 'Verdict',
    spec: {
      concept: 'Finishes off the wounded.', flavor: 'No appeals.',
      rules: [onHit({ action: 'execute', to: 'target', below_pct: 12 })],
      visual: { kill: 'shatter', body: 'spikes' },
    },
  },
  {
    id: 'chaos', name: 'Chaos', family: 'fortune', color: '#ff66ff', icon: 'Ch', tags: ['random', 'status'],
    blurb: 'Hits have a 12% chance each to Burn, Chill, Weaken or Shock.', adj: 'Chaotic', noun: 'Chaos',
    spec: {
      concept: 'Every hit rolls a random curse.', flavor: 'Nobody, least of all the tower, knows what happens next.',
      rules: (['burn', 'chill', 'weaken', 'shock'] as const).map((s) => ({
        when: { event: 'on_hit' as const }, if: [{ check: 'chance' as const, p: 0.12 }],
        do: [{ action: 'apply_status' as const, to: 'target' as const, status: s }],
      })),
      visual: { aura: 'flicker', impact: 'confetti' },
    },
  },
  {
    id: 'gamble', name: 'Gamble', family: 'fortune', color: '#66ffcc', icon: 'Ga', tags: ['random', 'variance'],
    blurb: 'Base damage halved, but every hit adds a random 0-200% bonus.', adj: 'Reckless', noun: 'Wager',
    spec: {
      concept: 'Damage becomes a dice roll.', flavor: 'Double or nothing. Mostly double.',
      stats: { damage_mult: 0.5 },
      rules: [onHit({ action: 'damage', to: 'target', amount: { mul: [{ dmg: 1 }, { random: [0, 2] }] } })],
      visual: { impact: 'sparks' },
    },
  },
  {
    id: 'bounty', name: 'Bounty', family: 'fortune', color: '#ffaa33', icon: 'Bn', tags: ['mark', 'gold', 'grow'],
    blurb: 'Every 5 s marks the strongest enemy in range as Wanted; if it dies: +6 gold and +1% damage forever.', adj: 'Hunting', noun: 'Bounty',
    spec: {
      concept: 'Puts a price on the biggest threat and grows with every trophy.', flavor: 'Dead or alive. Preferably dead.',
      vars: [{ id: 'trophies', max: 50 }],
      statuses: [{
        id: 'wanted', name: 'Wanted', duration: 5, damage_taken_mult: 1.1,
        on_death: [{ action: 'grant_gold', amount: 6 }, { action: 'add_var', var: 'trophies', amount: 1 }, { action: 'vfx', effect: 'confetti', at: 'target' }],
        tint: '#ffaa33', icon: 'eye', overlay: 'glow',
      }],
      rules: [
        { when: { event: 'every', seconds: 5 }, do: [{ action: 'apply_status', to: { select: 'strongest_in_range', n: 1 }, status: 'wanted' }] },
        onHit({ action: 'damage', to: 'target', amount: { mul: [{ dmg: 0.01 }, { var: 'trophies' }] } }),
      ],
    },
  },
  {
    id: 'jinx', name: 'Jinx', family: 'fortune', color: '#8844aa', icon: 'Jx', tags: ['curse', 'amplify'],
    blurb: '20% chance on hit to Curse: the next status the enemy receives is doubled.', adj: 'Cursed', noun: 'Jinx',
    spec: {
      concept: 'Hexes enemies so the next affliction lands twice as hard.', flavor: 'Bad luck is contagious.',
      rules: [{ when: { event: 'on_hit' }, if: [{ check: 'chance', p: 0.2 }], do: [{ action: 'apply_status', to: 'target', status: 'curse' }] }],
      visual: { aura: 'rotor', impact: 'glyph' },
    },
  },
  {
    id: 'jackpot', name: 'Jackpot', family: 'fortune', color: '#44ddff', icon: 'Jp', tags: ['luck', 'extreme'],
    blurb: '1% chance per hit to deal 5000% damage (500% to bosses).', adj: 'Lucky', noun: 'Jackpot',
    spec: {
      concept: 'Tiny chance of an absurd hit.', flavor: 'Someday.',
      rules: [
        {
          when: { event: 'on_hit' }, if: [{ check: 'chance', p: 0.01 }, { check: 'target_is_not', trait: 'boss' }],
          do: [
            { action: 'damage', to: 'target', amount: { dmg: 50 } },
            { action: 'vfx', effect: 'text', at: 'target', text: 'JACKPOT' },
            { action: 'vfx', effect: 'confetti', at: 'target' },
          ],
        },
        {
          when: { event: 'on_hit' }, if: [{ check: 'chance', p: 0.01 }, { check: 'target_is', trait: 'boss' }],
          do: [{ action: 'damage', to: 'target', amount: { dmg: 5 } }, { action: 'vfx', effect: 'text', at: 'target', text: 'JACKPOT' }],
        },
      ],
      visual: { aura: 'stars' },
    },
  },
  // ------------------------------------------------------------ Life & Matter
  {
    id: 'spore', name: 'Spore', family: 'matter', color: '#b5e61d', icon: 'Sr', tags: ['spawn', 'trap', 'toxic'],
    blurb: 'Kills leave a spore mine on the path that bursts for 150% toxic damage and Poisons.', adj: 'Fungal', noun: 'Spore',
    spec: {
      concept: 'The fallen sprout traps for the living.', flavor: 'From every end, a beginning.',
      projectiles: [{
        id: 'sporemine', motion: 'mine', lifetime: 12, splash: 0.8, amount: { dmg: 1.5 }, type: 'toxic',
        on_hit: [{ action: 'apply_status', to: 'target', status: 'poison', stacks: 2 }],
        look: { shape: 'star', size: 1.2 }, impact: 'splash',
      }],
      rules: [{ when: { event: 'on_kill' }, do: [{ action: 'fire_projectile', projectile: 'sporemine', from: 'point', aim: 'random' }] }],
      visual: { aura: 'bubbles' },
    },
  },
  {
    id: 'swarm', name: 'Swarm', family: 'matter', color: '#ffcf40', icon: 'Sw', tags: ['summon', 'seek'],
    blurb: 'Every 5th attack releases a drone that hunts for 6 s.', adj: 'Swarming', noun: 'Hive',
    spec: {
      concept: 'Attacks hatch little hunters.', flavor: 'Many hands make short work.',
      rules: [{ when: { event: 'every_nth_attack', n: 5 }, do: [{ action: 'summon_drone', count: 1, lifetime: 6, damage: { dmg: 0.3 } }] }],
      visual: { aura: 'motes' },
    },
  },
  {
    id: 'gravity', name: 'Gravity', family: 'matter', color: '#6a5acd', icon: 'Gv', tags: ['pull', 'cluster'],
    blurb: 'Hits pull nearby enemies toward the target (0.8 s cooldown).', adj: 'Crushing', noun: 'Singularity',
    spec: {
      concept: 'Hits drag the crowd together.', flavor: 'Come closer.',
      rules: [{
        when: { event: 'on_hit' }, if: [{ check: 'cooldown', seconds: 0.8 }],
        do: [
          { action: 'pull', to: { select: 'all_in_radius', radius: 1.5 }, toward: 'target', strength: 0.5 },
          { action: 'vfx', effect: 'implode', at: 'target' },
        ],
      }],
      visual: { aura: 'vortex' },
    },
  },
  {
    id: 'contagion', name: 'Contagion', family: 'matter', color: '#7cfc00', icon: 'Ct', tags: ['spread', 'death'],
    blurb: 'When an enemy dies in range, its statuses spread to up to 3 enemies nearby.', adj: 'Plagued', noun: 'Plague',
    spec: {
      concept: 'Afflictions jump from the dead to the living.', flavor: 'Share and share alike.',
      rules: [{
        when: { event: 'on_enemy_dies_in_range' },
        do: [{ action: 'spread_statuses', radius: 1.5, max_targets: 3 }, { action: 'vfx', effect: 'burst', at: 'point' }],
      }],
      visual: { aura: 'drip' },
    },
  },
  {
    id: 'siphon', name: 'Siphon', family: 'matter', color: '#ff4d88', icon: 'Si', tags: ['life', 'sustain'],
    blurb: 'Stores the damage it deals; every 2500 restores 1 life (max 1 per wave).', adj: 'Thirsting', noun: 'Siphon',
    spec: {
      concept: 'Drinks from every hit and gives it back to the base.', flavor: 'Waste not.',
      vars: [{ id: 'blood', max: 5000 }],
      rules: [
        onHit({ action: 'add_var', var: 'blood', amount: { dmg: 1 } }),
        {
          when: { event: 'on_var_reached', var: 'blood', value: 2500 },
          do: [{ action: 'restore_life', amount: 1 }, { action: 'set_var', var: 'blood', value: 0 }, { action: 'vfx', effect: 'heal', at: 'self' }],
        },
      ],
      visual: { aura: 'drip', impact: 'pop' },
    },
  },
  {
    id: 'growth', name: 'Growth', family: 'matter', color: '#4caf50', icon: 'Gw', tags: ['grow', 'scaling'],
    blurb: 'Each kill permanently adds +0.5% damage (up to +50%).', adj: 'Blooming', noun: 'Bloom',
    spec: {
      concept: 'Grows stronger with every kill, forever.', flavor: 'Fed well.',
      vars: [{ id: 'growth', max: 100 }],
      rules: [
        { when: { event: 'on_kill' }, do: [{ action: 'add_var', var: 'growth', amount: 1 }] },
        onHit({ action: 'damage', to: 'target', amount: { mul: [{ dmg: 0.005 }, { var: 'growth' }] } }),
      ],
      visual: { aura: 'petals', body: 'petals' },
    },
  },
  {
    id: 'mirror', name: 'Mirror', family: 'matter', color: '#dff6ff', icon: 'Mi', tags: ['mirror', 'duplicate'],
    blurb: 'Every attack also fires a bullet in the opposite direction.', adj: 'Mirrored', noun: 'Reflection',
    spec: {
      concept: 'Each attack has a reflection that shoots backwards.', flavor: 'Two sides to every story.',
      rules: [{ when: { event: 'on_attack' }, do: [{ action: 'fire_projectile', projectile: 'bullet', aim: 'away' }] }],
      visual: { body: 'crystal', muzzle: 'flash' },
    },
  },
  {
    id: 'bramble', name: 'Bramble', family: 'matter', color: '#8fbc5a', icon: 'Br', tags: ['root', 'zone', 'trap'],
    blurb: 'Hits can root briefly and grow thorn patches on the path that slow and cut.', adj: 'Thorned', noun: 'Bramble',
    spec: {
      concept: 'Hits sprout thorns across the path.', flavor: 'The garden bites back.',
      zones: [{
        id: 'thorns', shape: 'path_segment', radius: 0.6, duration: 4, speed_mult: 0.7,
        tick: { every: 0.5, do: [{ action: 'damage', to: 'target', amount: { dmg: 0.15 } }] },
        style: 'hazard', color: 'base',
      }],
      rules: [
        { when: { event: 'on_hit' }, if: [{ check: 'chance', p: 0.25 }, { check: 'cooldown', seconds: 1 }], do: [{ action: 'create_zone', zone: 'thorns', at: 'target' }] },
        { when: { event: 'on_hit' }, if: [{ check: 'chance', p: 0.1 }], do: [{ action: 'apply_status', to: 'target', status: 'root', duration: 0.3 }] },
      ],
      visual: { body: 'spikes' },
    },
  },
];

export const POWERS: PowerDef[] = RAW.map((p) => ({ ...p, spec: { dsl: 1, name: p.name, ...p.spec } as FusionSpec }));
export const POWER_BY_ID = new Map(POWERS.map((p) => [p.id, p]));

export const FAMILIES: Record<PowerDef['family'], string> = {
  elements: 'Elements',
  forms: 'Forms',
  tempo: 'Tempo',
  fortune: 'Fortune',
  matter: 'Life & Matter',
};
