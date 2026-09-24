// The Codex: every fusion you have made, kept compact. One page per tower
// (tabs with counts), then one tab per base power, then a list of compact
// rows. Each pair has its triples (its evolutions) nested beneath it. A row
// opens in place to show the concept and rules. Long lists are paged.

import { TOWERS, TOWER_BY_ID } from '../content/towers.ts';
import { POWER_BY_ID } from '../content/powers.ts';
import { describeSpec } from '../effects/describe.ts';
import { stripTokens } from '../effects/concept.ts';
import { parentKey } from '../effects/keys.ts';
import { colorsFor } from '../sim/world.ts';
import { towerIcon } from './render/tower-art.ts';
import { conceptEl } from './ui/concept.ts';
import { h, mount, tone, fmtDate } from './ui/dom.ts';
import type { Codex, CodexEntry } from './storage.ts';

const PER_PAGE = 10;
/** Pairs and triples a single tower can make. */
const PER_TOWER = 40 * 40 + 40 * 40 * 40;

interface Group {
  pair: CodexEntry | null;
  triples: CodexEntry[];
  base: string;
}

export function codexScreen(codex: Codex): { search: HTMLElement; body: HTMLElement } {
  const all = codex.all();
  let tower = all[0]?.tower ?? TOWERS[0].id;
  let base = '';
  let page = 0;
  let q = '';
  let open = '';

  const body = h('div', { class: 'codex2' });

  const matches = (e: CodexEntry) => !q || `${e.name} ${e.powers.map((p) => POWER_BY_ID.get(p)?.name ?? p).join(' ')} ${stripTokens(e.concept)}`.toLowerCase().includes(q);

  /** Pairs with their triples beneath; a triple whose pair you haven't kept stands alone. */
  const groups = (list: CodexEntry[]): Group[] => {
    const byKey = new Map(list.map((e) => [e.key, e]));
    const out = new Map<string, Group>();
    for (const e of list) {
      if (e.powers.length < 3) {
        const g = out.get(e.key) ?? { pair: null, triples: [], base: e.powers[0] };
        g.pair = e;
        out.set(e.key, g);
      } else {
        const pk = parentKey(e.key)!;
        const g = out.get(pk) ?? { pair: byKey.get(pk) ?? null, triples: [], base: e.powers[0] };
        g.triples.push(e);
        out.set(pk, g);
      }
    }
    const name = (g: Group) => (g.pair ?? g.triples[0]).powers.map((p) => POWER_BY_ID.get(p)?.name ?? p).join(' ');
    return [...out.values()].sort((a, b) => name(a).localeCompare(name(b)));
  };

  const chain = (e: CodexEntry) => h('span', { class: 'chain' }, ...e.powers.flatMap((p, i) => {
    const pw = POWER_BY_ID.get(p);
    return [
      i ? h('span', { class: 'arrow' }, '›') : null,
      h('span', { class: 'pchip', style: tone(pw?.color ?? '#999'), title: pw?.name ?? p }, pw?.icon ?? p),
    ];
  }));

  const row = (e: CodexEntry, child: boolean): HTMLElement => {
    const isOpen = open === e.key;
    const tdef = TOWER_BY_ID.get(e.tower);
    return h('div', { class: `crow ${child ? 'child' : ''} ${isOpen ? 'open' : ''}` },
      h('div', { class: 'line', on: { click: () => { open = isOpen ? '' : e.key; render(); } } },
        child ? h('span', { class: 'arrow' }, '↳') : null,
        tdef ? towerIcon(tdef.id, e.powers.length, 30, colorsFor(e.powers), e.powers.length) : null,
        h('span', { class: 'nm', style: { color: POWER_BY_ID.get(e.powers[0])?.color } }, e.name),
        chain(e),
        e.status === 'ready' && e.discoveryNo ? h('span', { class: 'badge gold' }, `#${e.discoveryNo.toLocaleString()}`) : e.status !== 'ready' ? h('span', { class: 'badge grey' }, e.status === 'offline' ? 'Offline' : 'Provisional') : null,
        e.worldFirst ? h('span', { class: 'badge red', title: 'World First' }, '★') : null,
        h('span', { class: 'caret' }, isOpen ? '▾' : '▸'),
      ),
      isOpen ? h('div', { class: 'more' },
        conceptEl(e.spec, { potency: e.potency, dmgBase: tdef?.damage[0] }, e.concept),
        e.flavor ? h('div', { class: 'flavor' }, e.flavor) : null,
        h('div', { class: 'row' },
          e.worldFirst ? h('span', { class: 'badge red' }, 'WORLD FIRST') : null,
          e.discoveredAt ? h('span', { class: 'badge' }, `first forged ${fmtDate(e.discoveredAt)}`) : null,
          h('span', { class: 'badge' }, `made ${fmtDate(e.firstSeen)}`),
        ),
        e.spec ? h('ul', { class: 'rules' }, ...describeSpec(e.spec, { potency: e.potency }).map((l) => h('li', null, l))) : null,
      ) : null,
    );
  };

  const render = () => {
    const list = all.filter(matches);
    const count = (id: string) => list.filter((e) => e.tower === id).length;
    // A search that finds nothing on this tower moves to one where it finds something.
    if (q && !count(tower)) tower = TOWERS.find((t) => count(t.id))?.id ?? tower;
    const mine = list.filter((e) => e.tower === tower);
    const bases = [...new Set(mine.map((e) => e.powers[0]))].sort((a, b) => (POWER_BY_ID.get(a)?.name ?? a).localeCompare(POWER_BY_ID.get(b)?.name ?? b));
    if (base && !bases.includes(base)) base = '';
    const gs = groups(mine.filter((e) => !base || e.powers[0] === base));
    const pages = Math.max(1, Math.ceil(gs.length / PER_PAGE));
    page = Math.min(page, pages - 1);
    const tdef = TOWER_BY_ID.get(tower)!;

    mount(body,
      h('div', { class: 'ctabs' }, ...TOWERS.map((t) => h('div', {
        class: `ctab ${t.id === tower ? 'sel' : ''} ${count(t.id) ? '' : 'empty'}`,
        on: { click: () => { tower = t.id; base = ''; page = 0; open = ''; render(); } },
      }, towerIcon(t.id, 1, 26), h('span', null, t.name), h('span', { class: 'n' }, String(count(t.id)))))),
      h('div', { class: 'cpage' },
        h('div', { class: 'row chead' },
          h('span', { class: 'grow' }, `${tdef.name}: ${mine.length} made`, h('span', { class: 'small muted' }, ` of ${PER_TOWER.toLocaleString()} possible`)),
        ),
        bases.length > 1 ? h('div', { class: 'bases' },
          h('span', { class: `chip ${base ? '' : 'sel'}`, style: tone('#777'), on: { click: () => { base = ''; page = 0; render(); } } }, `All ${mine.length}`),
          ...bases.map((b) => {
            const pw = POWER_BY_ID.get(b);
            return h('span', { class: `chip ${base === b ? 'sel' : ''}`, style: tone(pw?.color ?? '#999'), on: { click: () => { base = b; page = 0; render(); } } },
              `${pw?.name ?? b} ${mine.filter((e) => e.powers[0] === b).length}`);
          })) : null,
        gs.length
          ? h('div', { class: 'crows' }, ...gs.slice(page * PER_PAGE, (page + 1) * PER_PAGE).flatMap((g) => [
            g.pair ? row(g.pair, false) : null,
            ...g.triples.sort((a, b) => a.name.localeCompare(b.name)).map((t) => row(t, !!g.pair)),
          ]))
          : h('div', { class: 'stat-line' }, q ? 'No fusions match.' : `No fusions on the ${tdef.name} yet.`),
        pages > 1 ? h('div', { class: 'pager' },
          h('button', { class: 'btn grey', disabled: page === 0, on: { click: () => { page--; render(); } } }, '‹'),
          ...Array.from({ length: pages }, (_, i) => h('button', { class: `btn ${i === page ? 'gold active' : 'grey'}`, on: { click: () => { page = i; render(); } } }, String(i + 1))),
          h('button', { class: 'btn grey', disabled: page >= pages - 1, on: { click: () => { page++; render(); } } }, '›'),
        ) : null,
      ),
    );
  };

  const search = h('input', {
    class: 'search', attrs: { placeholder: 'Search fusions...' },
    on: { input: (ev: Event) => { q = (ev.target as HTMLInputElement).value.toLowerCase(); page = 0; render(); } },
  });
  render();
  return { search, body };
}
