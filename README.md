# Infinite Tower

A web-based tower defense game where every tower + power combination is a unique **fusion**.
A local LLM (Ollama) generates each fusion the first time any player makes it. The server
validates and balances it, then saves it so every other player gets the same one.

- **10 towers × 40 powers.** Each tower can hold up to 3 powers.
- **~123,000 possible fusions.** Each one is generated on first discovery, balanced by
  simulation and saved for good. The first player to make it gets credit.
- **The LLM writes no code.** It builds effects out of a small, safe effect language
  (triggers → conditions → actions, plus custom statuses, projectiles and zones). The game
  engine runs them.
- **A complete tower defense game on its own.** Hand-built towers, enemies, bosses, maps and
  waves. It still works with the server or Ollama offline.

## Planning docs

| Doc | What's in it |
| --- | --- |
| [docs/game-design.md](docs/game-design.md) | The base game: design goals, core loop, towers, enemies, powers, sockets and drafts, waves, economy, feel |
| [docs/fusion-system.md](docs/fusion-system.md) | How fusions work: combo math, the effect language, the Ollama pipeline, uniqueness, balance by simulation, database and API |
| [docs/architecture-and-roadmap.md](docs/architecture-and-roadmap.md) | Tech stack, repo layout, performance budgets, milestones, open questions |

## Status

Planning. Nothing is built yet. See the roadmap for build order.
