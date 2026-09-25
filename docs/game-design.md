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
socket. Tier 2 costs one and a half times the tower's price and tier 3 three times (a Bolt is
100, then +150, then +300). Per gold, an upgrade buys about two thirds to three quarters of the
damage of a new tower, plus range, and it needs no new tile, so building tall on a good tile
competes with building wide.

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

### 3.1 Levels

Separately from its tier, a tower can be **levelled up** with gold, from level 1 to 10 (L, or
the Level button). Levels make a tower stronger without opening sockets:

- every level adds **15% base damage**, so every damage number in its fusion grows with it;
- the numbers its fusion **marks as growing** (a stun's length, a proc chance, a blast radius,
  a chain count) grow by their own step per level. The Forge chooses which numbers grow and
  by how much when it designs a fusion; everything else stays fixed. Hand-made powers and
  offline fusions grow a few natural numbers (status and zone durations, chances, radii).

A level costs more the higher the tower's tier and the more (and rarer) cards it holds:

> level cost = tower price × 0.35 × tier factor (1 / 1.5 / 2.1) × 1.22^(level − 1) ×
> (1 + 0.3 per Common, 0.5 per Rare, 0.75 per Epic, 1.1 per Legendary card socketed)

So a bare Bolt's first level is 35 gold, and the same Bolt at tier 2 with an Epic and a Rare
card pays 120. The first levels of a tier-3 tower buy about as much damage per gold as a new
tower: upgrade a tower on a good tile, then level it. Levels also **raise the price of that tower's next socket** (by 10% per level
for a Common card up to 26% for a Legendary) **and of its next tier** (10% per level). Level
first and your cards cost more to add; socket first and every level costs more. That choice
is the point.

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

You keep one card from most packs (two from a Twin Pack); the rest are gone. Each slot of a
pack has a rarity floor, and most packs have a perk:

| Pack | Cards | Perk | Where |
| --- | --- | --- | --- |
| Starter | keep 1 of 3, one Rare+ | | start of every run |
| Shape | keep 1 of 3, better odds later | | every 3 waves; Shop (90 + 14 × wave) |
| Salvage | keep 1 of 4 | the cards you don't keep are scrapped for gold | Shop (120 + 16 × wave) |
| Family | keep 1 of 4, one Rare+ | every card from one power family (Elements, Forms, Tempo, Fortune, Life & Matter), shown on the pack | every 12 waves; Shop (140 + 18 × wave), family changes each wave |
| Gambler | keep 1 of 3, one Rare+ | one free reroll of the whole pack | Shop from wave 3 (170 + 22 × wave) |
| Prism | keep 1 of 3, all Rare+ | | Shop (240 + 32 × wave) |
| Twin | keep 2 of 5, two Rare+ | | Shop from wave 6 (300 + 36 × wave) |
| Boss | keep 1 of 4, all Rare+, one Epic+ | | each boss defeated |
| Crown | keep 1 of 3, all Epic+, one Legendary | | Shop from wave 15 (800 + 50 × wave) |

Unwanted cards can be **scrapped** from the hand (right-click) for 15 / 40 / 100 / 250 gold by
rarity.

**Looks.** Better cards and packs look it:

- **Cards:**
  - Rare cards get a light sweep and a blue glow.
  - Epic cards get a holographic rainbow foil and a purple bloom.
  - Legendary cards get foil, a spinning gold border, a pulsing gold bloom and sparkles.
  - Big cards tilt toward the pointer, and their foil and glare follow it.
- **Packs:**
  - Salvage, Family and Gambler packs are shiny.
  - Prism, Twin and Boss packs are holographic.
  - The Crown Pack is radiant gold with sparkles.
- **Openings:** a pack with an Epic or Legendary inside opens with light rays behind the
  cards.

### 4.4 Sockets and order

A tower has up to three sockets, opened by tier: tier 1 opens the base, tier 2 the secondary
and tier 3 the tertiary. Order matters: the **base** power leads, the **secondary** bends it,
and the **tertiary** adds a twist. **A socketed card is there for good:** it can't be taken
out. Selling the tower scraps its cards, and their scrap value is added to the sell price.

**Socketing costs** climb steeply by slot (80 / 240 / 720 gold for a Common card), and rarer
cards cost more. The rarity markup is biggest in the base slot, where a card carries about
60% of the fusion, and tapers off in later slots, where it carries less:

| Card | Base slot | Secondary | Tertiary |
| --- | --- | --- | --- |
| Common | 80 | 240 | 720 |
| Rare | 160 (×2) | 360 (×1.5) | 865 (×1.2) |
| Epic | 240 (×3) | 480 (×2) | 1,010 (×1.4) |
| Legendary | 400 (×5) | 720 (×3) | 1,295 (×1.8) |

Those are prices at wave 1 on a level-1 tower. Prices rise with the **level of the tower**
the card goes into (+10% per level for Common, +14% Rare, +19% Epic, +26% Legendary; see
§3.1), and a little as the run goes on, because gold income grows too (+1% per wave for
Common, +1.5% Rare, +2.2% Epic, +3.2% Legendary). By wave 60 a Legendary card in the tertiary
slot costs about 3,700 gold on a level-1 tower, and about 12,500 on a level-10 one.

