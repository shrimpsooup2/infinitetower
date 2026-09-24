// Watch the Strategist play: replays a recorded game in the real client, in
// headless Chromium, and saves it as a video.
//
//   node tools/strategist.ts meadow hard 1 --record run.json
//   node tools/record.ts run.json [out.webm] [--speed 4]   (needs `playwright` installed)
//
// The world is deterministic, so the client plays the same game when it starts
// from the recorded state and makes the recorded calls at the recorded ticks.
// A Node replay checks that first. The client builds without API_BASE, so it
// uses offline fusions, the same ones the Strategist planned with. A caption
// in the corner lists the bot's moves as it makes them.

import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { World } from '../src/sim/world.ts';
import { MAP_BY_ID } from '../src/content/maps.ts';
import { DIFFICULTY_BY_ID } from '../src/content/rules.ts';
import type { Script } from './strategist.ts';

const args = process.argv.slice(2);
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : dflt;
};
const speedArg = flag('speed', '');
const [scriptPath, outArg] = args;
if (!scriptPath) {
  console.error('usage: node tools/record.ts run.json [out.webm] [--speed 4]');
  process.exit(1);
}
const script = JSON.parse(readFileSync(scriptPath, 'utf8')) as Script;
const out = resolve(outArg ?? scriptPath.replace(/\.json$/, '') + '.webm');
const map = MAP_BY_ID.get(script.map)!;

type Call = [string, ...unknown[]];
const call = (w: World, [name, ...a]: Call) => (w as unknown as Record<string, (...x: unknown[]) => unknown>)[name](...a);

// 1. Replay in Node, with effects on like the client, to be sure it is the same game.
{
  const w = new World({ map, difficulty: script.diff, seed: script.seed, autoStart: false });
  w.restore(script.start);
  for (const [i, st] of script.steps.entries()) {
    for (let t = 0; w.tick < st.tick && t < 60 * 600; t++) { w.step(); w.fx.length = 0; }
    for (const c of st.calls) call(w, c);
    const a = st.after;
    if (w.tick !== st.tick || Math.abs(w.gold - a.gold) > 1e-6 || w.lives !== a.lives || w.waveN !== a.waveN) {
      console.error(`replay diverged at step ${i}: tick ${w.tick}/${st.tick} gold ${w.gold}/${a.gold} lives ${w.lives}/${a.lives}`);
      process.exit(1);
    }
  }
  console.log(`replay checked: ${script.steps.length} waves match`);
}

// 2. Build the client (offline fusions) and serve it.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const site = mkdtempSync(join(tmpdir(), 'it-record-'));
execFileSync(process.execPath, [join(root, 'tools/build.ts'), site], { stdio: 'ignore', env: { ...process.env, API_BASE: '' } });
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(site, p === '/' ? 'index.html' : p);
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;

// 3. Play it on video. The speed defaults to a video of about four minutes.
const last = script.steps.at(-1)!.tick + 60 * 90;
const speed = Number(speedArg || Math.max(2, Math.min(8, Math.ceil(last / 60 / 240))));
const videoDir = mkdtempSync(join(tmpdir(), 'it-video-'));
const size = { width: 1280, height: 720 };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: size, recordVideo: { dir: videoDir, size } });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(([start, s]) => {
  if (sessionStorage.getItem('rec')) return;
  sessionStorage.setItem('rec', '1');
  localStorage.clear();
  localStorage.setItem('it.settings.v1', JSON.stringify(s));
  localStorage.setItem('it.run.v2', JSON.stringify({ save: start, savedAt: Date.now() }));
}, [script.start, { tutorialDone: true, autoStart: false, sound: false, volume: 0 }] as const);
await page.goto(`http://127.0.0.1:${port}/`);
// Hold the game still from the moment it exists: the replay starts on the recorded tick.
await page.evaluate(() => {
  const app = (window as unknown as { __app: Record<string, unknown> }).__app;
  let game = app.game as { speed: number } | undefined;
  Object.defineProperty(app, 'game', {
    configurable: true,
    get: () => game,
    set: (v: { speed: number } | undefined) => { game = v; if (v) v.speed = 0; },
  });
});
await page.getByText(/^Continue/).click();
await page.waitForFunction(() => !!(window as unknown as { __app: { game?: unknown } }).__app.game);

