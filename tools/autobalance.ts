// The auto-balancer: eases the game until the Strategist can beat it.
//
// For each map, the Strategist plays on the chosen difficulty. When it loses,
// it knows how close it was: the share of the killing wave's HP its defence
// would have held. The balancer eases exactly that:
//
//   - a boss wave: the boss's HP and shield, by that share (with a little margin);
//     if cutting the boss did not help, the leak is its escorts or the shapes it
//     sheds, and the wave's band is eased instead;
//   - any other wave: the toughness of its band of ten waves (TOUGHNESS in
//     src/content/waves.ts), so every shape at that wave has that much less HP
//     (and every later wave with it). The number of shapes, and the bounty they
//     pay, stays the same.
//
// Then the game goes back to an exact save just before the first wave the
// change affects and plays on, until the map is won. After a win it measures
// how much more HP each boss wave could have had; a boss that every map beat
// with room to spare is raised (keeping 15% in hand), so the game ends up
// just beatable rather than comfortable. Maps run in parallel, one
// per core; each ends with its own values, and the easiest of them all is what
// every map can be won with. It prints those, to be written into
// src/content/enemies.ts (boss hp and shield) and src/content/waves.ts
// (TOUGHNESS; GROWTH is printed too, for reference).
//
//   node tools/autobalance.ts [maps] [difficulty] [--jobs 4] [--minutes 40] [--full]
//     maps: a comma list or act1 | act2 | act3 | all (default: act2,act3 samples)
//   It prints a line per wave and per change as it goes. Each map stops after
//   --minutes and reports what it has. The Strategist plays light (fewer
//   candidates per step) unless --full.

import { fork } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ENEMIES, ENEMY_BY_ID, bossFor } from '../src/content/enemies.ts';
import { MAPS, MAP_BY_ID } from '../src/content/maps.ts';
import { GROWTH, TOUGHNESS, growthBand } from '../src/content/waves.ts';
import type { DifficultyDef } from '../src/sim/types.ts';
import { play, type Tuner } from './strategist.ts';

type Diff = DifficultyDef['id'];

interface Values { growth: number[]; toughness: number[]; bosses: Record<string, { hp: number; shield: number }> }

/** Lose at `hold`: ease by a little more than that, and always by at least 5%. */
const ease = (hold: number) => Math.max(0.5, Math.min(0.95, hold * 0.97));

const tuner = (log: string[]): Tuner => {
  // What each boss wave held the last time its boss was cut: if a cut did not
  // help, the leak is its escorts or the shapes it sheds, not the boss itself.
  const lastBossHold = new Map<number, number>();
  return ({ map, wave, hold }) => {
  const f = ease(hold);
  const before = lastBossHold.get(wave);
  const boss = before !== undefined && hold - before < 0.05 ? null : bossFor(map, wave);
  if (boss) {
    lastBossHold.set(wave, hold);
    const d = ENEMY_BY_ID.get(boss)!;
    d.hp = Math.round(d.hp * f);
    d.shield = Math.round(d.shield * f);
    log.push(`wave ${wave}: ${boss} x${f.toFixed(2)} -> ${d.hp} hp, ${d.shield} shield`);
    return { from: wave, note: `${boss} x${f.toFixed(2)}` };
  }
  // Make the band's shapes less tough (not fewer: fewer would also pay less
  // bounty, and the bot would come out weaker). Spread the cut over the band's
  // waves up to this one, so the curve stays smooth.
  const band = growthBand(wave);
  const first = Math.max(2, band * 10 + 1);
  const was = TOUGHNESS[band];
  TOUGHNESS[band] *= Math.pow(f, 1 / (wave - first + 1));
  log.push(`wave ${wave}: toughness of waves ${band * 10 + 1}-${band * 10 + 10} ${was.toFixed(4)} -> ${TOUGHNESS[band].toFixed(4)}`);
  lastBossHold.delete(wave);
  return { from: first, note: `toughness ${band * 10 + 1}-${band * 10 + 10} x${f.toFixed(2)} at wave ${wave}` };
  };
};

