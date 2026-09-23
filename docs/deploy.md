# Putting Infinite Tower online (for free)

```
players' browsers ──► GitHub Pages ─ the game (static files)                    free
        │
        └────────────► Render ─ the forge (Node), holds OLLAMA_API_KEY          free plan
                          │
                          ├──► Ollama cloud ─ designs new fusions               your key
                          └──► Firebase Firestore ─ the shared fusion database  free (Spark)
```

- **GitHub Pages** hosts the game. It's public static files, so it never holds the key.
- **Render** runs the forge server with your key as a secret. Players only ever talk to its
  `/api/...` endpoints.
- **Firestore** keeps every fusion, discovery number and generation log. Render's free
  servers lose their disk on each restart, so the data lives in Firebase instead.
- If any piece is down or out of quota, the game keeps working with offline fusions.

It takes about 15 minutes, all in the browser.

## 1. Firebase: the database

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
   (Google Analytics can be off). New projects are on the free **Spark** plan, with no card.
2. **Build → Firestore Database → Create database.** Pick a location near your players and
   start in **production mode**. Production rules block all browser access, which is what
   we want: only the server reads and writes, using a service account.
3. **Project settings** (the gear icon) → **Service accounts → Generate new private key.**
   A `.json` file downloads. Treat it like a password: it gives full access to the database.

## 2. Render: the forge server

1. Go to [render.com](https://render.com) and sign up with GitHub. The free plan covers one
   always-available web service. Check their current terms.
2. **New → Blueprint** → pick the `infinitetower` repo. Render reads `render.yaml` and asks
   for two values:
   - `OLLAMA_API_KEY`: your Ollama key.
   - `FIREBASE_SERVICE_ACCOUNT`: open the downloaded `.json` file and paste its whole
     contents. If the field mangles it, paste a base64 version instead (`base64 -w0 key.json`
     on Linux, `base64 -i key.json` on a Mac). Both work.
3. **Apply.** When it's live you get a URL like `https://infinitetower-forge.onrender.com`.
   Open `<that URL>/api/health` and check for `"forge":true`.
   - The blueprint already allows `https://shrimpsooup2.github.io` to call it
     (`CORS_ORIGINS`), and caps new AI fusions at 500 a day (`FORGE_DAILY_CAP`).
   - Free Render servers **sleep after ~15 minutes without visitors**. The next visitor
     wakes the server, which takes up to about a minute. The game is playable the whole
     time, and their fusions arrive once the server is awake.

## 3. GitHub Pages: the game

1. GitHub repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables → New repository variable:**
   `API_BASE` = the Render URL from step 2 (no trailing slash). It's just an address, not a
   secret.
3. **Actions → "Deploy game to GitHub Pages" → Run workflow.** It also runs on every push. It
   tests, builds with `tools/build.ts` and publishes to
   **https://shrimpsooup2.github.io/infinitetower/**.

To try the static build locally:
`API_BASE=http://localhost:8787 npm run build && python3 -m http.server -d dist`.

## Staying inside the free limits

| Service | Free allowance | What happens at the limit |
| --- | --- | --- |
| Firestore (Spark) | 50,000 reads, 20,000 writes per day, 1 GiB stored | API calls fail until the daily reset, and players get offline fusions |
| Render (free) | One web service; sleeps when idle | Slower first load after a quiet spell |
| Ollama cloud | Whatever your plan includes | Capped by the settings below |

The server is built to be frugal:

- It caches the title-screen stats.
- It stores specs compactly.
- It only reads the documents a fusion needs.

Knobs, all set as variables on Render:

- `FORGE_DAILY_CAP` (default 500): new AI fusions per day across everyone. Stored fusions are
  free to hand out again.
- `FORGE_RATE_LIMIT` (default 60): new AI fusions per player per hour.
- `FORGE_CONCURRENCY` (default 2): model calls at once.

## Other ways to run the backend

The same server runs on any Docker host (`Dockerfile`), such as Railway or Fly.io. Without
`FIREBASE_SERVICE_ACCOUNT` it uses a local SQLite file at `DB_PATH`, which then needs a
persistent volume mounted at `/data`. With `FIREBASE_SERVICE_ACCOUNT` set, it needs no disk
at all.

## Keys and safety

- Your Ollama key and the Firebase service account only ever live in Render's environment
  (or a local `.env`, which git ignores). Never put them in the repo, the Pages site or
  `API_BASE`.
- If either one leaks, revoke it (Ollama account settings, or Firebase → Service accounts →
  manage keys in Google Cloud) and paste the new one into Render. Nothing else changes.
