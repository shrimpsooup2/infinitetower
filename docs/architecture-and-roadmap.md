# Architecture and Roadmap

## 1. Stack: zero runtime dependencies

The whole game (server, simulation, client) is TypeScript with **no npm runtime
dependencies**:

| Need | Built on |
| --- | --- |
| Run TypeScript on the server | Node 22.18+ native type stripping (erasable syntax only: no enums, namespaces or parameter properties) |
| Serve TypeScript to the browser | `node:module` `stripTypeScriptTypes`, cached by file modification time. Browsers load `src/client/main.ts` as a native ES module. |
| Database | `node:sqlite` (`DatabaseSync`, WAL) |
| Balance workers | `node:worker_threads` |
| HTTP | `node:http` |
| Rendering | Canvas 2D (no engine) |
| Audio | WebAudio synth presets (no sound files) |
| Tests | `node:test` |

The only dev dependencies are `typescript` and `@types/node`, for `npm run typecheck`.
`tsconfig.json` enforces `erasableSyntaxOnly` and `verbatimModuleSyntax`, so what `tsc`
accepts is exactly what Node and the stripper can run.

## 2. Module map

```
src/
  sim/            World (commands, fixed 60 Hz step, snapshot / restore), towers (8 chassis),
                  enemies (movement, abilities, modifiers), entities (projectiles, zones,
                  drones), combat, path, spatial hash, seeded RNG (sfc32)
  effects/        types, schema builder (validation + JSON Schema), dsl (limits, schemas,
                  cheat sheet), validate, runtime (rule dispatch, actions, values, selectors),
                  vfxlib (41 recipes), describe (spec -> English), lint, combiner (offline
                  fusions), keys
  content/        towers, powers (40 hand-made specs), enemies (2D / 3D / 4D and bosses),
                  waves (budget generator), maps (9 + tutorial), packs, rarity, rules
                  (difficulties, economy), twists, colours
  balance/        bench: benchmark scenarios and the potency solver
  server/         app (HTTP, static + TS stripping, API, rate limit), db (SQLite store),
                  forge/ (prompt, examples, llm, pipeline, balancer, balance-worker), main
  client/         main (title, campaign, codex, settings), game (loop, input, HUD, packs,
                  hand, side panel), tutorial, forge client, storage, audio,
                  render/ (renderer, fx, draw, tower-art, enemy-art, geometry, pack-art), ui/dom
tests/            effects, sim, forge (node:test)
tools/            bot (playtest), pregen (seed the database), screenshot (Playwright)
```

## 3. Key design decisions

- **Deterministic simulation.**
  - A fixed 60 Hz step and a seeded RNG, and no `Math.random` in the sim.
  - Enemies store their distance along the path rather than free positions.
  - The sim emits `FxEvent`s that the renderer consumes. The sim never draws, and the
    renderer never changes game state.
  - Together these make benchmarks reproducible, runs saveable (snapshot / restore between
    waves), and the bot and tests trustworthy.
- **Commands are World methods** (`place`, `upgrade`, `socket`, `callWave`, `openPack`, ...).
  They return an error string or a result. The UI, the bot and the tests all drive the game
  the same way.
- **Specs are data.** The same interpreter runs hand-made powers, offline combinations and
  model-designed fusions. Adding a mechanic means adding one action, trigger or layer to the
  language, and every fusion can then use it.
- **The server owns truth for fusions.** The client keeps a local Codex (your own
  discoveries) and never trusts client-supplied specs.
- **The game still works without its services.** With no server or no model, towers play
  offline combinations.

## 4. Rendering

- A cached background layer holds the grid, arena, road with chevrons, spawn and exit bases,
  and rocks. Entities are drawn each frame, interpolated between sim steps.
- The Fx system is a pooled particle system plus beams, shapes, orbiters and text. It
  interprets the VFX language directly, so model-designed looks need no new code.
- **Towers** (`tower-art.ts`) are inked plinth-and-head emplacements, drawn procedurally per
  chassis and tier.
