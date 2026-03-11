// ============================================================
// Gameparty - Express + SQLite Backend
// ============================================================
const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { version } = require('./package.json');

const app = express();
const PORT = process.env.PORT || 3000;

// Global shop cooldowns (in-memory, reset on server restart)
const shopCooldownTs = {}; // { rob_controller: timestamp }
const SHOP_COOLDOWN_MS = { rob_controller: 5 * 60 * 1000 };

app.use(cors());
app.use(express.json());

// index.html mit versionierten Asset-URLs ausliefern (Cache-Busting)
app.get('/', (req, res) => {
    let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    html = html
        .replace('css/style.css"', `css/style.css?v=${version}"`)
        .replace('js/i18n.js"', `js/i18n.js?v=${version}"`)
        .replace('js/data.js"', `js/data.js?v=${version}"`)
        .replace('js/app.js"', `js/app.js?v=${version}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
});

app.use(express.static(path.join(__dirname)));

// ---- Server-Sent Events ----
const sseClients = new Set();

function broadcast() {
    sseClients.forEach(res => res.write('event: update\ndata: {}\n\n'));
}

// Broadcast nach jedem erfolgreichen POST/PUT/DELETE
app.use((req, res, next) => {
    if (req.method === 'GET') return next();
    const originalJson = res.json.bind(res);
    res.json = (data) => {
        originalJson(data);
        if (data && !data.error) broadcast();
    };
    next();
});

// Kein Cache für alle API-Routen
app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseClients.add(res);
    // Heartbeat alle 25s damit die Verbindung nicht vom Browser gekappt wird
    const heartbeat = setInterval(() => res.write(':\n\n'), 25000);
    req.on('close', () => { sseClients.delete(res); clearInterval(heartbeat); });
});

// ---- Database Setup ----
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'gameparty.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, pin TEXT, role TEXT DEFAULT 'player');
    CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, maxPlayers INT, genre TEXT, lanRating INT DEFAULT 0, previewUrl TEXT, ready INT DEFAULT 0, status TEXT DEFAULT 'approved', suggestedBy TEXT, sessionCoins INT DEFAULT 0, shop_links TEXT DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS game_players (game_id INT, player TEXT, PRIMARY KEY(game_id, player));
    CREATE TABLE IF NOT EXISTS coins (player TEXT PRIMARY KEY, amount INT DEFAULT 0);
    CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT, amount INT, reason TEXT, timestamp INT);
    CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT, players TEXT, coinsPerPlayer INT, timestamp INT);
    CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT, type TEXT, timestamp INT);
    CREATE TABLE IF NOT EXISTS genres_played (player TEXT, genre TEXT, PRIMARY KEY(player, genre));
    CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, game TEXT, isNewGame INT, leader TEXT, status TEXT, scheduledTime TEXT, scheduledDay TEXT, message TEXT, createdAt INT, approvedAt INT, startedAt INT, completedAt INT, pendingCoins INT, coinsApproved INT);
    CREATE TABLE IF NOT EXISTS proposal_players (proposal_id TEXT, player TEXT, PRIMARY KEY(proposal_id, player));
    CREATE TABLE IF NOT EXISTS attendees (player TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS stars (player TEXT PRIMARY KEY, amount INT DEFAULT 0);
    CREATE TABLE IF NOT EXISTS challenges (
        id TEXT PRIMARY KEY,
        challenger TEXT,
        opponent TEXT,
        game TEXT,
        stakeCoins INT DEFAULT 0,
        stakeStars INT DEFAULT 0,
        status TEXT DEFAULT 'pending',
        winner TEXT,
        createdAt INT,
        resolvedAt INT
    );
    CREATE TABLE IF NOT EXISTS team_challenges (
        id TEXT PRIMARY KEY,
        game TEXT,
        stakeCoinsPerPerson INT DEFAULT 0,
        stakeStarsPerPerson INT DEFAULT 0,
        teamA TEXT,
        teamB TEXT,
        status TEXT DEFAULT 'pending',
        winnerTeam TEXT,
        createdBy TEXT,
        createdAt INT,
        resolvedAt INT
    );
    CREATE TABLE IF NOT EXISTS player_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target TEXT,
        type TEXT,
        from_player TEXT,
        message TEXT,
        createdAt INT
    );
    CREATE TABLE IF NOT EXISTS live_sessions (
        id TEXT PRIMARY KEY,
        game TEXT NOT NULL,
        leader TEXT NOT NULL,
        startedAt INT,
        endedAt INT,
        status TEXT DEFAULT 'lobby',
        pending_coins INT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS live_session_players (
        session_id TEXT,
        player TEXT,
        joinedAt INT,
        PRIMARY KEY (session_id, player)
    );
`);

// ---- Migration: deadline Feld in player_events ----
try { db.prepare('ALTER TABLE player_events ADD COLUMN deadline INTEGER').run(); } catch {}

// ---- Migration: status Feld in player_events (fuer Penalty-Queue) ----
try { db.prepare("ALTER TABLE player_events ADD COLUMN status TEXT DEFAULT 'active'").run(); } catch {}
// Bestehende Eintraege auf active setzen (falls noch nicht gesetzt)
try { db.prepare("UPDATE player_events SET status = 'active' WHERE status IS NULL").run(); } catch {}

// ---- Migration: ip Feld in users (fuer LAN-IP-Verwaltung) ----
try { db.prepare("ALTER TABLE users ADD COLUMN ip TEXT DEFAULT ''").run(); } catch {}

// Migration: Gaming account fields
['steam', 'ubisoft', 'battlenet', 'epic', 'ea', 'riot', 'discord', 'teamspeak'].forEach(col => {
    try { db.prepare(`ALTER TABLE users ADD COLUMN ${col} TEXT DEFAULT ''`).run(); } catch {}
});

// ---- Migration: lang Feld in users (Sprache: 'en' oder 'de') ----
try { db.prepare("ALTER TABLE users ADD COLUMN lang TEXT DEFAULT 'en'").run(); } catch {}

// ---- Migration: medium Feld in live_sessions (fuer LAN/Steam/etc) ----
try { db.prepare("ALTER TABLE live_sessions ADD COLUMN medium TEXT DEFAULT 'lan'").run(); } catch {}

// ---- Migration: medium_account Feld in live_sessions ----
try { db.prepare("ALTER TABLE live_sessions ADD COLUMN medium_account TEXT").run(); } catch {}

// ---- Migration: medium Feld in sessions (fuer LAN/Steam/etc) ----
try { db.prepare("ALTER TABLE sessions ADD COLUMN medium TEXT DEFAULT 'lan'").run(); } catch {}

// ---- Migration: medium Feld in proposals (fuer LAN/Steam/etc) ----
try { db.prepare("ALTER TABLE proposals ADD COLUMN medium TEXT DEFAULT 'lan'").run(); } catch {}

// ---- Migration: medium_account Feld in proposals ----
try { db.prepare("ALTER TABLE proposals ADD COLUMN medium_account TEXT").run(); } catch {}

// ---- Migration: Rename steamRating to previewUrl ----
try {
    db.exec('ALTER TABLE games RENAME COLUMN steamRating TO previewUrl');
    console.log('Migration: steamRating → previewUrl');
} catch (e) { /* bereits migriert oder Spalte existiert nicht */ }

// ---- Migration: shop_links Feld in games ----
try { db.prepare("ALTER TABLE games ADD COLUMN shop_links TEXT DEFAULT '[]'").run(); } catch {}

// ---- Migration: pending_coins Feld in live_sessions ----
try { db.prepare("ALTER TABLE live_sessions ADD COLUMN pending_coins INT DEFAULT 0").run(); } catch {}

// ---- Migration: acceptances Feld in team_challenges ----
try { db.prepare("ALTER TABLE team_challenges ADD COLUMN acceptances TEXT DEFAULT '[]'").run(); } catch {}

// ---- Migration: challenge_id und challenge_type in live_sessions ----
try { db.prepare("ALTER TABLE live_sessions ADD COLUMN challenge_id TEXT").run(); } catch {}
try { db.prepare("ALTER TABLE live_sessions ADD COLUMN challenge_type TEXT").run(); } catch {}

// ---- Tabelle: duel_votes ----
db.exec(`CREATE TABLE IF NOT EXISTS duel_votes (
    session_id TEXT,
    player     TEXT,
    voted_for  TEXT,
    created_at INT,
    PRIMARY KEY (session_id, player)
)`);

// Indexes für häufige WHERE-Spalten
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_player_events_target ON player_events(target)").run(); } catch {}
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_live_sessions_status ON live_sessions(status)").run(); } catch {}
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status)").run(); } catch {}
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_team_challenges_status ON team_challenges(status)").run(); } catch {}
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_history_player ON history(player)").run(); } catch {}

// ---- Cleanup: verwaiste Attendees (Spieler geloescht, aber noch in attendees) ----
try {
    const result = db.prepare('DELETE FROM attendees WHERE player NOT IN (SELECT name FROM users)').run();
    if (result.changes > 0) {
        console.log(`Startup-Cleanup: ${result.changes} verwaiste Attendee-Eintraege entfernt`);
    }
} catch (e) { /* Tabelle existiert noch nicht beim ersten Start */ }

// ---- Seed Data (from data.js CONFIG + FALLBACK_GAMES) ----
function seedIfEmpty() {
    const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    if (userCount === 0) {
        console.log('Seeding initial users...');
        const insertUser = db.prepare('INSERT OR IGNORE INTO users (name, pin, role) VALUES (?, ?, ?)');
        const insertAttendee = db.prepare('INSERT OR IGNORE INTO attendees (player) VALUES (?)');
        const insertCoin = db.prepare('INSERT OR IGNORE INTO coins (player, amount) VALUES (?, 0)');
        const insertStar = db.prepare('INSERT OR IGNORE INTO stars (player, amount) VALUES (?, 0)');

        const adminName = process.env.SEED_ADMIN_NAME;
        const adminPin  = process.env.SEED_ADMIN_PIN;

        const users = (adminName && adminPin)
            ? [{ name: adminName, pin: adminPin, role: 'admin' }]
            : [
                { name: 'Daniel', pin: '1234', role: 'admin' },
                { name: 'Martin', pin: '1111', role: 'player' },
                { name: 'Kevin',  pin: '2222', role: 'player' },
                { name: 'Peter',  pin: '3333', role: 'player' },
                { name: 'Julian', pin: '4444', role: 'player' },
                { name: 'Lars',   pin: '5555', role: 'player' },
                { name: 'Wolf',   pin: '6666', role: 'player' }
            ];

        const seedMany = db.transaction(() => {
            for (const u of users) {
                insertUser.run(u.name, u.pin, u.role);
                insertAttendee.run(u.name);
                insertCoin.run(u.name);
                insertStar.run(u.name);
            }
        });
        seedMany();
    }
}

seedIfEmpty();

// ---- Migration: Ensure existing users have stars ----
function migrateStars() {
    const players = db.prepare('SELECT name FROM users').all();
    const insertStar = db.prepare('INSERT OR IGNORE INTO stars (player, amount) VALUES (?, 0)');
    const transaction = db.transaction(() => {
        for (const u of players) insertStar.run(u.name);
    });
    transaction();
}

migrateStars();

// ---- Helper: Get game with players ----
function getGameWithPlayers(game) {
    const players = db.prepare('SELECT player FROM game_players WHERE game_id = ?').all(game.id);
    const playersObj = {};
    players.forEach(p => { playersObj[p.player] = true; });
    return {
        id: game.id,
        name: game.name,
        maxPlayers: game.maxPlayers,
        genre: game.genre || '',
        lanRating: game.lanRating,
        previewUrl: game.previewUrl || '',
        ready: !!game.ready,
        status: game.status,
        suggestedBy: game.suggestedBy,
        sessionCoins: game.sessionCoins || 0,
        shopLinks: JSON.parse(game.shop_links || '[]'),
        players: playersObj
    };
}

function getAllGamesWithPlayers() {
    const games = db.prepare('SELECT * FROM games').all();
    return games.map(getGameWithPlayers);
}

// ---- API Routes ----

// GET /api/init - Load everything for initial state
app.get('/api/init', (req, res) => {
    const users = db.prepare('SELECT name, role, ip, lang, steam, ubisoft, battlenet, epic, ea, riot, discord, teamspeak FROM users').all();
    const games = getAllGamesWithPlayers();
    const coins = {};
    db.prepare('SELECT player, amount FROM coins').all().forEach(r => { coins[r.player] = r.amount; });
    const stars = {};
    db.prepare('SELECT player, amount FROM stars').all().forEach(r => { stars[r.player] = r.amount; });
    const attendees = db.prepare('SELECT player FROM attendees WHERE player IN (SELECT name FROM users)').all().map(r => r.player);
    const settings = {};
    db.prepare('SELECT key, value FROM settings').all().forEach(r => { settings[r.key] = r.value; });
    const players = users.map(u => u.name);

    res.json({ users, games, coins, stars, attendees, settings, players, version, shopCooldowns: shopCooldownTs });
});

// POST /api/login
app.post('/api/login', (req, res) => {
    const { name, pin } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE name = ?').get(name);
    if (!user || user.pin !== pin) {
        return res.status(401).json({ error: 'Falsche PIN' });
    }
    res.json({ success: true, role: user.role });
});

// GET /api/games
app.get('/api/games', (req, res) => {
    res.json(getAllGamesWithPlayers());
});

// POST /api/games/suggest
app.post('/api/games/suggest', (req, res) => {
    const { name, genre, maxPlayers, suggestedBy } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    const existing = db.prepare('SELECT id FROM games WHERE LOWER(name) = LOWER(?)').get(name);
    if (existing) return res.status(409).json({ error: 'Spiel existiert bereits' });

    const result = db.prepare('INSERT INTO games (name, maxPlayers, genre, status, suggestedBy) VALUES (?, ?, ?, ?, ?)').run(name, maxPlayers || 4, genre || '', 'suggested', suggestedBy || null);
    if (suggestedBy) {
        db.prepare('INSERT OR IGNORE INTO game_players (game_id, player) VALUES (?, ?)').run(result.lastInsertRowid, suggestedBy);
    }
    res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/games/:name/approve
app.put('/api/games/:name/approve', (req, res) => {
    const { sessionCoins } = req.body;
    const game = db.prepare('SELECT id FROM games WHERE name = ?').get(req.params.name);
    if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden' });
    db.prepare('UPDATE games SET status = ?, sessionCoins = ? WHERE id = ?').run('approved', sessionCoins || 0, game.id);
    res.json({ success: true });
});

// DELETE /api/games/:name
app.delete('/api/games/:name', (req, res) => {
    const game = db.prepare('SELECT id FROM games WHERE name = ?').get(req.params.name);
    if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden' });
    db.transaction(() => {
        db.prepare('DELETE FROM game_players WHERE game_id = ?').run(game.id);
        db.prepare('DELETE FROM games WHERE id = ?').run(game.id);
    })();
    res.json({ success: true });
});

// PUT /api/games/:name
app.put('/api/games/:name', (req, res) => {
    const game = db.prepare('SELECT id FROM games WHERE name = ?').get(req.params.name);
    if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden' });
    const { newName, genre, maxPlayers, previewUrl, sessionCoins, shopLinks } = req.body;
    const updates = [];
    const params = [];
    if (newName !== undefined) { updates.push('name = ?'); params.push(newName); }
    if (genre !== undefined) { updates.push('genre = ?'); params.push(genre); }
    if (maxPlayers !== undefined) { updates.push('maxPlayers = ?'); params.push(maxPlayers); }
    if (previewUrl !== undefined) { updates.push('previewUrl = ?'); params.push(previewUrl); }
    if (sessionCoins !== undefined) { updates.push('sessionCoins = ?'); params.push(sessionCoins); }
    if (shopLinks !== undefined) { updates.push('shop_links = ?'); params.push(JSON.stringify(shopLinks)); }
    if (updates.length > 0) {
        params.push(game.id);
        db.prepare(`UPDATE games SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }
    res.json({ success: true });
});

// POST /api/games/:name/interest
app.post('/api/games/:name/interest', (req, res) => {
    const { player } = req.body;
    const game = db.prepare('SELECT id FROM games WHERE name = ?').get(req.params.name);
    if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden' });
    const existing = db.prepare('SELECT 1 FROM game_players WHERE game_id = ? AND player = ?').get(game.id, player);
    if (existing) {
        db.prepare('DELETE FROM game_players WHERE game_id = ? AND player = ?').run(game.id, player);
        res.json({ interested: false });
    } else {
        db.prepare('INSERT INTO game_players (game_id, player) VALUES (?, ?)').run(game.id, player);
        res.json({ interested: true });
    }
});

// GET /api/genres
const BASE_GENRES = ['Action', 'Egoshooter', 'Indie', 'Rollenspiel', 'Strategie', 'Taktik'];

app.get('/api/genres', (req, res) => {
    const games = db.prepare("SELECT genre FROM games WHERE genre IS NOT NULL AND genre != ''").all();
    const genres = new Set(BASE_GENRES);
    games.forEach(g => {
        g.genre.split(',').forEach(genre => {
            const trimmed = genre.trim();
            if (trimmed) genres.add(trimmed);
        });
    });
    res.json([...genres].sort());
});

// GET /api/coins
app.get('/api/coins', (req, res) => {
    const coins = {};
    db.prepare('SELECT player, amount FROM coins').all().forEach(r => { coins[r.player] = r.amount; });
    res.json(coins);
});

// POST /api/coins/add
app.post('/api/coins/add', (req, res) => {
    const { player, amount, reason } = req.body;
    if (player === 'alle') {
        const allPlayers = db.prepare('SELECT name FROM users').all();
        const ts = Date.now();
        const tx = db.transaction(() => {
            allPlayers.forEach(u => {
                db.prepare('INSERT INTO coins (player, amount) VALUES (?, MAX(0, ?)) ON CONFLICT(player) DO UPDATE SET amount = MAX(0, amount + ?)').run(u.name, amount, amount);
                db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(u.name, amount, reason || '', ts);
            });
        });
        tx();
        broadcast({ type: 'update' });
        return res.json({ affectedPlayers: allPlayers.length });
    }
    db.prepare('INSERT INTO coins (player, amount) VALUES (?, MAX(0, ?)) ON CONFLICT(player) DO UPDATE SET amount = MAX(0, amount + ?)').run(player, amount, amount);
    db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(player, amount, reason || '', Date.now());
    const row = db.prepare('SELECT amount FROM coins WHERE player = ?').get(player);
    res.json({ newBalance: row ? row.amount : 0 });
});

// POST /api/coins/spend
app.post('/api/coins/spend', (req, res) => {
    const { player, amount, reason } = req.body;
    const row = db.prepare('SELECT amount FROM coins WHERE player = ?').get(player);
    if (!row || row.amount < amount) return res.status(400).json({ error: 'Nicht genug Coins' });
    db.prepare('UPDATE coins SET amount = amount - ? WHERE player = ?').run(amount, player);
    db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(player, -amount, reason || '', Date.now());
    res.json({ newBalance: row.amount - amount });
});

// POST /api/shop/rob-coins
app.post('/api/shop/rob-coins', (req, res) => {
    const { thief, target, cost } = req.body;
    if (!thief || !target) return res.status(400).json({ error: 'thief und target erforderlich' });

    const thiefRow = db.prepare('SELECT amount FROM coins WHERE player = ?').get(thief);
    if (!thiefRow || thiefRow.amount < cost) return res.status(400).json({ error: 'Nicht genug Coins' });

    const stolen = Math.floor(Math.random() * 21); // 0 bis 20

    const tx = db.transaction(() => {
        // Kosten vom Täter abziehen
        db.prepare('UPDATE coins SET amount = amount - ? WHERE player = ?').run(cost, thief);
        db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(thief, -cost, `Shop: Taschendieb Münzen (Ziel: ${target})`, Date.now());

        if (stolen > 0) {
            // Gestohlene Coins vom Opfer abziehen (mindestens 0)
            const targetRow = db.prepare('SELECT amount FROM coins WHERE player = ?').get(target);
            const actualStolen = targetRow ? Math.min(stolen, targetRow.amount) : 0;
            if (actualStolen > 0) {
                db.prepare('UPDATE coins SET amount = amount - ? WHERE player = ?').run(actualStolen, target);
                db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(target, -actualStolen, `Taschendieb: ${thief} hat ${actualStolen} Coins gestohlen`, Date.now());
                db.prepare('INSERT INTO coins (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(thief, actualStolen, actualStolen);
                db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(thief, actualStolen, `Beute: ${actualStolen} Coins von ${target} gestohlen`, Date.now());
                return actualStolen;
            }
        }
        return 0;
    });

    const actualStolen = tx();
    broadcast({ type: 'update' });
    res.json({ stolen: actualStolen });
});

// GET /api/shop/cooldowns
app.get('/api/shop/cooldowns', (req, res) => res.json(shopCooldownTs));

// POST /api/shop/rob-controller
app.post('/api/shop/rob-controller', (req, res) => {
    const { thief, target, cost } = req.body;
    if (!thief || !target) return res.status(400).json({ error: 'thief und target erforderlich' });

    // Global cooldown check
    const lastPurchase = shopCooldownTs.rob_controller || 0;
    const remainingMs = SHOP_COOLDOWN_MS.rob_controller - (Date.now() - lastPurchase);
    if (remainingMs > 0) return res.status(429).json({ error: 'cooldown', remainingMs });

    const thiefRow = db.prepare('SELECT amount FROM coins WHERE player = ?').get(thief);
    if (!thiefRow || thiefRow.amount < cost) return res.status(400).json({ error: 'Nicht genug Coins' });

    const targetStars = db.prepare('SELECT amount FROM stars WHERE player = ?').get(target);
    const success = Math.random() < 0.5 && targetStars && targetStars.amount > 0;

    const tx = db.transaction(() => {
        // Kosten vom Täter abziehen
        db.prepare('UPDATE coins SET amount = amount - ? WHERE player = ?').run(cost, thief);
        db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(thief, -cost, `Shop: Taschendieb Controller (Ziel: ${target})`, Date.now());

        if (success) {
            // 1 Controller-Punkt vom Opfer stehlen
            db.prepare('UPDATE stars SET amount = amount - 1 WHERE player = ?').run(target);
            db.prepare('INSERT INTO stars (player, amount) VALUES (?, 1) ON CONFLICT(player) DO UPDATE SET amount = amount + 1').run(thief);
        }
    });

    tx();
    shopCooldownTs.rob_controller = Date.now();
    broadcast({ type: 'update' });
    res.json({ success });
});

// GET /api/stars
app.get('/api/stars', (req, res) => {
    const stars = {};
    db.prepare('SELECT player, amount FROM stars').all().forEach(r => { stars[r.player] = r.amount; });
    res.json(stars);
});

// POST /api/shop/buy-star — Spieler kauft 1 Controller-Punkt für Coins (kein Admin nötig)
app.post('/api/shop/buy-star', (req, res) => {
    const { player, cost } = req.body;
    if (!player || cost == null) return res.status(400).json({ error: 'player und cost erforderlich' });
    const coinRow = db.prepare('SELECT amount FROM coins WHERE player = ?').get(player);
    if (!coinRow || coinRow.amount < cost) return res.status(400).json({ error: 'Nicht genug Coins' });
    const tx = db.transaction(() => {
        db.prepare('UPDATE coins SET amount = amount - ? WHERE player = ?').run(cost, player);
        db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(player, -cost, 'Shop: Controller-Punkt kaufen', Date.now());
        db.prepare('INSERT INTO stars (player, amount) VALUES (?, 1) ON CONFLICT(player) DO UPDATE SET amount = amount + 1').run(player);
    });
    tx();
    const row = db.prepare('SELECT amount FROM stars WHERE player = ?').get(player);
    res.json({ newStars: row ? row.amount : 1 });
});

// POST /api/stars/add
app.post('/api/stars/add', (req, res) => {
    const { player, amount, requestedBy } = req.body;
    if (!player || !amount) return res.status(400).json({ error: 'player und amount erforderlich' });
    const _requester2 = requestedBy || player;
    const _isAdmin2 = !!db.prepare("SELECT 1 FROM users WHERE name = ? AND role = 'admin'").get(_requester2);
    if (!_isAdmin2) return res.status(403).json({ error: 'Nur Admins können Controller-Punkte vergeben' });
    if (player === 'alle') {
        const allPlayers = db.prepare('SELECT name FROM users').all();
        const tx = db.transaction(() => {
            allPlayers.forEach(u => {
                db.prepare('INSERT INTO stars (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(u.name, amount, amount);
            });
        });
        tx();
        broadcast({ type: 'update' });
        return res.json({ affectedPlayers: allPlayers.length });
    }
    db.prepare('INSERT INTO stars (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(player, amount, amount);
    const row = db.prepare('SELECT amount FROM stars WHERE player = ?').get(player);
    broadcast({ type: 'update' });
    res.json({ newStars: row ? row.amount : 0 });
});

// GET /api/history/:player
app.get('/api/history/:player', (req, res) => {
    const history = db.prepare('SELECT * FROM history WHERE player = ? ORDER BY timestamp DESC LIMIT 100').all(req.params.player);
    res.json(history);
});

// GET /api/sessions
app.get('/api/sessions', (req, res) => {
    const sessions = db.prepare('SELECT * FROM sessions ORDER BY timestamp DESC').all();
    res.json(sessions.map(s => ({ ...s, players: JSON.parse(s.players || '[]') })));
});

// POST /api/sessions
app.post('/api/sessions', (req, res) => {
    const { game, players, coinsPerPlayer } = req.body;
    const result = db.prepare('INSERT INTO sessions (game, players, coinsPerPlayer, timestamp) VALUES (?, ?, ?, ?)').run(game, JSON.stringify(players), coinsPerPlayer, Date.now());
    res.json({ success: true, id: result.lastInsertRowid });
});

// GET /api/proposals
app.get('/api/proposals', (req, res) => {
    const proposals = db.prepare('SELECT * FROM proposals ORDER BY createdAt DESC').all();
    const result = proposals.map(p => {
        const players = db.prepare('SELECT player FROM proposal_players WHERE proposal_id = ?').all(p.id).map(r => r.player);
        return { ...p, isNewGame: !!p.isNewGame, coinsApproved: p.coinsApproved === null ? null : !!p.coinsApproved, players };
    });
    res.json(result);
});

// POST /api/proposals
app.post('/api/proposals', (req, res) => {
    const { id, game, isNewGame, leader, message, scheduledDay, scheduledTime, medium, medium_account } = req.body;
    const activeGame = getActiveSessionForPlayer(leader);
    if (activeGame) return res.status(400).json({ error: `Du bist bereits in einer laufenden Session: ${activeGame}` });
    const proposalId = id || 'p_' + Date.now();
    db.prepare('INSERT INTO proposals (id, game, isNewGame, leader, status, scheduledTime, scheduledDay, message, createdAt, coinsApproved, medium, medium_account) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(proposalId, game, isNewGame ? 1 : 0, leader, 'pending', scheduledTime || '', scheduledDay || '', message || '', Date.now(), 0, medium || 'lan', medium_account || '');
    db.prepare('INSERT INTO proposal_players (proposal_id, player) VALUES (?, ?)').run(proposalId, leader);
    res.json({ success: true, id: proposalId });
});

// PUT /api/proposals/:id
app.put('/api/proposals/:id', (req, res) => {
    const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Proposal nicht gefunden' });
    if (req.body.status === 'completed') {
        const completedAt = req.body.completedAt || Date.now();
        const playerCount = db.prepare('SELECT COUNT(*) as cnt FROM proposal_players WHERE proposal_id = ?').get(req.params.id).cnt;
        const maxMultiplierSetting = db.prepare("SELECT value FROM settings WHERE key = 'max_multiplier'").get();
        const playerMultipliersSetting = db.prepare("SELECT value FROM settings WHERE key = 'player_multipliers'").get();
        const maxMultiplier = parseInt(maxMultiplierSetting?.value || '10');
        const playerMultipliersMap = (() => { try { return JSON.parse(playerMultipliersSetting?.value || '{}'); } catch { return {}; } })();
        const cappedCount = Math.min(playerCount, maxMultiplier);
        let playerRate = 0;
        for (let c = cappedCount; c >= 2; c--) {
            if (playerMultipliersMap[String(c)] !== undefined) { playerRate = parseFloat(playerMultipliersMap[String(c)]); break; }
        }
        const durationMin = proposal.startedAt ? Math.ceil((completedAt - proposal.startedAt) / 60000) : 0;
        req.body.pendingCoins = Math.round(durationMin * playerRate);
    }
    if (req.body.status === 'active') {
        const playerCount = db.prepare('SELECT COUNT(*) as cnt FROM proposal_players WHERE proposal_id = ?').get(req.params.id).cnt;
        if (playerCount < 2) return res.status(400).json({ error: 'Eine Session benötigt mindestens 2 Spieler' });
        const players = db.prepare('SELECT player FROM proposal_players WHERE proposal_id = ?').all(req.params.id);
        for (const { player } of players) {
            const conflict = db.prepare(`
                SELECT ls.game FROM live_sessions ls
                INNER JOIN live_session_players lsp ON ls.id = lsp.session_id
                WHERE lsp.player = ? AND ls.status = 'running'
            `).get(player);
            if (conflict) return res.status(400).json({ error: `${player} ist bereits in einer laufenden Session: ${conflict.game}` });
            const proposalConflict = db.prepare(`
                SELECT p.game FROM proposals p
                INNER JOIN proposal_players pp ON p.id = pp.proposal_id
                WHERE pp.player = ? AND p.status = 'active' AND p.id != ?
            `).get(player, req.params.id);
            if (proposalConflict) return res.status(400).json({ error: `${player} ist bereits in einer laufenden Session: ${proposalConflict.game}` });
        }
    }
    const updates = [];
    const params = [];
    for (const [key, value] of Object.entries(req.body)) {
        if (['status', 'scheduledTime', 'scheduledDay', 'message', 'approvedAt', 'startedAt', 'completedAt', 'pendingCoins', 'coinsApproved', 'medium', 'medium_account'].includes(key)) {
            updates.push(`${key} = ?`);
            params.push(value);
        }
    }
    if (updates.length > 0) {
        params.push(req.params.id);
        db.prepare(`UPDATE proposals SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }
    res.json({ success: true });
});

// DELETE /api/proposals/:id
app.delete('/api/proposals/:id', (req, res) => {
    db.transaction(() => {
        db.prepare('DELETE FROM proposal_players WHERE proposal_id = ?').run(req.params.id);
        db.prepare('DELETE FROM proposals WHERE id = ?').run(req.params.id);
    })();
    res.json({ success: true });
});

// POST /api/proposals/:id/join
app.post('/api/proposals/:id/join', (req, res) => {
    const { player } = req.body;
    const proposal = db.prepare('SELECT status FROM proposals WHERE id = ?').get(req.params.id);
    if (proposal && proposal.status === 'active') {
        const activeGame = getActiveSessionForPlayer(player);
        if (activeGame) return res.status(400).json({ error: `Du bist bereits in einer laufenden Session: ${activeGame}` });
    }
    db.prepare('INSERT OR IGNORE INTO proposal_players (proposal_id, player) VALUES (?, ?)').run(req.params.id, player);
    res.json({ success: true });
});

// POST /api/proposals/:id/leave
app.post('/api/proposals/:id/leave', (req, res) => {
    const { player } = req.body;
    db.prepare('DELETE FROM proposal_players WHERE proposal_id = ? AND player = ?').run(req.params.id, player);
    res.json({ success: true });
});

// POST /api/proposals/:id/approve — Coins auszahlen und Proposal abschliessen
app.post('/api/proposals/:id/approve', (req, res) => {
    const { coins, approvedBy } = req.body;
    const _isAdmin5 = !!db.prepare("SELECT 1 FROM users WHERE name = ? AND role = 'admin'").get(approvedBy);
    if (!_isAdmin5) return res.status(403).json({ error: 'Nur Admins können freigeben' });
    const coinsPerPlayer = parseInt(coins) || 0;
    const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Proposal nicht gefunden' });
    if (proposal.coinsApproved) return res.status(400).json({ error: 'Bereits freigegeben' });

    const players = db.prepare('SELECT player FROM proposal_players WHERE proposal_id = ?').all(req.params.id).map(r => r.player);

    for (const player of players) {
        db.prepare('INSERT INTO coins (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(player, coinsPerPlayer, coinsPerPlayer);
        db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(player, coinsPerPlayer, `Session: ${proposal.game} (${players.length} Spieler)`, Date.now());
    }

    db.prepare('INSERT INTO sessions (game, players, coinsPerPlayer, timestamp) VALUES (?, ?, ?, ?)').run(proposal.game, JSON.stringify(players), coinsPerPlayer, Date.now());
    db.prepare('UPDATE proposals SET coinsApproved = 1 WHERE id = ?').run(req.params.id);
    broadcast({ type: 'update' });
    res.json({ success: true });
});

// GET /api/attendees
app.get('/api/attendees', (req, res) => {
    const attendees = db.prepare('SELECT player FROM attendees WHERE player IN (SELECT name FROM users)').all().map(r => r.player);
    res.json(attendees);
});

// PUT /api/attendees
app.put('/api/attendees', (req, res) => {
    const { attendees } = req.body;
    db.prepare('DELETE FROM attendees').run();
    const insert = db.prepare('INSERT INTO attendees (player) VALUES (?)');
    const insertMany = db.transaction((list) => {
        for (const p of list) insert.run(p);
    });
    insertMany(attendees);
    res.json({ success: true });
});

// GET /api/users
app.get('/api/users', (req, res) => {
    const users = db.prepare('SELECT name, role, ip, lang, steam, ubisoft, battlenet, epic, ea, riot, discord, teamspeak FROM users').all();
    res.json(users);
});

// POST /api/users
app.post('/api/users', (req, res) => {
    const { name, pin, role } = req.body;
    if (!name || !pin) return res.status(400).json({ error: 'Name und PIN erforderlich' });
    const existing = db.prepare('SELECT 1 FROM users WHERE name = ?').get(name);
    if (existing) return res.status(409).json({ error: 'Name existiert bereits' });
    db.prepare('INSERT INTO users (name, pin, role) VALUES (?, ?, ?)').run(name, pin, role || 'player');
    db.prepare('INSERT OR IGNORE INTO coins (player, amount) VALUES (?, 0)').run(name);
    db.prepare('INSERT OR IGNORE INTO stars (player, amount) VALUES (?, 0)').run(name);
    res.json({ success: true });
});

// PUT /api/users/:name
app.put('/api/users/:name', (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE name = ?').get(req.params.name);
    if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
    const { newName, role } = req.body;
    if (newName && newName !== req.params.name) {
        const exists = db.prepare('SELECT 1 FROM users WHERE name = ?').get(newName);
        if (exists) return res.status(409).json({ error: 'Name existiert bereits' });
        db.prepare('UPDATE users SET name = ? WHERE name = ?').run(newName, req.params.name);
        db.prepare('UPDATE coins SET player = ? WHERE player = ?').run(newName, req.params.name);
        db.prepare('UPDATE stars SET player = ? WHERE player = ?').run(newName, req.params.name);
        db.prepare('UPDATE history SET player = ? WHERE player = ?').run(newName, req.params.name);
        db.prepare('UPDATE tokens SET player = ? WHERE player = ?').run(newName, req.params.name);
        db.prepare('UPDATE game_players SET player = ? WHERE player = ?').run(newName, req.params.name);
        db.prepare('UPDATE proposal_players SET player = ? WHERE player = ?').run(newName, req.params.name);
        db.prepare('UPDATE attendees SET player = ? WHERE player = ?').run(newName, req.params.name);
    }
    if (role) {
        db.prepare('UPDATE users SET role = ? WHERE name = ?').run(role, newName || req.params.name);
    }
    res.json({ success: true });
});

// DELETE /api/users/:name
app.delete('/api/users/:name', (req, res) => {
    db.prepare('DELETE FROM users WHERE name = ?').run(req.params.name);
    db.prepare('DELETE FROM attendees WHERE player = ?').run(req.params.name);
    broadcast();
    res.json({ success: true });
});

// PUT /api/users/:name/ip
app.put('/api/users/:name/ip', (req, res) => {
    const { ip } = req.body;
    if (ip === undefined) return res.status(400).json({ error: 'ip erforderlich' });
    db.prepare('UPDATE users SET ip = ? WHERE name = ?').run(ip, req.params.name);
    broadcast();
    res.json({ success: true });
});

// PUT /api/users/:name/lang
app.put('/api/users/:name/lang', (req, res) => {
    const { lang } = req.body;
    if (!lang || !['en', 'de'].includes(lang)) return res.status(400).json({ error: "lang muss 'en' oder 'de' sein" });
    const user = db.prepare('SELECT 1 FROM users WHERE name = ?').get(req.params.name);
    if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
    db.prepare('UPDATE users SET lang = ? WHERE name = ?').run(lang, req.params.name);
    broadcast();
    res.json({ ok: true });
});

// PUT /api/users/:name/accounts
app.put('/api/users/:name/accounts', (req, res) => {
    const { steam, ubisoft, battlenet, epic, ea, riot, discord, teamspeak } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE name = ?').get(req.params.name);
    if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
    db.prepare('UPDATE users SET steam = ?, ubisoft = ?, battlenet = ?, epic = ?, ea = ?, riot = ?, discord = ?, teamspeak = ? WHERE name = ?')
        .run(steam || '', ubisoft || '', battlenet || '', epic || '', ea || '', riot || '', discord || '', teamspeak || '', req.params.name);
    broadcast();
    res.json({ success: true });
});

// PUT /api/users/:name/pin
app.put('/api/users/:name/pin', (req, res) => {
    const { oldPin, newPin } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE name = ?').get(req.params.name);
    if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
    if (oldPin && user.pin !== oldPin) return res.status(401).json({ error: 'Alte PIN falsch' });
    db.prepare('UPDATE users SET pin = ? WHERE name = ?').run(newPin, req.params.name);
    res.json({ success: true });
});

// GET /api/tokens/:player
app.get('/api/tokens/:player', (req, res) => {
    const tokens = db.prepare('SELECT * FROM tokens WHERE player = ?').all(req.params.player);
    res.json(tokens);
});

// POST /api/tokens
app.post('/api/tokens', (req, res) => {
    const { player, type } = req.body;
    const result = db.prepare('INSERT INTO tokens (player, type, timestamp) VALUES (?, ?, ?)').run(player, type, Date.now());
    res.json({ success: true, id: result.lastInsertRowid });
});

// DELETE /api/tokens/:player/:type
app.delete('/api/tokens/:player/:type', (req, res) => {
    const token = db.prepare('SELECT id FROM tokens WHERE player = ? AND type = ? LIMIT 1').get(req.params.player, req.params.type);
    if (!token) return res.status(404).json({ error: 'Token nicht gefunden' });
    db.prepare('DELETE FROM tokens WHERE id = ?').run(token.id);
    res.json({ success: true });
});

// GET /api/genres-played/:player
app.get('/api/genres-played/:player', (req, res) => {
    const genres = db.prepare('SELECT genre FROM genres_played WHERE player = ?').all(req.params.player).map(r => r.genre);
    res.json(genres);
});

// POST /api/genres-played
app.post('/api/genres-played', (req, res) => {
    const { player, genre } = req.body;
    const existing = db.prepare('SELECT 1 FROM genres_played WHERE player = ? AND genre = ?').get(player, genre);
    if (existing) return res.json({ isNew: false });
    db.prepare('INSERT INTO genres_played (player, genre) VALUES (?, ?)').run(player, genre);
    res.json({ isNew: true });
});

// DELETE /api/reset
app.delete('/api/reset', (req, res) => {
    const { requestedBy } = req.body;
    const isAdmin = !!db.prepare("SELECT 1 FROM users WHERE name = ? AND role = 'admin'").get(requestedBy);
    if (!isAdmin) return res.status(403).json({ error: 'Nur Admins können zurücksetzen' });
    db.exec(`
        DELETE FROM users; DELETE FROM games; DELETE FROM game_players;
        DELETE FROM coins; DELETE FROM stars; DELETE FROM history; DELETE FROM sessions;
        DELETE FROM tokens; DELETE FROM genres_played; DELETE FROM proposals;
        DELETE FROM proposal_players; DELETE FROM attendees; DELETE FROM settings;
        DELETE FROM challenges;
        DELETE FROM team_challenges;
    `);
    seedIfEmpty();
    res.json({ success: true });
});

app.delete('/api/reset/coins', (req, res) => {
    const { requestedBy } = req.body;
    const isAdmin = !!db.prepare("SELECT 1 FROM users WHERE name = ? AND role = 'admin'").get(requestedBy);
    if (!isAdmin) return res.status(403).json({ error: 'Nur Admins können zurücksetzen' });
    db.prepare('UPDATE coins SET amount = 0').run();
    broadcast({ type: 'update' });
    res.json({ success: true });
});

app.delete('/api/reset/stars', (req, res) => {
    const { requestedBy } = req.body;
    const isAdmin = !!db.prepare("SELECT 1 FROM users WHERE name = ? AND role = 'admin'").get(requestedBy);
    if (!isAdmin) return res.status(403).json({ error: 'Nur Admins können zurücksetzen' });
    db.prepare('UPDATE stars SET amount = 0').run();
    broadcast({ type: 'update' });
    res.json({ success: true });
});

app.delete('/api/reset/challenges', (req, res) => {
    const { requestedBy } = req.body;
    const isAdmin = !!db.prepare("SELECT 1 FROM users WHERE name = ? AND role = 'admin'").get(requestedBy);
    if (!isAdmin) return res.status(403).json({ error: 'Nur Admins können zurücksetzen' });
    db.prepare('DELETE FROM challenges').run();
    broadcast({ type: 'update' });
    res.json({ success: true });
});

app.delete('/api/reset/team-challenges', (req, res) => {
    db.prepare('DELETE FROM team_challenges').run();
    broadcast({ type: 'update' });
    res.json({ success: true });
});

// ---- Challenges API ----

// GET /api/challenges
app.get('/api/challenges', (req, res) => {
    const challenges = db.prepare('SELECT * FROM challenges ORDER BY createdAt DESC').all();
    res.json(challenges);
});

// POST /api/challenges
app.post('/api/challenges', (req, res) => {
    const { challenger, opponent, game, stakeCoins, stakeStars } = req.body;
    if (!challenger || !opponent || !game) return res.status(400).json({ error: 'challenger, opponent und game erforderlich' });
    if (challenger === opponent) return res.status(400).json({ error: 'Du kannst dich nicht selbst herausfordern' });

    const coins = stakeCoins || 0;
    const stars = stakeStars || 0;
    if (coins < 0 || stars < 0) return res.status(400).json({ error: 'Einsatz darf nicht negativ sein' });

    // Check challenger has enough coins/stars
    if (coins > 0) {
        const row = db.prepare('SELECT amount FROM coins WHERE player = ?').get(challenger);
        if (!row || row.amount < coins) return res.status(400).json({ error: 'Nicht genug Coins' });
    }
    if (stars > 0) {
        const row = db.prepare('SELECT amount FROM stars WHERE player = ?').get(challenger);
        if (!row || row.amount < stars) return res.status(400).json({ error: 'Nicht genug Sterne' });
    }

    const id = 'ch_' + Date.now();
    db.prepare('INSERT INTO challenges (id, challenger, opponent, game, stakeCoins, stakeStars, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, challenger, opponent, game, coins, stars, 'pending', Date.now());
    res.json({ success: true, id });
});

// PUT /api/challenges/:id/accept
app.put('/api/challenges/:id/accept', (req, res) => {
    const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Challenge nicht gefunden' });
    if (c.status !== 'pending') return res.status(400).json({ error: 'Challenge ist nicht mehr offen' });

    const { player } = req.body;
    if (player !== c.opponent) return res.status(403).json({ error: 'Nur der Herausgeforderte kann annehmen' });

    // Check opponent has enough coins/stars
    if (c.stakeCoins > 0) {
        const row = db.prepare('SELECT amount FROM coins WHERE player = ?').get(c.opponent);
        if (!row || row.amount < c.stakeCoins) return res.status(400).json({ error: 'Nicht genug Coins' });
    }
    if (c.stakeStars > 0) {
        const row = db.prepare('SELECT amount FROM stars WHERE player = ?').get(c.opponent);
        if (!row || row.amount < c.stakeStars) return res.status(400).json({ error: 'Nicht genug Sterne' });
    }

    const challengerBusy = getActiveSessionForPlayer(c.challenger);
    if (challengerBusy) return res.status(400).json({ error: `${c.challenger} ist bereits in einer laufenden Session: ${challengerBusy}` });
    const opponentBusy = getActiveSessionForPlayer(c.opponent);
    if (opponentBusy) return res.status(400).json({ error: `${c.opponent} ist bereits in einer laufenden Session: ${opponentBusy}` });

    const sid = 'ls_duel_' + Date.now();
    const now = Date.now();
    const _acceptTx6 = db.transaction(() => {
        if (c.stakeCoins > 0) db.prepare('UPDATE coins SET amount = amount - ? WHERE player = ?').run(c.stakeCoins, c.challenger);
        if (c.stakeStars > 0) db.prepare('UPDATE stars SET amount = amount - ? WHERE player = ?').run(c.stakeStars, c.challenger);
        if (c.stakeCoins > 0) db.prepare('UPDATE coins SET amount = amount - ? WHERE player = ?').run(c.stakeCoins, c.opponent);
        if (c.stakeStars > 0) db.prepare('UPDATE stars SET amount = amount - ? WHERE player = ?').run(c.stakeStars, c.opponent);
        db.prepare('UPDATE challenges SET status = ? WHERE id = ?').run('accepted', req.params.id);
        db.prepare("INSERT INTO live_sessions (id, game, leader, status, startedAt, challenge_id, challenge_type) VALUES (?, ?, ?, 'running', ?, ?, '1v1')").run(sid, c.game, c.challenger, now, c.id);
        db.prepare('INSERT OR IGNORE INTO live_session_players (session_id, player, joinedAt) VALUES (?, ?, ?)').run(sid, c.challenger, now);
        db.prepare('INSERT OR IGNORE INTO live_session_players (session_id, player, joinedAt) VALUES (?, ?, ?)').run(sid, c.opponent, now);
    });
    try {
        _acceptTx6();
    } catch (e) {
        console.error('Duel session creation failed:', e);
        return res.status(500).json({ error: 'Session konnte nicht erstellt werden' });
    }

    // Notify both players that the duel has started
    const duelStartPayload = JSON.stringify({ game: c.game, challenger: c.challenger, opponent: c.opponent, stakeCoins: c.stakeCoins, stakeStars: c.stakeStars, sessionId: sid, type: '1v1' });
    const duelStartNow = Date.now();
    db.prepare('INSERT INTO player_events (target, type, from_player, message, createdAt, status) VALUES (?, ?, ?, ?, ?, ?)').run(c.challenger, 'duel_start', '', duelStartPayload, duelStartNow, 'active');
    db.prepare('INSERT INTO player_events (target, type, from_player, message, createdAt, status) VALUES (?, ?, ?, ?, ?, ?)').run(c.opponent, 'duel_start', '', duelStartPayload, duelStartNow, 'active');
    broadcast({ type: 'update' });
    res.json({ success: true, sessionId: sid });
});

// PUT /api/challenges/:id/reject
app.put('/api/challenges/:id/reject', (req, res) => {
    const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Challenge nicht gefunden' });
    if (c.status !== 'pending') return res.status(400).json({ error: 'Challenge ist nicht mehr offen' });

    const { player } = req.body;
    if (player !== c.opponent) return res.status(403).json({ error: 'Nur der Herausgeforderte kann ablehnen' });

    db.prepare('UPDATE challenges SET status = ?, resolvedAt = ? WHERE id = ?').run('rejected', Date.now(), req.params.id);
    res.json({ success: true });
});

// PUT /api/challenges/:id/complete
app.put('/api/challenges/:id/complete', (req, res) => {
    const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Challenge nicht gefunden' });
    if (c.status !== 'accepted') return res.status(400).json({ error: 'Challenge muss erst angenommen sein' });

    const { player, winner } = req.body;
    if (player !== c.challenger) return res.status(403).json({ error: 'Nur der Herausforderer kann den Gewinner setzen' });
    if (winner !== c.challenger && winner !== c.opponent) return res.status(400).json({ error: 'Gewinner muss Herausforderer oder Gegner sein' });

    db.prepare('UPDATE challenges SET status = ?, winner = ? WHERE id = ?').run('completed', winner, req.params.id);
    res.json({ success: true });
});

// PUT /api/challenges/:id/payout
app.put('/api/challenges/:id/payout', (req, res) => {
    const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Challenge nicht gefunden' });
    if (c.status !== 'completed') return res.status(400).json({ error: 'Challenge muss erst abgeschlossen sein' });
    if (!c.winner) return res.status(400).json({ error: 'Kein Gewinner gesetzt' });

    const loser = c.winner === c.challenger ? c.opponent : c.challenger;
    const now = Date.now();

    const payout = db.transaction(() => {
        // Coins: Both players already paid at acceptance; winner gets both stakes back
        if (c.stakeCoins > 0) {
            db.prepare('UPDATE coins SET amount = amount + ? WHERE player = ?').run(c.stakeCoins * 2, c.winner);
            db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(loser, -c.stakeCoins, `Duell verloren vs ${c.winner} (${c.game})`, now);
            db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(c.winner, c.stakeCoins * 2, `Duell gewonnen vs ${loser} (${c.game})`, now);
        }
        // Stars: same logic; both players already paid at acceptance
        if (c.stakeStars > 0) {
            db.prepare('UPDATE stars SET amount = amount + ? WHERE player = ?').run(c.stakeStars * 2, c.winner);
        }
        db.prepare('UPDATE challenges SET status = ?, resolvedAt = ? WHERE id = ?').run('paid', now, req.params.id);
    });

    payout();
    res.json({ success: true, winner: c.winner, loser });
});

// DELETE /api/challenges/:id
app.delete('/api/challenges/:id', (req, res) => {
    db.prepare('DELETE FROM challenges WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ---- Team Challenges API ----

// GET /api/team-challenges
app.get('/api/team-challenges', (req, res) => {
    const rows = db.prepare('SELECT * FROM team_challenges ORDER BY createdAt DESC').all();
    res.json(rows);
});

// POST /api/team-challenges
app.post('/api/team-challenges', (req, res) => {
    const { createdBy, game, stakeCoinsPerPerson, stakeStarsPerPerson, teamA, teamB } = req.body;
    if (!createdBy || !game || !Array.isArray(teamA) || !Array.isArray(teamB)) {
        return res.status(400).json({ error: 'createdBy, game, teamA und teamB erforderlich' });
    }
    if (teamA.length < 2) return res.status(400).json({ error: 'Team A braucht mindestens 2 Spieler' });
    if (teamB.length < 2) return res.status(400).json({ error: 'Team B braucht mindestens 2 Spieler' });

    const setB = new Set(teamB);
    const overlap = teamA.filter(p => setB.has(p));
    if (overlap.length > 0) return res.status(400).json({ error: 'Ein Spieler kann nicht in beiden Teams sein' });

    const inA = new Set(teamA).has(createdBy);
    const inB = setB.has(createdBy);
    if (!inA && !inB) return res.status(400).json({ error: 'Ersteller muss in einem Team sein' });

    const coins = stakeCoinsPerPerson || 0;
    const stars = stakeStarsPerPerson || 0;
    if (coins < 0 || stars < 0) return res.status(400).json({ error: 'Einsatz darf nicht negativ sein' });

    if (coins > 0) {
        const row = db.prepare('SELECT amount FROM coins WHERE player = ?').get(createdBy);
        if (!row || row.amount < coins) return res.status(400).json({ error: 'Nicht genug Coins' });
    }
    if (stars > 0) {
        const row = db.prepare('SELECT amount FROM stars WHERE player = ?').get(createdBy);
        if (!row || row.amount < stars) return res.status(400).json({ error: 'Nicht genug Sterne' });
    }

    const id = 'tc_' + Date.now();
    db.prepare(
        'INSERT INTO team_challenges (id, game, stakeCoinsPerPerson, stakeStarsPerPerson, teamA, teamB, status, createdBy, createdAt, acceptances) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, game, coins, stars, JSON.stringify(teamA), JSON.stringify(teamB), 'pending', createdBy, Date.now(), JSON.stringify([createdBy]));
    res.json({ success: true, id });
});

// PUT /api/team-challenges/:id/accept
app.put('/api/team-challenges/:id/accept', (req, res) => {
    const tc = db.prepare('SELECT * FROM team_challenges WHERE id = ?').get(req.params.id);
    if (!tc) return res.status(404).json({ error: 'Team-Challenge nicht gefunden' });
    if (tc.status !== 'pending') return res.status(400).json({ error: 'Team-Challenge ist nicht mehr offen' });

    const { player } = req.body;
    const teamA = JSON.parse(tc.teamA);
    const teamB = JSON.parse(tc.teamB);
    const allPlayers = [...teamA, ...teamB];

    if (!allPlayers.includes(player)) {
        return res.status(403).json({ error: 'Nur Teilnehmer können annehmen' });
    }

    const acceptances = JSON.parse(tc.acceptances || '[]');
    if (acceptances.includes(player)) {
        return res.status(400).json({ error: 'Du hast bereits angenommen' });
    }

    const newAcceptances = [...acceptances, player];
    const allAccepted = allPlayers.every(p => newAcceptances.includes(p));

    if (allAccepted) {
        // Check all players have sufficient coins/stars
        if (tc.stakeCoinsPerPerson > 0) {
            for (const p of allPlayers) {
                const row = db.prepare('SELECT amount FROM coins WHERE player = ?').get(p);
                if (!row || row.amount < tc.stakeCoinsPerPerson) {
                    return res.status(400).json({ error: `${p} hat nicht genug Coins` });
                }
            }
        }
        if (tc.stakeStarsPerPerson > 0) {
            for (const p of allPlayers) {
                const row = db.prepare('SELECT amount FROM stars WHERE player = ?').get(p);
                if (!row || row.amount < tc.stakeStarsPerPerson) {
                    return res.status(400).json({ error: `${p} hat nicht genug Sterne` });
                }
            }
        }

        const now = Date.now();
        const sid = 'ls_duel_team_' + now;

        const finalizeAccept = db.transaction(() => {
            for (const p of allPlayers) {
                if (tc.stakeCoinsPerPerson > 0) {
                    db.prepare('UPDATE coins SET amount = amount - ? WHERE player = ?').run(tc.stakeCoinsPerPerson, p);
                }
                if (tc.stakeStarsPerPerson > 0) {
                    db.prepare('UPDATE stars SET amount = amount - ? WHERE player = ?').run(tc.stakeStarsPerPerson, p);
                }
            }
            db.prepare('UPDATE team_challenges SET status = ?, acceptances = ? WHERE id = ?').run('accepted', JSON.stringify(newAcceptances), req.params.id);
            // Create a live session for all participants
            db.prepare("INSERT INTO live_sessions (id, game, leader, status, startedAt, challenge_id, challenge_type) VALUES (?, ?, ?, 'running', ?, ?, 'team')").run(sid, tc.game, tc.createdBy, now, tc.id);
            for (const p of allPlayers) {
                db.prepare('INSERT OR IGNORE INTO live_session_players (session_id, player, joinedAt) VALUES (?, ?, ?)').run(sid, p, now);
            }
        });
        finalizeAccept();
        // Notify all participants that the duel has started
        const tcStartPayload = JSON.stringify({ game: tc.game, teamA, teamB, createdBy: tc.createdBy, stakeCoinsPerPerson: tc.stakeCoinsPerPerson, stakeStarsPerPerson: tc.stakeStarsPerPerson, sessionId: sid, type: 'team' });
        const tcStartNow = Date.now();
        for (const p of allPlayers) {
            db.prepare('INSERT INTO player_events (target, type, from_player, message, createdAt, status) VALUES (?, ?, ?, ?, ?, ?)').run(p, 'duel_start', '', tcStartPayload, tcStartNow, 'active');
        }
        broadcast({ type: 'update' });
        res.json({ success: true, allAccepted: true, sessionId: sid });
    } else {
        // Not all accepted yet — just record this acceptance
        db.prepare('UPDATE team_challenges SET acceptances = ? WHERE id = ?').run(JSON.stringify(newAcceptances), req.params.id);
        broadcast({ type: 'update' });
        res.json({ success: true, allAccepted: false });
    }
});

// PUT /api/team-challenges/:id/reject
app.put('/api/team-challenges/:id/reject', (req, res) => {
    const tc = db.prepare('SELECT * FROM team_challenges WHERE id = ?').get(req.params.id);
    if (!tc) return res.status(404).json({ error: 'Team-Challenge nicht gefunden' });
    if (tc.status !== 'pending') return res.status(400).json({ error: 'Team-Challenge ist nicht mehr offen' });

    const { player } = req.body;
    const teamA = JSON.parse(tc.teamA);
    const teamB = JSON.parse(tc.teamB);
    if (![...teamA, ...teamB].includes(player)) {
        return res.status(403).json({ error: 'Nur Teilnehmer können ablehnen' });
    }

    // Status is pending, so no stakes have been deducted yet — no refund needed
    db.prepare('UPDATE team_challenges SET status = ?, resolvedAt = ? WHERE id = ?').run('rejected', Date.now(), req.params.id);
    broadcast({ type: 'update' });
    res.json({ success: true });
});

// PUT /api/team-challenges/:id/complete
app.put('/api/team-challenges/:id/complete', (req, res) => {
    const tc = db.prepare('SELECT * FROM team_challenges WHERE id = ?').get(req.params.id);
    if (!tc) return res.status(404).json({ error: 'Team-Challenge nicht gefunden' });
    if (tc.status !== 'accepted') return res.status(400).json({ error: 'Team-Challenge muss erst angenommen sein' });

    const { player, winnerTeam } = req.body;
    if (player !== tc.createdBy) {
        return res.status(403).json({ error: 'Nur der Herausforderer kann den Gewinner setzen' });
    }
    if (winnerTeam !== 'A' && winnerTeam !== 'B') {
        return res.status(400).json({ error: 'Gewinner muss "A" oder "B" sein' });
    }

    db.prepare('UPDATE team_challenges SET status = ?, winnerTeam = ? WHERE id = ?').run('completed', winnerTeam, req.params.id);

    // Notify all admins so they can pay out
    const admins = db.prepare("SELECT name FROM users WHERE role = 'admin'").all().map(r => r.name);
    const reviewPayload = JSON.stringify({ tcId: tc.id, game: tc.game, winnerTeam });
    const notifyNow = Date.now();
    admins.forEach(admin => {
        db.prepare('INSERT INTO player_events (target, type, from_player, message, createdAt, status) VALUES (?, ?, ?, ?, ?, ?)')
            .run(admin, 'tc_winner_review', tc.createdBy, reviewPayload, notifyNow, 'active');
    });

    broadcast({ type: 'update' });
    res.json({ success: true });
});

// PUT /api/team-challenges/:id/payout
app.put('/api/team-challenges/:id/payout', (req, res) => {
    const tc = db.prepare('SELECT * FROM team_challenges WHERE id = ?').get(req.params.id);
    if (!tc) return res.status(404).json({ error: 'Team-Challenge nicht gefunden' });
    if (tc.status !== 'completed') return res.status(400).json({ error: 'Team-Challenge muss erst abgeschlossen sein' });
    if (!tc.winnerTeam) return res.status(400).json({ error: 'Kein Gewinnerteam gesetzt' });

    const teamA = JSON.parse(tc.teamA);
    const teamB = JSON.parse(tc.teamB);
    const totalPlayers = teamA.length + teamB.length;
    const totalPot = tc.stakeCoinsPerPerson * totalPlayers;
    const totalStarPot = tc.stakeStarsPerPerson * totalPlayers;

    const winners = tc.winnerTeam === 'A' ? teamA : teamB;
    const losers  = tc.winnerTeam === 'A' ? teamB : teamA;

    const baseCoins = Math.floor(totalPot / winners.length);
    const remainder = totalPot - baseCoins * winners.length;
    const baseStars = Math.floor(totalStarPot / winners.length);
    const starRemainder = totalStarPot - baseStars * winners.length;

    const now = Date.now();
    const winnerTeamLabel = tc.winnerTeam === 'A' ? 'Team A' : 'Team B';
    const loserTeamLabel  = tc.winnerTeam === 'A' ? 'Team B' : 'Team A';

    const payout = db.transaction(() => {
        winners.forEach((p, idx) => {
            const coinAmount = baseCoins + (idx === 0 ? remainder : 0);
            const starAmount = baseStars + (idx === 0 ? starRemainder : 0);
            if (coinAmount > 0) {
                db.prepare('UPDATE coins SET amount = amount + ? WHERE player = ?').run(coinAmount, p);
                db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)')
                    .run(p, coinAmount, `Team-Duell gewonnen (${winnerTeamLabel}) – ${tc.game}`, now);
            }
            if (starAmount > 0) {
                db.prepare('UPDATE stars SET amount = amount + ? WHERE player = ?').run(starAmount, p);
            }
        });
        losers.forEach(p => {
            if (tc.stakeCoinsPerPerson > 0) {
                db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)')
                    .run(p, -tc.stakeCoinsPerPerson, `Team-Duell verloren (${loserTeamLabel}) – ${tc.game}`, now);
            }
        });
        db.prepare('UPDATE team_challenges SET status = ?, resolvedAt = ? WHERE id = ?').run('paid', now, req.params.id);
    });
    payout();

    // Payout-Benachrichtigung für alle Teilnehmer
    const payoutPayload = {
        game: tc.game,
        winnerTeam: tc.winnerTeam,
        teamA,
        teamB,
        stakeCoinsPerPerson: tc.stakeCoinsPerPerson,
        stakeStarsPerPerson: tc.stakeStarsPerPerson,
        totalPot,
        totalStarPot,
        baseCoins,
        remainder,
        baseStars,
        starRemainder
    };
    const notifyNow = Date.now();
    [...teamA, ...teamB].forEach(p => {
        db.prepare('INSERT INTO player_events (target, type, from_player, message, createdAt, status) VALUES (?, ?, ?, ?, ?, ?)')
            .run(p, 'tc_payout', '', JSON.stringify(payoutPayload), notifyNow, 'active');
    });

    res.json({ success: true, winnerTeam: tc.winnerTeam, totalPot, baseCoins, remainder });
});

// DELETE /api/team-challenges/:id
app.delete('/api/team-challenges/:id', (req, res) => {
    const tc = db.prepare('SELECT * FROM team_challenges WHERE id = ?').get(req.params.id);
    if (!tc) return res.status(404).json({ error: 'Team-Challenge nicht gefunden' });

    if (tc.status === 'accepted') {
        const teamA = JSON.parse(tc.teamA);
        const teamB = JSON.parse(tc.teamB);
        const allPlayers = [...teamA, ...teamB];
        const refund = db.transaction(() => {
            for (const p of allPlayers) {
                if (tc.stakeCoinsPerPerson > 0) {
                    db.prepare('UPDATE coins SET amount = amount + ? WHERE player = ?').run(tc.stakeCoinsPerPerson, p);
                }
                if (tc.stakeStarsPerPerson > 0) {
                    db.prepare('UPDATE stars SET amount = amount + ? WHERE player = ?').run(tc.stakeStarsPerPerson, p);
                }
            }
        });
        refund();
    }

    db.prepare('DELETE FROM team_challenges WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ---- Duel Voting ----

function _duelPayout(session, winnerOverride, db) {
    if (session.challenge_type === '1v1') {
        const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(session.challenge_id);
        if (!c) return;
        const winner = winnerOverride || c.winner;
        if (!winner) return;
        const loser = winner === c.challenger ? c.opponent : c.challenger;
        const now = Date.now();
        const payout = db.transaction(() => {
            if (c.stakeCoins > 0) {
                db.prepare('INSERT INTO coins (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(winner, c.stakeCoins * 2, c.stakeCoins * 2);
                db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(winner, c.stakeCoins * 2, `Duell gewonnen vs ${loser} (${c.game})`, now);
                db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(loser, -c.stakeCoins, `Duell verloren vs ${winner} (${c.game})`, now);
            }
            if (c.stakeStars > 0) {
                db.prepare('INSERT INTO stars (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(winner, c.stakeStars * 2, c.stakeStars * 2);
            }
            db.prepare('UPDATE challenges SET status = ?, winner = ?, resolvedAt = ? WHERE id = ?').run('paid', winner, now, c.id);
        });
        payout();
        const duelPayload = {
            game: c.game,
            winner,
            loser,
            stakeCoins: c.stakeCoins,
            stakeStars: c.stakeStars
        };
        const notifyNow = Date.now();
        db.prepare('INSERT INTO player_events (target, type, from_player, message, createdAt, status) VALUES (?, ?, ?, ?, ?, ?)')
            .run(winner, 'duel_payout', '', JSON.stringify({ ...duelPayload, isWinner: true }), notifyNow, 'active');
        db.prepare('INSERT INTO player_events (target, type, from_player, message, createdAt, status) VALUES (?, ?, ?, ?, ?, ?)')
            .run(loser, 'duel_payout', '', JSON.stringify({ ...duelPayload, isWinner: false }), notifyNow, 'active');
    } else {
        const tc = db.prepare('SELECT * FROM team_challenges WHERE id = ?').get(session.challenge_id);
        if (!tc) return;
        const winnerTeam = winnerOverride || tc.winnerTeam;
        if (!winnerTeam) return;
        const teamA = JSON.parse(tc.teamA);
        const teamB = JSON.parse(tc.teamB);
        const winners = winnerTeam === 'A' ? teamA : teamB;
        const losers  = winnerTeam === 'A' ? teamB : teamA;
        const totalPlayers = teamA.length + teamB.length;
        const totalPot = tc.stakeCoinsPerPerson * totalPlayers;
        const totalStarPot = tc.stakeStarsPerPerson * totalPlayers;
        const baseCoins = Math.floor(totalPot / winners.length);
        const remainder = totalPot - baseCoins * winners.length;
        const baseStars = Math.floor(totalStarPot / winners.length);
        const starRemainder = totalStarPot - baseStars * winners.length;
        const winnerTeamLabel = winnerTeam === 'A' ? 'Team A' : 'Team B';
        const loserTeamLabel  = winnerTeam === 'A' ? 'Team B' : 'Team A';
        const now = Date.now();
        const payout = db.transaction(() => {
            winners.forEach((p, idx) => {
                const coinAmount = baseCoins + (idx === 0 ? remainder : 0);
                const starAmount = baseStars + (idx === 0 ? starRemainder : 0);
                if (coinAmount > 0) {
                    db.prepare('INSERT INTO coins (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(p, coinAmount, coinAmount);
                    db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(p, coinAmount, `Team-Duell gewonnen (${winnerTeamLabel}) – ${tc.game}`, now);
                }
                if (starAmount > 0) {
                    db.prepare('INSERT INTO stars (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(p, starAmount, starAmount);
                }
            });
            losers.forEach(p => {
                if (tc.stakeCoinsPerPerson > 0) {
                    db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(p, -tc.stakeCoinsPerPerson, `Team-Duell verloren (${loserTeamLabel}) – ${tc.game}`, now);
                }
            });
            db.prepare('UPDATE team_challenges SET status = ?, winnerTeam = ?, resolvedAt = ? WHERE id = ?').run('paid', winnerTeam, now, tc.id);
        });
        payout();
        const payoutPayload = {
            game: tc.game,
            winnerTeam,
            teamA,
            teamB,
            stakeCoinsPerPerson: tc.stakeCoinsPerPerson,
            stakeStarsPerPerson: tc.stakeStarsPerPerson,
            totalPot,
            totalStarPot,
            baseCoins,
            remainder,
            baseStars,
            starRemainder
        };
        const notifyNow = Date.now();
        [...winners, ...losers].forEach(p => {
            db.prepare('INSERT INTO player_events (target, type, from_player, message, createdAt, status) VALUES (?, ?, ?, ?, ?, ?)')
                .run(p, 'tc_payout', '', JSON.stringify(payoutPayload), notifyNow, 'active');
        });
    }
}

// GET /api/duel-votes/:sessionId
app.get('/api/duel-votes/:sessionId', (req, res) => {
    const votes = db.prepare(
        'SELECT player, voted_for FROM duel_votes WHERE session_id = ?'
    ).all(req.params.sessionId);
    res.json({ votes });
});

// POST /api/duel-votes/resolve  (must come BEFORE /api/duel-votes with param to avoid route conflict)
app.post('/api/duel-votes/resolve', (req, res) => {
    const { sessionId, winner, admin } = req.body;
    const _isAdmin3 = !!db.prepare("SELECT 1 FROM users WHERE name = ? AND role = 'admin'").get(admin);
    if (!_isAdmin3) return res.status(403).json({ error: 'Nur Admins können auflösen' });

    const session = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(sessionId);
    if (!session || !session.challenge_id) {
        return res.status(400).json({ error: 'invalid session' });
    }

    if (session.challenge_type === '1v1') {
        db.prepare(`UPDATE challenges SET winner = ? WHERE id = ?`).run(winner, session.challenge_id);
    } else {
        db.prepare(`UPDATE team_challenges SET winnerTeam = ? WHERE id = ?`).run(winner, session.challenge_id);
    }
    _duelPayout(session, winner, db);
    broadcast({ type: 'update' });
    res.json({ success: true });
});

// POST /api/duel-votes/approve
app.post('/api/duel-votes/approve', (req, res) => {
    const { sessionId } = req.body;
    const session = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(sessionId);
    if (!session || !session.challenge_id) return res.status(400).json({ error: 'invalid session' });
    _duelPayout(session, null, db);
    broadcast({ type: 'update' });
    res.json({ success: true });
});

// POST /api/duel-votes
app.post('/api/duel-votes', (req, res) => {
    const { sessionId, player, votedFor } = req.body;

    const session = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(sessionId);
    if (!session || session.status !== 'ended' || !session.challenge_id) {
        return res.status(400).json({ error: 'invalid session' });
    }

    const _playerInSession4 = db.prepare('SELECT 1 FROM live_session_players WHERE session_id = ? AND player = ?').get(sessionId, player);
    if (!_playerInSession4) return res.status(403).json({ error: 'Nicht Teilnehmer dieser Session' });
    db.prepare(`INSERT OR REPLACE INTO duel_votes (session_id, player, voted_for, created_at)
                VALUES (?, ?, ?, ?)`).run(sessionId, player, votedFor, Date.now());

    const players = db.prepare(
        'SELECT player FROM live_session_players WHERE session_id = ?'
    ).all(sessionId).map(r => r.player);

    const votes = db.prepare(
        'SELECT player, voted_for FROM duel_votes WHERE session_id = ?'
    ).all(sessionId);

    const allVoted = votes.length >= players.length;

    if (allVoted) {
        const unique = [...new Set(votes.map(v => v.voted_for))];
        const consensus = unique.length === 1;

        if (consensus) {
            // KONSENS: Sofortige Auszahlung ohne Admin-Freigabe
            if (session.challenge_type === '1v1') {
                db.prepare(`UPDATE challenges SET winner = ? WHERE id = ?`)
                    .run(unique[0], session.challenge_id);
            } else {
                db.prepare(`UPDATE team_challenges SET winnerTeam = ? WHERE id = ?`)
                    .run(unique[0], session.challenge_id);
            }
            _duelPayout(session, unique[0], db);
        } else {
            if (session.challenge_type === '1v1') {
                db.prepare(`UPDATE challenges SET status = 'conflict' WHERE id = ?`)
                    .run(session.challenge_id);
            } else {
                db.prepare(`UPDATE team_challenges SET status = 'conflict' WHERE id = ?`)
                    .run(session.challenge_id);
            }
            const admins = db.prepare("SELECT name FROM users WHERE role = 'admin'").all();
            const conflictPayload = JSON.stringify({ sessionId, challengeId: session.challenge_id });
            const notifyNow = Date.now();
            admins.forEach(a => {
                db.prepare('INSERT INTO player_events (target, type, from_player, message, createdAt, status) VALUES (?, ?, ?, ?, ?, ?)')
                    .run(a.name, 'duel_conflict', '', conflictPayload, notifyNow, 'active');
            });
        }

        broadcast({ type: 'update' });
        return res.json({ success: true, allVoted: true, consensus });
    }

    broadcast({ type: 'update' });
    res.json({ success: true, allVoted: false });
});

// ---- Player Events ----

const PENALTY_TYPES = ['force_play', 'drink_order'];

// POST /api/player-events
app.post('/api/player-events', (req, res) => {
    const { target, type, from_player, message, deadline } = req.body;
    if (!target || !message) return res.status(400).json({ error: 'target und message erforderlich' });
    let status = 'active';
    if (PENALTY_TYPES.includes(type)) {
        const activePenalty = db.prepare(
            "SELECT id FROM player_events WHERE target = ? AND type IN ('force_play', 'drink_order') AND status = 'active'"
        ).get(target);
        if (activePenalty) status = 'queued';
    }
    db.prepare('INSERT INTO player_events (target, type, from_player, message, deadline, createdAt, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(target, type || '', from_player || '', message, deadline || null, Date.now(), status);
    res.json({ success: true, status });
});

// GET /api/player-events/:player  – nur aktive Events (fuer Modal-Anzeige)
app.get('/api/player-events/:player', (req, res) => {
    const events = db.prepare("SELECT * FROM player_events WHERE target = ? AND (status = 'active' OR status IS NULL) ORDER BY createdAt ASC").all(req.params.player);
    res.json(events);
});

// GET /api/activities/:player  – Inbox-Queue + gesendete Penalties
app.get('/api/activities/:player', (req, res) => {
    const player = req.params.player;
    const incoming = db.prepare(
        "SELECT * FROM player_events WHERE target = ? AND type IN ('force_play', 'drink_order') ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, createdAt ASC"
    ).all(player);
    const outgoing = db.prepare(
        "SELECT * FROM player_events WHERE from_player = ? AND type IN ('force_play', 'drink_order') ORDER BY createdAt DESC"
    ).all(player);
    res.json({ incoming, outgoing });
});

// DELETE /api/player-events/:id
app.delete('/api/player-events/:id', (req, res) => {
    const ev = db.prepare('SELECT * FROM player_events WHERE id = ?').get(req.params.id);
    db.prepare('DELETE FROM player_events WHERE id = ?').run(req.params.id);
    // Penalty-Queue: naechste gequeuete Penalty aktivieren
    if (ev && PENALTY_TYPES.includes(ev.type)) {
        const next = db.prepare(
            "SELECT id FROM player_events WHERE target = ? AND type IN ('force_play', 'drink_order') AND status = 'queued' ORDER BY createdAt ASC LIMIT 1"
        ).get(ev.target);
        if (next) db.prepare("UPDATE player_events SET status = 'active' WHERE id = ?").run(next.id);
    }
    res.json({ success: true });
});

// ---- Live Sessions ----

function getActiveSessionForPlayer(player) {
    const inLive = db.prepare(`
        SELECT ls.game FROM live_sessions ls
        INNER JOIN live_session_players lsp ON ls.id = lsp.session_id
        WHERE lsp.player = ? AND ls.status IN ('lobby', 'running')
    `).get(player);
    if (inLive) return inLive.game;

    const inProposal = db.prepare(`
        SELECT p.game FROM proposals p
        INNER JOIN proposal_players pp ON p.id = pp.proposal_id
        WHERE pp.player = ? AND p.status = 'active'
    `).get(player);
    return inProposal ? inProposal.game : null;
}


// GET /api/settings
app.get('/api/settings', (req, res) => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const result = {};
    rows.forEach(r => result[r.key] = r.value);
    res.json(result);
});

// PUT /api/settings/:key
app.put('/api/settings/:key', (req, res) => {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value required' });
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(req.params.key, String(value), String(value));
    res.json({ success: true });
    broadcast({ type: 'update' });
});

// GET /api/live-sessions
app.get('/api/live-sessions', (req, res) => {
    const sessions = db.prepare('SELECT * FROM live_sessions ORDER BY startedAt DESC').all();
    sessions.forEach(s => {
        s.players = db.prepare('SELECT player FROM live_session_players WHERE session_id = ? ORDER BY joinedAt ASC').all(s.id).map(r => r.player);
    });
    res.json(sessions);
});

// POST /api/live-sessions — Raum erstellen (status: lobby)
app.post('/api/live-sessions', (req, res) => {
    const { game, leader, medium = 'lan', account = null } = req.body;
    if (!game || !leader) return res.status(400).json({ error: 'game und leader erforderlich' });
    const activeGame = getActiveSessionForPlayer(leader);
    if (activeGame) return res.status(400).json({ error: `Du bist bereits in einer laufenden Session: ${activeGame}` });
    const id = 'ls_' + Date.now();
    db.prepare("INSERT INTO live_sessions (id, game, leader, status, medium, medium_account) VALUES (?, ?, ?, 'lobby', ?, ?)").run(id, game, leader, medium, account);
    db.prepare('INSERT INTO live_session_players (session_id, player, joinedAt) VALUES (?, ?, ?)').run(id, leader, Date.now());
    res.json({ id });
});

// PUT /api/live-sessions/:id/start — Session starten (lobby → running)
app.put('/api/live-sessions/:id/start', (req, res) => {
    const session = db.prepare('SELECT status FROM live_sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (session.status !== 'lobby') return res.status(400).json({ error: 'Session nicht im Lobby-Status' });
    const playerCount = db.prepare('SELECT COUNT(*) as cnt FROM live_session_players WHERE session_id = ?').get(req.params.id).cnt;
    if (playerCount < 2) return res.status(400).json({ error: 'Eine Session benötigt mindestens 2 Spieler' });
    const players = db.prepare('SELECT player FROM live_session_players WHERE session_id = ?').all(req.params.id);
    for (const { player } of players) {
        const conflict = db.prepare(`
            SELECT ls.game FROM live_sessions ls
            INNER JOIN live_session_players lsp ON ls.id = lsp.session_id
            WHERE lsp.player = ? AND ls.id != ? AND ls.status IN ('running')
        `).get(player, req.params.id);
        if (conflict) return res.status(400).json({ error: `${player} ist bereits in einer laufenden Session: ${conflict.game}` });
        const proposalConflict = db.prepare(`
            SELECT p.game FROM proposals p
            INNER JOIN proposal_players pp ON p.id = pp.proposal_id
            WHERE pp.player = ? AND p.status = 'active'
        `).get(player);
        if (proposalConflict) return res.status(400).json({ error: `${player} ist bereits in einer laufenden Session: ${proposalConflict.game}` });
    }
    db.prepare("UPDATE live_sessions SET status = 'running', startedAt = ? WHERE id = ?").run(Date.now(), req.params.id);
    res.json({ success: true });
});

// POST /api/live-sessions/:id/join — nur im lobby-Status möglich
app.post('/api/live-sessions/:id/join', (req, res) => {
    const { player } = req.body;
    const session = db.prepare('SELECT status, game, leader FROM live_sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (session.status !== 'lobby') return res.status(400).json({ error: 'Session läuft bereits, kein Beitritt möglich' });
    if (session.leader === player) return res.status(400).json({ error: 'Leader kann nicht dem eigenen Raum beitreten' });
    const activeGame = getActiveSessionForPlayer(player);
    if (activeGame) return res.status(400).json({ error: `Du bist bereits in einer laufenden Session: ${activeGame}` });
    try {
        db.prepare('INSERT OR IGNORE INTO live_session_players (session_id, player, joinedAt) VALUES (?, ?, ?)').run(req.params.id, player, Date.now());
    } catch {}
    res.json({ success: true });
});

// POST /api/live-sessions/:id/leave — nur im lobby-Status möglich
app.post('/api/live-sessions/:id/leave', (req, res) => {
    const { player } = req.body;
    const session = db.prepare('SELECT leader, status FROM live_sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (session.status !== 'lobby') return res.status(400).json({ error: 'Session läuft bereits' });
    if (session.leader === player) return res.status(400).json({ error: 'Leader kann nicht verlassen' });
    db.prepare('DELETE FROM live_session_players WHERE session_id = ? AND player = ?').run(req.params.id, player);
    res.json({ success: true });
});

// PUT /api/live-sessions/:id/end
app.put('/api/live-sessions/:id/end', (req, res) => {
    const { player } = req.body || {};
    const session = db.prepare('SELECT leader FROM live_sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

    // Nur validieren wenn player gegeben (Abwärtskompatibilität)
    if (player) {
        if (session.leader !== player) {
            // Check ob Admin
            const user = db.prepare('SELECT role FROM users WHERE name = ?').get(player);
            if (!user || user.role !== 'admin') {
                return res.status(403).json({ error: 'Nur der Leader oder ein Admin kann die Session beenden' });
            }
        }
    }

    const endedAt = Date.now();
    const sessionData = db.prepare('SELECT startedAt FROM live_sessions WHERE id = ?').get(req.params.id);
    const playerCount = db.prepare('SELECT COUNT(*) as cnt FROM live_session_players WHERE session_id = ?').get(req.params.id).cnt;
    const maxMultiplierSetting = db.prepare("SELECT value FROM settings WHERE key = 'max_multiplier'").get();
    const playerMultipliersSetting = db.prepare("SELECT value FROM settings WHERE key = 'player_multipliers'").get();
    const maxMultiplier = parseInt(maxMultiplierSetting?.value || '10');
    const playerMultipliersMap = (() => { try { return JSON.parse(playerMultipliersSetting?.value || '{}'); } catch { return {}; } })();
    const cappedCount = Math.min(playerCount, maxMultiplier);
    let playerRate = 0;
    for (let c = cappedCount; c >= 2; c--) {
        if (playerMultipliersMap[String(c)] !== undefined) { playerRate = parseFloat(playerMultipliersMap[String(c)]); break; }
    }
    const durationMin = sessionData?.startedAt ? Math.ceil((endedAt - sessionData.startedAt) / 60000) : 0;
    const pendingCoins = Math.round(durationMin * playerRate);
    db.prepare("UPDATE live_sessions SET status = 'ended', endedAt = ?, pending_coins = ? WHERE id = ?").run(endedAt, pendingCoins, req.params.id);
    res.json({ success: true });
});

// POST /api/live-sessions/:id/approve
app.post('/api/live-sessions/:id/approve', (req, res) => {
    const { coinsPerPlayer: bodyCoins, player } = req.body;
    const session = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    const _isAdmin1 = !!db.prepare("SELECT 1 FROM users WHERE name = ? AND role = 'admin'").get(player);
    const _isLeader1 = session.leader === player;
    if (!_isAdmin1 && !_isLeader1) return res.status(403).json({ error: 'Nicht berechtigt' });
    const coinsPerPlayer = session.pending_coins > 0 ? session.pending_coins : Math.max(0, parseInt(bodyCoins) || 0);
    const players = db.prepare('SELECT player FROM live_session_players WHERE session_id = ?').all(req.params.id).map(r => r.player);
    const now = Date.now();
    const approve = db.transaction(() => {
        for (const player of players) {
            db.prepare('INSERT INTO coins (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(player, coinsPerPlayer, coinsPerPlayer);
            db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(player, coinsPerPlayer, `Session: ${session.game} (${players.length} Spieler)`, now);
        }
        db.prepare('INSERT INTO sessions (game, players, coinsPerPlayer, timestamp, medium) VALUES (?, ?, ?, ?, ?)').run(session.game, JSON.stringify(players), coinsPerPlayer, now, session.medium);
        db.prepare('DELETE FROM live_session_players WHERE session_id = ?').run(req.params.id);
        db.prepare('DELETE FROM live_sessions WHERE id = ?').run(req.params.id);
    });
    approve();
    res.json({ success: true });
});

// POST /api/live-sessions/:id/duel-cancel — Abbrechen mit Rückerstattung der Einsätze
app.post('/api/live-sessions/:id/duel-cancel', (req, res) => {
    const session = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (!session.challenge_id) return res.status(400).json({ error: 'Keine Duell-Session' });

    const cancel = db.transaction(() => {
        if (session.challenge_type === '1v1') {
            const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(session.challenge_id);
            if (c) {
                if (c.stakeCoins > 0) {
                    db.prepare('UPDATE coins SET amount = amount + ? WHERE player = ?').run(c.stakeCoins, c.challenger);
                    db.prepare('UPDATE coins SET amount = amount + ? WHERE player = ?').run(c.stakeCoins, c.opponent);
                }
                if (c.stakeStars > 0) {
                    db.prepare('UPDATE stars SET amount = amount + ? WHERE player = ?').run(c.stakeStars, c.challenger);
                    db.prepare('UPDATE stars SET amount = amount + ? WHERE player = ?').run(c.stakeStars, c.opponent);
                }
                db.prepare("UPDATE challenges SET status = 'cancelled' WHERE id = ?").run(c.id);
            }
        } else {
            const tc = db.prepare('SELECT * FROM team_challenges WHERE id = ?').get(session.challenge_id);
            if (tc) {
                const teamA = JSON.parse(tc.teamA);
                const teamB = JSON.parse(tc.teamB);
                const allPlayers = [...teamA, ...teamB];
                for (const p of allPlayers) {
                    if (tc.stakeCoinsPerPerson > 0) db.prepare('UPDATE coins SET amount = amount + ? WHERE player = ?').run(tc.stakeCoinsPerPerson, p);
                    if (tc.stakeStarsPerPerson > 0) db.prepare('UPDATE stars SET amount = amount + ? WHERE player = ?').run(tc.stakeStarsPerPerson, p);
                }
                db.prepare("UPDATE team_challenges SET status = 'cancelled' WHERE id = ?").run(tc.id);
            }
        }
        db.prepare('DELETE FROM duel_votes WHERE session_id = ?').run(session.id);
        db.prepare('DELETE FROM live_session_players WHERE session_id = ?').run(session.id);
        db.prepare('DELETE FROM live_sessions WHERE id = ?').run(session.id);
    });
    cancel();
    broadcast({ type: 'update' });
    res.json({ success: true });
});

// DELETE /api/live-sessions/:id
app.delete('/api/live-sessions/:id', (req, res) => {
    db.prepare('DELETE FROM live_session_players WHERE session_id = ?').run(req.params.id);
    db.prepare('DELETE FROM live_sessions WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ---- Start Server ----
app.listen(PORT, () => {
    console.log(`Gameparty Server laeuft auf http://localhost:${PORT}`);
});
