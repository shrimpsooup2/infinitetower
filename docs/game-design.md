# Game Design — Infinite Tower

This doc covers the base tower defense game. The fusion system sits on top of it (see
[fusion-system.md](fusion-system.md)), but the base game has to be fun and complete on its
own, with no server and no LLM.

---

## 1. Design goals

1. **A tactical TD first.** Every mechanic must be easy to read on screen at 2× speed. If a
   player can't tell why an enemy got through, the design has failed.
2. **Discovery is the reward.** The player should always want to try "what happens if I put
   *these* on *that*?"
3. **Fusions change how a tower plays, not just its numbers.** A fusion that only adds +% is a
   bug. The balance system tunes the numbers. The LLM supplies the new behavior.
4. **Works offline.** The server and LLM add to the game, but the game never needs them.
   Without a connection you get a deterministic "unforged" fusion (see fusion-system §9).

---

## 2. Core loop

| Timescale | Loop |
| --- | --- |
| Seconds | Place, upgrade and sell towers. Set targeting. Watch the fight, react to leaks. |
| Minutes (a wave) | Read the next-wave preview, spend gold, socket powers, call the wave (early for a bonus). |
| One run (30–45 min) | 40 waves on one map. A power draft every 3 waves, a boss every 10. Build 3–6 fused towers that counter what the map throws at you. |
| Across runs | A codex of fusions you've discovered, plus the worldwide count. Unlock maps and difficulties. Earn world-first credits. |

No permanent stat upgrades between runs. That keeps balance clean and lets players compare
fusions fairly.

---

## 3. Maps and paths

- A tile grid (working size 24×14). Enemies follow **fixed paths**. Towers go on buildable tiles.
- Some maps have 2 spawns, forking or merging paths, or **air lanes**. Flyers go straight from
  spawn to exit and ignore the path.
- **Why fixed paths and no mazing:** fusions that move enemies along the path (push back,
  rewind, teleport) only mean something, and can only be balanced, when the path is fixed.
  Mazing combined with push-back breaks the game.
- Launch content: **6 hand-made maps**. The first is a tutorial map. The others each stress
  something different (long single lane, split paths, heavy air, short lanes, choke points,
  a double spawn).
- Later: a **seeded procedural map generator** for endless mode and daily challenges (roadmap M6).

---

## 4. Economy and lives

- **Gold** comes from kill bounties, a wave-clear bonus, and an **early-call bonus**. Calling
  the next wave early pays a bonus scaled by the time left on the timer, and waves can overlap.
- **Selling** refunds 70%. A tower placed during the current build phase refunds 100% (a free undo).
- **Socketing** a power costs gold, and the cost goes up by slot: 100 / 250 / 500 (tunable).
- **Lives:** 20 on Normal. A leaked enemy costs 1 life, elites 2, bosses 10.
- No interest mechanic. It rewards hoarding, which fights against experimenting.

---

## 5. Towers (10 chassis)

Each tower is a **chassis**: a way of attacking that defines what counts as a hit. The same
power trio should turn out very differently on a Hive than on a Railgun. The LLM gets a card
describing the chassis for this reason.

| # | Tower | Role | Base attack | What counts as a "hit" | Targets | Dmg type |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Bolt** | Reliable single-target DPS | Fast homing bolts | Each bolt impact | Ground + Air | Kinetic |
| 2 | **Cannon** | Splash | Slow shells, small blast | Each enemy in the blast | Ground | Kinetic |
| 3 | **Frost** | Control | Shards that apply Chill. Freeze chance at tier III | Each shard impact | Ground + Air | Frost |
| 4 | **Arc** | Multi-target | Lightning that chains to 3 enemies | Each chain link | Ground + Air | Shock |
| 5 | **Rail** | Long range, line pierce | Hitscan line that pierces everything | Each enemy on the line | Ground + Air | Kinetic |
| 6 | **Mortar** | Artillery | Lobbed shell aimed at a path point. Huge range, has a minimum range, leaves a crater | Each enemy in the blast | Ground | Kinetic |
| 7 | **Flame** | Short-range crowd DoT | Cone spray that applies Burn | Each enemy per cone tick (4/s) | Ground | Fire |
| 8 | **Prism** | Ramping beam | Continuous beam. Damage ramps on the same target | Each beam tick (4/s) | Ground + Air | Arcane |
| 9 | **Beacon** | Support | No attack. Aura gives +range and +attack speed, reveals stealth | **Conduit:** hits by allied towers in its aura, at 50% potency | — | — |
| 10 | **Hive** | Summoner | Launches drones that seek and sting. Drones can intercept flyers | Each drone sting | Ground + Air | Toxic |

