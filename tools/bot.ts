// Headless playtest bot: plays campaign maps with a simple greedy strategy
// (build where the path is densest, open packs, socket the best cards, upgrade
// to open sockets) and reports how far it gets. Used to tune the difficulty
// curve. Fusions come from the offline combiner, so no LLM is needed.
//
//   node tools/bot.ts [mapId|all] [difficulty] [seeds]
//   node tools/bot.ts all normal 2

import { fileURLToPath } from 'node:url';
import { World } from '../src/sim/world.ts';
import type { MapDef, Tower, DifficultyDef } from '../src/sim/types.ts';
import { MAPS, MAP_BY_ID } from '../src/content/maps.ts';
import { TOWER_BY_ID } from '../src/content/towers.ts';

/** The bot's build order, cycled. Damage dealers first, support later. */
const ROTATION = ['bolt', 'cannon', 'arc', 'frost', 'rail', 'mortar', 'flame', 'prism', 'hive', 'beacon'];

interface Result {
  map: string;
  seed: number;
  won: boolean;
  wave: number;
  lives: number;
  towers: number;
  fused: number;
  tiers: string;
  hand: number;
  ms: number;
  levels: number;
}

/** Buildable tiles ranked by how much path they cover within 3 tiles. */
function rankTiles(w: World): [number, number][] {
  const pts: [number, number][] = [];
  const out = { x: 0, y: 0, ang: 0 };
  for (const p of w.paths) for (let d = 0; d < p.length; d += 0.5) { p.at(d, out); pts.push([out.x, out.y]); }
  const tiles: { c: number; r: number; score: number }[] = [];
  for (let r = 0; r < w.rows; r++) {
    for (let c = 0; c < w.cols; c++) {
      if (!w.canBuild(c, r)) continue;
      let score = 0;
      for (const [x, y] of pts) if ((x - c - 0.5) ** 2 + (y - r - 0.5) ** 2 < 9) score++;
      if (score) tiles.push({ c, r, score });
    }
  }
  return tiles.sort((a, b) => b.score - a.score).map((t) => [t.c, t.r]);
}

function act(w: World, tiles: [number, number][], state: { next: number }): void {
  // Open every pack and keep its rarest card, preferring a power not already held.
  while (w.packs.length || w.offer) {
    const offered = w.offer?.cards ?? w.openPack(w.packs[0].uid);
    if (typeof offered === 'string') break;
    const held = new Set(w.cards.map((c) => c.power));
    const best = [...offered].sort((a, b) => b.rarity - a.rarity || Number(held.has(a.power)) - Number(held.has(b.power)))[0];
    w.pickCard(best.uid);
  }
  // Keep a small hand of the best cards and scrap the rest for gold.
  const keep = Math.max(3, w.towers.length);
  if (w.cards.length > keep) {
    const spare = [...w.cards].sort((a, b) => a.rarity - b.rarity).slice(0, w.cards.length - keep);
    for (const c of spare) w.scrapCard(c.uid);
  }
  // Socket the best cards into towers with open sockets, strongest towers first.
  // Past the base socket, keep enough gold for the next tower it still wants.
  const byTier = [...w.towers].sort((a, b) => b.tier - a.tier || b.dmgTotal - a.dmgTotal);
  const wantTowers = Math.min(tiles.length, 3 + Math.floor(w.waveN / 3));
  const reserve = w.towers.length < wantTowers ? TOWER_BY_ID.get(ROTATION[state.next % ROTATION.length])!.cost : 0;
  for (const t of byTier) {
    while (w.cards.length && t.sockets.length < t.tier) {
      // The rarest card it can afford right now (rarer cards cost more to socket).
      const keep = t.sockets.length ? reserve : 0;
      const card = [...w.cards].sort((a, b) => b.rarity - a.rarity)
        .find((c) => !w.socketBlocker(t, c.rarity) && w.gold - w.socketCost(t, c.rarity)! >= keep);
      if (!card || w.socket(t.id, card.uid)) break;
    }
  }
  // Then build or upgrade. New towers only once the existing ones have grown,
  // since upgrades are what open sockets for fusions.
  for (let guard = 0; guard < 20; guard++) {
    const avgTier = w.towers.reduce((a, t) => a + t.tier, 0) / Math.max(1, w.towers.length);
    const want = Math.min(tiles.length, 3 + Math.floor(w.waveN / 3));
    const cheapestUp = byTier
      .map((t) => ({ t, cost: w.upgradeCost(t) }))
      .filter((x): x is { t: Tower; cost: number } => x.cost !== null)
      .sort((a, b) => a.cost - b.cost)[0];
    if (w.towers.length < want && (w.towers.length < 3 || avgTier >= 1.8 || !cheapestUp)) {
      const def = TOWER_BY_ID.get(ROTATION[state.next % ROTATION.length])!;
      if (w.gold < def.cost) break;
      const spot = tiles.find(([c, r]) => w.canBuild(c, r));
      if (!spot) break;
      if (typeof w.place(def.id, spot[0], spot[1]) === 'string') break;
      state.next++;
    } else if (cheapestUp && w.gold >= cheapestUp.cost) {
      w.upgrade(cheapestUp.t.id);
    } else break;
  }
  // Spare gold goes into levels once the towers are built out: the busiest
  // towers first, cheapest level first.
  for (let guard = 0; guard < 10; guard++) {
    const avgTier = w.towers.reduce((a, t) => a + t.tier, 0) / Math.max(1, w.towers.length);
    const want = Math.min(tiles.length, 3 + Math.floor(w.waveN / 3));
    const upgradesLeft = w.towers.some((t) => t.tier < 3);
    if (upgradesLeft && !(w.towers.length >= want && avgTier >= 2.4)) break;
    const pick = [...w.towers].sort((a, b) => b.dmgTotal - a.dmgTotal).slice(0, 4)
      .map((t) => ({ t, cost: w.levelCost(t) }))
      .filter((x): x is { t: Tower; cost: number } => x.cost !== null)
      .sort((a, b) => a.cost - b.cost)[0];
    if (!pick || w.gold < pick.cost) break;
    w.levelUp(pick.t.id);
  }
}