- **3D enemies** (`geometry.ts`, `enemy-art.ts`):
  - the polyhedra are built from textbook coordinates (golden-ratio permutations), with
    edges at minimum distance and faces from a convex-hull pass;
  - they are shaded like an early-2000s render: per-vertex lighting bent toward the face
    normal (drawn as a gradient across each face), Blinn-Phong specular hotspots, a fresnel
    rim and sky-tinted upward faces;
  - they are drawn on an offscreen buffer at roughly half resolution, with alpha snapped to
    hard edges, then scaled up with nearest-neighbour sampling onto a screen-aligned grid,
    for a touch of aliasing.
- **4D enemies** are rotated in the XW and ZW planes, projected with perspective, and drawn as
  wireframes.

## 5. Testing and tuning

- `npm test` runs 24 cases:
  - every authored spec validates;
  - the validator survives 2,000 random fuzz specs;
  - 300 random offline fusions validate;
  - keys and rules text behave;
  - the sim is deterministic and save/restore safe;
  - a final-wave leak is a defeat;
  - all 400 tower × power pairs run;
  - wave and pack rules hold;
  - polytope vertex, edge and face counts (and Euler's formula) are right;
  - the forge works end to end with the mock model, including numbering, World Firsts,
    lineage, the provisional fallback and the HTTP API;
  - the static build is plain JS with no server code, and the deployment guards (CORS
    allowlist, daily cap, spoof-proof per-IP limit) hold.
- `npm run bot -- all normal 2` plays the campaign headlessly and prints the result per map
  (waves reached, lives, towers by tier, fusions, time). Set `BOT_TRACE=1` to also print lives
  per wave and the economy totals. It takes about 2 s per map.
- `tools/screenshot.ts` drives every screen in headless Chromium, including a gallery of every
  3D, 4D and boss shape, and reports page errors.

## 6. Deployment

One Node process serves the game, the API and the forge, with one SQLite file. The public
setup puts a static build of the game on GitHub Pages (`tools/build.ts`, published by
`.github/workflows/pages.yml`) and runs this server from the `Dockerfile` as the API, with the
key as a host secret. See [deploy.md](deploy.md).

- Set `OLLAMA_API_KEY` (and optionally `OLLAMA_MODEL`, `OLLAMA_FORMAT`, `OLLAMA_THINK`).
  `FORGE_CONCURRENCY` limits parallel model calls, `FORGE_RATE_LIMIT` limits new generations
  per IP per hour, `FORGE_DAILY_CAP` limits them per day across everyone, and
  `BALANCE_WORKERS` sets the solver's thread count. For a browser site on another origin,
  set `CORS_ORIGINS`, and behind a hosting proxy, `TRUST_PROXY=1`.
- Keep `data/` on a persistent volume. Everything else is stateless.
- Before launch, `npm run pregen -- N` can seed the database so early players meet existing
  fusions.
- Never commit `.env` (it's gitignored). Put the key in the host's secret store.

## 7. Roadmap

Built:

- simulation, effect and VFX language, 10 towers, 40 powers;
- enemies across 2D, 3D and 4D, 6 bosses;
- 9-map campaign, 4 difficulties, endless mode;
- card packs, rarities and exclusive powers;
- the forge with Ollama, validation, lint, novelty, balance by simulation and lineage;
- discovery numbers, World Firsts, the local Codex;
- the tutorial, tests, playtest bot and pregen tool.

Next:

1. **Real-model shakedown.** Run `pregen` against the chosen Ollama cloud model. Read
   `gen_log` for common repair reasons, and tune the prompt and lint (`PROMPT_VERSION`
   records which prompt made each fusion).
2. **Card and pack art.** Illustrated card faces per power family, rarity frames with foil
   and animated glints, and distinct pack designs with a tear-open animation.
3. **Human playtests** of the Act II and III curve. The bot is a floor, not a player.
   Retune the wave budget, boss HP and economy from real runs.
4. **Worldwide Codex browser.** Browse and search all discovered fusions by number (names and
   rules only after you've made them yourself, keeping the no-preview rule).
5. **Daily challenge.** A seeded map and a fixed card pool, with a shared leaderboard by
   waves reached (anonymous).
6. **Mobile layout** polish (touch placement, a compact side panel).
7. **Moderation hooks** for fusion names: a banned-word list and a report button, with
   regeneration by admin.
