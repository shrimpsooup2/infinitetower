// Dev tool: drive the game in headless Chromium and save screenshots.
// Usage: node tools/screenshot.ts [url] [outDir]   (needs `playwright` installed)

import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:8787';
const out = process.argv[3] ?? 'screenshots';
const errors: string[] = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`page: ${e.message}\n${e.stack ?? ''}`));
const shot = async (name: string) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('saved', name); };
const wait = (ms: number) => page.waitForTimeout(ms);

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('it.settings.v1', JSON.stringify({ tutorialDone: true })); });
await page.reload();
await wait(1200);
await shot('01-title');
await page.getByText('Play', { exact: true }).click();
await wait(500);
await shot('02-campaign');
await page.getByText('Start', { exact: true }).click();
await wait(800);
await shot('03-game-start');
await page.locator('.packstack').first().click();
await wait(400);
await shot('04-pack');
await page.getByText('Open', { exact: true }).click();
await wait(1600);
await shot('05-pack-reveal');
await page.locator('.dcard.pickable').first().click();
await wait(400);
await shot('05b-pack-kept');
await page.getByText('Done', { exact: true }).click();

// Drive the world directly to set up a busy scene.
await page.evaluate(() => {
  const g = (window as any).__app.game;
  const w = g.w;
  w.gold = 20000;
  const spots = [['bolt', 5, 5], ['cannon', 7, 6], ['arc', 11, 6], ['frost', 13, 6], ['beacon', 8, 5], ['hive', 16, 6], ['rail', 9, 8], ['mortar', 15, 1], ['flame', 7, 9], ['prism', 17, 5]];
  for (const [d, c, r] of spots) w.place(d, c, r);
  for (const t of w.towers) { w.upgrade(t.id); w.upgrade(t.id); }
  const pw = ['ember', 'storm', 'echo', 'frost', 'orbit', 'boomerang', 'spore', 'bramble', 'rain', 'venom', 'gravity', 'void', 'cluster', 'nova', 'tide', 'haste'];
  let i = 0;
  for (const t of w.towers) for (let k = 0; k < 2; k++) { const c = w.giveCard(pw[i++ % pw.length], i % 4); w.socket(t.id, c.uid); }
  g.select(w.towers[2]);
  w.callWave();
  g.speed = 2;
});
await wait(9000);
await shot('06-wave-1');
await page.evaluate(() => {
  const w = (window as any).__app.game.w;
  w.waveN = 9;
  w.countdown = 0.1;
});
await wait(9000);
await shot('07-boss-icosagon');
await page.evaluate(() => {
  const w = (window as any).__app.game.w;
  for (const e of w.enemies) e.alive = false;
  w.waveN = 26;
  w.countdown = 0.1;
});
await wait(7000);
await shot('08-3d-shapes');
await page.evaluate(() => {
  const w = (window as any).__app.game.w;
  w.waveN = 44;
  w.countdown = 0.1;
  w.lives = 999;
});
await wait(7000);
await shot('09-4d-shapes');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await wait(300);
await shot('10-paused');
await page.evaluate(() => (window as any).__app.codexScreen());
await wait(600);
await shot('11-codex');
// Shape gallery: every 3D and 4D enemy frozen along the path of a fresh game.
for (const dims of [[3], [4], [0]]) {
  await page.evaluate(async (dims) => {
    const app = (window as any).__app;
    app.start('meadow', 'normal');
    const w = app.game.w;
    const { spawnEnemy } = await import('/src/sim/enemies.ts' as string);
    const { ENEMIES, BOSS_WAVES } = await import('/src/content/enemies.ts' as string);
    const bosses = new Set(Object.values(BOSS_WAVES));
    const list = ENEMIES.filter((e: any) => (dims[0] === 0 ? bosses.has(e.id) : e.dim === dims[0] && !bosses.has(e.id)));
    const len = w.paths[0].length;
    list.forEach((d: any, i: number) => {
      const e = spawnEnemy(w, d.id, 0, 30, { dist: 2 + (i + 0.5) * ((len - 4) / list.length), lateral: 0 });
      if (e) { e.speed = 0; e.timers = e.timers.map(() => 1e9); }
    });
  }, dims);
  await wait(1500);
  await shot(`12-gallery-${dims[0] || 'bosses'}`);
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no errors');
await browser.close();
