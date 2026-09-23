# Putting Infinite Tower online

The public game has two parts:

```
players' browsers ──► GitHub Pages (the game: static files, free)
        │
        └────────────► forge backend (Node + SQLite) ──► Ollama cloud
                          holds OLLAMA_API_KEY as a secret
```

- **GitHub Pages** hosts the game. It is only static files, so it can't hold a secret:
  anything in a Pages site can be read by anyone.
- **The forge backend** is this repo's Node server. It keeps your Ollama key private, calls
  the model, balances fusions and stores the shared fusion database. Players never see the
  key. The site only calls the backend's `/api/...` endpoints.
- The backend also serves the whole game at its own URL. So Pages is optional: you can share
  the backend URL on its own if you prefer.
- If the backend is down or out of budget, the game keeps working with offline fusions.

## 1. Deploy the backend

It needs a host that runs a Docker container (the repo has a `Dockerfile`) with a
**persistent volume** mounted at `/data`, which is where the fusion database lives.

### Railway (easiest, all in the browser)

1. railway.com → **New Project → Deploy from GitHub repo** → pick `infinitetower`. It finds
   the `Dockerfile` and builds it.
2. Open the service → **Variables** and add:

   | Name | Value |
   | --- | --- |
   | `OLLAMA_API_KEY` | your key |
   | `CORS_ORIGINS` | `https://<your-github-name>.github.io` |
   | `TRUST_PROXY` | `1` |
   | `FORGE_DAILY_CAP` | `500` (new AI fusions per day across all players; lower to spend less) |
   | `OLLAMA_MODEL` | optional, default `gpt-oss:120b` |

3. Right-click the service → **Attach volume**, with mount path `/data`.
4. **Settings → Networking → Generate Domain.** Copy the URL, for example
   `https://infinitetower-production.up.railway.app`.
5. Open `<that URL>/api/health`. You should see `"forge":true`.

### Fly.io (command line)

```sh
fly launch --no-deploy                 # accept the Dockerfile; internal port 8787
fly volumes create data --size 1
# add to fly.toml:
#   [mounts]
#   source = "data"
#   destination = "/data"
fly secrets set OLLAMA_API_KEY=... CORS_ORIGINS=https://<your-github-name>.github.io TRUST_PROXY=1
fly deploy
```

Any other Docker host works the same way: set the variables above, mount `/data`, and
expose port 8787 (or set `PORT`). Hosts without persistent disks lose every fusion on each
redeploy, so avoid them for the backend.

## 2. Publish the game on GitHub Pages

1. In the GitHub repo: **Settings → Pages → Build and deployment → Source: GitHub
   Actions**.
2. **Settings → Secrets and variables → Actions → Variables → New repository variable:**
   `API_BASE` = the backend URL from step 1 (no trailing slash). This is a *variable*, not a
   secret, because it's just an address. The key never goes to GitHub.
3. **Actions → "Deploy game to GitHub Pages" → Run workflow.** It also runs on every push to
   `main` or the development branch. It runs the tests, builds the site with
   `tools/build.ts`, and publishes it.
4. The game is live at `https://<your-github-name>.github.io/infinitetower/`.

To try the static build locally:
`API_BASE=http://localhost:8787 npm run build && python3 -m http.server -d dist`.

## 3. Keep the bill in check

Every new fusion costs a model call, usually a few, counting repairs. Stored fusions are
free to hand out. The limits:

- `FORGE_DAILY_CAP`: new generations per UTC day across everyone. Once it's reached,
  players get offline fusions until the next day.
- `FORGE_RATE_LIMIT`: new generations per player IP per hour (default 60).
- `FORGE_CONCURRENCY`: parallel model calls (default 2).
- Also set a spending limit in your Ollama account if it offers one.
- `npm run pregen -- 50` (run against the backend's database) pre-forges fusions, so early
  players meet existing ones.

## Keys and safety

- The key only ever lives in the backend host's variables (or a local `.env`, which git
  ignores). Never put it in the repo, the Pages site or `API_BASE`.
- If a key ever leaks, revoke it in your Ollama account settings and set the new one on the
  backend. Nothing else needs to change.
