# Game Design: Infinite Tower

This doc covers the game itself. The fusion system sits on top of it (see
[fusion-system.md](fusion-system.md)), but the game is complete without a server or an LLM.
Numbers here match the content files in `src/content/`, which are the source of truth.

---

## 1. Design goals

1. **A readable tactical TD first.** Every mechanic has to read on screen at 3× speed. If a
   player can't tell why a shape got through, the design has failed.
2. **Discovery is the reward.** The player should always want to try "what happens if I put
   *these*, in *this order*, on *that*?"
3. **Fusions change how a tower plays, not just its numbers.** Balance is automatic (by
   simulation). The model supplies new behaviour and a new look.
4. **Difficulty climbs hard.** Enemies get much tougher as the campaign goes on. The first act
   can be won with plain towers and a few fusions. The last act needs fusions that really
   synergise.
5. **The game teaches itself once, in one place.** A guided tutorial explains everything. The
   rest of the UI does not scatter hint text around.

---

## 2. Core loop

| Timescale | Loop |
| --- | --- |
| Seconds | Place, upgrade and sell towers. Set targeting. Watch the fight and react to leaks. |
| A wave | Read the next-wave preview, open packs, socket cards, spend gold, then call the wave (early for a bonus). |
| A run | 20, 40 or 60 waves on one map, with a card pack every 3 waves and a boss every 10. Build a handful of fused towers that answer what the map throws at you. |
| Across runs | Unlock maps, beat them on harder difficulties, and fill your Codex with fusions, some of them World Firsts. |

There are no permanent stat upgrades between runs. That keeps balance clean and lets players
compare fusions fairly.

---

## 3. Towers

Ten towers, each with its own attack "chassis", so the same powers feel different on
different towers. Every tower has 3 tiers. Upgrading raises its stats and opens the next card
socket. Upgrades are a real investment: tier 2 costs twice the tower's price and tier 3 four
times (a Bolt is 100, then +200, then +400).

| Tower | Chassis | Role | Cost | Air |
| --- | --- | --- | --- | --- |
| Bolt | projectile | Fast homing bullets, single-target DPS | 100 | yes |
| Cannon | projectile | Explosive shells, splash | 150 | no |
| Frost | projectile | Twin ice shards that Chill | 120 | yes |
| Arc | chain | Instant lightning that jumps between enemies | 175 | yes |
| Rail | hitscan | Long-range line shot that pierces everything | 200 | yes |
| Mortar | lob | Incendiary artillery from very far away | 180 | no |
| Flame | cone | Short-range sweeping fire | 140 | no |
| Prism | beam | A beam that ramps up on the same target | 190 | yes |
| Beacon | aura | Buffs and reveals nearby. Its powers are lent to neighbouring towers | 160 | yes |
| Hive | drones | Seeking drones that sting anything | 210 | yes |

Targeting modes: first, last, strong, weak, close. Selling refunds 70%.

---

## 4. Powers, cards and packs

### 4.1 Powers

40 powers in 5 families. Each one works on its own as a single-power upgrade, and they fuse
in combination.

| Family | Powers |
| --- | --- |
| Elements | Ember, Frost, Storm, Venom, Stone, Tide, Radiance, Void |
| Forms | Split, Pierce, Ricochet, Boomerang, Orbit, Cluster, Nova, Rain |
| Tempo | Haste, Echo, Overcharge, Momentum, Patience, Stasis, Rewind, Metronome |
| Fortune | Precision, Greed, Executioner, Chaos, Gamble, Bounty, Jinx, Jackpot |
| Life & Matter | Spore, Swarm, Gravity, Contagion, Siphon, Growth, Mirror, Bramble |

### 4.2 Cards and rarity

Powers arrive as **cards**. Each card has a rarity that multiplies the strength of its power
once socketed. With several cards, the multiplier is a weighted blend: base 60%, secondary
30%, tertiary 10%.

| Rarity | Multiplier | Colour |
| --- | --- | --- |
| Common | ×1.0 | grey |
| Rare | ×1.2 | blue |
| Epic | ×1.45 | purple |
| Legendary | ×1.75 | gold |

The strongest powers only come at high rarity:

