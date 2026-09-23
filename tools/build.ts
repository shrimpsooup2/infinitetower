// Static build of the game for GitHub Pages (or any static host).
// Follows the imports from src/client/main.ts, strips the TypeScript types,
// renames .ts to .js, and writes index.html pointing at the forge backend.
//
//   API_BASE=https://my-forge.example.com node tools/build.ts [outDir]
//
// Without API_BASE the site still works: the game uses offline fusions.

import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] ?? 'dist');
const apiBase = (process.env.API_BASE ?? '').trim().replace(/\/+$/, '');

if (apiBase && !/^https?:\/\/[^\s"'<>]+$/.test(apiBase)) {
  console.error(`API_BASE must be an http(s) URL, got "${apiBase}"`);
  process.exit(1);
}

/** Relative import specifiers in a module (static, re-export and dynamic). */
const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g;

rmSync(out, { recursive: true, force: true });
const seen = new Set<string>();
const queue = [join(root, 'src/client/main.ts')];
while (queue.length) {
  const file = queue.pop()!;
  if (seen.has(file)) continue;
  seen.add(file);
  const rel = relative(root, file);
  if (rel.startsWith('src/server')) throw new Error(`client code must not import server code: ${rel}`);
  const js = stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'strip' }).replace(IMPORT_RE, (_m, pre: string, q: string, spec: string) => {
    if (spec.endsWith('.ts')) {
      queue.push(resolve(dirname(file), spec));
      return `${pre}${q}${spec.slice(0, -3)}.js${q}`;
    }
    return `${pre}${q}${spec}${q}`;
  });
  const dest = join(out, rel.replace(/\.ts$/, '.js'));
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, js);
}

copyFileSync(join(root, 'src/client/style.css'), join(out, 'src/client/style.css'));
let html = readFileSync(join(root, 'index.html'), 'utf8').replace('./src/client/main.ts', './src/client/main.js');
if (apiBase) html = html.replace('<script type="module"', `<script>window.IT_API_BASE = ${JSON.stringify(apiBase)};</script>\n  <script type="module"`);
writeFileSync(join(out, 'index.html'), html);
// Serve files as-is on GitHub Pages (no Jekyll processing).
writeFileSync(join(out, '.nojekyll'), '');

console.log(`Built ${seen.size} modules into ${relative(root, out) || '.'}${apiBase ? ` (forge API: ${apiBase})` : ' (no API_BASE: offline fusions only)'}`);