- **Tiers:** every tower has 3 upgrade tiers (I → II → III) that raise its base stats.
  **Tiers also unlock sockets:** 1 socket at tier I, 2 at tier II, 3 at tier III. So the
  3-power fusions show up in the mid and late game.
- **Targeting modes:** First, Last, Strong, Weak, Close. A fusion can add its own mode, such
  as "Most Statuses".
- **Beacon and Hive matter a lot for fusions.** Beacon turns any power into an area support
  effect (its powers go off when towers it buffs hit something). Hive turns powers into minion
  behavior. That gives the same trio very different results depending on the tower.

---

## 6. Damage types and defenses

Six damage types: **Kinetic, Fire, Frost, Shock, Toxic, Arcane.**

| Defense | Rule | Countered by |
| --- | --- | --- |
| **Armor** | Flat reduction per hit against Kinetic (a minimum of 20% of the damage always gets through) | Big single hits, Arcane, Stone, Void |
| **Shield** | Absorbs X damage, regenerates after 3 s without being hit | Shock (2× vs shields), sustained fire |
| **Resist** | −50% from one damage type, shown by a colored rim | Mixing damage types |
| **Tenacity** | Crowd-control durations shrink with each repeated CC (bosses always have it) | Damage instead of control |

Arcane ignores armor and resist but has lower base numbers.

### Built-in statuses

Fusions can also invent their own statuses (see fusion-system §4).

| Status | Effect | Stacking |
| --- | --- | --- |
| Burn | Fire damage over time | Refreshes; the stronger source wins |
| Poison | Toxic damage over time | Adds stacks (up to a cap) |
| Chill | −12% speed per stack. At 3 stacks → Freeze | Adds stacks |
| Freeze | Can't move. Then 2 s of freeze immunity | — |
| Stun | Can't move or use abilities | — |
| Shock | Next hit deals +50% | Consumed by the next hit |
| Mark | Takes +X% damage from all sources. Also reveals stealth | Refreshes |
| Weaken | −armor | Adds stacks |
| Fear | Walks backwards | — |
| Bleed | Takes damage per tile moved | Adds stacks |

Every status has a unique **icon shape**, not only a color, so colorblind players can read them.

---

## 7. Enemies (18 regulars + 4 bosses)

Enemies exist to make the player diversify. Each one tests a different kind of answer, and
that is what makes fusions worth hunting for.

| Enemy | Trait | What it tests |
| --- | --- | --- |
| Grunt | Baseline | — |
| Runner | Fast, low HP | Tracking, slows |
| Brute | Armored | Burst, Arcane, armor shred |
| Swarmling | Tiny, comes in packs of 15–30 | AoE |
| Wisp | **Flyer.** Straight line, ignores the path | Anti-air coverage |
| Aegis | Regenerating shield | Shock, sustained pressure |
| Mender | Heals nearby allies every 3 s | Focus fire, range |
| Splitter | Splits into 2 on death (the halves split once more) | AoE after single-target |
| Blinker | Teleports 2 tiles forward every 4 s | Depth of defense |
| Burrower | Can't be targeted for 2 s out of every 6 | Lingering zones, DoT |
| Juggernaut | Huge HP, slow, has Tenacity | Raw DPS |
| Shade | **Stealth.** Can't be targeted until revealed | Beacon, Mark effects |
| Warbanner | Speeds up nearby allies | Priority targeting |
| Necro | Revives the last 3 nearby dead allies once | Burst, spread-out kills |
| Carapace | Immune to one damage type (color-coded, changes per wave) | Damage type variety |
| Mimic | Gains resist to whatever damage type hits it most | Not relying on one type |
| Broodmother | Spawns Swarmlings while walking | AoE plus single-target |
| Phantom | Ignores the first 3 hits from each tower | High hit-rate towers, DoT |

**Bosses** (waves 10 / 20 / 30 / 40):

