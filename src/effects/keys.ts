// Fusion keys. Power ORDER matters: the first socket is the base power (the
// heart of the design), the second shapes it, the third adds a twist.
// 10 towers x (40^2 pairs + 40^3 triples) = 656,000 fusions.

export const KEY_VERSION = 'v1';

export function fusionKey(tower: string, powers: readonly string[]): string {
  return `${KEY_VERSION}:${tower}:${powers.join('>')}`;
}

export function parseKey(key: string): { tower: string; powers: string[] } | null {
  const m = /^v1:([a-z]+):([a-z]+(?:>[a-z]+){0,2})$/.exec(key);
  if (!m) return null;
  return { tower: m[1], powers: m[2].split('>') };
}

/** Key of the fusion this one evolved from (triple -> pair), or null. */
export function parentKey(key: string): string | null {
  const p = parseKey(key);
  if (!p || p.powers.length < 3) return null;
  return fusionKey(p.tower, p.powers.slice(0, 2));
}

export const TOTAL_FUSIONS = 10 * (40 * 40 + 40 * 40 * 40);
