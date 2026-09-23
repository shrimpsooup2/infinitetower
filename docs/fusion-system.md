# The Fusion System

Every tower + ordered power combination is a **fusion**. The first time anyone makes one, an
LLM designs it in a safe effect language. The server validates it, checks its quality,
balances it by simulation and stores it with a discovery number. After that it is shared with
every player, forever.

Source: `src/effects/` (the language), `src/balance/` (the solver) and `src/server/forge/`
(prompt, model client, pipeline).

---

## 1. Combinations

- A tower holds up to 3 powers **in order**: base > secondary > tertiary. Each one has less
  pull on the design than the one before (roughly 60 / 30 / 10). Frost > Echo and Echo > Frost
  are different fusions.
- Repeats are allowed (Ember > Ember is a "doubled" fusion).
- **Count:** 10 towers × (40² pairs + 40³ triples) = **656,000** fusions.
- **Key:** `v1:<tower>:<base>><secondary>[><tertiary>]`, for example `v1:arc:frost>echo`.
  The `v1` is the version of the effect language.
- A single power isn't a fusion. Each power has a hand-made spec (`src/content/powers.ts`)
  that works on any tower.
- **Triples evolve pairs.** A triple's parent is its first two powers. The parent is forged
  first, and the triple has to keep the parent's identity (see §5.4).

---

## 2. The effect language

The model never writes code. It returns one JSON object, a `FusionSpec`, which the engine
interprets. The schema lives in `src/effects/dsl.ts`, which also generates the JSON Schema
(about 39 KB) and the cheat sheet the prompt includes.

### 2.1 Shape of a spec

```jsonc
{
  "dsl": 1,
  "concept": "one sentence: the idea a player gets in five seconds",
  "name": "Glacial Carillon",          // 1-3 words, unique, at most 32 characters
  "flavor": "a line of flavour text",
  "stats":   { "damage_mult": 0.9, "rate_mult": 1.1, "chains": 1, "crit_chance": 0.1 },
  "attack":  { "motion": "sine", "look": { ... } },  // optional change to the basic attack
  "vars":        [ ... ],   // up to 3 counters that live on the tower
  "statuses":    [ ... ],   // up to 2 custom statuses (stacks, tick, on_expire, on_death, look)
  "projectiles": [ ... ],   // up to 2 custom projectiles (11 motions, on_hit, on_end, look)
  "zones":       [ ... ],   // up to 2 custom zones (shape, tick, on_enter, slow, look)
  "vfx":         [ ... ],   // up to 6 custom visual effects, each with up to 4 layers
  "rules":       [ ... ],   // 1-6 rules: trigger -> conditions -> actions
  "visual": { "body": "crystal", "aura": "snowfall", "impact": "b_bell", "kill": "shatter", ... },
  "sound":  { "attack": "chime", "pitch": 1.2 }
}
```

### 2.2 Rules

A rule is **trigger → up to 3 conditions → up to 5 actions**.

- **Triggers (18):** on_attack, on_hit, on_kill, on_crit, every_nth_attack, every, on_beat,
  on_idle, on_enemy_enters_range, on_enemy_leaves_range, on_status_applied,
  on_status_expired, on_enemy_dies_in_range, on_projectile_end, on_var_reached,
  on_wave_start, on_wave_end, on_ally_hit.
- **Conditions (14):** chance, cooldown, target_hp_below / above, target_has_status /
  lacks_status, target_is / is_not (a trait), var_at_least / below,
  enemies_in_range_at_least, target_distance, first_hit_on_target, every_nth.
- **Actions (26):** damage, explode, execute, apply_status, remove_status, consume_status,
  spread_statuses, knockback, pull, teleport_along_path, rewind_position, swap_positions,
  shrink, fire_projectile, create_zone, summon_drone, repeat_attack, modify_tower, set_var,
  add_var, grant_gold, restore_life, reveal, break_shield, vfx, sound. Any action can take a
  `delay` or a `repeat`.