const title = `Strategist bot · ${map.name} · ${DIFFICULTY_BY_ID.get(script.diff)!.name}`;
await page.evaluate(([steps, title, speed]) => {
  type W = Record<string, unknown> & {
    tick: number; gold: number; lives: number; waveN: number; phase: string;
    step(): void; towers: { id: number; def: { name: string }; tier: number; level: number }[];
    cards: { uid: number; power: string; rarity: number }[]; offer: { cards: { uid: number; power: string; rarity: number }[] } | null;
  };
  const g = (window as unknown as { __app: { game: { w: W; speed: number } } }).__app.game;
  const w = g.w;
  const RARITY = ['Common', 'Rare', 'Epic', 'Legendary'];
  const cardName = (c?: { power: string; rarity: number }) => (c ? `${RARITY[c.rarity]} ${c.power}` : 'a card');
  const tower = (id: unknown) => w.towers.find((t) => t.id === id);

  // The caption: what the bot is doing, newest first.
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:12px;top:56px;z-index:9999;width:280px;padding:10px 12px;border-radius:10px;background:rgba(10,12,20,.78);color:#e8ecf4;font:12px/1.45 system-ui,sans-serif;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.35)';
  const head = document.createElement('div');
  head.style.cssText = 'font-weight:700;font-size:13px;color:#ffd166;margin-bottom:4px';
  head.textContent = `${title} · ${speed}x`;
  const lines = document.createElement('div');
  box.append(head, lines);
  document.body.append(box);
  const said: string[] = [];
  const say = (s: string) => {
    said.unshift(s);
    said.length = Math.min(said.length, 9);
    lines.innerHTML = '';
    said.forEach((t, i) => {
      const d = document.createElement('div');
      d.textContent = t;
      d.style.opacity = String(1 - i * 0.09);
      lines.append(d);
    });
  };

  const describe = ([name, ...a]: [string, ...unknown[]]): string | null => {
    switch (name) {
      case 'place': return `Build ${a[0]} at ${a[1]},${a[2]}`;
      case 'upgrade': { const t = tower(a[0]); return t ? `Upgrade ${t.def.name} to tier ${t.tier + 1}` : null; }
      case 'levelUp': { const t = tower(a[0]); return t ? `Level ${t.def.name} to ${t.level + 1}` : null; }
      case 'socket': { const t = tower(a[0]); return `Socket ${cardName(w.cards.find((c) => c.uid === a[1]))} into ${t?.def.name ?? 'a tower'}`; }
      case 'pickCard': return `Keep ${cardName(w.offer?.cards.find((c) => c.uid === a[0]))} from a pack`;
      case 'scrapCard': return `Scrap ${cardName(w.cards.find((c) => c.uid === a[0]))}`;
      case 'buyPack': return `Buy a ${a[0]} pack`;
      case 'callWave': return `Call wave ${w.waveN + 1}`;
      default: return null;
    }
  };

  let i = 0;
  const bad: string[] = [];
  const due = () => {
    while (i < steps.length && w.tick === steps[i].tick) {
      const st = steps[i++];
      for (const c of st.calls) {
        const s = describe(c);
        (w[c[0]] as (...x: unknown[]) => unknown).apply(w, c.slice(1));
        if (s) say(s);
      }
      if (Math.abs(w.gold - st.after.gold) > 1e-6 || w.lives !== st.after.lives) bad.push(`wave ${st.after.waveN}: gold ${w.gold} vs ${st.after.gold}, lives ${w.lives} vs ${st.after.lives}`);
    }
  };
  if (w.tick !== steps[0].tick) throw new Error(`the game is at tick ${w.tick}, the recording starts at ${steps[0].tick}`);
  const step = w.step.bind(w);
  w.step = () => { step(); due(); };
  due();
  g.speed = speed;
  (window as unknown as { __rec: unknown }).__rec = { left: () => steps.length - i, phase: () => w.phase, wave: () => w.waveN, tick: () => w.tick, bad };
}, [script.steps, title, speed] as const);

console.log(`recording ${title} at ${speed}x (about ${Math.round(last / 60 / speed)}s)...`);
await page.evaluate(() => {
  const r = (window as unknown as { __rec: { frames: number } }).__rec;
  r.frames = 0;
  const f = () => { r.frames++; requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
for (let prev = { frames: 0, t: Date.now() }; ;) {
  await page.waitForTimeout(15_000);
  const r = await page.evaluate(() => {
    const r = (window as unknown as { __rec: { left(): number; phase(): string; frames: number; wave(): number; tick(): number; bad: string[] } }).__rec;
    return { left: r.left(), phase: r.phase(), frames: r.frames, wave: r.wave(), tick: r.tick(), drift: r.bad.length };
  });
  const fps = ((r.frames - prev.frames) * 1000) / (Date.now() - prev.t);
  prev = { frames: r.frames, t: Date.now() };
  console.log(`  wave ${r.wave}, ${Math.round(r.tick / 60)}s of play, ${fps.toFixed(0)} fps${r.drift ? `, drifted on ${r.drift} waves` : ''}`);
  if (r.left === 0 && (r.phase === 'victory' || r.phase === 'defeat')) break;
}
await page.waitForTimeout(5000);
const bad = await page.evaluate(() => (window as unknown as { __rec: { bad: string[] } }).__rec.bad);
const video = page.video()!;
await context.close();
await browser.close();
server.close();
renameSync(await video.path(), out);
rmSync(site, { recursive: true, force: true });
rmSync(videoDir, { recursive: true, force: true });
if (bad.length) console.log(`the client drifted from the recording:\n  ${bad.join('\n  ')}`);
if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
console.log(`saved ${out}`);