So a Legendary is worth saving for the right tower and the moment you can afford it. The hand
shows each card's price for the selected tower. Each socket in the tower panel shows its
Common price now and what Rare, Epic and Legendary cards cost relative to it (such as ×1.7
×2.8 ×5.3), with the full breakdown on hover. Hovering a card over the tower shows how its
price is built: slot price × rarity × level × wave.

- **One power:** the power's own hand-made upgrade for that tower.
- **Two powers:** a pair fusion. **Three powers:** a triple, which evolves its pair.
- Fusions are forged by the AI the first time anyone makes them (see fusion-system.md).
  Until one arrives, the tower plays an offline combination of its powers, so it is never
  idle.

**A single power.** With one card socketed, the panel shows the tower's description with the
power's effects listed beneath it, spelled out.

**Reading a fusion.** The panel shows the fusion's short explanation, written by the Forge,
with its key numbers live: each is shown at the tower's real level, damage and balance.
Numbers in green grow with level (hover for the step), damage is shown in gold (it grows 10%
per level), and plain numbers are fixed. The Details list gives every rule, with each growing
number labelled by its step, such as "3.1 s (+0.2 s/lvl)".

**No previews.** Hovering a card over a tower shows "???" for any fusion you haven't made
yourself. Fusions you've made are stored in your browser, and those you can preview.

**The Codex** keeps them compact:
- a page for each tower, as tabs with counts;
- tabs for each base power on that tower;
- a list of one-line rows (name, power chain, discovery number, World First star). Each triple
  is nested under the pair it evolved from.
- A row opens in place to show the concept, dates and rules.
- Long lists are paged, and the search box jumps to the tower with matches.

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

Stranger polygons join them:

| Shape | Wave | What it does |
| --- | --- | --- |
| Digon {2} | 2 | Two sides meeting at both ends: a tiny, fragile, very fast lens |
| Pentagram {5/2} | 5 | A star polygon whose sides cross; dashes at 3x speed every 4.5 s |
| Hexagram {6/2} | 8 | A compound of two Triangles; splits into both when destroyed |

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

Stranger solids:

| Solid | Wave | What it does |
| --- | --- | --- |
| Stella Octangula | 23 | Two Tetrahedra run through each other (a compound); breaks into both |
| Toroid | 26 | A polyhedron with a hole: one direct hit in three flies through it (DoTs, zones and blasts still land) |
| Small Stellated Dodecahedron | 28 | A Kepler–Poinsot star; every 7 s it throws a spike that jams the nearest tower |
| Hemicube | 33 | Half a cube glued to its own opposite: it lives in two places at once, showing a ghost where it will swap to (ahead, then part of the way back) |
| Snub Cube | 36 | Chiral; immune to one damage type at a time, switching every 5 s |

### 5.3 Hyperspace (4D): waves 41–60

Polytopes, counted by cells: the 5-Cell, 3-3 Duoprism, Tesseract, 5-5 Duoprism, 16-Cell and
24-Cell. All of them periodically **phase** through the 4th axis and can't be hit directly
while phased, though damage over time and zones still work. Their powers scale with cell
count (shields, splitting, healing, haste auras, tower-stomping, adaptive resistances).
Two stranger ones join them: the **Rectified 5-Cell** (wave 44; five tetrahedra and five
octahedra, and it dashes) and the **Great Duoprism {5/2}×{5/2}** (wave 53; two pentagrams
multiplied through each other, and it jams the 2 nearest towers every 7 s).

### 5.4 Bosses

Every act ends in the limit of its dimension (waves 20, 40 and 60). The midpoints (waves 10, 30
and 50) bring one of three bosses, and **each map has its own**, so the campaign meets all of
them:

| Wave | Boss | Signature |
| --- | --- | --- |
| 10 | The Icosagon | Stomps towers offline |
| 10 | The Apeirogon | An infinite zigzag: its head drags a chain of 12 links, each its own shape, and hastes them |
| 10 | The Great Heptagram {7/3} | Dashes, and sheds a Pentagram at every fifth of its HP |
| 20 | The Circle | Sheds Dodecagons at 66% HP and rolls faster below 33% |
| 30 | The Geodesic | Rewinds its own HP once, hastes nearby shapes |
| 30 | The Great Stellated Dodecahedron | Spears the 3 nearest towers every 5 s, and sheds Small Stellated Dodecahedra |
| 30 | The Compound of Five Tetrahedra | A new immunity every 6 s, sheds Tetrahedra at 80/60/40/20%, and breaks into five more |
| 40 | The Sphere | Phases and stomps |
| 50 | The 600-Cell | Spawns 5-Cells, stomps and phases |
| 50 | The 120-Cell | Its dual: births Dodecahedra, heals everything around it, phases |
| 50 | The Grand Antiprism | The strangest uniform polytope: 30% of hits pass through it, it flickers between two places, and it sheds Rectified 5-Cells |
| 60 | The Glome | The hypersphere: everything at once |