The building blocks:

- **Values** are numbers or small expressions:
  - `{"dmg": x}` is x times the tower's damage. It is required for all damage, because it is
    what the balancer scales.
  - Readers: `{"var"}`, `{"stacks"}`, `{"target_hp_pct"}`, `{"enemies_in_range"}`,
    `{"random": [a, b]}`.
  - Arithmetic: `add`, `mul`, `min`, `max`, up to 3 levels deep.
- **Selectors** pick who is affected: target, all in range, a radius, random / strongest /
  weakest / first / last n, nearest, a chain, or everyone with a status.
- **Points** pick where: target, impact point, the tower, a random spot in range, or n tiles
  ahead of or behind on the path.
- **Built-in statuses (12):** burn, poison, chill, freeze, stun, root, shock, mark, weaken,
  fear, bleed, curse. Custom statuses stack with these.
- **Damage types (6):** kinetic, fire, frost, shock, toxic, arcane. Enemies can resist or
  adapt to them.

### 2.3 The VFX language

How a fusion looks is half its design, so the visual vocabulary is large enough for the model
to draw almost anything.

- **Layers**, up to 4 per effect:
  - `particles`: 14 shapes (spark, shard, smoke, petal, flake, drop, bubble...). Emitters
    control count, direction (radial, up, cone, inward, along...), speed, life, size and
    alpha curves, colour to end-colour, glow, spin, gravity and drag.
  - `beam`: 9 styles (solid, dashed, dotted, wave, helix, zigzag, lightning, chain, twin),
    with width, core colour, jitter and scroll.
  - `shape`: circle, ring, polygon, star, cross, crescent, spiral, rays and glyph, with
    radius and alpha curves, rotation, concentric copies, dashes and glow.
  - `orbiters`: things circling the point.
  - `text`: popups.
  - `shake`: screen shake.
