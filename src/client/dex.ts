// The Shape Dex: every enemy in the game, numbered like a field guide. Shapes
// you haven't met in a run are dark silhouettes; once one crosses your map it
// is entered with its stats, abilities, where it turns up and how many you
// have destroyed. The selected shape turns slowly in a large view.

import { ENEMIES, BOSS_POOLS, bossFor, DIMENSION_NAMES } from '../content/enemies.ts';
import { MAPS } from '../content/maps.ts';
import type { EnemyAbility, EnemyDef } from '../sim/types.ts';
import { drawEnemyBody, enemyIcon } from './render/enemy-art.ts';
import { h, mount, fmtDate } from './ui/dom.ts';
import type { Progress } from './storage.ts';

const SECTIONS: { title: string; test: (d: EnemyDef) => boolean }[] = [
  { title: 'Flatland · 2D', test: (d) => d.dim === 2 && !d.traits.includes('boss') },
  { title: 'Solidspace · 3D', test: (d) => d.dim === 3 && !d.traits.includes('boss') },
  { title: 'Hyperspace · 4D', test: (d) => d.dim === 4 && !d.traits.includes('boss') },
  { title: 'Bosses', test: (d) => d.traits.includes('boss') },
];

/** Every shape in Dex order, numbered from 1. */
export const DEX_ORDER: EnemyDef[] = SECTIONS.flatMap((s) => ENEMIES.filter(s.test));

const pct = (x: number | undefined) => `${Math.round((x ?? 0) * 100)}%`;

function abilityTag(a: EnemyAbility): string {
  switch (a.kind) {
    case 'heal': return `Heals ${pct(a.amount)}`;
    case 'blink': return 'Blinks';
    case 'burrow': return 'Phases (4D)';
    case 'spawn': return a.count ? `Drags ${a.count} links` : 'Spawns shapes';
    case 'split': return `Splits in ${a.count ?? 2}`;
    case 'revive': return 'Revives the fallen';
    case 'haste_aura': return `Hastes ${pct(a.amount)}`;
    case 'phase': return `Ignores ${a.count} hits`;
    case 'mimic': return 'Adapts';
    case 'carapace': return 'Carapace';
    case 'stomp': return 'Stomps towers';
    case 'rewind_hp': return 'Rewinds HP';
    case 'phases': return 'Sheds and enrages';
    case 'dash': return 'Dashes';
    case 'evade': return `Evades ${pct(a.amount)}`;
    case 'antipode': return 'Two places at once';
    case 'cycle_immunity': return 'Shifting immunity';
    case 'spikes': return `Jams ${a.count ?? 1} tower${(a.count ?? 1) > 1 ? 's' : ''}`;
    case 'shed': return `Sheds ${a.count ?? 3}`;
  }
}

/** Where a shape turns up: its introduction wave, or the maps whose boss it is. */
function whereText(d: EnemyDef): string {
  if (d.traits.includes('boss')) {
    const waves = Object.entries(BOSS_POOLS).filter(([, ids]) => ids.includes(d.id)).map(([n]) => Number(n));
    const maps = MAPS.filter((m) => waves.some((n) => n <= m.waves && bossFor(m, n) === d.id)).map((m) => m.name);
    return `Boss of wave ${waves.join(' / ')}${maps.length && maps.length < MAPS.length ? ` on ${maps.join(', ')}` : ''}`;
  }
  if (d.intro) return `First appears in wave ${d.intro} (${DIMENSION_NAMES[d.dim]})`;
  return 'Part of a larger shape';
}

