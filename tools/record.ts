// Watch the Strategist play: replays a recorded game in the real client, in
// headless Chromium, and saves it as a video.
//
//   node tools/strategist.ts meadow hard 1 --record run.json
//   node tools/record.ts run.json [out.webm] [--speed 4] [--size 1600x900] [--no-panel]
//                        [--show] [--pace 900]
//   (needs `playwright` installed)
//
// The world is deterministic, so the client plays the same game when it starts
// from the recorded state and makes the recorded calls at the recorded ticks.
// A Node replay checks that first. The client builds without API_BASE, so it
// uses offline fusions, the same ones the Strategist planned with. A caption
// in the corner lists the bot's moves as it makes them, and the tower panel
// shows the tower it just changed, then its best towers in turn (--no-panel
// leaves nothing selected).
//
// --show plays it like a person at the controls: before each wave the game
// holds still while a cursor moves to what a player would click (a tower button
// then the tile, a tower then Upgrade or Level, a card, the pack stack, the
// Shop, the call-wave button) and clicks it, about --pace ms an action, with a
// caption saying what the bot is doing and why.

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
const [vw, vh] = flag('size', '1280x720').split('x').map(Number);
const pace = Number(flag('pace', '900'));
const panel = !args.includes('--no-panel');
if (!panel) args.splice(args.indexOf('--no-panel'), 1);
const show = args.includes('--show');
if (show) args.splice(args.indexOf('--show'), 1);
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
    for (let t = 0; w.tick < st.tick && t < 60 * 3600; t++) { w.step(); w.fx.length = 0; }
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
const size = { width: vw, height: vh };
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
await page.evaluate(([steps, title, speed, panel, show, pace]) => {
  type T = { id: number; c: number; r: number; def: { id: string; name: string }; tier: number; level: number; dmgTotal: number };
  type C = { uid: number; power: string; rarity: number };
  type W = Record<string, unknown> & {
    tick: number; gold: number; lives: number; waveN: number; phase: string;
    step(): void; towers: T[]; cards: C[]; offer: { cards: C[] } | null;
  };
  const g = (window as unknown as { __app: { game: { w: W; speed: number; r: { cam: { ox: number; oy: number; s: number } } } } }).__app.game;
  const w = g.w;
  const RARITY = ['Common', 'Rare', 'Epic', 'Legendary'];
  const nice = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);
  const cardName = (c?: C) => (c ? `${RARITY[c.rarity]} ${nice(c.power)}` : 'a card');
  const tower = (id: unknown) => w.towers.find((t) => t.id === id);

  // The caption: what the bot is doing, newest first.
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;width:280px;padding:10px 12px;border-radius:10px;background:rgba(10,12,20,.78);color:#e8ecf4;font:12px/1.45 system-ui,sans-serif;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.35)';
  const head = document.createElement('div');
  head.style.cssText = 'font-weight:700;font-size:13px;color:#ffd166;margin-bottom:4px';
  head.textContent = `${title} · ${speed}x`;
  const lines = document.createElement('div');
  box.append(head, lines);
  document.body.append(box);
  const said: string[] = [];
  const say = (s: string) => {
    said.unshift(s);
    said.length = Math.min(said.length, 6);
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
      case 'place': return `Build a ${nice(String(a[0]))}`;
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

  /** The bot's reason for a purchase, from its plan note: "build rail @3,4 (-12.0 leak)". */
  const reason = (note: string | undefined): string => {
    const m = note && /\((?:-[\d.]+ )?(.+)\)$/.exec(note);
    if (!m) return '';
    const why = m[1];
    if (why === 'leak') return 'the next wave would get through otherwise';
    const boss = /^boss (\d+)$/.exec(why);
    if (boss) return `getting ready for the boss on wave ${boss[1]}`;
    const x = /^@x([\d.]+)$/.exec(why);
    if (x) return Number(x[1]) <= 1.5 ? 'keeping a safety margin (the next wave with 50% more health)' : `building margin for harder waves ahead (x${x[1]} health)`;
    return why;
  };

  // The tower panel: the tower the bot just changed, then its best towers in turn.
  const select = (t: unknown) => (g as unknown as { select(t: unknown): void }).select(t);
  const pick = (t: unknown) => { if (panel && t) select(t); };
  let held = 0;
  let busy = false;
  if (panel) {
    let k = 0;
    setInterval(() => {
      if (busy || performance.now() < held) return;
      const top = [...w.towers].sort((a, b) => b.dmgTotal - a.dmgTotal).slice(0, 4);
      if (top.length) pick(top[k++ % top.length]);
    }, 4000);
  }

  // ---- show mode: a cursor, a banner, and a pause for each action.
  const cursor = document.createElement('div');
  cursor.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18 L12 28 L16 26 L12 17 L21 17 Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>';
  cursor.style.cssText = 'position:fixed;left:0;top:0;z-index:10001;pointer-events:none;transform:translate(640px,360px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));display:none';
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;left:50%;top:92px;transform:translateX(-50%);z-index:10000;max-width:760px;padding:10px 18px;border-radius:12px;background:rgba(10,12,20,.86);color:#fff;font:600 18px/1.35 system-ui,sans-serif;text-align:center;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.4);display:none';
  const bannerWhy = document.createElement('div');
  bannerWhy.style.cssText = 'font:500 14px/1.35 system-ui,sans-serif;color:#ffd166;margin-top:3px';
  const bannerWhat = document.createElement('div');
  banner.append(bannerWhat, bannerWhy);
  const style = document.createElement('style');
  style.textContent = '@keyframes rec-ripple{from{transform:translate(-50%,-50%) scale(.3);opacity:.9}to{transform:translate(-50%,-50%) scale(1.6);opacity:0}}';
  document.head.append(style);
  if (show) document.body.append(cursor, banner);
  let cx = 640, cy = 360;
  const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const moveTo = async (x: number, y: number, ms = pace * 0.45) => {
    const x0 = cx, y0 = cy, t0 = performance.now();
    for (;;) {
      const u = Math.min(1, (performance.now() - t0) / ms);
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      cx = x0 + (x - x0) * e;
      cy = y0 + (y - y0) * e + Math.sin(u * Math.PI) * -18;
      cursor.style.transform = `translate(${cx}px,${cy}px)`;
      if (u >= 1) break;
      await frame();
    }
  };
  const ripple = (color = '#ffd166') => {
    const r = document.createElement('div');
    r.style.cssText = `position:fixed;left:${cx + 2}px;top:${cy + 2}px;width:46px;height:46px;border-radius:50%;border:3px solid ${color};z-index:10000;pointer-events:none;animation:rec-ripple .5s ease-out forwards`;
    document.body.append(r);
    setTimeout(() => r.remove(), 600);
  };
  const click = async (color?: string) => {
    cursor.style.transition = 'filter .1s';
    ripple(color);
    cursor.firstElementChild!.setAttribute('transform', 'scale(0.85)');
    await sleep(120);
    cursor.firstElementChild!.removeAttribute('transform');
    await sleep(pace * 0.25);
  };
  const centerOf = (el: Element | null) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return b.width ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
  };
  const tile = (c: number, r: number) => {
    const cam = g.r.cam;
    return { x: cam.ox + (c + 0.5) * cam.s, y: cam.oy + (r + 0.5) * cam.s };
  };
  const goEl = async (sel: string | Element | null, fallback?: { x: number; y: number }) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    const p = centerOf(el) ?? fallback;
    if (p) await moveTo(p.x, p.y);
  };
  const handCard = (uid: unknown) => {
    const sorted = [...w.cards].sort((a, b) => b.rarity - a.rarity || a.power.localeCompare(b.power));
    const i = sorted.findIndex((c) => c.uid === uid);
    return document.querySelectorAll('.hand .card')[i] ?? null;
  };
  const selectTower = async (t: T | undefined) => {
    if (!t) return;
    const p = tile(t.c, t.r);
    await moveTo(p.x, p.y);
    await click();
    select(t);
    for (let k = 0; k < 4; k++) await frame();
  };
  const banner1 = (what: string, why: string) => {
    bannerWhat.textContent = what;
    bannerWhy.textContent = why;
    bannerWhy.style.display = why ? 'block' : 'none';
    banner.style.display = 'block';
  };
  const run = (c: [string, ...unknown[]]) => (w[c[0]] as (...x: unknown[]) => unknown).apply(w, c.slice(1));

  /** Act out one call the way a player would, then make it. */
  const act = async (c: [string, ...unknown[]], note: string | undefined) => {
    const [name, ...a] = c;
    const what = describe(c);
    if (what && name !== 'openPack') banner1(what, reason(note));
    let result: unknown;
    switch (name) {
      case 'place': {
        await goEl(`.tbtn[data-id="${a[0]}"]`);
        await click();
        const p = tile(Number(a[1]), Number(a[2]));
        await moveTo(p.x, p.y, pace * 0.6);
        await click();
        result = run(c);
        if (result && typeof result === 'object') select(result);
        break;
      }
      case 'upgrade':
      case 'levelUp': {
        const t = tower(a[0]);
        await selectTower(t);
        await goEl(name === 'upgrade' ? '.side .actions .btn.blue' : '.side .actions .lvbtn', t ? tile(t.c, t.r) : undefined);
        await click();
        result = run(c);
        break;
      }
      case 'socket': {
        const t = tower(a[0]);
        await selectTower(t);
        await goEl(handCard(a[1]));
        await click();
        result = run(c);
        break;
      }
      case 'openPack':
        banner1('Open a card pack', '');
        await goEl('.packstack');
        await click();
        result = run(c);
        break;
      case 'pickCard':
        await sleep(pace * 0.4);
        result = run(c);
        break;
      case 'scrapCard':
        await goEl(handCard(a[0]));
        await click('#ff6b6b');
        result = run(c);
        break;
      case 'buyPack':
        await goEl('.shopbtn');
        await click();
        result = run(c);
        break;
      case 'callWave':
        await goEl('.callbtn');
        await click('#7bd88f');
        result = run(c);
        break;
      default:
        result = run(c);
    }
    if (what) say(what);
    return result;
  };

  let i = 0;
  const bad: string[] = [];
  const check = (st: typeof steps[number]) => {
    if (Math.abs(w.gold - st.after.gold) > 1e-6 || w.lives !== st.after.lives) bad.push(`wave ${st.after.waveN}: gold ${w.gold} vs ${st.after.gold}, lives ${w.lives} vs ${st.after.lives}`);
  };
  const showStep = async (st: typeof steps[number]) => {
    // The purchases line up with the plan's notes, one each; the last note may say what it saves for.
    const notes = (st.notes ?? []).filter((n) => !n.startsWith('saves for') && !n.startsWith('('));
    const saving = (st.notes ?? []).find((n) => n.startsWith('saves for'));
    let k = 0;
    cursor.style.display = 'block';
    for (const c of st.calls) {
      const buy = c[0] === 'place' || c[0] === 'upgrade' || c[0] === 'levelUp' || c[0] === 'socket';
      if (c[0] === 'callWave' && saving) {
        banner1('Saving the rest', `for ${saving.replace(/^saves for /, '').replace(/ \(.*\)$/, '').replace(/@\d+,\d+/, '').trim()}`);
        await sleep(pace);
      }
      await act(c, buy ? notes[k++] : undefined);
    }
    banner.style.display = 'none';
    held = performance.now() + 5000;
    check(st);
  };
  const due = () => {
    while (!busy && i < steps.length && w.tick === steps[i].tick) {
      const st = steps[i++];
      if (show) {
        busy = true;
        // An action that fails must not hold the game still for good.
        void showStep(st).catch((e) => bad.push(`wave ${st.after.waveN}: ${e}`)).finally(() => { busy = false; });
        return;
      }
      let changed: unknown = null;
      for (const c of st.calls) {
        const s = describe(c);
        const r = run(c);
        if (s) say(s);
        if (c[0] === 'place' && r && typeof r === 'object') changed = r;
        else if (c[0] === 'upgrade' || c[0] === 'levelUp' || c[0] === 'socket') changed = tower(c[1]) ?? changed;
      }
      if (changed) {
        pick(changed);
        held = performance.now() + 5000;
      }
      check(st);
    }
  };
  if (w.tick !== steps[0].tick) throw new Error(`the game is at tick ${w.tick}, the recording starts at ${steps[0].tick}`);
  // While an action is being acted out the game holds still, so each call lands on its recorded tick.
  const step = w.step.bind(w);
  w.step = () => { if (busy) return; step(); due(); };
  due();
  g.speed = speed;
  (window as unknown as { __rec: unknown }).__rec = { left: () => steps.length - i + (busy ? 1 : 0), phase: () => w.phase, quiet: () => (w as unknown as { quiescent(): boolean }).quiescent(), wave: () => w.waveN, tick: () => w.tick, bad };
}, [script.steps, title, speed, panel, show, pace] as const);