- **Colours:** `base`, `secondary` and `tertiary` (the powers' colours, in socket order),
  `damage` (the colour of the damage type), or any `#rrggbb`.
- **Hooks:** the spec's `visual` block names effects for the tower `body` decoration
  (spikes, gear, petals, shell, crystal, eye, core, halo_ring, fins), its `aura`, `muzzle`,
  `impact` and `kill` effects, and its projectile, beam and spray looks. Statuses get overlays
  (flames, bubbles, sparks, cracks, chains...) and zones get styles (ripples, spiral,
  hazard, glyph, vortex...).
- **Built-in library:** 41 ready-made effects the model can reference by name (pop, ring,
  shatter, implode, shockwave, lightning, laser, pillar, mist, snowfall, embers, vortex...).
  They live in `src/effects/vfxlib.ts`.
- **Sounds:** 10 synth presets (pew, zap, boom, chime, thud, hiss, warble, pluck, laser,
  whoosh), with pitch.

### 2.4 Safety

`validateSpec` checks the whole spec against the schema:

- Numbers are **clamped** into range rather than rejected.
- Unknown fields are dropped.
- It checks references: statuses, projectiles, zones, vars and vfx must exist.
- Every damage value must use `dmg`.
- Triggers with no target (such as `every`) can't use `target`.

At runtime the engine limits how deep chained spawns can go and how often they fire, caps
restored lives at the maximum, and keeps crowd control from becoming permanent.

---

## 3. The forge pipeline

`src/server/forge/pipeline.ts`:

```
request(key)
  └ stored and ready? ────────────────────────────── return it
  └ same key already forging? ────────────────────── join that job
  └ queue (players waiting are served first)
      └ triple: forge the parent pair first
      └ LLM design ──► extract JSON ──► validate ──► lint ──► novelty ──► balance
            ▲                                                               │
            └──────────── problems fed back as a repair message (up to 3) ◄─┘
      └ save with the next discovery number
      └ total failure: save the offline combination as PROVISIONAL (no number)
                       and retry in the background every 10 minutes
```

### 3.1 The prompt

`src/server/forge/prompt.ts`, versioned (`PROMPT_VERSION`) and stored with every fusion.

- **The system prompt** gives the model:
  - its role, The Forge;
  - how ordered sockets work;
  - what makes a great fusion: one clear idea, emergent rather than additive, built for its
    chassis, at least one new noun, a payoff moment, and a look that matches the concept;
  - what to avoid: pure stat boosts, re-used power effects, dead mechanics, loops, glued-on
    names;
  - game facts for scale: map size, speeds, dimensions, modifiers, ranges, HP growth;
  - the full language cheat sheet and the output format.
- **Worked examples:** four hand-made pair fusions (Glacial Carillon, Miasma Maelstrom, Solar
  Verdict, Monsoon Barrage) and one evolution (Thunder-Rung Carillon). All of them pass
  validation, lint and balance. The pair prompt picks the examples that best match the
  request.
- **The pair prompt:**
  - the tower card (chassis, stats, what its attack does);
  - the base and secondary power cards with their roles;
  - a random **twist seed** from about 80 seeds, to push variety;
  - an **avoid list** of existing fusions on the same tower with the same base, so siblings
    differ.
- **The triple prompt:** the parent spec in full, the tertiary card, the evolution rules
  (keep the parent, add a twist, use the tertiary colour prominently, evolve the name), and
  the other tertiary evolutions of the same parent to differ from.
- **Repair messages** list the exact problems and ask for a complete corrected spec.

### 3.2 Model client

`OllamaLLM` posts to `{OLLAMA_HOST}/api/chat` with the API key as a Bearer token. It works
with Ollama's cloud (`https://ollama.com`) and with a local Ollama.

- The output format can be free JSON (the default), the full JSON Schema (structured
  output), or none. It falls back automatically if the server rejects the format.
- It sets `num_ctx` 32k, `keep_alive`, and optionally `think` for reasoning models.
- `extractJson` pulls the first complete object out of a reply, tolerating code fences, prose
  and trailing commas.

`MockLLM` is a deterministic stand-in. It returns the offline combination under a new name,
answers repair requests and evolves triples from the parent quoted in the prompt, so the
whole pipeline can run in tests.

### 3.3 Quality lint

`lintFusion` rejects designs that are valid but weak:

- it only changes stats or vars;
- it uses fewer than two kinds of effect action (pairs);
- every rule uses the same trigger;
- the base power isn't recognisable in the mechanics;
- the secondary power doesn't visibly shape them;
- it's nearly identical to the plain base power;
- it's visually bland, using fewer than three visual hooks, custom effects or vfx actions.

Softer notes, such as the secondary dominating the base or no custom vfx, are logged but don't
block. For triples, lint also checks that the tertiary changed something and compares the spec
against the parent (see §5.4).

### 3.4 Novelty

Each spec gets a signature: its triggers, actions, templates and motions. A new fusion must
not be too similar to its siblings (same tower and base): the Jaccard similarity limit is
0.85. Names must be unique across the database.

---

## 4. Balance by simulation

The model decides what a fusion **does**. The solver (`src/balance/bench.ts`) decides how
**strong** it is. It runs in worker threads.

- **Four benchmark scenarios** on a fixed test map:
  - a lone tough boss (an Octahedron at ×12 HP);
  - a swarm of Triangles and Squares;
  - armoured Octagons;
  - a mixed wave with flyers, shields and healers.
- **Score:** each scenario is scored on damage dealt, crowd control (how much progress was
  denied), effect gold and restored lives, compared with the same tower with no powers. The
  blended ratio is 0.6 × mean + 0.4 × best. That lets a specialist that shines in one
  scenario count.
- **Target by socket count:**

  | Sockets | Tier | Target | Tolerance |
  | --- | --- | --- | --- |
  | 1 | 1 | ×1.3 | ±0.15 |
  | 2 | 2 | ×1.6 | ±0.2 |
  | 3 | 3 | ×2.0 | ±0.25 |

- **Potency** is one multiplier, searched from 0.1 to 2. It scales every `{dmg}` value
  linearly. Slows, damage amps, zones and displacement scale by √potency (movement capped at
  ×1.3).
- **Deliberately loose.** Balance is meant to keep fusions sane, not make them identical.
  - "Niche" designs that never reach the target run at maximum potency.
  - A design is only sent back as too strong if it still exceeds 1.6× the target at 10%
    potency.
  - Difficulty lives in the enemies, not in flattening fusions.
- In play, potency is multiplied by the **rarity factor** of the socketed cards.

---

## 5. Storage, numbering and lineage

### 5.1 Database

SQLite (`node:sqlite`, WAL). The `fusions` table stores, per key:

- tower, base, powers, parent key;
- status (`ready` or `provisional`);
- name, concept, flavour, spec JSON;
- potency, balance report and ratio;
- signature, effect-language, prompt and model versions, attempts;
- **discovery_no** (unique, only for `ready` fusions);
- **discovered_at** and a forged count.

`gen_log` keeps every attempt's raw output and the problems found with it, for improving the
prompt.

### 5.2 Discovery numbers and credit

- When a fusion is saved as ready it gets the next number (Fusion #1, #2, ...) and a date.
  Provisional fusions have no number until the forge succeeds.
- **No player names are stored or shown.** Credit is the number and the date.
- **World First:** the player whose request started the job gets an owner token, and the
  client celebrates when that player's fusion lands. Anyone else who makes the fusion later
  gets it instantly, labelled "first forged <date>".

### 5.3 The client side

`src/client/forge.ts`:

1. Single powers apply instantly.
2. For a pair or triple, a fusion already in the local **Codex** (localStorage, up to 300
   specs) applies instantly.
3. Otherwise the tower immediately plays the offline combination, shown as forging, while the
   client posts the key and polls with its token.
4. When the fusion lands it replaces the offline one live, goes into the Codex, and triggers
   a banner.
5. If the server is down, the offline combination stays. It is marked offline and never
   numbered.

The Codex is also what makes previews possible. The side panel shows a fusion's rules only if
it is already in your Codex.

### 5.4 Lineage (triples)

A triple is an **evolution** of its pair. `specDiff` against the parent allows:

- at most 2 modified rules;
- at most 1 removed rule;
- at most 2 added rules;
- at most 2 new templates.

The tertiary also has to change something. The prompt asks the model to show the twist in
the visuals using the `tertiary` colour. So a pair's identity carries through all 40 of its
triples, and the tertiary really is a twist.

---

## 6. HTTP API

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/health` | `{ ok, forge, model }` |
| GET | `/api/stats` | Discovered count, total (656,000), forge status |
| POST | `/api/forge` `{key}` | `200` with the fusion if it's ready. `202` `{status, position, token}` if it's queued or forging. `429` with status `rate_limited` over the per-IP hourly limit for new generations, or `daily_cap` once today's global budget is used. `400` for a bad key. |
| GET | `/api/forge?key=&token=` | Status or result. `worldFirst` is true only for the job's owner token. |

Static files: `index.html` and `src/**` (TypeScript is served stripped of its types).
`src/server/**` is never served.

---

## 7. Offline fusions

`offlineFusion` (`src/effects/combiner.ts`) builds a playable combination from the power specs
with no model:

- the base power at full strength and the secondary scaled to 0.6 (the tertiary to 0.3);
- template ids prefixed per socket (`a_`, `b_`, `c_`);
- one of 16 deterministic "twists" chosen by the key.

It is the fallback everywhere: before a forge result arrives, when the server is down, and as
the provisional spec when the model fails. It also powers the playtest bot and the tests.
