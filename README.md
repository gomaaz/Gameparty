# 🎮 Gameparty

[![Docker Hub](https://img.shields.io/docker/pulls/gomaaz/gameparty?logo=docker&label=Docker%20Hub)](https://hub.docker.com/r/gomaaz/gameparty)
[![GitHub](https://img.shields.io/badge/GitHub-gomaaz%2FGameparty-181717?logo=github)](https://github.com/gomaaz/Gameparty)

> **Disclaimer:** This project is 100% vibe-coded. It was built for fun, at a LAN party, for friends — not for production. No guarantees of any kind. The author takes no responsibility for any damage, data loss, bugs, or chaos of any sort that may result from using this software. Use at your own risk. Have fun. 🤙

---

> *Because telling your friends "let's play something" is never quite enough.*

We all know the situation: you've got a group of friends at a LAN party, everyone wants to have fun together — but half the group is glued to their own game, and getting everyone to actually play *together* feels like herding cats. Someone always has a reason not to join. "Just one more round." "I don't really know that game." "Maybe later."

**Gameparty** was built to fix exactly that.

The idea is simple: turn your LAN party into a shared experience with a little friendly competition. Players earn **Coins** for gaming together, spend them on fun actions in the **Shop**, challenge each other to **Duels** and **Team Duels**, and fight for the top spot on the **Leaderboard**. Suddenly, joining a group session isn't just something you do — it's something you *want* to do, because there's something at stake and the whole crew is in on it.

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
Players earn Coins for every minute they spend in a group session. The rate scales with the number of participants and is fully configurable by the admin:

- Each player count (2, 3, 4, … players) has its own **Coins per minute** rate
- A **max player limit** caps the rate (e.g., sessions with more than 7 players still earn at the 7-player rate)
- **Formula:** `Coins = ceil(minutes) × rate[playerCount]`
- All rates are set individually in the admin panel and saved instantly on change

Session cards show the **expected rate** while waiting in the lobby, and a **live coin counter** ticks up in real time once the session is running.

### Shop
Spend Coins on actions that shake up the session:

| Item | Cost | Description |
|---|---|---|
| Controller Point | 20 Coins | Permanent victory point on the leaderboard |
| Choose Next Game | 3 Coins | You decide which game is played next |
| Skip Token | 2 Coins | Skip a game you don't want to play |
| Force Play | 5 Coins | Force one other player to participate |
| Drink Order | 3 Coins | Order someone to drink immediately |

Shop actions that target another player (Force Play, Drink Order) generate a **real-time notification** for the recipient, including an acknowledgement flow so the initiator knows the action was received.

### Duels (1v1)
Challenge another player head-to-head with Coins or Controller Points as stakes:

- Set your stake and pick an opponent — the challenge appears in their notification panel immediately
- Stakes are **deducted from both players as soon as the duel is accepted** — no backing out
- Once the duel is live, the challenger marks the winner and the admin pays out the pot
- The winner receives a **payout modal** with a full breakdown of winnings

### Team Duels
The full group gets in on the action — not just two players:

- **Build two teams** from all LAN-present players; each player can only be on one side
- Set a **stake per person** — the input is automatically capped to the lowest balance in the current lineup, so no one can bet more than they have
- A **live pot preview** updates as players are added or stakes are changed
- Every participant must **individually accept** the challenge before it goes live; anyone can reject and cancel it
- The creator is the **Gruppenleiter (GL)** — shown first in the team list with a gold GL badge, and the only one who can select the winning team
- When the winner is set, **all admins receive a notification** in their challenge panel with a direct link to the card
- After the admin pays out, **every participant gets a payout modal** showing whether they won or lost, their earnings (or losses), and the full team breakdown
- Remainder Coins that can't be split evenly go to the first winner in the list

### Notifications Panel
A live panel in the header (⚔️ badge) collects all pending actions for the current player:

- **Duels** — accept or reject directly from the panel; clicking the item navigates to the challenge card
- **Team Duels** — shown with a 👥 indicator; clicking opens the Team tab and scrolls to the card
- **Admin winner review** — admins see a 🏆 notification when a Team Duel creator sets the winning team
- **Shop tasks** — Force Play and Drink Order arrive here; confirm with ✓ to send an acknowledgement back to the buyer
- Badge count combines all pending items across types

### Game Library
- Large game library with genre filtering and LAN ratings
- Players can mark their interest in games
- **Game Matcher** shows which game has the most interested players right now
- Game titles are clickable — opens a **YouTube preview** for quick orientation
- Admin can add per-game **shop links** (Steam, Epic Games, etc.) for easy purchase access
- Admin can add, approve, or edit games

### Sessions
Two session types, same unified interface:

- **Spontaneous sessions** — start immediately, players join the lobby
- **Planned sessions** — scheduled for a specific date/time, visible to all players
- The group leader (GL) is always shown first in the player list, others sorted alphabetically
- Admin can end any session and trigger Coin payout
- Players see the **live coin accumulator** ticking up second by second in running sessions
- Both session types use the same approval and payout flow

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

### Option C — Reverse Proxy (Nginx Proxy Manager)

If you expose Gameparty via a reverse proxy, SSE (live updates) requires specific configuration to work correctly. Without it, the proxy buffers the event stream and clients never receive real-time updates.

**Nginx Proxy Manager — Advanced tab (per Proxy Host):**

```nginx
# Required for SSE (Server-Sent Events / live updates)
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 86400s;
proxy_send_timeout 86400s;
proxy_http_version 1.1;
proxy_set_header Connection '';
```

> Without `proxy_buffering off`, SSE events are silently swallowed by the proxy and clients fall back to 10-second polling only.
> Without `proxy_read_timeout 86400s`, the proxy closes idle SSE connections after ~60 seconds, causing constant reconnects and browser console errors.

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

The UI supports **English** (default) and **German**. Switch languages using the flag button in the header. The selection is stored in `localStorage`.

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
├── svg/             # SVG icons (coins, controller, platform logos)
├── Dockerfile       # Multi-stage Docker build
└── docker-compose.yml
```

## Roles

| Role | Permissions |
|---|---|
| `player` | Earn Coins, use Shop, create and accept Duels & Team Duels, mark game interest, join sessions |
| `admin` | + Start/end sessions, manage players, adjust Coins, configure coin rates, pay out duel pots |

---

## Admin Settings

The admin panel includes a **Session Coins** configuration card:

- **Coinrate per player count** — set individual Coins/min rates for 2, 3, 4, … players
- **Max player limit** — sessions with more players than the limit use the cap's rate
- All settings save automatically on input change (no save button needed)

---

## Versioning & Changelog

Every change is committed with a version tag (`v2.3.x`).
See [CHANGELOG.md](CHANGELOG.md) for the full history.
All releases are available under [Releases](https://github.com/gomaaz/Gameparty/releases).
