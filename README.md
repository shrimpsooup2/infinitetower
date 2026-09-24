# Infinite Tower

A web tower defense game where every tower + ordered power combination is a unique
**fusion**. The first time anyone in the world makes a combination, an LLM on Ollama's cloud
designs it. The server validates it, balances it by simulation and saves it with a discovery
number. From then on, every player who makes that combination gets the same fusion.

- **10 towers, 40 powers, 656,000 fusions.** Up to three powers per tower, in order: **base**
  (the heart of it), **secondary** (bends it) and **tertiary** (a twist). Frost > Echo and
  Echo > Frost are different fusions.
- **The model writes no code.** It builds fusions from a safe effect language: triggers,
  conditions and actions, custom statuses, projectiles and zones, and a visual-effects language
  of particles, beams, shapes, orbiters and more. So a fusion can look like anything from a mist
  sprayer to a heavy laser.
- **Discovery numbers, no names.** Fusions are numbered and dated (Fusion #1,024, first forged
  12 Mar 2027). The first player to make one gets a *World First*. You can't preview a fusion
  until you've made it yourself, and the ones you've made are kept in your browser's Codex.
- **Card packs with rarities.** Powers come as Common, Rare, Epic and Legendary cards, and you
  keep one card from each pack. Rarer cards are stronger, and the most exotic powers only come
  at high rarity.
- **Tower levels.** Level a tower up for more damage, and the numbers its fusion marks as
  growing grow too; each fusion's explanation shows its real numbers at the tower's level.
  Levels make that tower's next cards and tier cost more, so you choose what to grow first.
- **Shapes that climb through dimensions.** The first 20 waves are 2D polygons (triangle to
  tetradecagon), then 3D polyhedra rendered like early-2000s CG, then 4D polytopes that phase in
  and out of reach.
- **A complete game on its own.** It has a guided tutorial, a 3-act campaign of 15 themed maps, 4
  difficulties and endless mode. Without an LLM it still works, using offline fusions.

## Quick start

Requires **Node 22.18+**. The server runs TypeScript natively, so there are no runtime
dependencies and nothing to install.

```sh
cp .env.example .env      # then set OLLAMA_API_KEY (ollama.com -> Settings -> API keys)
npm start                 # http://localhost:8787
```

With no key the game still runs, and fusions come from the offline combiner. For development
without a key, `LLM_PROVIDER=mock npm start` uses a deterministic fake model that exercises the
whole forge pipeline. A local Ollama works too: `OLLAMA_HOST=http://localhost:11434`.

| Command | What it does |
| --- | --- |
| `npm start` / `npm run dev` | Run the server (dev restarts on changes under `src/`) |
| `npm test` | Test suites: effect language, simulation, forge and API |
| `npm run typecheck` | `tsc` over everything (install `typescript` and `@types/node` for this) |
| `npm run build` | Static build of the game into `dist/` (for GitHub Pages; set `API_BASE`) |
| `npm run bot -- all normal 2` | Headless playtest bot over the campaign, for tuning difficulty |
| `npm run pregen -- 25` | Pre-forge 25 random fusions (or pass `v1:tower:a>b` keys) |

`tools/screenshot.ts` drives the game in headless Chromium (needs `playwright`) and saves
screenshots of every screen.

## Putting it online

The game can be published for free: **GitHub Pages** for the game, a free **Render**
server holding your Ollama key, and **Firebase Firestore** for the shared fusion database.
The key never goes into the site. See **[docs/deploy.md](docs/deploy.md)** for the steps.

## Layout

```
src/sim/        deterministic 60 Hz simulation (World, towers, enemies, projectiles)
src/effects/    the effect language: types, schema, validator, runtime, VFX library,
                describer, lint, offline combiner
src/content/    towers, powers, enemies, waves, maps, packs, rarities, rules
src/balance/    benchmark scenarios and the potency solver
src/server/     HTTP server, fusion stores (SQLite / Firestore), the forge (prompt, Ollama client, pipeline)
src/client/     Canvas renderer, UI, tutorial, audio, local storage, forge client
tests/          node:test suites
tools/          playtest bot, pregen, screenshots
```

## Docs

| Doc | What's in it |
| --- | --- |
| [docs/game-design.md](docs/game-design.md) | The game: loop, towers, cards and packs, enemies by dimension, campaign, economy, tutorial, art direction |
| [docs/fusion-system.md](docs/fusion-system.md) | Fusions: ordered combos, the effect and VFX language, the forge pipeline, balance by simulation, lineage, storage and API |
| [docs/architecture-and-roadmap.md](docs/architecture-and-roadmap.md) | The zero-dependency stack, module map, determinism, testing, deployment, what's next |
| [docs/deploy.md](docs/deploy.md) | Going public for free: GitHub Pages, Render and Firebase, plus spend caps |
