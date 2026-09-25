// The auto-balancer: eases the game until the Strategist can beat it.
//
// For each map, the Strategist plays on the chosen difficulty. When it loses,
// it knows how close it was: the share of the killing wave's HP its defence
// would have held. The balancer eases exactly that:
//
//   - a boss wave: the boss's HP and shield, by that share (with a little margin);
//     if cutting the boss did not help, the leak is its escorts or the shapes it
//     sheds, and the wave's band is eased instead;
//   - any other wave: the toughness step of its band of ten waves (TOUGHNESS in
//     src/content/waves.ts), so every shape from the band's first wave on has
//     that much less HP. The number of shapes, and the bounty they pay, stays
//     the same.
//
// Then the game goes back to an exact save just before the first wave the
// change affects and plays on, until the map is won.
//
// With --radical, Act III's waves (41 on) and bosses are first eased hard (at
// least 20% a time) to get through to the end fast. Then it goes back the other
// way: after each win (up to three) it measures how many times its HP every
// Act III wave could have had and still been survived, raises each band and
// boss to that less 15%, and plays again (easing gently if that loses). Each
// map reports the values of its last win. Maps run in parallel, one per core;
// the easiest value any map needed is what every map can be won with. It
// prints those, to be written into src/content/enemies.ts (boss hp and
// shield) and src/content/waves.ts (TOUGHNESS; GROWTH is printed too).
//
//   node tools/autobalance.ts [maps] [difficulty] [--jobs 4] [--minutes 40] [--full] [--radical]
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
/** The radical first pass: ease well past what was needed, at least 20% a time. */
const easeHard = (hold: number) => Math.max(0.3, Math.min(0.8, hold * 0.75));
/** Waves from here on (and their bosses) belong to Act III alone, so only they are raised back. */
const ACT3 = 41;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

interface Balancer extends Tuner {
  /** The values of the last win: proven beatable. */
  proven: Values | null;
}

/**
 * `radical`: until the first win, Act III's waves and bosses are eased hard, to
 * get through to the end fast. After each win (up to three times), everything
 * in Act III that was beaten with room to spare is raised back to where it is
 * just beatable, keeping 15% in hand, and played again.
 */
