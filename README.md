# 🎮 Gameparty

> **Disclaimer:** This project is 100% vibe-coded. It was built for fun, at a LAN party, for friends — not for production. No guarantees of any kind. The author takes no responsibility for any damage, data loss, bugs, or chaos of any sort that may result from using this software. Use at your own risk. Have fun. 🤙

---

> *Because telling your friends "let's play something" is never quite enough.*

We all know the situation: you've got a group of friends at a LAN party, everyone wants to have fun together — but half the group is glued to their own game, and getting everyone to actually play *together* feels like herding cats. Someone always has a reason not to join. "Just one more round." "I don't really know that game." "Maybe later."

**Gameparty** was built to fix exactly that.

The idea is simple: turn your LAN party into a shared experience with a little friendly competition. Players earn **Coins** for gaming together, spend them on fun actions in the **Shop**, challenge each other to **Duels**, and fight for the top spot on the **Leaderboard**. Suddenly, joining a group session isn't just something you do — it's something you *want* to do, because there's something at stake and the whole crew is in on it.

It's not about winning. It's about getting everyone off their corner of the couch and into the same game — laughing, competing, and actually spending time together. That's the whole point.

---

## Screenshots

<table>
  <tr>
    <td align="center"><img src="screenshots/2026-03-07%2018-23-45.png" width="160"/><br/><sub>Home &amp; Leaderboard</sub></td>
    <td align="center"><img src="screenshots/2026-03-07%2018-23-56.png" width="160"/><br/><sub>Duels</sub></td>
    <td align="center"><img src="screenshots/2026-03-07%2018-24-05.png" width="160"/><br/><sub>Shop</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="screenshots/2026-03-07%2018-24-24.png" width="160"/><br/><sub>Game List</sub></td>
    <td align="center"><img src="screenshots/2026-03-07%2018-24-46.png" width="160"/><br/><sub>Game Library</sub></td>
    <td></td>
  </tr>
</table>

---

## Features

### Coin System
Players earn Coins by completing gaming sessions together:
- **1 Coin** – Session with at least 3 players
- **2 Coins** – Session with 4+ players
- **3 Coins** – Session with all present players

The more people join, the more everyone earns. Simple incentive, big effect.

### Shop
Spend Coins on actions that shake up the session:
| Item | Cost | Description |
|---|---|---|
| Controller Point 🎮 | 20 Coins | Permanent victory point on the leaderboard |
| Choose Next Game | 3 Coins | You decide which game is played next |
| Skip Token | 2 Coins | Skip a game you don't want to play |
| Force Play | 5 Coins | Force one other player to participate |
| Drink Order | 3 Coins | Order someone to drink immediately |

### Duels
Players can challenge each other 1-on-1, with Coins or Controller Points as stakes. Accept a challenge and a live duel session starts immediately.

### Game Library
- Large game library with genre filtering
- Players can mark their interest in games
- Game Matcher shows which game has the most interested players right now
- Admin can propose, approve, or edit games

### Sessions & Proposals
- Players can propose sessions (immediately or scheduled)
- Admin approves and starts sessions
- Live session lobby with join functionality
- Automatic Coin distribution on session completion

### Leaderboard
Sorted by Controller Points, then by Coins. Controller Points are permanent victory points — they can't be spent, only earned.

### Live Updates
All clients update in real time via Server-Sent Events (SSE). No refresh needed — everyone sees the same state instantly.

---

## Quick Start

### Option A — Docker Hub (easiest)

No git clone, no build. Just two commands.

```bash
curl -O https://raw.githubusercontent.com/gomaaz/Gameparty/main/docker-compose.yml
docker compose up -d
```

The image is pulled from Docker Hub automatically. Open **http://localhost:3000** in your browser.
All devices on the same network can connect via **http://\<HOST-IP\>:3000**.

**Default login (first start with a fresh database):**
| Field | Value |
|---|---|
| Username | `admin` |
| PIN | `1234` |

> The admin account is created automatically on first start. Log in, then add your players via the Admin panel.
> You can change the default credentials before the first start by editing `SEED_ADMIN_NAME` / `SEED_ADMIN_PIN` in `docker-compose.yml`.

> Data is persisted in a Docker named volume (`gameparty-data`) and survives container restarts and updates.

**Update to the latest version:**
```bash
docker compose pull && docker compose up -d
```

**Custom port (e.g. 8080):**
Edit `docker-compose.yml` and change `"3000:3000"` to `"8080:3000"`.

---

### Option B — Manual (Node.js)

```bash
# Install dependencies
npm install

# Start server
npm start
```

Requires **Node.js 18+**.
The server runs on `http://localhost:3000`.

---

## Tech Stack

- **Backend:** Node.js, Express, better-sqlite3 (SQLite)
- **Frontend:** Vanilla JS, HTML5, CSS3 – no framework
- **Database:** SQLite with WAL mode
- **Realtime:** Server-Sent Events (SSE)
- **Deployment:** Docker / Docker Compose

## Internationalization

The UI supports **English** (default) and **German**. Switch languages using the flag button (🇩🇪 / 🇬🇧) in the header. The selection is stored in `localStorage`.

To add another language, extend `js/i18n.js` with a new locale object.

---

## Project Structure

```
gameparty/
├── server.js        # Express backend + SQLite API
├── index.html       # Single-page app shell
├── js/
│   ├── app.js       # Complete frontend logic
│   ├── data.js      # Configuration, player list, game library
│   └── i18n.js      # Translations (EN/DE) + t() helper
├── css/
│   └── style.css    # Dark gaming theme
├── Dockerfile       # Multi-stage Docker build
├── docker-compose.yml
└── VERSION          # Current version number
```

## Roles

| Role | Permissions |
|---|---|
| `player` | Earn Coins, use Shop, create duels, mark interest |
| `admin` | + Start/complete sessions, manage players, adjust Coins |

Login via PIN (configurable in `js/data.js`).

---

## Versioning & Changelog

Every change is committed with a version tag (`v2.3.1`, `v2.3.2`, …).
See [CHANGELOG.md](CHANGELOG.md) for the full history.
All releases are available under [Releases](https://github.com/gomaaz/Gameparty/releases).
