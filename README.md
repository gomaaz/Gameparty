# 🎮 Gameparty

A gamification app for LAN parties. Players earn Coins by playing game sessions together, spend them in the Shop, challenge each other to duels, and compete for Controller Points on the leaderboard.

## Features

### Coin System
Players earn Coins by completing gaming sessions:
- **1 Coin** – Session with at least 3 players
- **2 Coins** – Session with 4+ players
- **3 Coins** – Session with all present players

### Shop
Spend Coins on actions:
| Item | Cost | Description |
|---|---|---|
| Controller Point 🎮 | 20 Coins | Permanent victory point on the leaderboard |
| Choose Next Game | 3 Coins | You decide which game is played next |
| Skip Token | 2 Coins | Skip a game you do not want to play |
| Force Play | 5 Coins | Force one other player to participate |
| Drink Order | 3 Coins | Order someone to drink immediately |

### Duels
Players can challenge each other 1-on-1, with Coins or Controller Points as stakes.

### Game Library
- Large game library with genre filtering
- Players can mark their interest in games
- Game Matcher shows which game has the most interested players
- Admin can propose or edit games

### Sessions & Proposals
- Players can propose sessions (immediately or scheduled)
- Admin approves and starts sessions
- Live session lobby with join functionality
- Automatic Coin distribution on session completion

### Leaderboard
Sorted by Controller Points, then by Coins. Controller Points are permanent victory points and cannot be spent.

### Live Updates
All clients are updated in real time via Server-Sent Events (SSE) — no manual refresh needed.

## Tech Stack

- **Backend:** Node.js, Express, better-sqlite3 (SQLite)
- **Frontend:** Vanilla JS, HTML5, CSS3 – no framework
- **Database:** SQLite with WAL mode
- **Realtime:** Server-Sent Events (SSE)

## Internationalization

The UI supports **English** (default) and **German**. Switch languages using the flag button (🇩🇪 / 🇬🇧) in the header. The selection is stored in `localStorage`.

To add another language, extend `js/i18n.js` with a new locale object.

## Installation & Start

```bash
# Install dependencies
npm install

# Start server
npm start
```

The server runs on `http://localhost:3000`.

All devices on the same network can connect via `http://<HOST-IP>:3000`.

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
├── assets/          # Static files
└── VERSION          # Current version number
```

## Roles

| Role | Permissions |
|---|---|
| `player` | Earn Coins, use Shop, create duels, mark interest |
| `admin` | + Start/complete sessions, manage players, adjust Coins |

Login via PIN (configurable in `js/data.js`).

## Versioning

Every change is tagged with a Git version (`v1.0`, `v1.1`, …).
All versions are available under [Releases](https://github.com/gomaaz/Gameparty/releases).