In endless mode a 4D boss comes every 10 waves. Bosses shrug off crowd control (tenacity) and
cost many lives if they leak.

### 5.5 The Shape Dex

The **Shape Dex** (title menu) lists every shape, numbered like a field guide. Shapes you
haven't met in a run are dark silhouettes. Once one crosses your map, it is entered with:

- a turning model;
- its description, traits and abilities;
- its base stats;
- where it turns up (its introduction wave, or which maps it is the boss of);
- when you first met it, and how many you have destroyed.

### 5.6 Group modifiers

Variety comes from modifiers that can be applied to any group of shapes:

- **Flying:** takes an air lane that ignores the road, so only anti-air towers can hit it.
- **Swarm:** many small, weak copies.
- **Swift:** faster.
- **Elite:** bigger and tougher, and worth more.
- **Stealth:** must be revealed or marked before towers can target it.

Endless mode (past wave 60) stacks global mutators (shielded, swift, regen, armored, swarm).

### 5.7 Waves

Waves are generated per (map, wave number) from an HP budget that grows about 15% per wave
through Solidspace (13% from the budget plus 2% from a global HP creep) and about 13% in
Hyperspace (11% plus the creep). They are deterministic, so every player sees the same waves
on the same map. A shape that splits is budgeted with the shapes it splits into. Swift groups
move 1.5× as fast, so they get only 70% of their share of the budget. Each new shape gets an
**introduction wave** where it stars. Every 5th wave is a **rush** (swift, flying or swarming
variants). Boss waves bring escorts. Older shapes mix back in as filler. The top bar previews the next wave's shapes and
modifiers.

---

## 6. Campaign, maps and difficulty

Three acts of five maps each, laid out as stops on one winding trail across a world map (in the
spirit of Battle Cats). Beating a map unlocks the next one. Everything past the furthest stop
you have reached is hidden under cloud; beating a stage rolls the cloud back along the trail to
the next stop, and once every stage is beaten the whole map stays open. Each stretch of land
is drawn in the theme of the stage on it, and each stop shows which difficulties it has been
cleared on. Maps grow as the campaign
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

**How far good play gets:** the Strategist (`tools/strategist.ts`) plans every wave by
playing copies of the game ahead. It too uses only offline fusions. One run per map and
difficulty (W = won; else the wave it fell on, and the share of that wave's HP its defence
could have held):

| Act | Casual | Normal | Hard | Brutal |
| --- | --- | --- | --- | --- |
| I (5 maps) | 5 wins | 5 wins | 5 wins | 5 wins, all without losing a life |
| II (5 maps) | 3 wins; else 40 (38%) | falls at 40 (29–84%) or 30 (95%) | 1 flawless win (Geode); else 30 (32–88%) | falls at 30 (27–75%) |
| III (5 maps) | falls at 45–56 | falls at 40 (42–82%) | falls at 30 (30–65%) | falls at 10–30 |

- The walls are the bosses. Wave-30 bosses come in at 14–24× the HP of wave 29 (wave-10
  bosses are 5–8×, the Sphere at wave 40 about 5×). They stop every Hard and Brutal run past
  Act I except one. The wave-40 Sphere stops Normal.
- Past wave 40, wave HP grows 13% a wave (`260 × 1.13^n`), while income grows about
  linearly, so even Casual runs in Act III fall between waves 45 and 56.
- Per gold, a new tier-1 tower buys about twice the damage of a tier upgrade, and levels buy
  less still. The planner fills good tiles with tier-1 towers first, and upgrades later,
  when tiles run out.
- Single runs are noisy: Geode was a flawless win on Hard but fell at wave 40 on Normal.
  Small early choices snowball.

---

## 7. Economy and lives

- **Gold** comes from kill bounties (growing 4% per wave), a wave-clear bonus (30 + 9 × wave)
  and an **early-call bonus**. Calling the next wave early pays for the countdown time you
  skip. Waves can overlap.
- Gold goes to towers, upgrades, levels, sockets and Shop packs, and comes back from selling
  (70%, levels included, plus the scrap value of its cards), scrapping cards and Salvage
  Packs.
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
14. Level the tower up: more damage, growing numbers, and pricier sockets and tiers after.
15. Packs over time, the Shop, and scrapping.
16. Hotkeys.
17. Survive the remaining waves.

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
- **The menus** float the game's shapes in the background, and they are a toy. They drift out
  of the cursor's way. You can grab one and fling it into the others. Clicking a polygon knocks
  off a side (hexagon, pentagon, ... triangle) and then pops it, and solids split in two
  before popping. Clicking empty space sends out a small shockwave. The shapes persist across
  screens until a reload.

---

## 10. Controls

| Input | Action |
| --- | --- |
| 1–0 | Pick a tower to build (Shift+click keeps building) |
| Space | Send the next wave |
| U / L / S / T | Upgrade / level up / sell (press twice) / cycle targeting |
| F | Game speed 1×/2×/3× |
| Esc / P | Cancel, or pause |
| Right-click | Cancel; on a card: scrap it |

Runs autosave between waves and can be continued from the title screen.
