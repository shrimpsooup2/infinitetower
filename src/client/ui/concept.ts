// A fusion's concept with its live numbers: each quoted number is shown at the
// tower's real value, green if it grows with level (hover for the step), gold
// for damage (which grows with the tower's damage).

import type { FusionSpec } from '../../effects/types.ts';
import { renderConcept, stripTokens, type ConceptView } from '../../effects/concept.ts';
import { LEVELS } from '../../content/towers.ts';
import { h } from './dom.ts';

export function conceptEl(spec: FusionSpec | null, view: ConceptView = {}, text = ''): HTMLElement {
  if (!spec) return h('div', { class: 'concept' }, stripTokens(text));
  const step = (per: number) => `${per > 0 ? '+' : '−'}${Math.round(Math.abs(per) * 100) / 100} per level`;
  return h('div', { class: 'concept' }, ...renderConcept(spec, view).map((p) => {
    if (p.grows) return h('span', { class: 'num dmg', title: `Damage: grows ${Math.round(LEVELS.damage * 100)}% per level` }, p.text);
    if (p.per) return h('span', { class: 'num lvl', title: step(p.per) }, p.text);
    if (p.per === 0) return h('span', { class: 'num', title: 'Fixed' }, p.text);
    return p.text;
  }));
}
