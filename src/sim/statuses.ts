// Built-in statuses, expressed with the same runtime shape as custom ones.

import type { StatusDefRT } from './types.ts';

function B(key: string, name: string, o: Partial<StatusDefRT>): StatusDefRT {
  return {
    key, name, builtin: true, stacking: 'refresh', maxStacks: 1, duration: 2,
    speedMult: 1, dmgTakenMult: 1, armorDelta: 0, hardCC: false, reverse: false, storesDamage: 0,
    damagePerTile: null, dot: null, tick: null, onApply: null, onExpire: null, onDeath: null,
    tint: '#ffffff', icon: 'dot', overlay: 'none', scale: 1, vfx: null, owner: null,
    ...o,
  };
}

export const BUILTIN_STATUS_DEFS: Record<string, StatusDefRT> = {
  burn: B('burn', 'Burn', { duration: 3, dot: { amount: { dmg: 0.3 }, type: 'fire' }, tint: '#ff7a45', icon: 'flame', overlay: 'flames' }),
  poison: B('poison', 'Poison', { stacking: 'add', maxStacks: 10, duration: 4, dot: { amount: { dmg: 0.1 }, type: 'toxic' }, tint: '#8be15b', icon: 'drop', overlay: 'bubbles' }),
  chill: B('chill', 'Chill', { stacking: 'add', maxStacks: 4, duration: 2, speedMult: 0.88, tint: '#6fd6ff', icon: 'diamond' }),
  freeze: B('freeze', 'Freeze', { duration: 1, hardCC: true, tint: '#bfefff', icon: 'diamond', overlay: 'shell' }),
  stun: B('stun', 'Stun', { duration: 0.6, hardCC: true, tint: '#ffe45c', icon: 'star', overlay: 'sparks' }),
  root: B('root', 'Root', { duration: 0.6, hardCC: true, tint: '#8fbc5a', icon: 'cross', overlay: 'chains' }),
  shock: B('shock', 'Shock', { duration: 3, tint: '#ffe45c', icon: 'triangle', overlay: 'sparks' }),
  mark: B('mark', 'Mark', { duration: 4, dmgTakenMult: 1.15, tint: '#fff3a8', icon: 'eye', overlay: 'glow' }),
  weaken: B('weaken', 'Weaken', { stacking: 'add', maxStacks: 5, duration: 5, armorDelta: -2, tint: '#c0a080', icon: 'cross', overlay: 'cracks' }),
  fear: B('fear', 'Fear', { duration: 1, reverse: true, tint: '#d0a0ff', icon: 'skull', overlay: 'shadow' }),
  bleed: B('bleed', 'Bleed', { stacking: 'add', maxStacks: 5, duration: 4, damagePerTile: { dmg: 0.25 }, tint: '#ff4d4d', icon: 'drop', overlay: 'drip' }),
  curse: B('curse', 'Curse', { duration: 6, tint: '#8844aa', icon: 'skull', overlay: 'shadow' }),
};

/** Statuses that count as crowd control for immunity / tenacity. */
export function isCC(d: StatusDefRT): boolean {
  return d.hardCC || d.reverse;
}