- **Rare or better:** Orbit, Boomerang, Cluster, Nova, Rain, Overcharge, Momentum,
  Executioner, Chaos, Spore, Growth, Mirror.
- **Epic or better:** Echo, Void, Siphon, Patience, Bounty, Jinx, Gamble, Contagion.
- **Legendary only:** Metronome, Jackpot, Rewind, Stasis.

Rarity odds improve as the waves climb.

### 4.3 Packs

**You keep one card from each pack.** Opening a pack flips its cards over one at a time, with
the rarest card getting a fanfare. You pick one and the rest are gone, so cards are precious
and every pick is a decision about which fusion to build next. An opened pack has to be
picked from before another can be opened, and the choice is saved with the run, so reloading
can't re-roll it.

| Pack | Choose from | How you get it |
| --- | --- | --- |
| Starter | 3, one Rare+ | Start of every run |
| Shape | 3, better odds later | Every 3 waves, or the Shop (90 + 14 × wave gold) |
| Prism | 3, all Rare+ | Shop only (240 + 32 × wave gold) |
| Boss | 4, all Rare+, one Epic+ | Each boss defeated |

Unwanted cards can be **scrapped** from the hand (right-click) for 15 / 40 / 100 / 250 gold by
rarity.

### 4.4 Sockets and order

A tower has up to three sockets, opened by tier: tier 1 opens the base, tier 2 the secondary
and tier 3 the tertiary. Order matters: the **base** power leads, the **secondary** bends it,
and the **tertiary** adds a twist. Only the last card can be removed. It goes back to the
hand, and the gold paid for its socket is spent.

**Socketing costs** climb steeply by slot (80 / 240 / 720 gold for a Common card), and rarer
cards cost more. The rarity markup is biggest in the base slot, where a card carries about
60% of the fusion, and tapers off in later slots, where it carries less:

| Card | Base slot | Secondary | Tertiary |
| --- | --- | --- | --- |
| Common | 80 | 240 | 720 |
| Rare | 160 (×2) | 360 (×1.5) | 865 (×1.2) |
| Epic | 240 (×3) | 480 (×2) | 1,010 (×1.4) |
| Legendary | 400 (×5) | 720 (×3) | 1,295 (×1.8) |

Those are wave-1 prices. Socket prices also rise as a run goes on, and faster for rarer cards
(+2% per wave for Common, +3% Rare, +4.5% Epic, +6.5% Legendary), because gold income grows
too. By wave 60 a Legendary card in the tertiary slot costs about 6,300 gold.

So a Legendary is worth saving for the right tower and the moment you can afford it. The hand
shows each card's price for the selected tower.

- **One power:** the power's own hand-made upgrade for that tower.
- **Two powers:** a pair fusion. **Three powers:** a triple, which evolves its pair.
- Fusions are forged by the AI the first time anyone makes them (see fusion-system.md).
  Until one arrives, the tower plays an offline combination of its powers, so it is never
  idle.

**No previews.** Hovering a card over a tower shows "???" for any fusion you haven't made
yourself. Fusions you've made are stored in your browser, and those you can preview. The
Codex screen lists them with their number, date, World First badge and rules text.

---

## 5. Enemies: a climb through dimensions

Every enemy is a shape. A run climbs from 2D to 4D, and each dimension ends in its limit
shape.

### 5.1 Flatland (2D): waves 1–20

Twelve polygons, from the Triangle (3 sides) to the Tetradecagon (14). More sides means more
HP, and from 8 sides up, armour. The first eight are plain. The last four each have an effect:

| Shape | Effect |
| --- | --- |
| Hendecagon (11) | Regenerating shield |
| Dodecagon (12) | Splits into two Hexagons |
| Tridecagon (13) | Heals nearby shapes |
| Tetradecagon (14) | Blinks forward and phases briefly |

### 5.2 Solidspace (3D): waves 21–40

Polyhedra, counted by faces. The Platonic solids (Tetrahedron, Cube, Octahedron,
Dodecahedron, Icosahedron) are plain, with more faces meaning tougher. The complex solids
have powers whose **strength scales with their face count**:

| Solid | Faces | Power |
| --- | --- | --- |
| Triangular Prism | 5 | Flies |
| Truncated Tetrahedron | 8 | Shatters into 4 Tetrahedra |
| Cuboctahedron | 14 | 70 regenerating shield per face |
| Rhombic Dodecahedron | 12 | Heals neighbours 1% per face |
| Truncated Octahedron | 14 | Blinks, and hastes neighbours 1% per face |
| Truncated Icosahedron | 32 | Drops Tetrahedra, faster with more faces |
| Rhombicosidodecahedron | 62 | Revives fallen shapes and adapts its resistances |

### 5.3 Hyperspace (4D): waves 41–60

Polytopes, counted by cells: the 5-Cell, 3-3 Duoprism, Tesseract, 5-5 Duoprism, 16-Cell and
24-Cell. All of them periodically **phase** through the 4th axis and can't be hit directly
while phased, though damage over time and zones still work. Their powers scale with cell
count (shields, splitting, healing, haste auras, tower-stomping, adaptive resistances).

### 5.4 Bosses

| Wave | Boss | Signature |
| --- | --- | --- |
| 10 | The Icosagon | Stomps towers offline |
| 20 | The Circle | Sheds Dodecagons at 66% HP and rolls faster below 33% |
| 30 | The Geodesic | Rewinds its own HP once, hastes nearby shapes |
| 40 | The Sphere | Phases and stomps |
| 50 | The 600-Cell | Spawns, stomps and phases |
| 60 | The Glome | The hypersphere: everything at once |

Bosses shrug off crowd control (tenacity) and cost many lives if they leak.

### 5.5 Group modifiers

Variety comes from modifiers that can be applied to any group of shapes:

- **Flying:** takes an air lane that ignores the road, so only anti-air towers can hit it.
- **Swarm:** many small, weak copies.
- **Swift:** faster.
- **Elite:** bigger and tougher, and worth more.
- **Stealth:** must be revealed or marked before towers can target it.

Endless mode (past wave 60) stacks global mutators (shielded, swift, regen, armored, swarm).

### 5.6 Waves

Waves are generated per (map, wave number) from an HP budget that grows about 15% per wave:
13% from the budget plus 2% from a global HP creep. They are deterministic, so every player
sees the same waves on the same map. Each new shape gets an **introduction wave** where it
stars. Every 5th wave is a **rush** (swift, flying or swarming variants). Boss waves bring
escorts. Older shapes mix back in as filler. The top bar previews the next wave's shapes and
modifiers.

---

## 6. Campaign, maps and difficulty

Three acts of five maps each. Beating a map unlocks the next one. Maps grow as the campaign
goes on, from 20 × 12 tiles to 30 × 17, and so does their look: the first maps are plain grey
arenas, and later ones are drawn in richer themes.

| Act | Maps (theme) | Size | Waves | Shapes |
| --- | --- | --- | --- | --- |
| I · Flatland | Meadow, Switchback (plain), Crossroads, Loopback (graph paper), Orchard (garden) | 20 × 12 to 26 × 14 | 20 | 2D |
| II · Solidspace | Skyway, Fork (blueprint), Dunes (desert), Spiral, Geode (crystal cavern) | 26 × 15 to 28 × 16 | 40 | 2D, then 3D |
| III · Hyperspace | Twin Rivers, Gauntlet (neon grid), Nebula, Event Horizon (deep space), Tesseract (hyperspace) | 26 × 15 to 30 × 17 | 60 | 2D, 3D, then 4D |

A theme sets the ground and its pattern, the road style, the obstacles (rocks, sketched
blocks, bushes, wireframe cubes, mesas, crystals, neon pillars, asteroids, hypercubes), small
scatter such as grass tufts, cacti or stars, props around the arena, and ambient motion
(fireflies, drifting motes, twinkling stars, a scan line). Themes only change the look, never
the rules.

The maps stress different things: gentle serpentines and long zig-zags, merging spawns, a
road that crosses itself, heavy air traffic, a road that splits and rejoins, an inward spiral,
two separate roads with two exits, a short road through rocks, a long comb of a road, and a
road that folds back through itself. After the last wave you can keep going in endless mode.