const tuner = (log: string[], radical: boolean): Balancer => {
  // What each boss wave held the last time its boss was cut: if a cut did not
  // help, the leak is its escorts or the shapes it sheds, not the boss itself.
  const lastBossHold = new Map<number, number>();
  let wins = 0;
  const b: Balancer = {
    proven: null,
    raiseFrom: ACT3,
    ease({ map, wave, hold }) {
      const f = radical && !wins && wave >= ACT3 ? easeHard(hold) : ease(hold);
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
      // bounty, and the bot would come out weaker), from the band's first wave on.
      const band = growthBand(wave);
      const first = band * 10 + 1;
      const was = TOUGHNESS[band];
      TOUGHNESS[band] *= f;
      log.push(`wave ${wave}: toughness from wave ${first} ${was.toFixed(3)} -> ${TOUGHNESS[band].toFixed(3)}`);
      lastBossHold.delete(wave);
      return { from: Math.max(1, first), note: `toughness from wave ${first} x${f.toFixed(2)} (lost at ${wave})` };
    },
    raise({ map, spare }) {
      b.proven = snapshot();
      if (!radical || ++wins > 3) return null;
      const changes: string[] = [];
      let from = Infinity;
      // Bands: raise to the room the tightest ordinary wave had (less 15%).
      // Steps multiply, so each band's step accounts for the ones before it.
      let carried = 1;
      const bandF = new Map<number, number>();
      for (let band = growthBand(ACT3); band < TOUGHNESS.length; band++) {
        const room = [...spare].filter(([n]) => growthBand(n) === band && !bossFor(map, n)).map(([, k]) => k);
        if (!room.length) break;
        const f = clamp(Math.min(...room) / 1.15 / carried, 0.7, 1.6);
        if (Math.abs(f - 1) > 0.03) {
          TOUGHNESS[band] *= f;
          changes.push(`toughness from wave ${band * 10 + 1} x${f.toFixed(2)}`);
          from = Math.min(from, band * 10 + 1);
        }
        carried *= f;
        bandF.set(band, carried);
      }
      // Bosses: the room their wave had, less 15%, less what their band's raise already adds.
      for (const [n, k] of spare) {
        const boss = bossFor(map, n);
        if (!boss) continue;
        const f = clamp(k / 1.15 / (bandF.get(growthBand(n)) ?? 1), 0.7, 1.6);
        if (Math.abs(f - 1) <= 0.03) continue;
        const d = ENEMY_BY_ID.get(boss)!;
        d.hp = Math.round(d.hp * f);
        d.shield = Math.round(d.shield * f);
        changes.push(`${boss} x${f.toFixed(2)}`);
        from = Math.min(from, n);
      }
      if (!changes.length) return null;
      log.push(`raised (win ${wins}): ${changes.join(', ')}`);
      return { from, note: `raise ${changes.join(', ')}` };
    },
  };
  return b;
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
    const t = tuner(log, args.includes('--radical'));
    const r = await play(mapId, diff as Diff, 7919, {
      threads: 1, tries: 0, tune: t, light: !args.includes('--full'), say, deadline: t0 + minutes * 60000,
      trace: args.includes('--trace'),
    });
    say(r.won ? `won with ${r.lives} lives` : `stopped at wave ${r.wave} (time limit)`);
    // Report the values of a win: this one, else the last one (a raise that was not won back is dropped).
    const values = r.won ? snapshot() : t.proven ?? snapshot();
    const proven = r.won || !!t.proven;
    if (!r.won && t.proven) say('reporting the values of its last win');
    process.stdout.write(JSON.stringify({ map: mapId, won: r.won, proven, wave: r.wave, lives: r.lives, log, values }) + '\n');
  } else {
    const pick = (a: string) => a === 'all' ? MAPS.map((m) => m.id) : /^act[123]$/.test(a) ? MAPS.filter((m) => m.act === Number(a[3])).map((m) => m.id) : a.split(',').filter((id) => MAP_BY_ID.has(id));
    const maps = pos[0] ? pos[0].split(',').flatMap(pick) : ['fork', 'twinrivers', 'nebula', 'horizon'];
    const diff = (pos[1] ?? 'hard') as Diff;
    const before = snapshot();
    const results: { map: string; won: boolean; proven: boolean; wave: number; lives: number; log: string[]; values: Values }[] = [];
    const queue = [...maps].sort((a, b) => MAP_BY_ID.get(b)!.waves - MAP_BY_ID.get(a)!.waves);
    let running = 0;
    console.log(`balancing ${maps.join(', ')} on ${diff}, ${jobs} at a time`);
    const done = () => {
      // The easiest value any map needed is what every map can be won with.
      const out: Values = {
        growth: before.growth.map((g, i) => Math.min(...results.map((r) => r.values.growth[i] ?? g))),
        // Steps multiply, so compare what each map needed in total at each band, then turn back into steps.
        toughness: (() => {
          const total = (t: number[]) => t.map((_, i) => t.slice(0, i + 1).reduce((a, b) => a * b, 1));
          const need = total(before.toughness).map((x, i) => Math.min(x, ...results.map((r) => total(r.values.toughness ?? before.toughness)[i])));
          return need.map((x, i) => (i ? x / need[i - 1] : x));
        })(),
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
      console.log(`\n${JSON.stringify(out)}`);
    };
    const next = () => {
      while (running < jobs && queue.length) {
        const m = queue.shift()!;
        running++;
        const child = fork(fileURLToPath(import.meta.url), [m, diff, '--job', '--minutes', String(minutes), ...['--full', '--radical'].filter((f) => args.includes(f))], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
        let text = '';
        child.stdout!.on('data', (b) => { text += b; });
        child.on('exit', () => {
          running--;
          try {
            const r = JSON.parse(text.trim().split('\n').pop()!);
            results.push(r);
            console.log(`${r.map.padEnd(12)} ${r.won ? `won with ${r.lives} lives` : `stopped at wave ${r.wave} (time limit)`}${r.proven ? '' : ' (values not proven by a win)'}`);
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
