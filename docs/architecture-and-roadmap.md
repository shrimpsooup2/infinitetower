# Architecture & Roadmap

---

## 1. Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Language | **TypeScript everywhere** | One simulation codebase runs in the browser (gameplay) *and* on the server (balance solving, validation) |
| Rendering | **PixiJS v8** (WebGL/WebGPU) | Fast 2D batching for thousands of sprites and particles. Unlike Phaser, it doesn't bring a scene or physics framework we'd have to fight |
| UI overlay | **Preact + signals** | Tiny. Menus, the tower panel, the codex and tooltips are text-heavy, and DOM is better than canvas text for that (accessibility, selection, layout) |
| Build / dev | **Vite**, **pnpm workspaces** | Fast HMR. Shared packages across client, server and tools |
| Server | **Node 22 + Hono** | Small and fast, with first-class streaming for SSE forge progress |
| Database | **SQLite** (better-sqlite3 + Drizzle) | Nothing to operate, one file, easily handles this write volume. Move to Postgres only if we ever run several server instances |
| Schemas | **Zod 4** | One definition gives runtime validation *and* JSON Schema (`z.toJSONSchema`) for Ollama's `format` |
| LLM | **Ollama** behind an `LLMProvider` interface | Local and free per generation. The interface lets an OpenAI-compatible endpoint be swapped in later |
| Tests | Vitest · fast-check (fuzzing) · Playwright (smoke) | See §6 |

---

## 2. Repo layout

```
infinitetower/
├─ apps/
│  ├─ client/            Vite + PixiJS + Preact
│  │  └─ src/  render/  ui/  audio/  net/  cache/ (IndexedDB)
│  └─ server/            Hono + SQLite + forge pipeline
│     └─ src/  api/  forge/  llm/  db/  queue/  balance/ (worker_threads)
├─ packages/
│  ├─ sim/               deterministic engine: world, systems, path-following, spatial hash, RNG
│  ├─ effects/           primitive registry, interpreter, schema + cheat-sheet generators,
│  │                     validator, fusion lint, describer (spec → tooltip), offline combiner
│  └─ content/           towers, powers (base specs), enemies, bosses, maps, wave rules, twist seeds
├─ tools/
│  ├─ eval/              model/prompt eval harness + review page
│  ├─ pregen/            pre-generation CLI
│  └─ balance/           sim-driven balance reports for the base content
└─ docs/
```

`packages/sim` and `packages/effects` have **no DOM dependencies**. They run in the browser, in
Node and in workers.

---

## 3. Simulation design

- **Fixed 60 Hz tick.** The renderer interpolates between the last two states. Time scale
  (1×/2×/3×) runs more ticks per frame. It never changes `dt`.
- **Deterministic:** a seeded PRNG (sfc32) per run, and no `Math.random`/`Date` inside the sim.
  All player input is **commands** (place, upgrade, sell, socket, set target mode, call wave)
  applied at tick boundaries. So **save and replay = seed + command log** (+ periodic snapshots),
  and daily-challenge leaderboards can later be checked by replaying the run on the server.
  A forge result that arrives mid-run is recorded as a command ("apply spec hash H at tick T").
- **Enemies store their position as distance along the path** (1D), turned into x/y when needed.
  Path-manipulation effects become trivial (push back = subtract distance). A small
  position-history ring buffer (about 3 s at 10 Hz) powers `rewind_position`.
- **Spatial hash** (cell = 2 tiles) handles every range and radius query.
- **Event bus:** the sim emits typed events each tick (`hit`, `kill`, `status_applied`,
  `projectile_end`, …). Two things consume them:
  1. the **rule dispatcher**, which has rules indexed by trigger type, so dispatch costs
     O(rules subscribed to that event);
  2. the **renderer and audio**, through a per-tick event list. The sim never touches Pixi.
- **Budgets are enforced inside the sim** (see fusion-system §10). A runaway fusion gets
  clipped. It can't crash the game or tank the frame rate.

### Performance targets
- 400 enemies + 1,500 projectiles + 3,000 particles at 60 fps on an integrated GPU.
- Worst-case sim tick ≤ 4 ms. Object pools for projectiles and particles. Pixi
  `ParticleContainer` for particles.

---

## 4. Art and audio direction

- **Procedural "neon geometry on dark slate."** With 123k fusions we can't hand-draw anything
  fusion-specific, so everything is procedural vector art, baked into a texture atlas at startup.
  - Towers are layered geometric shapes. Fused towers get a crown ring of their powers' family
    glyphs in the fusion's palette, plus the fusion's aura.
  - Enemies are distinct silhouettes: shape = type, size = weight, rim color = resist.
  - Fusion visuals = palette × projectile shape × trail × impact × aura (fusion-system §4.5).
    That's thousands of distinct looks at no art cost.
  - Meaning is carried by **shape and icon first, color second** (colorblind-safe).