| Difficulty | Enemy HP | Lives | Starting gold | Bounty |
| --- | --- | --- | --- | --- |
| Casual | ×0.7 | 30 | 350 | ×1.1 |
| Normal | ×1.0 | 20 | 300 | ×1.0 |
| Hard | ×1.3 | 15 | 275 | ×0.95 |
| Brutal | ×1.65 | 10 | 250 | ×0.9 |

**Tuning target:** the playtest bot (`tools/bot.ts`) builds greedily, sockets its best
cards, keeps the rarest card from each pack, never shops, and gets fusions only from the
offline combiner. On Casual it clears every Act I map. On Normal it wins about half its Act I
runs, usually falls to the wave-20 boss (the Circle) in Act III, and falls between waves 20
and 30 in Act II. Players
who pick their cards with a plan and design fusions that really synergise should get much
further.

---

## 7. Economy and lives

- **Gold** comes from kill bounties (growing 4% per wave), a wave-clear bonus (30 + 9 × wave)
  and an **early-call bonus**. Calling the next wave early pays for the countdown time you
  skip. Waves can overlap.
- Gold goes to towers, upgrades, sockets and Shop packs, and comes back from selling (70%)
  and scrapping cards.
- **Lives:** a leaked shape costs its lives value. Most shapes cost 1, elites 2, and bosses
  10–20.
- There is no interest mechanic. It rewards hoarding, which works against experimenting.

---

## 8. The tutorial

The tutorial is the only place the game explains itself. It runs on its own short, forgiving
map (6 waves on Casual). It points at the relevant button, card or map tile with a pulsing
highlight and waits until the player actually does each thing:

1. What shapes and lives are.
2. Build a Bolt on the marked tile.
3. Send the first wave.
4. Towers fire on their own, and kills pay gold.
5. Select the tower and upgrade it.
6. Open a card pack and keep one card.
7. What cards and rarities are.
8. Socket the card.
9. Open a second pack and keep another power.
10. Socket it too: a fusion.
11. The Forge, World Firsts and discovery numbers.
12. Order matters (named using the player's own two cards).
13. You can't preview a fusion until you've made it, and the Codex keeps what you make.
14. Packs over time, the Shop, and scrapping.
15. Hotkeys.
16. Survive the remaining waves.

The tutorial can be skipped at any step. After it's finished it moves to the bottom of the
title menu for replays. Nothing else in the UI carries instructional text.

---

## 9. Art direction

- **The world** is flat and bold, in the spirit of diep.io: pastel polygons with darker
  outlines on a light grey grid, and the Ubuntu font with white outlined text.
- **Towers deliberately break from that.** They are inked emplacements: a fixed stone plinth
  whose shape shows the tier (rounded square, then octagon, then octagon with bolts), socket
  gems lit in the socketed powers' colours, and a turning head with its own silhouette. The
  heads are a crossbow kite, hex cannon, ice crystal, tesla coil, coil rail, mortar bowl,
  fuel-tank flamer, floating gem, pylon and hive dome. Heads use a dark ink outline and a
  gloss highlight. An unpowered head wears the tower's own tint. A powered head takes the base
  power's colour, with accents in the secondary's colour and the core in the tertiary's.
- **2D enemies** are flat outlined polygons.
- **3D enemies break the style too.** They look like early-2000s CG renders: glossy
  solids with light running across each face, white specular hotspots and a cool rim light.
  They tumble and float above a ground shadow, and are drawn at slightly low resolution with
  a touch of aliasing.
- **4D enemies** are rotating wireframe projections through the fourth axis.
- **Fusion visuals** come from the model's VFX language (particles, beams, shapes, orbiters,
  text, screen shake), so every fusion looks like its idea.

---

## 10. Controls

| Input | Action |
| --- | --- |
| 1–0 | Pick a tower to build (Shift+click keeps building) |
| Space | Send the next wave |
| U / S / T | Upgrade / sell (press twice) / cycle targeting |
| F | Game speed 1×/2×/3× |
| Backspace | Remove the last socketed card |
| Esc / P | Cancel, or pause |
| Right-click | Cancel; on a card: scrap it |

Runs autosave between waves and can be continued from the title screen.