export function playMap(map: MapDef, difficulty: DifficultyDef['id'], seed: number): Result {
  const t0 = Date.now();
  const w = new World({ map, difficulty, seed, fx: false, autoStart: true });
  const tiles = rankTiles(w);
  const state = { next: 0 };
  act(w, tiles, state);
  w.callWave();
  let tick = 0;
  const lives: number[] = [];
  let lastWave = 0;
  while (w.phase === 'running' && tick < 60 * 60 * 90) {
    w.step();
    tick++;
    if (tick % 120 === 0) act(w, tiles, state);
    if (w.waveN !== lastWave) {
      lives.push(w.lives);
      lastWave = w.waveN;
    }
  }
  if (process.env.BOT_TRACE) {
    const invested = w.towers.reduce((a, t) => a + t.invested + t.socketGold, 0);
    console.log(`  lives at each wave start: ${lives.join(' ')}`);
    console.log(`  gold earned ${Math.round(w.stats.goldEarned)}, in towers ${Math.round(invested)}, unspent ${Math.round(w.gold)}`);
  }
  return {
    map: map.id, seed, won: w.phase === 'victory', wave: w.phase === 'victory' ? w.totalWaves : w.waveN, lives: w.lives,
    towers: w.towers.length, fused: w.towers.filter((t) => t.sockets.length >= 2).length,
    tiers: [1, 2, 3].map((k) => w.towers.filter((t) => t.tier === k).length).join('/'), hand: w.cards.length, ms: Date.now() - t0,
    levels: w.towers.reduce((a, t) => a + t.level - 1, 0),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [which = 'all', diff = 'normal', seedsArg = '1'] = process.argv.slice(2);
  const maps = which === 'all' ? MAPS : [MAP_BY_ID.get(which)].filter((m): m is MapDef => !!m);
  if (!maps.length) {
    console.error(`unknown map "${which}"; try one of: all, ${MAPS.map((m) => m.id).join(', ')}`);
    process.exit(1);
  }
  const seeds = Math.max(1, Number(seedsArg) || 1);
  console.log(`map          seed  result        lives towers t1/t2/t3 fused lvls hand   time`);
  for (const m of maps) {
    for (let s = 1; s <= seeds; s++) {
      const r = playMap(m, diff as DifficultyDef['id'], s * 7919);
      const res = r.won ? `WON ${r.wave}/${m.waves}` : `lost at ${r.wave}/${m.waves}`;
      console.log(`${r.map.padEnd(12)} ${String(s).padStart(4)}  ${res.padEnd(13)} ${String(r.lives).padStart(5)} ${String(r.towers).padStart(6)} ${r.tiers.padStart(8)} ${String(r.fused).padStart(5)} ${String(r.levels).padStart(4)} ${String(r.hand).padStart(4)} ${(r.ms / 1000).toFixed(1).padStart(6)}s`);
    }
  }
}