- **Audio:** sfxr-style synthesized SFX from parameter presets in WebAudio. Fusions choose a
  preset and a pitch. Voices are capped and sounds are throttled per event type, so a 30-chain
  lightning fusion doesn't become white noise. A few ambient music loops come later.

---

## 5. Deployment

```
docker compose
  app     Node server: serves the built client + API, SQLite on a volume
  ollama  ollama/ollama with GPU passthrough; model pulled on first start
```

- **Dev:** `pnpm dev` runs Vite and the server with hot reload, pointed at an Ollama on the host
  (`localhost:11434`).
- **Config:** `OLLAMA_URL`, `OLLAMA_MODEL`, `DB_PATH`, `PREGEN_ENABLED`, `FORGE_MAX_QUEUE_PER_PLAYER`.
- The client works with **no server at all** (offline combiner + IndexedDB cache), so a static
  build could also go on any static host as a demo.

---

## 6. Testing strategy

| Test | What it guarantees |
| --- | --- |
| Primitive unit tests | Each building block does exactly what its `doc` string claims (the LLM relies on those docs) |
| Determinism golden tests | seed + command log → the same final-state hash, on every commit |
| **Spec fuzzer** | Random schema-valid specs (fast-check, driven by the JSON Schema), each run for 60 s of sim. Checks: no exceptions, limits hold, tick time stays bounded. **This is what makes "the LLM can output anything schema-valid" safe** |
| Balance regression | Sim scores for every tower and single-power combo are snapshotted. CI flags unexpected shifts |
| Describer round-trip | Every example and base spec produces non-empty, non-truncated tooltip text |
| E2E smoke (Playwright) | Load → place tower → start wave → clear wave 1 |

---

## 7. Milestones

Each milestone ends with something playable or measurable.

| # | Milestone | Scope | Done when |
| --- | --- | --- | --- |
| **M0** | Foundation | Monorepo, CI (typecheck, lint, test), sim loop + render loop, one map, path following, 1 tower, 1 enemy, debug overlay | An enemy walks the path, a tower kills it, and the determinism test passes |
| **M1** | Playable core | 5 towers (Bolt, Cannon, Frost, Arc, Mortar), 8 enemies, gold and lives, 20 waves, place/upgrade/sell, targeting, speed controls, win/lose | Playtest question: *"is it fun with zero powers?"* If not, fix it before moving on |
| **M2** | Effect language | Registry, interpreter, describer, validator, lint. Rebuild tower attacks on the effect language. All 40 powers as base specs. Sockets and drafts. Offline combiner. Spec fuzzer | All 400 single-power combos work. Any combo yields a working offline fusion. The fuzzer passes 100k specs |
| **M3** | Complete base game | The other 5 towers, 18 enemies, 4 bosses, 6 maps, 40 waves, difficulties, menus, save/resume, local codex, audio, polish, tutorial, sim-driven balance pass | Every map is winnable on Normal and genuinely hard on Hard. Outside playtesters finish runs without help |
| **M4** | Forge server | Hono + SQLite, Ollama provider, two-stage prompts, schema output, validation + repair, novelty check, potency solve in a worker, queue + dedupe, SSE, client "Forging…" UX + reveal, IndexedDB cache, eval harness | Eval: ≥ 90% of combos end `ready` with no fallback. p50 latency < 20 s on the target GPU. In blind review most fusions are rated "feels unique" |
| **M5** | Discovery layer | Global codex, world-first and first-wielder credits, live "discovered" counter, votes, pre-generation worker, admin review and moderation | All 8,200 pairs pre-generated and spot-checked |
| **M6** | Replayability | Seeded procedural maps, endless mode + mutators, daily seeded challenge with replay-checked leaderboards | — |

**Why this order:** the base game has to be good on its own (M1–M3) before we connect the LLM.
The effect language (M2) is built *before* the complete base game, because all of our own
content (tower attacks, the 40 powers) gets written in it. By the time Ollama is connected, the
language will already have been proven by 400+ hand-made effects.

---

## 8. Open questions

1. **Combo order.** The recommendation is unordered with repeats (123k fusions; see
   fusion-system §1). Or do you want order to matter (640k)?
2. **How powers are obtained.** Roguelite drafts every 3 waves (recommended), or all powers
   always available and bought with gold?
3. **Previewing known fusions.** Once someone has discovered a fusion, can other players see
   what it does *before* socketing it? The recommendation is yes: discovery is the world-first
   moment, and after that a fusion is a build tool. The alternative is to keep it hidden until
   you've forged it yourself.
4. **Where Ollama runs.** Your own PC with a GPU, or a rented GPU box? How much VRAM? That
   decides the model size and forge latency.
5. **Art direction.** Procedural neon geometry (recommended; it scales to 123k fusions for free)
   or sprite art?
6. **Player identity.** Anonymous display names (recommended to start) or real accounts?
