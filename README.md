# 🎮 Gameparty

[![Docker Hub](https://img.shields.io/docker/pulls/gomaaz/gameparty?logo=docker&label=Docker%20Hub)](https://hub.docker.com/r/gomaaz/gameparty)
[![GitHub](https://img.shields.io/badge/GitHub-gomaaz%2FGameparty-181717?logo=github)](https://github.com/gomaaz/Gameparty)

> **Disclaimer:** This project is 100% vibe-coded. It was built for fun, at a LAN party, for friends — not for production. No guarantees of any kind. The author takes no responsibility for any damage, data loss, bugs, or chaos that may result from using this software. Use at your own risk. Have fun. 🤙

---

> *Because telling your friends "let's play something" is never quite enough.*

We all know the situation: you've got a group of friends at a LAN party, everyone wants to have fun together — but half the group is glued to their own game, and getting everyone to actually play *together* feels like herding cats. Someone always has a reason not to join. "Just one more round." "I don't really know that game." "Maybe later."

**Gameparty** was built to fix exactly that.

The idea is simple: turn your LAN party into a shared experience with a little friendly competition. Players earn **Coins** for gaming together, spend them on fun actions in the **Shop**, challenge each other to **Duels** and **Team Duels**, and fight for the top spot on the **Leaderboard**. Suddenly, joining a group session isn't just something you do — it's something you *want* to do, because there's something at stake and the whole crew is in on it.

It's not about winning. It's about getting everyone off their corner of the couch and into the same game — laughing, competing, and actually spending time together. That's the whole point.

---

## Screenshots


<p align="center">
  <a href="https://github.com/user-attachments/assets/e1011f7c-da92-4c15-b212-3e57380ce859"><img src="https://github.com/user-attachments/assets/e1011f7c-da92-4c15-b212-3e57380ce859" width="160"></a>
  <a href="https://github.com/user-attachments/assets/21da1e5e-3cf4-478f-a7d0-64d7b62f4425"><img src="https://github.com/user-attachments/assets/21da1e5e-3cf4-478f-a7d0-64d7b62f4425" width="160"></a>
  <a href="https://github.com/user-attachments/assets/babb70d6-594a-4312-bdd6-7d337b9d1d0c"><img src="https://github.com/user-attachments/assets/babb70d6-594a-4312-bdd6-7d337b9d1d0c" width="160"></a>
  <a href="https://github.com/user-attachments/assets/fc240af9-1da5-4fd7-ad81-5ca2f01ec054"><img src="https://github.com/user-attachments/assets/fc240af9-1da5-4fd7-ad81-5ca2f01ec054" width="160"></a>
  <a href="https://github.com/user-attachments/assets/678fa0c1-186a-4a91-b575-e434484f6b4c"><img src="https://github.com/user-attachments/assets/678fa0c1-186a-4a91-b575-e434484f6b4c" width="160"></a>
  <a href="https://github.com/user-attachments/assets/7353fcb1-284b-4839-9124-e13f4c50d3cb"><img src="https://github.com/user-attachments/assets/7353fcb1-284b-4839-9124-e13f4c50d3cb" width="160"></a>
  <a href="https://github.com/user-attachments/assets/a895de44-d354-4a5f-9718-a23702bc5879"><img src="https://github.com/user-attachments/assets/a895de44-d354-4a5f-9718-a23702bc5879" width="160"></a>
  <a href="https://github.com/user-attachments/assets/869172fc-7af2-406f-9877-5e686175d54c"><img src="https://github.com/user-attachments/assets/869172fc-7af2-406f-9877-5e686175d54c" width="160"></a>
  <a href="https://github.com/user-attachments/assets/1d25f2ca-ef0e-4440-b462-f030381bb40d"><img src="https://github.com/user-attachments/assets/1d25f2ca-ef0e-4440-b462-f030381bb40d" width="160"></a>
  <a href="https://github.com/user-attachments/assets/27629f6c-897d-4893-b97b-024b87d1f2f8"><img src="https://github.com/user-attachments/assets/27629f6c-897d-4893-b97b-024b87d1f2f8" width="160"></a>
</p>


---

## Features

### Coin System
Players earn Coins for every minute they spend in a group session. The rate scales with the number of participants and is fully configurable by the admin. Session cards show the expected rate while waiting, and a live counter ticks up in real time once the session is running.

### Shop
Spend Coins on actions that shake up the session:

| Item | Cost | Description |
|---|---|---|
| Controller Point | 20 Coins | Permanent victory point on the leaderboard |
| Force Play | 5 Coins | Force one other player to join a game of your choice |
| Skip Token | 2 Coins | Skip a game you don't want to play |
| Drink Order | 3 Coins | Order someone to drink immediately |
| Pickpocket (Coins) | 10 Coins | Steal 0–20 Coins from another player |
| Pickpocket (Controller) | 50 Coins | Steal a Controller Point — 50% chance |

Targeted actions (Force Play, Drink Order, Pickpocket) trigger a real-time notification for the recipient, including an acknowledgement flow.

### Duels, Team Duels & FFA
**1v1 Duels:** Challenge another player head-to-head — stakes are deducted from both sides the moment a duel is accepted. No backing out.

**Team Duels:** Build two teams from everyone present, set a stake per person, and every participant must individually accept before it goes live. The winner is set by the Group Leader; the admin pays out the pot.

**FFA (Free-for-All):** The third challenge type — everyone against everyone. Any number of players (minimum 3) enter with equal stakes, and the payout is distributed by finishing position. Configure exactly how much each place earns (e.g. 1st: 50%, 2nd: 30%, 3rd: 20%) or use a preset. Quick picks included: 50/30/20, 60/40, 70/20/10, and Winner-Takes-All. Every participant must accept individually before stakes are locked. Once the session ends, the creator assigns the final standings; the admin reviews and triggers the payout.

**Payout Modes** (available for all three challenge types):
- *Winner Takes All* — the default. The full pot goes to the winner (or winning team).
- *Split by %* — configure a custom winner/loser percentage split. The loser gets a partial refund; the winner takes the rest. The winner must receive at least 50%.

### Game Library
The game list is the heart of Gameparty — all approved games in one place, each with cover art visible as a faded background on every card.

- **Game detail modal** — click any game title to open a full view with a **screenshot slider** (cover + up to 6 in-game screenshots), release date, genres, supported platforms, Metacritic score, shop links, description, and PC system requirements
- **Shop links** — clickable badges below each game title (Steam, GOG, Epic, and more)
- **YouTube badge** — quick link to a YouTube search for any game
- **Game Matcher** — shows which game currently has the most interested players
- Players can mark their interest per game; the admin can add, edit, approve, and delete games

### Sessions
Two types, one unified interface:

- **Spontaneous sessions** — start immediately, players join the lobby
- **Planned sessions** — scheduled for a specific date/time, visible to everyone in advance
- Session cards show the game's cover image for quick recognition
- Optional player slots — numbered seats, lowest free slot filled first
- When a session ends and Coins are paid out, every participant gets a receipt modal with game, duration, player count, and coin earnings

### Notifications
A live panel in the header collects all pending actions — duel challenges, team duel invites, shop tasks (Force Play, Drink Order), and admin payout alerts. Badge count updates instantly for everyone.

### RAWG Integration (optional)
Connect to [RAWG.io](https://rawg.io) to automatically enrich your game library with rich metadata. Get a free API key at [rawg.io/apidocs](https://rawg.io/apidocs) and set it in `docker-compose.yml`.

**What gets fetched and stored locally:**
- Cover image → `gamefiles/covers/`
- Up to 6 in-game screenshots → `gamefiles/screenshots/`
- Description, Metacritic score, genres, release date, platforms, PC system requirements
- Store links (Steam, GOG, Epic, Xbox, PlayStation Store, official website)

**How to use it:**
- Toggle RAWG on/off in the admin panel under *Game Data*
- Click **"Load game data from RAWG"** to enrich all approved games at once — already complete entries are skipped to save API calls
- When suggesting a new game, an autocomplete dropdown appears with RAWG results — selecting one pre-fills all metadata and downloads images immediately
- The admin panel shows total API requests made and how many games have been enriched

### Game Import & Export

| Action | Description |
|---|---|
| **Export CSV** | Download all approved games as a CSV file |
| **Import CSV** | Upload a CSV to add or update games — existing entries are overwritten, player interests are preserved |
| **Import via URL** | Paste a public Google Sheets link or direct CSV URL — fetched and parsed server-side |
| **Load Default Games** | One-click import of ~100 pre-configured games — ideal for a fresh setup |

All imports show a preview modal before committing. CSV format:
```
name,genre,maxPlayers,shoplink_label_1,shoplink_url_1,shoplink_label_2,shoplink_url_2
"Mario Kart 8","Racing",4,"Steam","https://store.steampowered.com/app/...","",""
```

> **Tip (Excel):** Save as *CSV UTF-8 (comma delimited)* — not the default semicolon-separated format used in some locales.

### Server Logs
Live log viewer in the admin panel with level filter (ALL / INFO / ERROR / DEBUG). RAWG API calls are logged in detail at DEBUG level. Set the log level in `docker-compose.yml`:
```yaml
LOG_LEVEL=INFO   # OFF | INFO | DEBUG
```

---

## Quick Start

### Option A — Docker Hub (recommended)

No git clone, no build. Just two commands:

```bash
curl -O https://raw.githubusercontent.com/gomaaz/Gameparty/main/docker-compose.yml
docker compose up -d
```

Open **http://localhost:3000** in your browser.
Everyone on your network can join via **http://\<HOST-IP\>:3000**.

**Default login (first start only):**
| Field | Value |
|---|---|
| Username | `admin` |
| PIN | `1234` |

> Change default credentials before first start by editing `SEED_ADMIN_NAME` / `SEED_ADMIN_PIN` in `docker-compose.yml`.

**Update to the latest version:**
```bash
docker compose pull && docker compose up -d
```

**Persistent data:**
- The SQLite database lives in a named Docker volume (`gameparty-data`) — survives restarts and updates
- Cover images and screenshots downloaded via RAWG are stored in `./gamefiles/` (bind-mounted from your host)

**Custom port (e.g. 8080):**
Change `"3000:3000"` to `"8080:3000"` in `docker-compose.yml`.

**RAWG API key:**
Set `RAWG_API_KEY=your_key_here` in `docker-compose.yml`. Free key at [rawg.io/apidocs](https://rawg.io/apidocs).

---

### Option B — Reverse Proxy (Nginx Proxy Manager)

If you expose Gameparty via a reverse proxy, SSE (live updates) requires specific configuration. Add this to the **Advanced** tab of your Proxy Host:

```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 86400s;
proxy_send_timeout 86400s;
proxy_http_version 1.1;
proxy_set_header Connection '';
```

> Without `proxy_buffering off`, live updates are silently swallowed and clients fall back to polling only.

---

### Option C — Manual (Node.js)

```bash
npm install
npm start
```

Requires **Node.js 18+**. Server runs at `http://localhost:3000`.

---

## Configuration

All configuration lives in `docker-compose.yml`:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `/data/gameparty.db` | SQLite database path |
| `GAMEFILES_PATH` | `/app/gamefiles` | Storage path for covers and screenshots |
| `TZ` | `Europe/Berlin` | Timezone for timestamps |
| `RAWG_API_KEY` | *(empty)* | RAWG.io API key — enables game metadata enrichment |
| `LOG_LEVEL` | `INFO` | Log verbosity: `OFF` / `INFO` / `DEBUG` |
| `SEED_ADMIN_NAME` | `admin` | Initial admin username (fresh DB only) |
| `SEED_ADMIN_PIN` | `1234` | Initial admin PIN (fresh DB only) |

---

## Roles

| Role | Permissions |
|---|---|
| `player` | Earn Coins, use Shop, create and accept Duels, Team Duels & FFA Challenges, mark game interest, join sessions |
| `admin` | + Start/end sessions, manage players, adjust Coins, configure coin rates, pay out duel/FFA pots, manage game library, run RAWG enrichment |

---

## Tech Stack

- **Backend:** Node.js, Express, better-sqlite3 (SQLite)
- **Frontend:** Vanilla JS, HTML5, CSS3 — no framework
- **Realtime:** Server-Sent Events (SSE)
- **External API:** RAWG.io (optional)
- **Deployment:** Docker / Docker Compose

## Internationalization

The UI supports **English** (default) and **German**. Switch via the flag button in the header — stored in `localStorage`.

---

## Versioning

Every change is committed with a version tag (`v2.3.x`).
All releases are available under [Releases](https://github.com/gomaaz/Gameparty/releases).
