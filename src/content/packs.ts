// Card packs. Power cards arrive in packs: a Starter Pack at the beginning,
// a Shape Pack every few waves, a Boss Pack for each boss, and packs you can
// buy with gold between waves. Each slot of a pack has a rarity floor, and
// most packs carry a perk that changes how you draw from them.

import type { PowerDef } from '../sim/types.ts';

export type PackId = 'starter' | 'shape' | 'salvage' | 'family' | 'gambler' | 'prism' | 'twin' | 'boss' | 'crown';

export type PackPerk =
  /** The cards you don't keep are scrapped for gold. */
  | 'salvage'
  /** Every card comes from one power family, shown on the pack. */
  | 'family'
  /** One free reroll of the whole pack before you keep a card. */
  | 'reroll';

export interface PackDef {
  id: PackId;
  name: string;
  blurb: string;
  /** Minimum rarity of each card slot (0 common .. 3 legendary). */
  floors: number[];
  /** Cards you keep (default 1). */
  keep?: number;
  perk?: PackPerk;
  color: string;
  /** Gold price by wave (null = cannot be bought). */
  price: ((wave: number) => number) | null;
  /** First wave it is sold in the Shop. */
  minWave?: number;
  emblem: 'triangle' | 'square' | 'prism' | 'star' | 'gear' | 'family' | 'dice' | 'twin' | 'crown';
  /** How fancy it looks: 0 plain foil, 1 shiny, 2 holographic, 3 radiant. */
  tier: 0 | 1 | 2 | 3;
}

export const PACKS: PackDef[] = [
  {
    id: 'starter', name: 'Starter Pack', blurb: 'Keep 1 of 3 cards; one is Rare or better.',
    floors: [0, 0, 1], color: '#8eb2ff', price: null, emblem: 'square', tier: 0,
  },
  {
    id: 'shape', name: 'Shape Pack', blurb: 'Keep 1 of 3 cards. Better odds the further you get.',
    floors: [0, 0, 0], color: '#00b2e1', price: (w) => 90 + 14 * w, emblem: 'triangle', tier: 0,
  },
  {
    id: 'salvage', name: 'Salvage Pack', blurb: 'Keep 1 of 4 cards. The rest are scrapped for gold.',
    floors: [0, 0, 0, 0], perk: 'salvage', color: '#9aa4b2', price: (w) => 120 + 16 * w, emblem: 'gear', tier: 1,
  },
  {
    id: 'family', name: 'Family Pack', blurb: 'Keep 1 of 4 cards, all from one power family.',
    floors: [0, 0, 0, 1], perk: 'family', color: '#85e37d', price: (w) => 140 + 18 * w, emblem: 'family', tier: 1,
  },
  {
    id: 'gambler', name: 'Gambler Pack', blurb: 'Keep 1 of 3 cards, with one free reroll of the whole pack.',
    floors: [0, 0, 1], perk: 'reroll', color: '#fc7677', price: (w) => 170 + 22 * w, minWave: 3, emblem: 'dice', tier: 1,
  },
  {
    id: 'prism', name: 'Prism Pack', blurb: 'Keep 1 of 3 cards, every one Rare or better.',
    floors: [1, 1, 1], color: '#bf7ff5', price: (w) => 240 + 32 * w, emblem: 'prism', tier: 2,
  },
  {
    id: 'twin', name: 'Twin Pack', blurb: 'Keep 2 of 5 cards.',
    floors: [0, 0, 0, 1, 1], keep: 2, color: '#44ddff', price: (w) => 300 + 36 * w, minWave: 6, emblem: 'twin', tier: 2,
  },
  {
    id: 'boss', name: 'Boss Pack', blurb: 'Keep 1 of 4 cards: all Rare or better, one Epic or better.',
    floors: [1, 1, 1, 2], color: '#ffd166', price: null, emblem: 'star', tier: 2,
  },
  {
    id: 'crown', name: 'Crown Pack', blurb: 'Keep 1 of 3 cards: all Epic or better, one Legendary.',
    floors: [2, 2, 3], color: '#ffc629', price: (w) => 800 + 50 * w, minWave: 15, emblem: 'crown', tier: 3,
  },
];

export const PACK_BY_ID = new Map(PACKS.map((p) => [p.id, p]));

export const FAMILY_ORDER: PowerDef['family'][] = ['elements', 'forms', 'tempo', 'fortune', 'matter'];

/** Gold for scrapping a card, by rarity. */
export const SCRAP_VALUE = [15, 40, 100, 250];

/** A Shape Pack is awarded after every Nth wave (bosses give a Boss Pack instead)... */
export const PACK_EVERY = 3;
/** ...and every this many waves it is a Family Pack instead. */
export const FAMILY_PACK_EVERY = 12;