// Acted-out moves hold the game still for about 1.6 paces each.
const acting = show ? (script.steps.reduce((n, st) => n + st.calls.length, 0) * pace * 1.6) / 1000 : 0;
console.log(`recording ${title} at ${speed}x (about ${Math.round(last / 60 / speed + acting)}s)...`);
await page.evaluate(() => {
  const r = (window as unknown as { __rec: { frames: number } }).__rec;
  r.frames = 0;
  const f = () => { r.frames++; requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
let posted = false;
for (let prev = { frames: 0, t: Date.now() }; ;) {
  await page.waitForTimeout(15_000);
  const r = await page.evaluate(() => {
    const r = (window as unknown as { __rec: { left(): number; phase(): string; quiet(): boolean; frames: number; wave(): number; tick(): number; bad: string[] } }).__rec;
    return { left: r.left(), phase: r.phase(), quiet: r.quiet(), frames: r.frames, wave: r.wave(), tick: r.tick(), drift: r.bad.length };
  });
  const fps = ((r.frames - prev.frames) * 1000) / (Date.now() - prev.t);
  prev = { frames: r.frames, t: Date.now() };
  console.log(`  wave ${r.wave}, ${Math.round(r.tick / 60)}s of play, ${fps.toFixed(0)} fps${r.drift ? `, drifted on ${r.drift} waves` : ''}`);
  // A still from about a third of the way in, as a poster for the video.
  if (!posted && r.wave >= Math.ceil(script.steps.length / 3)) {
    posted = true;
    await page.screenshot({ path: out.replace(/\.webm$/, '') + '.png' });
  }
  if (r.left === 0 && (r.phase === 'victory' || r.phase === 'defeat' || (r.quiet && r.tick > script.steps.at(-1)!.tick))) break;
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