| Wave | Boss | Mechanic |
| --- | --- | --- |
| 10 | **The Colossus** | Stomps periodically and disables towers in a radius for 3 s. Teaches you to spread your defense. |
| 20 | **The Hydra** | On death splits into 3 heads, each with a different resist. |
| 30 | **The Chronarch** | Once below 50% HP, rewinds its own HP to what it was 5 s earlier (once). Speeds up allies. Tests burst damage. |
| 40 | **The Eclipse** | Three phases: shielded → spawns mirror clones → enraged sprint. |

Bosses don't disable fusions. Fusions are the fun part, so no mechanic should switch them off.

---

## 8. Waves

- **40 waves** per standard run. Waves come from a **budget-based generator** with per-map
  rules (enemy costs, composition rules, trait pacing). It is seeded and **fixed per map**, so
  every map's waves are the same each time and can be balanced. Boss waves and "signature"
  waves are written by hand.
- Trait pacing: introduce each enemy type alone first, then in mixes. Air starts around
  wave 6, stealth around 13, then combinations after that.
- The **next-wave preview** shows enemy icons, counts and trait badges, so players can plan
  counters.
- **Endless mode** (after wave 40 or picked directly): HP ×1.12 per wave, and a random
  **mutator** every 5 waves ("Shields everywhere", "Flyers ×2", "Regenerating", "Haste").
- Difficulties: **Casual / Normal / Hard / Brutal** (HP multiplier, lives, gold multiplier).

---

## 9. Powers (40, in 5 families of 8)

Every power has an id, a family, **tags** (hooks the LLM uses) and a **base effect written in
the same effect language** the LLM uses. Using that language for our own content proves it
can express enough, and it gives the LLM examples to learn from. **Single-power sockets never
touch the LLM**: 400 tower+power pairs, all hand-made.

### Elements — what the damage *is*
| Power | Base effect | Tags |
| --- | --- | --- |
| Ember | Hits apply Burn | fire, dot, spread |
| Frost | Hits apply Chill (3 stacks → Freeze) | cold, slow, freeze |
| Storm | Hits arc to 1 extra enemy | shock, chain, multi |
| Venom | Hits add stacking Poison | toxic, dot, stack |
| Stone | +50% vs armored. 10% chance to Stun | earth, stun, heavy |
| Tide | Hits push enemies back 0.4 tiles along the path | water, pushback, flow |
| Radiance | Hits Mark (+15% damage taken) and reveal stealth | light, mark, reveal |
| Void | Enemies you kill implode for Arcane damage nearby | void, death, implode |

### Forms — how the attack *moves*
| Power | Base effect | Tags |
| --- | --- | --- |
| Split | Fires 2 extra projectiles at 40% damage | multi, spread |
| Pierce | Projectiles pass through 2 more enemies | line, pierce |
| Ricochet | Projectiles bounce to a new target once | bounce, chain |
| Boomerang | Projectiles fly back to the tower and hit again | return, loop |
| Orbit | One projectile orbits the tower permanently, hitting what it passes | orbit, persistent |
| Cluster | Impacts release 3 bomblets | burst, spawn |
| Nova | Every 4th attack also sends out a ring pulse | ring, pulse, area |
| Rain | Every 3 s, strikes fall from the sky on random enemies in range | sky, random, area |

### Tempo — *when* things happen
| Power | Base effect | Tags |
| --- | --- | --- |
| Haste | +30% attack speed | speed |
| Echo | Each attack repeats 0.4 s later at 50% | repeat, delay |
| Overcharge | Every 5th attack deals ×3 and is bigger | nth, burst |
| Momentum | Attack speed ramps while firing nonstop, resets when idle | ramp, sustain |
| Patience | Charges while idle. The next attack spends the charge for bonus damage | charge, idle, burst |
| Stasis | 8% chance to freeze an enemy in time. Damage taken during it lands all at once when it ends | time, store, burst |
| Rewind | 6% chance to send an enemy back to where it was 2 s ago | time, pushback |
| Metronome | On every 4th beat of a global rhythm shared by all towers, attacks are doubled | rhythm, sync, global |