const snapshot = (): Values => ({
  growth: [...GROWTH],
  toughness: [...TOUGHNESS],
  bosses: Object.fromEntries(ENEMIES.filter((e) => e.traits.includes('boss')).map((e) => [e.id, { hp: e.hp, shield: e.shield }])),
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name: string, dflt: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args.splice(i, 2)[1] : dflt;
  };
  const jobs = Number(flag('jobs', String(availableParallelism())));
  const minutes = Number(flag('minutes', '40'));
  const pos = args.filter((a) => !a.startsWith('--'));
  if (args.includes('--job')) {
    // A child: balance one map, then report its values.
    const [mapId, diff] = pos;
    const log: string[] = [];
    const t0 = Date.now();
    const say = (l: string) => process.stderr.write(`[${((Date.now() - t0) / 60000).toFixed(0).padStart(3)} min] ${mapId.padEnd(11)} ${l}\n`);
    const r = await play(mapId, diff as Diff, 7919, {
      threads: 1, tries: 0, tune: tuner(log), light: !args.includes('--full'), say, deadline: t0 + minutes * 60000, margins: true,
      trace: args.includes('--trace'),
    });
    say(r.won ? `won with ${r.lives} lives` : `stopped at wave ${r.wave} (time limit)`);
    // Spare room per boss (after a win): the boss's HP could be this many times higher.
    const spare = Object.fromEntries(Object.entries(r.spare ?? {}).map(([n, k]) => [bossFor(MAP_BY_ID.get(mapId)!, Number(n))!, k]));
    if (r.won) say(`spare room at bosses: ${Object.entries(spare).map(([b, k]) => `${b} x${k.toFixed(2)}`).join(', ')}`);
    process.stdout.write(JSON.stringify({ map: mapId, won: r.won, wave: r.wave, lives: r.lives, log, spare, values: snapshot() }) + '\n');
  } else {
    const pick = (a: string) => a === 'all' ? MAPS.map((m) => m.id) : /^act[123]$/.test(a) ? MAPS.filter((m) => m.act === Number(a[3])).map((m) => m.id) : a.split(',').filter((id) => MAP_BY_ID.has(id));
    const maps = pos[0] ? pos[0].split(',').flatMap(pick) : ['fork', 'twinrivers', 'nebula', 'horizon'];
    const diff = (pos[1] ?? 'hard') as Diff;
    const before = snapshot();
    const results: { map: string; won: boolean; wave: number; lives: number; log: string[]; spare?: Record<string, number>; values: Values }[] = [];
    const queue = [...maps].sort((a, b) => MAP_BY_ID.get(b)!.waves - MAP_BY_ID.get(a)!.waves);
    let running = 0;
    console.log(`balancing ${maps.join(', ')} on ${diff}, ${jobs} at a time`);
    const done = () => {
      // The easiest value any map needed is what every map can be won with.
      const out: Values = {
        growth: before.growth.map((g, i) => Math.min(...results.map((r) => r.values.growth[i] ?? g))),
        toughness: before.toughness.map((g, i) => Math.min(...results.map((r) => r.values.toughness?.[i] ?? g))),
        bosses: {},
      };
      for (const [id, v] of Object.entries(before.bosses)) {
        const hp = Math.min(...results.map((r) => r.values.bosses[id]?.hp ?? v.hp));
        const shield = Math.min(...results.map((r) => r.values.bosses[id]?.shield ?? v.shield));
        out.bosses[id] = { hp, shield };
      }
      console.log('\nGROWTH (waves 1-10, 11-20, ...):');
      console.log(`  was  [${before.growth.map((g) => g.toFixed(4)).join(', ')}]`);
      console.log(`  now  [${out.growth.map((g) => g.toFixed(4)).join(', ')}]`);
      console.log('TOUGHNESS (waves 1-10, 11-20, ...):');
      console.log(`  was  [${before.toughness.map((g) => g.toFixed(4)).join(', ')}]`);
      console.log(`  now  [${out.toughness.map((g) => g.toFixed(4)).join(', ')}]`);
      console.log('bosses changed:');
      for (const [id, v] of Object.entries(out.bosses)) {
        const b = before.bosses[id];
        if (v.hp !== b.hp || v.shield !== b.shield) console.log(`  ${id.padEnd(16)} hp ${b.hp} -> ${v.hp}, shield ${b.shield} -> ${v.shield}`);
      }
      // The other way: a boss every map beat with room to spare can take more HP
      // (keeping 15% in hand), unless some map had to ease it.
      const eased = new Set(Object.keys(out.bosses).filter((id) => out.bosses[id].hp !== before.bosses[id].hp));
      const room = new Map<string, number>();
      for (const r of results) for (const [id, k] of Object.entries(r.spare ?? {})) room.set(id, Math.min(room.get(id) ?? Infinity, r.won ? k : 1));
      const harder = [...room].filter(([id, k]) => !eased.has(id) && k / 1.15 > 1.1);
      if (harder.length) {
        console.log('could take more HP (every map that met it beat it with room to spare):');
        for (const [id, k] of harder) {
          const f = Math.min(2, k / 1.15);
          const b = out.bosses[id];
          b.hp = Math.round((b.hp * f) / 100) * 100;
          b.shield = Math.round((b.shield * f) / 100) * 100;
          console.log(`  ${id.padEnd(16)} x${f.toFixed(2)} -> hp ${b.hp}, shield ${b.shield}`);
        }
      }
      console.log(`\n${JSON.stringify(out)}`);
    };
    const next = () => {
      while (running < jobs && queue.length) {
        const m = queue.shift()!;
        running++;
        const child = fork(fileURLToPath(import.meta.url), [m, diff, '--job', '--minutes', String(minutes), ...(args.includes('--full') ? ['--full'] : [])], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
        let text = '';
        child.stdout!.on('data', (b) => { text += b; });
        child.on('exit', () => {
          running--;
          try {
            const r = JSON.parse(text.trim().split('\n').pop()!);
            results.push(r);
            console.log(`${r.map.padEnd(12)} ${r.won ? `won with ${r.lives} lives` : `stopped at wave ${r.wave} (time limit)`}`);
            for (const l of r.log) console.log(`    ${l}`);
          } catch {
            console.log(`${m}: failed`);
          }
          if (!queue.length && !running) done();
          else next();
        });
      }
    };
    next();
  }
}
