// Card packs. Power cards arrive in packs: a Starter Pack at the beginning,
// a Shape Pack every few waves, a Boss Pack for each boss, and packs you can
// buy with gold between waves. Each slot of a pack has a rarity floor.

export interface PackDef {
  id: 'starter' | 'shape' | 'prism' | 'boss';
  name: string;
  blurb: string;
  /** Minimum rarity of each card slot (0 common .. 3 legendary). */
  floors: number[];
  color: string;
  /** Gold price by wave (null = cannot be bought). */
  price: ((wave: number) => number) | null;
  emblem: 'triangle' | 'square' | 'prism' | 'star';
}

export const PACKS: PackDef[] = [
  { id: 'starter', name: 'Starter Pack', blurb: 'Keep 1 of 3 cards; one is Rare or better.', floors: [0, 0, 1], color: '#8eb2ff', price: null, emblem: 'square' },
  { id: 'shape', name: 'Shape Pack', blurb: 'Keep 1 of 3 cards. Better odds the further you get.', floors: [0, 0, 0], color: '#00b2e1', price: (w) => 90 + 14 * w, emblem: 'triangle' },
  { id: 'prism', name: 'Prism Pack', blurb: 'Keep 1 of 3 cards, every one Rare or better.', floors: [1, 1, 1], color: '#bf7ff5', price: (w) => 240 + 32 * w, emblem: 'prism' },
  { id: 'boss', name: 'Boss Pack', blurb: 'Keep 1 of 4 cards: all Rare or better, one Epic or better.', floors: [1, 1, 1, 2], color: '#ffd166', price: null, emblem: 'star' },
];

export const PACK_BY_ID = new Map(PACKS.map((p) => [p.id, p]));

/** Gold for scrapping a card, by rarity. */
export const SCRAP_VALUE = [15, 40, 100, 250];

/** A Shape Pack is awarded after every Nth wave (bosses give a Boss Pack instead). */
export const PACK_EVERY = 3;
