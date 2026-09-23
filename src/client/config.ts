// Where the forge API lives. Empty means same origin: the Node server serves
// the game and the API together. The static build for GitHub Pages sets
// window.IT_API_BASE to the backend's URL (see tools/build.ts).

const g = globalThis as { IT_API_BASE?: string };

export const API_BASE = (g.IT_API_BASE ?? '').replace(/\/+$/, '');

export function api(path: string): string {
  return `${API_BASE}${path}`;
}
