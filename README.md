# Marketing PT Game 🎮

A live **"Guess the Member's Business"** buzzer quiz for the **16-minute Power Team presentation** of the Marketing Power Team, BNI Infinity (Term Apr 2026 – Sep 2026).

The chapter's other Power Teams compete: their captains buzz in on their phones to identify each Marketing member's business from progressive clues. First-press-wins, steal-on-wrong, a live bar-race scoreboard, logo answer-reveal, and a winner/mega-prize screen — all teaching the room who to refer.

## How it works

- **3 views**, all served from one server:
  - `/host?key=SECRET` — operator console (controls the game, sees answers privately)
  - `/screen?key=SECRET` — projector (clues, buzz status, bar race, winner) — run fullscreen
  - `/play` — captain phones (the QR target); pick a team, then one giant buzzer
- **5 competing teams** (`data/teams.json`): HNI · SME · Hospitality · Construction · Projects.
- **25 curated questions** across 3 rounds (`data/questions.json`): Who Am I? → Who Solves This? → Connect the Referral. Every one of the 10 Marketing members appears at least once.
- **First-press-wins is server-authoritative** — a single Node process decides who buzzed first, so it's fair and deterministic. Wrong answer → host reopens for a steal.

## Run locally

```bash
npm install
HOST_KEY=yourkey node server.js
# open http://localhost:3000/screen?key=yourkey  (projector)
#      http://localhost:3000/host?key=yourkey    (operator)
#      http://localhost:3000/play                 (captains)
```

Env vars: `PORT` (default 3000), `HOST_KEY` (gate for host/screen), `COUNTDOWN_MS` (buzzer arm countdown, default 3000), `DEFAULT_POINTS` (default 100).

## Content

- **Questions:** `data/questions.json`. Each has `clues[]` (revealed one at a time on screen), `answer`, `memberName`, `businessName`, `logo`, and `acceptableAnswers[]` (what the host counts as correct).
- **Logos:** drop the 10 business logos into `public/assets/logos/` using the exact filenames in `public/assets/logos/README.md`. Missing logos fall back to the business name in text — the game still runs.
- **Member source data:** `marketing-pt-members.json` (categories, companies, PALMS stats).

## Deploy (Dokploy on Hostinger VPS)

1. **DNS:** add an A record `ptgame.tetherlo.com → <VPS public IP>`.
2. Push this repo to GitHub.
3. **Dokploy → New Application** → connect the repo → it builds from the included `Dockerfile` (`node:22-alpine`). Set env: `HOST_KEY`, `COUNTDOWN_MS=3000`, `PORT=3000`.
4. **Domain:** add `ptgame.tetherlo.com`, enable HTTPS (Let's Encrypt via Traefik). HTTPS is mandatory for mobile buzzers.
5. **Volume:** mount a volume at `/app/state` so the game-state snapshot survives restarts.
6. **QR:** the lobby screen shows a join QR automatically (`/play`). For a printed backup: `node scripts/makeQR.js https://ptgame.tetherlo.com/play`.

WebSockets work over Traefik on the same domain — no extra config.

## Reliability

- Game state is in-memory but **snapshotted to `state/snapshot.json`** on every change and **auto-restored on boot** (survives container restarts).
- The **host browser mirrors state to localStorage** and can **Export** a backup JSON; an `Import` path can restore it if the server ever comes up empty.
- **Captains reconnect automatically** (Socket.IO) and keep their team + score.
- The host can **manually adjust any score**, **reset/replay** a question, and **reopen buzzers** at any time.

## Pre-game checklist (at the venue, on the live URL)

1. Open `/screen?key=…` on the projector, go fullscreen, click **"enable sound"**.
2. All 5 captains scan the QR on **mobile data**, pick their team → host shows 5 green dots.
3. Test one question: Arm → all 5 buzz → exactly one winner; mark Wrong → steal; mark Correct → bar race animates.
4. **End Game** (test) → **Reset to Lobby** for the real run.

## Members at a glance

| Name | Business | Category |
|------|----------|----------|
| Ajish Joseph | FireFly | Printing & Signage |
| Anup Joy | Watermark Event Solutions | Event Planning |
| Chriztopher Zine | Dista Solutions | Video Production |
| Gautham Manoj | Noun Creatives | Branding & Logo |
| Shimjith Methatta | Netcom Services | IT Hardware & Networking |
| Arjun K Kumar | Mantra IT Solutions | Digital Marketing & SEO |
| Arun Jose | Envision Financial Services | Business Financing |
| Maria Shaji | HamperBells | Customized Gifting |
| Rehdhil Siyad | Tetherlo | CRM & Sales Automation |
| George Sebastian | JB Creations | Uniforms & Apparel |