export function dexScreen(progress: Progress, revealAll: boolean): HTMLElement[] {
  const seen = progress.seen ?? {};
  const defeated = progress.defeated ?? {};
  const known = (d: EnemyDef) => revealAll || !!seen[d.id];
  const count = DEX_ORDER.filter(known).length;
  let sel = DEX_ORDER.find(known) ?? DEX_ORDER[0];

  const big = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const SIZE = 190;
  big.width = big.height = SIZE * dpr;
  big.style.width = big.style.height = `${SIZE}px`;
  const off = document.createElement('canvas');
  off.width = off.height = SIZE * dpr;
  const info = h('div', { class: 'dex-info' });
  const focus = h('div', { class: 'dex-focus' }, big, info);

  const renderInfo = () => {
    const d = sel;
    const no = `#${String(DEX_ORDER.indexOf(d) + 1).padStart(3, '0')}`;
    if (!known(d)) {
      mount(info,
        h('div', { class: 'dex-no' }, no),
        h('h2', null, '???'),
        h('div', { class: 'meta' }, 'Not met yet.'),
        h('div', { class: 'meta' }, whereText(d)),
      );
      return;
    }
    const traits = d.traits;
    mount(info,
      h('div', { class: 'dex-no' }, `${no} · ${DIMENSION_NAMES[d.dim]}`),
      h('h2', null, d.name),
      h('div', { class: 'dex-blurb' }, d.blurb),
      h('div', { class: 'chips' },
        ...traits.map((t) => h('span', { class: 'chip', style: { '--c': '#555' } }, t)),
        ...d.abilities.map((a) => h('span', { class: 'chip', style: { '--c': '#6a4fb3' } }, abilityTag(a)))),
      h('div', { class: 'statgrid dex-stats' },
        h('span', null, 'Base HP'), h('span', null, d.hp.toLocaleString()),
        h('span', null, 'Speed'), h('span', null, `${d.speed} tiles/s`),
        d.armor ? h('span', null, 'Armor') : null, d.armor ? h('span', null, String(d.armor)) : null,
        d.shield ? h('span', null, 'Shield') : null, d.shield ? h('span', null, d.shield.toLocaleString()) : null,
        h('span', null, 'Lives if it leaks'), h('span', null, String(d.lives)),
        h('span', null, 'Bounty'), h('span', null, `${d.bounty}g`),
        h('span', null, 'Destroyed'), h('span', null, (defeated[d.id] ?? 0).toLocaleString()),
      ),
      h('div', { class: 'meta' }, whereText(d)),
      seen[d.id] ? h('div', { class: 'meta' }, `First met ${fmtDate(seen[d.id])}`) : null,
    );
  };

  const sections = SECTIONS.map((s) => {
    const list = DEX_ORDER.filter(s.test);
    return h('div', { class: 'dex-section' },
      h('h2', null, `${s.title} · ${list.filter(known).length}/${list.length}`),
      h('div', { class: 'dex-grid' }, ...list.map((d) => {
        const card = h('div', { class: `dex-card ${known(d) ? '' : 'unseen'} ${d === sel ? 'sel' : ''}`, title: known(d) ? d.name : '???' },
          h('span', { class: 'no' }, `#${String(DEX_ORDER.indexOf(d) + 1).padStart(3, '0')}`),
          enemyIcon(d, 58),
          h('span', { class: 'nm' }, known(d) ? d.name : '???'),
        );
        card.addEventListener('click', () => {
          sel = d;
          for (const c of Array.from(document.querySelectorAll('.dex-card.sel'))) c.classList.remove('sel');
          card.classList.add('sel');
          renderInfo();
        });
        return card;
      })),
    );
  });

  // The large view turns until the screen goes away.
  const g = big.getContext('2d')!;
  const og = off.getContext('2d')!;
  const t0 = performance.now();
  const frame = (now: number) => {
    if (!big.isConnected && now - t0 > 1000) return;
    requestAnimationFrame(frame);
    const t = (now - t0) / 1000;
    const d = sel;
    const r = d.traits.includes('boss') ? 58 : 52;
    for (const c of [g, og]) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, SIZE, SIZE);
    }
    if (known(d)) {
      drawEnemyBody(g, d, SIZE / 2, SIZE / 2, r, t * 0.35, t, d.color, 3, d.dim === 3 ? 2 : 0);
    } else {
      // A silhouette: the shape drawn off screen, then filled flat.
      drawEnemyBody(og, d, SIZE / 2, SIZE / 2, r, t * 0.35, t, d.color, 3, 0);
      og.setTransform(1, 0, 0, 1, 0, 0);
      og.globalCompositeOperation = 'source-in';
      og.fillStyle = 'rgba(20,20,32,0.85)';
      og.fillRect(0, 0, off.width, off.height);
      og.globalCompositeOperation = 'source-over';
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(off, 0, 0);
    }
  };
  requestAnimationFrame(frame);
  renderInfo();

  return [
    h('div', { class: 'stat-line' }, `${count} / ${DEX_ORDER.length} shapes met`),
    h('div', { class: 'dex' }, h('div', { class: 'dex-list' }, ...sections), focus),
  ];
}