### Fortune — odds, value, risk
| Power | Base effect | Tags |
| --- | --- | --- |
| Precision | 20% chance to crit for ×2.5 | crit, luck |
| Greed | Kills drop +2 gold (capped per wave) | gold, economy |
| Executioner | Instantly kills non-boss enemies below 12% HP | execute, threshold |
| Chaos | Each hit applies a random built-in status | random, status |
| Gamble | Damage is rolled between ×0 and ×3 | random, variance |
| Bounty | Marks the strongest enemy in range. If it dies within 5 s: +gold and permanent +1% damage | mark, gold, grow |
| Jinx | Hits curse enemies: the next status they get is doubled | curse, amplify |
| Jackpot | 1% chance per hit to deal ×50 (×5 against bosses) | luck, extreme |

### Life & Matter — things that grow, spawn, bend
| Power | Base effect | Tags |
| --- | --- | --- |
| Spore | Kills leave a spore that bursts for Toxic damage when an enemy walks over it | spawn, trap, toxic |
| Swarm | Every 5th attack releases a short-lived seeking drone | summon, seek |
| Gravity | Hits pull nearby enemies toward the target | pull, cluster |
| Contagion | When an enemy with a status dies, its statuses spread to enemies nearby | spread, death |
| Siphon | Every 2,500 damage restores 1 life (max 1 per wave) | life, sustain |
| Growth | Each kill permanently adds +0.5% damage (up to +50%) | grow, scaling |
| Mirror | Attacks also fire a copy in the opposite direction | mirror, duplicate |
| Bramble | Hits root enemies for 0.3 s and leave a thorn patch on the path | root, zone, trap |

---

## 10. Sockets and drafts

- **Drafts:** pick 1 of 3 before wave 1 and after every 3rd wave. Bosses offer 1 of 4 plus a
  reroll. That's about **16–18 power cards per 40-wave run**, enough for roughly 4–6 heavily
  fused towers. There's a real choice about where to put them.
- **Cards are used up when socketed.** Unsocketing gives the card back, but the gold spent on
  the socket is lost. Duplicate drafts are allowed, so a tower can hold Ember + Ember + Ember,
  a "pure" fusion.
- Socketing a **1st** power runs that power's base effect. Socketing a **2nd or 3rd** power
  makes the tower **fuse**. Its behavior now comes from the fusion spec, which contains its
  parts but is more than the sum of them. The single-power effects no longer stack on top.
- The fusion key doesn't depend on socket order: A+B+C is the same as C+A+B. It also ignores
  tower tier, since tier only scales base stats.
- The draft pool starts at 24 powers, and the other 16 unlock through play (tunable). This
  keeps early runs readable and gives new players a steady stream of new things to try.

### Fusions in play
- **Known fusion** (already in the database): applies at once, with a short reveal and a
  name banner.
- **New fusion:** the tower shows **"Forging…"** and keeps fighting with a temporary offline
  fusion while the server generates the real one (about 10–30 s). When it lands, a reveal
  plays, and a **"WORLD FIRST"** banner if you're its discoverer.
- **Tooltip:** the LLM's name and flavor text, plus **exact rules text generated from the spec
  itself** (with numbers). The LLM's prose is never trusted for mechanics.

---

## 11. Meta progression

- **Codex:** every fusion you've forged or used, filterable by tower and power, with your
  world-firsts highlighted. A global counter: *"12,408 / 123,000 fusions discovered worldwide."*
- **Unlocks:** maps, difficulties and the other 16 powers. The campaign introduces towers
  gradually (map 1 has 4 towers, all 10 are unlocked by map 3).
- **Per-tower stats** after each wave (damage, kills, control seconds). They help players judge
  fusions, and they give us balance data.

---

## 12. Feel checklist (what makes a TD feel "good")

- [ ] Speed 1× / 2× / 3×, pause on Space, full keyboard shortcuts (1–0 for towers, Q/W/E for
      sockets, U upgrade, S sell, Tab to cycle targeting)
- [ ] Range preview while placing, path highlight, clear feedback on invalid tiles
- [ ] Health bars, status icons, optional damage numbers
- [ ] Next-wave preview with trait icons. An enemy encyclopedia entry pops up the first time
      you see a new enemy
- [ ] Hit flash, eased knockback, particle bursts, subtle screen shake (can be turned off),
      synthesized sound effects with a voice limit
- [ ] Undo placement during the build phase
- [ ] Save and resume a run (the sim is deterministic, so a save is seed + command log + snapshot)
- [ ] Tutorial map that teaches through play, not text walls
- [ ] Clear loss explanation: "Leaked: 6 Wisps (air) — none of your towers could reach them"
