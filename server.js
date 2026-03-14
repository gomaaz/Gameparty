// ============================================================
// Gameparty - Express + SQLite Backend
// ============================================================
const express = require('express');
const compression = require('compression');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { version } = require('./package.json');

// ---- Logger (define early, before DB) ----
const logBuffer = [];
const LOG_MAX = 500;
const LOG_LEVEL = (process.env.LOG_LEVEL || 'INFO').toUpperCase(); // OFF | INFO | DEBUG
function log(level, message) {
    const entry = { ts: new Date().toISOString(), level, message };
    logBuffer.push(entry);
    if (logBuffer.length > LOG_MAX) logBuffer.shift();
    if (LOG_LEVEL === 'OFF') return;
    if (level === 'DEBUG' && LOG_LEVEL !== 'DEBUG') return;
    console[level === 'ERROR' ? 'error' : 'log'](`[${entry.ts}] [${level}] ${message}`);
}
const logger = {
    info:  (msg) => log('INFO',  msg),
    error: (msg) => log('ERROR', msg),
    debug: (msg) => log('DEBUG', msg),
};

const app = express();
const PORT = process.env.PORT || 3000;

// Global shop cooldowns (in-memory, reset on server restart)
const shopCooldownTs = {}; // { rob_controller: timestamp }
const SHOP_COOLDOWN_MS = { rob_controller: 5 * 60 * 1000 };

app.use(cors());
app.use(compression());
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

app.use(express.static(path.join(__dirname), {
    setHeaders(res, filePath) {
        if (/\.(js|css|svg|png|jpg|jpeg|webp|ico|woff2?)$/.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}));

// ---- RAWG: Static file serving for downloaded covers + screenshots ----
const gamefilesDir = process.env.GAMEFILES_PATH || path.join(__dirname, 'gamefiles');
const coversDir = path.join(gamefilesDir, 'covers');
const screenshotsDir = path.join(gamefilesDir, 'screenshots');
fs.mkdirSync(coversDir, { recursive: true });
fs.mkdirSync(screenshotsDir, { recursive: true });
app.use('/gamefiles', express.static(gamefilesDir));

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

// ---- Auth middleware ----
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function requireAuth(req, res, next) {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });
    const s = db.prepare('SELECT player, role, created_at FROM auth_sessions WHERE token = ?').get(token);
    if (!s) return res.status(401).json({ error: 'Sitzung abgelaufen' });
    if (Date.now() - s.created_at > SESSION_TTL_MS) {
        db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
        return res.status(401).json({ error: 'Sitzung abgelaufen' });
    }
    req.authPlayer = s.player;
    req.authRole   = s.role;
    next();
}

const PUBLIC_ROUTES = [
    { method: 'POST', path: '/login' },
    { method: 'POST', path: '/logout' },
    { method: 'GET',  path: '/users' },
    { method: 'GET',  path: '/events' },
    { method: 'GET',  path: '/logs' },
    { method: 'GET',  path: '/time' },
    { method: 'GET',  path: '/init' },
    { method: 'GET',  path: '/settings' },
];
app.use('/api', (req, res, next) => {
    if (PUBLIC_ROUTES.some(p => p.method === req.method && req.path === p.path)) return next();
    requireAuth(req, res, next);
});

// GET /api/time — server timestamp for client clock sync
app.get('/api/time', (req, res) => res.json({ now: Date.now() }));

// GET /api/logs
app.get('/api/logs', (req, res) => {
    const level = req.query.level || 'ALL';
    const limit = Math.min(parseInt(req.query.limit || '200'), 500);
    let entries = logBuffer;
    if (level !== 'ALL') entries = entries.filter(e => e.level === level);
    res.json(entries.slice(-limit).reverse()); // newest first
});

app.get('/api/events', (req, res) => {
    const qToken = req.query.token;
    if (qToken) {
        const s = db.prepare('SELECT player FROM auth_sessions WHERE token = ?').get(qToken);
        if (!s) { res.status(401).end(); return; }
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseClients.add(res);
    logger.debug('SSE client connected');
    // Heartbeat alle 25s damit die Verbindung nicht vom Browser gekappt wird
    const heartbeat = setInterval(() => res.write(':\n\n'), 25000);
    req.on('close', () => { sseClients.delete(res); clearInterval(heartbeat); logger.debug('SSE client disconnected'); });
});

// ---- Database Setup ----
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'gameparty.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
logger.info('Database initialized');

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
    CREATE TABLE IF NOT EXISTS ffa_challenges (
        id TEXT PRIMARY KEY,
        game TEXT,
        stakeCoinsPerPerson INT DEFAULT 0,
        stakeStarsPerPerson INT DEFAULT 0,
        players TEXT,
        status TEXT DEFAULT 'pending',
        placements TEXT DEFAULT NULL,
        payoutConfig TEXT DEFAULT NULL,
        createdBy TEXT,
        createdAt INT,
        resolvedAt INT,
        acceptances TEXT DEFAULT '[]'
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

// ---- Migration: RAWG fields in games ----
try { db.prepare("ALTER TABLE games ADD COLUMN cover_url TEXT DEFAULT ''").run(); } catch {}
try { db.prepare("ALTER TABLE games ADD COLUMN description TEXT DEFAULT ''").run(); } catch {}
try { db.prepare("ALTER TABLE games ADD COLUMN rating INT DEFAULT 0").run(); } catch {}
try { db.prepare("ALTER TABLE games ADD COLUMN rawg_id INT DEFAULT 0").run(); } catch {}
try { db.prepare("ALTER TABLE games ADD COLUMN platforms TEXT DEFAULT ''").run(); } catch {}
try { db.prepare("ALTER TABLE games ADD COLUMN released TEXT DEFAULT ''").run(); } catch {}
try { db.prepare("ALTER TABLE games ADD COLUMN requirements TEXT DEFAULT ''").run(); } catch {}
try { db.prepare("ALTER TABLE games ADD COLUMN screenshots TEXT DEFAULT '[]'").run(); } catch {}

// ---- Migration: pending_coins Feld in live_sessions ----
try { db.prepare("ALTER TABLE live_sessions ADD COLUMN pending_coins INT DEFAULT 0").run(); } catch {}

// ---- Migration: acceptances Feld in team_challenges ----
try { db.prepare("ALTER TABLE team_challenges ADD COLUMN acceptances TEXT DEFAULT '[]'").run(); } catch {}

// ---- Migration: payoutMode/payoutConfig fuer challenges & team_challenges ----
try { db.prepare("ALTER TABLE challenges ADD COLUMN payoutMode TEXT DEFAULT 'winner_takes_all'").run(); } catch {}
try { db.prepare("ALTER TABLE challenges ADD COLUMN payoutConfig TEXT DEFAULT NULL").run(); } catch {}
try { db.prepare("ALTER TABLE team_challenges ADD COLUMN payoutMode TEXT DEFAULT 'winner_takes_all'").run(); } catch {}
try { db.prepare("ALTER TABLE team_challenges ADD COLUMN payoutConfig TEXT DEFAULT NULL").run(); } catch {}

// ---- Migration: challenge_id und challenge_type in live_sessions ----
try { db.prepare("ALTER TABLE live_sessions ADD COLUMN challenge_id TEXT").run(); } catch {}
try { db.prepare("ALTER TABLE live_sessions ADD COLUMN challenge_type TEXT").run(); } catch {}

// ---- Migration: player slots for live_sessions ----
try { db.prepare("ALTER TABLE live_sessions ADD COLUMN max_slots INT DEFAULT 0").run(); } catch {}
try { db.prepare("ALTER TABLE proposals ADD COLUMN max_slots INT DEFAULT 0").run(); } catch {}
try { db.prepare("ALTER TABLE live_session_players ADD COLUMN slot_number INT").run(); } catch {}

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
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_ffa_challenges_status ON ffa_challenges(status)").run(); } catch {}
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_history_player ON history(player)").run(); } catch {}

try { db.prepare("ALTER TABLE live_sessions ADD COLUMN duration_min INT DEFAULT 0").run(); } catch {}
try { db.prepare("ALTER TABLE live_sessions ADD COLUMN coin_rate REAL DEFAULT 0").run(); } catch {}
try { db.prepare("ALTER TABLE sessions ADD COLUMN duration_min INT DEFAULT 0").run(); } catch {}

try { db.prepare("ALTER TABLE proposal_players ADD COLUMN slot_number INT").run(); } catch {}

// ---- Migration: payoutAmounts / collected fuer challenges, team_challenges, ffa_challenges ----
try { db.prepare("ALTER TABLE challenges ADD COLUMN payoutAmounts TEXT DEFAULT NULL").run(); } catch {}
try { db.prepare("ALTER TABLE challenges ADD COLUMN payoutStarAmounts TEXT DEFAULT NULL").run(); } catch {}
try { db.prepare("ALTER TABLE challenges ADD COLUMN collected TEXT DEFAULT '[]'").run(); } catch {}
try { db.prepare("ALTER TABLE team_challenges ADD COLUMN payoutAmounts TEXT DEFAULT NULL").run(); } catch {}
try { db.prepare("ALTER TABLE team_challenges ADD COLUMN payoutStarAmounts TEXT DEFAULT NULL").run(); } catch {}
try { db.prepare("ALTER TABLE team_challenges ADD COLUMN collected TEXT DEFAULT '[]'").run(); } catch {}
try { db.prepare("ALTER TABLE ffa_challenges ADD COLUMN payoutAmounts TEXT DEFAULT NULL").run(); } catch {}
try { db.prepare("ALTER TABLE ffa_challenges ADD COLUMN payoutStarAmounts TEXT DEFAULT NULL").run(); } catch {}
try { db.prepare("ALTER TABLE ffa_challenges ADD COLUMN collected TEXT DEFAULT '[]'").run(); } catch {}

// ---- Migration: sessionPayoutAmounts / sessionCollected fuer live_sessions collect-flow ----
try { db.prepare("ALTER TABLE live_sessions ADD COLUMN sessionPayoutAmounts TEXT DEFAULT NULL").run(); } catch {}
try { db.prepare("ALTER TABLE live_sessions ADD COLUMN sessionCollected TEXT DEFAULT '[]'").run(); } catch {}
// ---- Migration: session_id column in player_events for indexed session_payout lookup ----
try { db.prepare("ALTER TABLE player_events ADD COLUMN session_id TEXT DEFAULT NULL").run(); } catch {}
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_player_events_session_id ON player_events(target, type, session_id)").run(); } catch {}

// ---- auth_sessions: server-side session tokens ----
db.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (
    token      TEXT PRIMARY KEY,
    player     TEXT NOT NULL,
    role       TEXT NOT NULL,
    created_at INTEGER NOT NULL
)`);
try { db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_player ON auth_sessions(player)').run(); } catch {}
// Prune expired sessions on startup (30 days TTL)
db.prepare('DELETE FROM auth_sessions WHERE created_at < ?').run(Date.now() - 30 * 24 * 60 * 60 * 1000);

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

// ---- Helper: Get shop price from settings (with fallback) ----
function getShopPrice(itemId, defaultPrice) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`shop_price_${itemId}`);
    return row ? (parseInt(row.value) || defaultPrice) : defaultPrice;
}

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
        ready: !!game.ready,
        status: game.status,
        suggestedBy: game.suggestedBy,
        shopLinks: JSON.parse(game.shop_links || '[]'),
        cover_url: game.cover_url || '',
        description: game.description || '',
        rating: game.rating || 0,
        rawg_id: game.rawg_id || 0,
        platforms: game.platforms || '',
        released: game.released || '',
        requirements: game.requirements || '',
        screenshots: game.screenshots || '[]',
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
    const cutoff = Date.now() - SESSION_TTL_MS;
    db.prepare('DELETE FROM auth_sessions WHERE player = ? AND created_at < ?').run(name, cutoff);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO auth_sessions (token, player, role, created_at) VALUES (?, ?, ?, ?)').run(token, name, user.role, Date.now());
    logger.info('User login: ' + name);
    res.json({ success: true, role: user.role, token });
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
    res.json({ success: true });
});

// GET /api/games
app.get('/api/games', (req, res) => {
    res.json(getAllGamesWithPlayers());
});

// POST /api/games/suggest
app.post('/api/games/suggest', (req, res) => {
    const { name, genre, maxPlayers, suggestedBy, shopLinks, coverUrl, description, rating, rawgId, platforms, released, requirements, screenshots } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    const existing = db.prepare('SELECT id FROM games WHERE LOWER(name) = LOWER(?)').get(name);
    if (existing) return res.status(409).json({ error: 'Spiel existiert bereits' });

    const result = db.prepare('INSERT INTO games (name, maxPlayers, genre, status, suggestedBy, shop_links, cover_url, description, rating, rawg_id, platforms, released, requirements, screenshots) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(name, maxPlayers || 4, genre || '', 'suggested', suggestedBy || null, JSON.stringify(shopLinks || []), coverUrl || '', description || '', rating || 0, rawgId || 0, platforms || '', released || '', requirements || '', JSON.stringify(screenshots || []));
    if (suggestedBy) {
        db.prepare('INSERT OR IGNORE INTO game_players (game_id, player) VALUES (?, ?)').run(result.lastInsertRowid, suggestedBy);
    }
    logger.info('Game suggested: ' + name);
    res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/games/:name/approve
app.put('/api/games/:name/approve', (req, res) => {
    const game = db.prepare('SELECT id, name, suggestedBy FROM games WHERE name = ?').get(req.params.name);
    if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden' });
    db.prepare('UPDATE games SET status = ? WHERE id = ?').run('approved', game.id);

    // Notify interested players
    const interested = db.prepare('SELECT player FROM game_players WHERE game_id = ?').all(game.id).map(r => r.player);
    const toNotify = new Set(interested);
    if (game.suggestedBy) toNotify.add(game.suggestedBy);
    const payload = JSON.stringify({ game: game.name });
    const now = Date.now();
    toNotify.forEach(player => {
        db.prepare('INSERT INTO player_events (target, type, from_player, message, createdAt, status) VALUES (?, ?, ?, ?, ?, ?)')
            .run(player, 'game_approved', '', payload, now, 'active');
    });

    logger.info('Game approved: ' + req.params.name);
    broadcast({ type: 'update' });
    res.json({ success: true });
});

// DELETE /api/games/shop-links — clear all shop links
app.delete('/api/games/shop-links', (req, res) => {
    db.prepare("UPDATE games SET shop_links = '[]'").run();
    logger.info('All shop links cleared');
    broadcast({ type: 'update' });
    res.json({ ok: true });
});

// DELETE /api/games/:name
app.delete('/api/games/:name', (req, res) => {
    const game = db.prepare('SELECT id, name, suggestedBy, status, cover_url, screenshots FROM games WHERE name = ?').get(req.params.name);
    if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden' });

    // Collect players to notify BEFORE deletion
    const toNotify = new Set();
    if (game.status === 'suggested') {
        const interested = db.prepare('SELECT player FROM game_players WHERE game_id = ?').all(game.id).map(r => r.player);
        interested.forEach(p => toNotify.add(p));
        if (game.suggestedBy) toNotify.add(game.suggestedBy);
    }

    // Delete local image files
    const toDelete = [];
    if (game.cover_url && game.cover_url.startsWith('/gamefiles/')) toDelete.push(game.cover_url);
    try { JSON.parse(game.screenshots || '[]').forEach(u => { if (u && u.startsWith('/gamefiles/')) toDelete.push(u); }); } catch {}
    toDelete.forEach(relUrl => {
        try { fs.unlinkSync(path.join(gamefilesDir, relUrl.replace('/gamefiles/', ''))); } catch {}
    });

    db.transaction(() => {
        db.prepare('DELETE FROM game_players WHERE game_id = ?').run(game.id);
        db.prepare('DELETE FROM games WHERE id = ?').run(game.id);
    })();

    // Send rejection notifications
    if (toNotify.size > 0) {
        const payload = JSON.stringify({ game: game.name });
        const now = Date.now();
        toNotify.forEach(player => {
            db.prepare('INSERT INTO player_events (target, type, from_player, message, createdAt, status) VALUES (?, ?, ?, ?, ?, ?)')
                .run(player, 'game_rejected', '', payload, now, 'active');
        });
    }

    logger.info('Game deleted: ' + req.params.name);
    broadcast({ type: 'update' });
    res.json({ success: true });
});

// PUT /api/games/:name
app.put('/api/games/:name', (req, res) => {
    const game = db.prepare('SELECT id FROM games WHERE name = ?').get(req.params.name);
    if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden' });
    const { newName, genre, maxPlayers, shopLinks, rawgId, coverUrl, description, rating, platforms, released, requirements } = req.body;
    const updates = [];
    const params = [];
    if (newName !== undefined) { updates.push('name = ?'); params.push(newName); }
    if (genre !== undefined) { updates.push('genre = ?'); params.push(genre); }
    if (maxPlayers !== undefined) { updates.push('maxPlayers = ?'); params.push(maxPlayers); }
    if (shopLinks !== undefined) { updates.push('shop_links = ?'); params.push(JSON.stringify(shopLinks)); }
    if (rawgId !== undefined) { updates.push('rawg_id = ?'); params.push(rawgId); }
    if (coverUrl !== undefined) { updates.push('cover_url = ?'); params.push(coverUrl); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (rating !== undefined) { updates.push('rating = ?'); params.push(rating); }
    if (platforms !== undefined) { updates.push('platforms = ?'); params.push(platforms); }
    if (released !== undefined) { updates.push('released = ?'); params.push(released); }
    if (requirements !== undefined) { updates.push('requirements = ?'); params.push(requirements); }
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

// POST /api/games/fetch-csv-url — fetch a public CSV (or Google Sheets) URL server-side, return parsed games
app.post('/api/games/fetch-csv-url', async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    // Google Sheets: convert edit/view URL to CSV export URL
    const sheetsMatch = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (sheetsMatch) url = `https://docs.google.com/spreadsheets/d/${sheetsMatch[1]}/export?format=csv`;
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Gameparty/1.0' } });
        if (!response.ok) return res.status(400).json({ error: `Fetch failed: HTTP ${response.status}` });
        const text = await response.text();
        const games = parseGameCSVServer(text);
        res.json({ games });
    } catch (e) {
        res.status(400).json({ error: 'URL konnte nicht geladen werden: ' + e.message });
    }
});

function parseGameCSVServer(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
    return lines.slice(1).map(line => {
        const values = [];
        let inQuote = false, cur = '';
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"' && !inQuote) { inQuote = true; }
            else if (ch === '"' && inQuote && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"' && inQuote) { inQuote = false; }
            else if (ch === ',' && !inQuote) { values.push(cur); cur = ''; }
            else { cur += ch; }
        }
        values.push(cur);
        const row = Object.fromEntries(headers.map((h, i) => [h, (values[i] || '').trim()]));
        const shopLinks = [];
        let n = 1;
        while (row[`shoplink_label_${n}`] !== undefined || row[`shoplink_url_${n}`] !== undefined) {
            const platform = (row[`shoplink_label_${n}`] || '').trim();
            const url = (row[`shoplink_url_${n}`] || '').trim();
            if (platform || url) shopLinks.push({ platform, url });
            delete row[`shoplink_label_${n}`]; delete row[`shoplink_url_${n}`];
            n++;
        }
        if (shopLinks.length === 0 && row.shoplinks) {
            try { const p = JSON.parse(row.shoplinks); if (Array.isArray(p)) shopLinks.push(...p); } catch {}
            delete row.shoplinks;
        }
        row.shopLinks = shopLinks;
        // Normalize lowercased headers back to camelCase
        if ('maxplayers' in row) { row.maxPlayers = row.maxplayers; delete row.maxplayers; }
        return row;
    }).filter(r => r.name && r.name.trim());
}

// POST /api/games/import
app.post('/api/games/import', (req, res) => {
    const { games } = req.body;
    if (!Array.isArray(games) || games.length === 0)
        return res.status(400).json({ error: 'games array required' });
    let imported = 0, updated = 0;
    const upsertStmt = db.prepare(
        `INSERT INTO games (name, maxPlayers, genre, status, shop_links) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
             maxPlayers = excluded.maxPlayers,
             genre = excluded.genre,
             shop_links = excluded.shop_links`
    );
    const tx = db.transaction(() => {
        for (const g of games) {
            if (!g.name?.trim()) continue;
            const shopLinks = Array.isArray(g.shopLinks) ? JSON.stringify(g.shopLinks) : '[]';
            const existing = db.prepare('SELECT id FROM games WHERE name = ?').get(g.name.trim());
            upsertStmt.run(
                g.name.trim(),
                parseInt(g.maxPlayers) || 4,
                g.genre?.trim() || '',
                'approved',
                shopLinks
            );
            existing ? updated++ : imported++;
        }
    });
    tx();
    logger.info('Games imported: ' + imported + ' new, ' + updated + ' updated');
    broadcast();
    res.json({ imported, updated });
});

// GET /api/genres
const BASE_GENRES = ['2D Plattformer', '3D Plattformer', 'Action', 'Adventure', 'Battle Royale', 'Beat em Up', 'Crafting', 'Egoshooter', 'Horror', 'Indie', 'Openworld', 'Racing', 'Rollenspiel', 'Simulation', 'Sport', 'Strategie', 'Survival', 'Taktik', 'Topdown'];

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
    if (req.authRole !== 'admin') return res.status(403).json({ error: 'Admin required' });
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
    const { thief, target } = req.body;
    const expectedCost = getShopPrice('rob_coins', 10);
    if (!thief || !target) return res.status(400).json({ error: 'thief und target erforderlich' });

    const thiefRow = db.prepare('SELECT amount FROM coins WHERE player = ?').get(thief);
    if (!thiefRow || thiefRow.amount < expectedCost) return res.status(400).json({ error: 'Nicht genug Coins' });

    const stolen = Math.floor(Math.random() * 21); // 0 bis 20

    const tx = db.transaction(() => {
        // Kosten vom Täter abziehen
        db.prepare('UPDATE coins SET amount = amount - ? WHERE player = ?').run(expectedCost, thief);
        db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(thief, -expectedCost, `Shop: Taschendieb Münzen (Ziel: ${target})`, Date.now());

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
    const { thief, target } = req.body;
    const expectedCost = getShopPrice('rob_controller', 50);
    if (!thief || !target) return res.status(400).json({ error: 'thief und target erforderlich' });

    // Global cooldown check
    const lastPurchase = shopCooldownTs.rob_controller || 0;
    const remainingMs = SHOP_COOLDOWN_MS.rob_controller - (Date.now() - lastPurchase);
    if (remainingMs > 0) return res.status(429).json({ error: 'cooldown', remainingMs });

    const thiefRow = db.prepare('SELECT amount FROM coins WHERE player = ?').get(thief);
    if (!thiefRow || thiefRow.amount < expectedCost) return res.status(400).json({ error: 'Nicht genug Coins' });

    const targetStars = db.prepare('SELECT amount FROM stars WHERE player = ?').get(target);
    const success = Math.random() < 0.5 && targetStars && targetStars.amount > 0;

    const tx = db.transaction(() => {
        // Kosten vom Täter abziehen
        db.prepare('UPDATE coins SET amount = amount - ? WHERE player = ?').run(expectedCost, thief);
        db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(thief, -expectedCost, `Shop: Taschendieb Controller (Ziel: ${target})`, Date.now());

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
    const { player } = req.body;
    const expectedCost = getShopPrice('buy_star', 20);
    if (!player) return res.status(400).json({ error: 'player erforderlich' });
    const coinRow = db.prepare('SELECT amount FROM coins WHERE player = ?').get(player);
    if (!coinRow || coinRow.amount < expectedCost) return res.status(400).json({ error: 'Nicht genug Coins' });
    const tx = db.transaction(() => {
        db.prepare('UPDATE coins SET amount = amount - ? WHERE player = ?').run(expectedCost, player);
        db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(player, -expectedCost, 'Shop: Controller-Punkt kaufen', Date.now());
        db.prepare('INSERT INTO stars (player, amount) VALUES (?, 1) ON CONFLICT(player) DO UPDATE SET amount = amount + 1').run(player);
    });
    tx();
    const row = db.prepare('SELECT amount FROM stars WHERE player = ?').get(player);
    res.json({ newStars: row ? row.amount : 1 });
});

// POST /api/stars/add
app.post('/api/stars/add', (req, res) => {
    const { player, amount } = req.body;
    if (!player || !amount) return res.status(400).json({ error: 'player und amount erforderlich' });
    if (req.authRole !== 'admin') return res.status(403).json({ error: 'Nur Admins können Controller-Punkte vergeben' });
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
        const players = db.prepare('SELECT player, slot_number FROM proposal_players WHERE proposal_id = ? ORDER BY COALESCE(slot_number, 999) ASC').all(p.id);
        return { ...p, isNewGame: !!p.isNewGame, coinsApproved: p.coinsApproved === null ? null : !!p.coinsApproved, players };
    });
    res.json(result);
});

// POST /api/proposals
app.post('/api/proposals', (req, res) => {
    const { id, game, isNewGame, leader, message, scheduledDay, scheduledTime, medium, medium_account, maxSlots } = req.body;
    const proposalId = id || 'p_' + Date.now();
    db.prepare('INSERT INTO proposals (id, game, isNewGame, leader, status, scheduledTime, scheduledDay, message, createdAt, coinsApproved, medium, medium_account, max_slots) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(proposalId, game, isNewGame ? 1 : 0, leader, 'pending', scheduledTime || '', scheduledDay || '', message || '', Date.now(), 0, medium || 'lan', medium_account || '', parseInt(maxSlots) || 0);
    db.prepare('INSERT INTO proposal_players (proposal_id, player, slot_number) VALUES (?, ?, 1)').run(proposalId, leader);
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
        req.body.pendingCoins = 0;
        req.body.coinsApproved = 0;
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
        if (['status', 'scheduledTime', 'scheduledDay', 'message', 'startedAt', 'completedAt', 'pendingCoins', 'medium', 'medium_account'].includes(key)) {
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
    const proposal = db.prepare('SELECT status, max_slots FROM proposals WHERE id = ?').get(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Nicht gefunden' });
    if (proposal.status === 'active') {
        const activeGame = getActiveSessionForPlayer(player);
        if (activeGame) return res.status(400).json({ error: `Du bist bereits in einer laufenden Session: ${activeGame}` });
    }
    const slots = parseInt(proposal.max_slots) || 0;
    let slotNumber = null;
    if (slots > 0) {
        const taken = db.prepare('SELECT slot_number FROM proposal_players WHERE proposal_id = ?').all(req.params.id).map(r => r.slot_number);
        slotNumber = Array.from({ length: slots }, (_, i) => i + 1).find(n => !taken.includes(n));
        if (!slotNumber) return res.status(400).json({ error: 'Sitzung ist voll' });
    }
    db.prepare('INSERT OR IGNORE INTO proposal_players (proposal_id, player, slot_number) VALUES (?, ?, ?)').run(req.params.id, player, slotNumber);
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
    const { approvedBy } = req.body;
    if (req.authRole !== 'admin') return res.status(403).json({ error: 'Nur Admins können freigeben' });
    const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Proposal nicht gefunden' });
    const coinsPerPlayer = proposal.pendingCoins || 0;
    if (proposal.coinsApproved) return res.status(400).json({ error: 'Bereits freigegeben' });

    const players = db.prepare('SELECT player FROM proposal_players WHERE proposal_id = ?').all(req.params.id).map(r => r.player);

    for (const player of players) {
        db.prepare('INSERT INTO coins (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(player, coinsPerPlayer, coinsPerPlayer);
        db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(player, coinsPerPlayer, `Session: ${proposal.game} (${players.length} Spieler)`, Date.now());
    }

    const proposalDurationMin = (proposal.startedAt && proposal.completedAt) ? Math.ceil((proposal.completedAt - proposal.startedAt) / 60000) : 0;
    db.prepare('INSERT INTO sessions (game, players, coinsPerPlayer, timestamp, duration_min) VALUES (?, ?, ?, ?, ?)').run(proposal.game, JSON.stringify(players), coinsPerPlayer, Date.now(), proposalDurationMin);
    db.prepare('UPDATE proposals SET coinsApproved = 1 WHERE id = ?').run(req.params.id);

    if (coinsPerPlayer > 0) {
        // Calculate durationMin and coinRate for the receipt
        const durationMin = (proposal.startedAt && proposal.completedAt)
            ? Math.ceil((proposal.completedAt - proposal.startedAt) / 60000)
            : 0;
        const maxMultiplierSetting = db.prepare("SELECT value FROM settings WHERE key = 'max_multiplier'").get();
        const playerMultipliersSetting = db.prepare("SELECT value FROM settings WHERE key = 'player_multipliers'").get();
        const maxMultiplier = parseInt(maxMultiplierSetting?.value || '10');
        const playerMultipliersMap = (() => { try { return JSON.parse(playerMultipliersSetting?.value || '{}'); } catch { return {}; } })();
        const cappedCount = Math.min(players.length, maxMultiplier);
        let coinRate = 0;
        for (let c = cappedCount; c >= 2; c--) {
            if (playerMultipliersMap[String(c)] !== undefined) { coinRate = parseFloat(playerMultipliersMap[String(c)]); break; }
        }
        const payoutPayload = JSON.stringify({ game: proposal.game, coins: coinsPerPlayer, playerCount: players.length, durationMin, coinRate });
        const payoutNow = Date.now();
        for (const p of players) {
            db.prepare('INSERT INTO player_events (target, type, from_player, message, createdAt, status) VALUES (?, ?, ?, ?, ?, ?)').run(p, 'session_payout', '', payoutPayload, payoutNow, 'active');
        }
    }

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
    const { name, pin } = req.body;
    if (!name || !pin) return res.status(400).json({ error: 'Name und PIN erforderlich' });
    const existing = db.prepare('SELECT 1 FROM users WHERE name = ?').get(name);
    if (existing) return res.status(409).json({ error: 'Name existiert bereits' });
    db.prepare('INSERT INTO users (name, pin, role) VALUES (?, ?, ?)').run(name, pin, 'player');
    db.prepare('INSERT OR IGNORE INTO coins (player, amount) VALUES (?, 0)').run(name);
    db.prepare('INSERT OR IGNORE INTO stars (player, amount) VALUES (?, 0)').run(name);
    res.json({ success: true });
});

// PUT /api/users/:name
app.put('/api/users/:name', (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE name = ?').get(req.params.name);
    if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
    const { newName, role } = req.body;
    if (role !== undefined && req.authRole !== 'admin') return res.status(403).json({ error: 'Admin required' });
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
    if (req.authRole !== 'admin') return res.status(403).json({ error: 'Admin required' });
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
    if (req.authRole !== 'admin') return res.status(403).json({ error: 'Nur Admins duerfen zuruecksetzen' });
    db.exec(`
        DELETE FROM users; DELETE FROM games; DELETE FROM game_players;
        DELETE FROM coins; DELETE FROM stars; DELETE FROM history; DELETE FROM sessions;
        DELETE FROM tokens; DELETE FROM genres_played; DELETE FROM proposals;
        DELETE FROM proposal_players; DELETE FROM attendees; DELETE FROM settings;
        DELETE FROM challenges;
        DELETE FROM team_challenges;
        DELETE FROM auth_sessions;
    `);
    seedIfEmpty();
    res.json({ success: true });
});

app.delete('/api/reset/coins', (req, res) => {
    if (req.authRole !== 'admin') return res.status(403).json({ error: 'Nur Admins duerfen zuruecksetzen' });
    db.prepare('UPDATE coins SET amount = 0').run();
    broadcast({ type: 'update' });
    res.json({ success: true });
});

app.delete('/api/reset/stars', (req, res) => {
    if (req.authRole !== 'admin') return res.status(403).json({ error: 'Nur Admins duerfen zuruecksetzen' });
    db.prepare('UPDATE stars SET amount = 0').run();
    broadcast({ type: 'update' });
    res.json({ success: true });
});

app.delete('/api/reset/challenges', (req, res) => {
    if (req.authRole !== 'admin') return res.status(403).json({ error: 'Nur Admins duerfen zuruecksetzen' });
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
    let { challenger, opponent, game, stakeCoins, stakeStars, payoutMode, payoutConfig } = req.body;
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

    payoutMode = payoutMode || 'winner_takes_all';
    const payoutErr = validatePayoutConfig(payoutMode, payoutConfig);
    if (payoutErr) return res.status(400).json({ error: payoutErr });
    const payoutConfigStr = (payoutMode === 'percentage' && payoutConfig) ? JSON.stringify(payoutConfig) : null;

    const id = 'ch_' + Date.now();
    db.prepare('INSERT INTO challenges (id, challenger, opponent, game, stakeCoins, stakeStars, status, createdAt, payoutMode, payoutConfig) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, challenger, opponent, game, coins, stars, 'pending', Date.now(), payoutMode, payoutConfigStr);
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
        logger.error('Duel session creation failed: ' + e.message);
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

    const winner = c.winner;
    const loser = winner === c.challenger ? c.opponent : c.challenger;

    const { winnerCoins, loserCoins } = calcPayout(c.stakeCoins * 2, c.payoutMode, c.payoutConfig);
    const { winnerCoins: winnerStars, loserCoins: loserStars } = calcPayout(c.stakeStars * 2, c.payoutMode, c.payoutConfig);

    const payoutAmounts = { [winner]: winnerCoins, [loser]: loserCoins };
    const payoutStarAmounts = { [winner]: winnerStars, [loser]: loserStars };

    db.prepare("UPDATE challenges SET status='released', payoutAmounts=?, payoutStarAmounts=?, collected='[]' WHERE id=?")
        .run(JSON.stringify(payoutAmounts), JSON.stringify(payoutStarAmounts), req.params.id);

    broadcast({ type: 'update' });
    res.json({ success: true, payoutAmounts, payoutStarAmounts });
});

// PUT /api/challenges/:id/collect
app.put('/api/challenges/:id/collect', (req, res) => {
    const { player } = req.body;
    if (!player) return res.status(400).json({ error: 'player erforderlich' });

    const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Challenge nicht gefunden' });
    if (c.status !== 'released') return res.status(400).json({ error: 'Challenge nicht im Status released' });
    if (player !== c.challenger && player !== c.opponent) return res.status(403).json({ error: 'Nicht Teilnehmer dieser Challenge' });

    const collected = JSON.parse(c.collected || '[]');
    if (collected.includes(player)) return res.status(400).json({ error: 'Bereits eingesammelt' });

    const payoutAmounts = JSON.parse(c.payoutAmounts || '{}');
    const payoutStarAmounts = JSON.parse(c.payoutStarAmounts || '{}');
    const coins = payoutAmounts[player] || 0;
    const stars = payoutStarAmounts[player] || 0;
    const now = Date.now();

    const collectTx = db.transaction(() => {
        if (coins > 0) {
            db.prepare('UPDATE coins SET amount = amount + ? WHERE player = ?').run(coins, player);
        }
        if (stars > 0) {
            db.prepare('UPDATE stars SET amount = amount + ? WHERE player = ?').run(stars, player);
        }
        db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)')
            .run(player, coins, `Duell Auszahlung (${c.game})`, now);
        collected.push(player);
        db.prepare('UPDATE challenges SET collected = ? WHERE id = ?').run(JSON.stringify(collected), req.params.id);
    });
    collectTx();

    const allParticipants = [c.challenger, c.opponent];
    const allCollected = allParticipants.every(p => collected.includes(p));
    if (allCollected) {
        db.prepare('UPDATE challenges SET status = ?, resolvedAt = ? WHERE id = ?').run('paid', now, req.params.id);
    }

    broadcast({ type: 'update' });
    res.json({ success: true, coins, stars });
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
    let { createdBy, game, stakeCoinsPerPerson, stakeStarsPerPerson, teamA, teamB, payoutMode, payoutConfig } = req.body;
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

    payoutMode = payoutMode || 'winner_takes_all';
    const payoutErr = validatePayoutConfig(payoutMode, payoutConfig);
    if (payoutErr) return res.status(400).json({ error: payoutErr });
    const payoutConfigStr = (payoutMode === 'percentage' && payoutConfig) ? JSON.stringify(payoutConfig) : null;

    const id = 'tc_' + Date.now();
    db.prepare(
        'INSERT INTO team_challenges (id, game, stakeCoinsPerPerson, stakeStarsPerPerson, teamA, teamB, status, createdBy, createdAt, acceptances, payoutMode, payoutConfig) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, game, coins, stars, JSON.stringify(teamA), JSON.stringify(teamB), 'pending', createdBy, Date.now(), JSON.stringify([createdBy]), payoutMode, payoutConfigStr);
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

    const { winnerCoins: winnerTeamCoins, loserCoins: loserTeamCoins } = calcPayout(totalPot, tc.payoutMode, tc.payoutConfig);
    const { winnerCoins: winnerTeamStars, loserCoins: loserTeamStars } = calcPayout(totalStarPot, tc.payoutMode, tc.payoutConfig);

    const baseCoins = Math.floor(winnerTeamCoins / winners.length);
    const remainder = winnerTeamCoins - baseCoins * winners.length;
    const baseStars = Math.floor(winnerTeamStars / winners.length);
    const starRemainder = winnerTeamStars - baseStars * winners.length;
    const baseLoserCoins = loserTeamCoins > 0 ? Math.floor(loserTeamCoins / losers.length) : 0;
    const loserRemainder = loserTeamCoins > 0 ? loserTeamCoins - baseLoserCoins * losers.length : 0;
    const baseLoserStars = loserTeamStars > 0 ? Math.floor(loserTeamStars / losers.length) : 0;
    const loserStarRemainder = loserTeamStars > 0 ? loserTeamStars - baseLoserStars * losers.length : 0;

    const payoutAmounts = {};
    const payoutStarAmounts = {};

    winners.forEach((p, idx) => {
        payoutAmounts[p] = baseCoins + (idx === 0 ? remainder : 0);
        payoutStarAmounts[p] = baseStars + (idx === 0 ? starRemainder : 0);
    });
    losers.forEach((p, idx) => {
        payoutAmounts[p] = loserTeamCoins > 0 ? baseLoserCoins + (idx === 0 ? loserRemainder : 0) : 0;
        payoutStarAmounts[p] = loserTeamStars > 0 ? baseLoserStars + (idx === 0 ? loserStarRemainder : 0) : 0;
    });

    db.prepare("UPDATE team_challenges SET status='released', payoutAmounts=?, payoutStarAmounts=?, collected='[]' WHERE id=?")
        .run(JSON.stringify(payoutAmounts), JSON.stringify(payoutStarAmounts), req.params.id);

    broadcast({ type: 'update' });
    res.json({ success: true, payoutAmounts, payoutStarAmounts });
});

// PUT /api/team-challenges/:id/collect
app.put('/api/team-challenges/:id/collect', (req, res) => {
    const { player } = req.body;
    if (!player) return res.status(400).json({ error: 'player erforderlich' });

    const tc = db.prepare('SELECT * FROM team_challenges WHERE id = ?').get(req.params.id);
    if (!tc) return res.status(404).json({ error: 'Team-Challenge nicht gefunden' });
    if (tc.status !== 'released') return res.status(400).json({ error: 'Team-Challenge nicht im Status released' });

    const teamA = JSON.parse(tc.teamA);
    const teamB = JSON.parse(tc.teamB);
    const allParticipants = [...teamA, ...teamB];
    if (!allParticipants.includes(player)) return res.status(403).json({ error: 'Nicht Teilnehmer dieser Challenge' });

    const collected = JSON.parse(tc.collected || '[]');
    if (collected.includes(player)) return res.status(400).json({ error: 'Bereits eingesammelt' });

    const payoutAmounts = JSON.parse(tc.payoutAmounts || '{}');
    const payoutStarAmounts = JSON.parse(tc.payoutStarAmounts || '{}');
    const coins = payoutAmounts[player] || 0;
    const stars = payoutStarAmounts[player] || 0;
    const now = Date.now();

    const collectTx = db.transaction(() => {
        if (coins > 0) {
            db.prepare('UPDATE coins SET amount = amount + ? WHERE player = ?').run(coins, player);
        }
        if (stars > 0) {
            db.prepare('UPDATE stars SET amount = amount + ? WHERE player = ?').run(stars, player);
        }
        db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)')
            .run(player, coins, `Team-Duell Auszahlung (${tc.game})`, now);
        collected.push(player);
        db.prepare('UPDATE team_challenges SET collected = ? WHERE id = ?').run(JSON.stringify(collected), req.params.id);
    });
    collectTx();

    const allCollected = allParticipants.every(p => collected.includes(p));
    if (allCollected) {
        db.prepare('UPDATE team_challenges SET status = ?, resolvedAt = ? WHERE id = ?').run('paid', now, req.params.id);
    }

    broadcast({ type: 'update' });
    res.json({ success: true, coins, stars });
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

// ---- FFA Challenges API ----

// GET /api/ffa-challenges
app.get('/api/ffa-challenges', (req, res) => {
    const rows = db.prepare('SELECT * FROM ffa_challenges ORDER BY createdAt DESC').all();
    res.json(rows);
});

// POST /api/ffa-challenges
app.post('/api/ffa-challenges', (req, res) => {
    let { createdBy, game, players, stakeCoinsPerPerson, stakeStarsPerPerson, payoutConfig } = req.body;
    if (!createdBy || !game || !Array.isArray(players)) {
        return res.status(400).json({ error: 'createdBy, game, players erforderlich' });
    }
    if (players.length < 3) return res.status(400).json({ error: 'Mindestens 3 Spieler erforderlich' });
    if (!players.includes(createdBy)) return res.status(400).json({ error: 'createdBy muss in players sein' });
    const unique = [...new Set(players)];
    if (unique.length !== players.length) return res.status(400).json({ error: 'Doppelte Spieler nicht erlaubt' });
    players = unique;

    if (!Array.isArray(payoutConfig) || payoutConfig.length === 0) {
        return res.status(400).json({ error: 'payoutConfig erforderlich' });
    }
    const payoutErr = validateFFAPayoutConfig(payoutConfig, players.length);
    if (payoutErr) return res.status(400).json({ error: payoutErr });

    const coins = parseInt(stakeCoinsPerPerson) || 0;
    const stars = parseInt(stakeStarsPerPerson) || 0;

    const id = 'ffa_' + Date.now();
    db.prepare(
        'INSERT INTO ffa_challenges (id, game, stakeCoinsPerPerson, stakeStarsPerPerson, players, status, payoutConfig, createdBy, createdAt, acceptances) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, game, coins, stars, JSON.stringify(players), 'pending', JSON.stringify(payoutConfig), createdBy, Date.now(), JSON.stringify([createdBy]));
    res.json({ success: true, id });
});

// PUT /api/ffa-challenges/:id/accept
app.put('/api/ffa-challenges/:id/accept', (req, res) => {
    const ffa = db.prepare('SELECT * FROM ffa_challenges WHERE id = ?').get(req.params.id);
    if (!ffa) return res.status(404).json({ error: 'FFA-Challenge nicht gefunden' });
    if (ffa.status !== 'pending') return res.status(400).json({ error: 'FFA-Challenge ist nicht mehr offen' });

    const { player } = req.body;
    const players = JSON.parse(ffa.players);
    if (!players.includes(player)) return res.status(403).json({ error: 'Nicht in dieser Challenge' });

    const acceptances = JSON.parse(ffa.acceptances || '[]');
    if (acceptances.includes(player)) return res.status(400).json({ error: 'Bereits akzeptiert' });

    const newAcceptances = [...acceptances, player];
    const allAccepted = players.every(p => newAcceptances.includes(p));

    if (allAccepted) {
        const now = Date.now();
        const sid = 'ls_ffa_' + now;
        const _ffaTx = db.transaction(() => {
            for (const p of players) {
                if (ffa.stakeCoinsPerPerson > 0) db.prepare('UPDATE coins SET amount = amount - ? WHERE player = ?').run(ffa.stakeCoinsPerPerson, p);
                if (ffa.stakeStarsPerPerson > 0) db.prepare('UPDATE stars SET amount = amount - ? WHERE player = ?').run(ffa.stakeStarsPerPerson, p);
            }
            db.prepare('UPDATE ffa_challenges SET status = ?, acceptances = ? WHERE id = ?').run('accepted', JSON.stringify(newAcceptances), req.params.id);
            db.prepare("INSERT INTO live_sessions (id, game, leader, status, startedAt, challenge_id, challenge_type) VALUES (?, ?, ?, 'running', ?, ?, 'ffa')").run(sid, ffa.game, ffa.createdBy, now, ffa.id);
            for (const p of players) {
                db.prepare('INSERT OR IGNORE INTO live_session_players (session_id, player, joinedAt) VALUES (?, ?, ?)').run(sid, p, now);
            }
        });
        _ffaTx();
        broadcast({ type: 'update' });
        res.json({ success: true, allAccepted: true, sessionId: sid });
    } else {
        db.prepare('UPDATE ffa_challenges SET acceptances = ? WHERE id = ?').run(JSON.stringify(newAcceptances), req.params.id);
        broadcast({ type: 'update' });
        res.json({ success: true, allAccepted: false });
    }
});

// PUT /api/ffa-challenges/:id/reject
app.put('/api/ffa-challenges/:id/reject', (req, res) => {
    const ffa = db.prepare('SELECT * FROM ffa_challenges WHERE id = ?').get(req.params.id);
    if (!ffa) return res.status(404).json({ error: 'FFA-Challenge nicht gefunden' });

    const { player } = req.body;
    const players = JSON.parse(ffa.players);
    if (!players.includes(player)) return res.status(403).json({ error: 'Nicht in dieser Challenge' });

    if (ffa.status === 'accepted') {
        const refund = db.transaction(() => {
            for (const p of players) {
                if (ffa.stakeCoinsPerPerson > 0) db.prepare('UPDATE coins SET amount = amount + ? WHERE player = ?').run(ffa.stakeCoinsPerPerson, p);
                if (ffa.stakeStarsPerPerson > 0) db.prepare('UPDATE stars SET amount = amount + ? WHERE player = ?').run(ffa.stakeStarsPerPerson, p);
            }
            db.prepare('UPDATE ffa_challenges SET status = ?, resolvedAt = ? WHERE id = ?').run('rejected', Date.now(), req.params.id);
        });
        refund();
    } else {
        db.prepare('UPDATE ffa_challenges SET status = ?, resolvedAt = ? WHERE id = ?').run('rejected', Date.now(), req.params.id);
    }
    broadcast({ type: 'update' });
    res.json({ success: true });
});

// PUT /api/ffa-challenges/:id/complete
app.put('/api/ffa-challenges/:id/complete', (req, res) => {
    const ffa = db.prepare('SELECT * FROM ffa_challenges WHERE id = ?').get(req.params.id);
    if (!ffa) return res.status(404).json({ error: 'FFA-Challenge nicht gefunden' });
    if (ffa.status !== 'accepted') return res.status(400).json({ error: 'FFA-Challenge muss erst angenommen sein' });

    const { createdBy, placements } = req.body;
    if (createdBy !== ffa.createdBy) return res.status(403).json({ error: 'Nur der Ersteller kann Platzierungen setzen' });

    const players = JSON.parse(ffa.players);
    if (!placements || typeof placements !== 'object') return res.status(400).json({ error: 'placements erforderlich' });
    const missingPlayers = players.filter(p => placements[p] === undefined || placements[p] === null);
    if (missingPlayers.length > 0) return res.status(400).json({ error: `Fehlende Platzierung für: ${missingPlayers.join(', ')}` });

    const placementValues = players.map(p => placements[p]);
    const uniquePlaces = new Set(placementValues);
    if (uniquePlaces.size !== placementValues.length) return res.status(400).json({ error: 'Jeder Platz darf nur einmal vergeben werden' });

    db.prepare('UPDATE ffa_challenges SET status = ?, placements = ? WHERE id = ?').run('completed', JSON.stringify(placements), req.params.id);

    const admins = db.prepare("SELECT name FROM users WHERE role = 'admin'").all().map(r => r.name);
    const now = Date.now();
    const payload = JSON.stringify({ ffaId: ffa.id, game: ffa.game, createdBy: ffa.createdBy });
    admins.forEach(admin => {
        db.prepare('INSERT INTO player_events (target, type, from_player, message, createdAt, status) VALUES (?, ?, ?, ?, ?, ?)')
            .run(admin, 'ffa_winner_review', ffa.createdBy, payload, now, 'active');
    });

    broadcast({ type: 'update' });
    res.json({ success: true });
});

// PUT /api/ffa-challenges/:id/payout
app.put('/api/ffa-challenges/:id/payout', (req, res) => {
    const ffa = db.prepare('SELECT * FROM ffa_challenges WHERE id = ?').get(req.params.id);
    if (!ffa) return res.status(404).json({ error: 'FFA-Challenge nicht gefunden' });
    if (ffa.status !== 'completed') return res.status(400).json({ error: 'FFA-Challenge muss erst abgeschlossen sein' });

    const players = JSON.parse(ffa.players);
    const placements = JSON.parse(ffa.placements || '{}');
    const config = JSON.parse(ffa.payoutConfig || '[]');

    const totalPot = ffa.stakeCoinsPerPerson * players.length;
    const totalStarPot = ffa.stakeStarsPerPerson * players.length;

    const coinPayouts = {};
    let coinRemainder = totalPot;
    for (const entry of config) {
        const pct = Number(entry.pct);
        const playerForPlace = players.find(p => placements[p] === entry.place);
        if (playerForPlace) {
            const amount = Math.floor(totalPot * pct / 100);
            coinPayouts[playerForPlace] = amount;
            coinRemainder -= amount;
        }
    }
    const place1Player = players.find(p => placements[p] === 1);
    if (place1Player && coinRemainder > 0) {
        coinPayouts[place1Player] = (coinPayouts[place1Player] || 0) + coinRemainder;
    }

    const starPayouts = {};
    let starRemainder = totalStarPot;
    for (const entry of config) {
        const pct = Number(entry.pct);
        const playerForPlace = players.find(p => placements[p] === entry.place);
        if (playerForPlace) {
            const amount = Math.floor(totalStarPot * pct / 100);
            starPayouts[playerForPlace] = amount;
            starRemainder -= amount;
        }
    }
    if (place1Player && starRemainder > 0) {
        starPayouts[place1Player] = (starPayouts[place1Player] || 0) + starRemainder;
    }

    // Ensure all players have an entry (even 0)
    for (const p of players) {
        if (coinPayouts[p] === undefined) coinPayouts[p] = 0;
        if (starPayouts[p] === undefined) starPayouts[p] = 0;
    }

    db.prepare("UPDATE ffa_challenges SET status='released', payoutAmounts=?, payoutStarAmounts=?, collected='[]' WHERE id=?")
        .run(JSON.stringify(coinPayouts), JSON.stringify(starPayouts), req.params.id);

    broadcast({ type: 'update' });
    res.json({ success: true });
});

// PUT /api/ffa-challenges/:id/collect
app.put('/api/ffa-challenges/:id/collect', (req, res) => {
    const { player } = req.body;
    if (!player) return res.status(400).json({ error: 'player erforderlich' });

    const ffa = db.prepare('SELECT * FROM ffa_challenges WHERE id = ?').get(req.params.id);
    if (!ffa) return res.status(404).json({ error: 'FFA-Challenge nicht gefunden' });
    if (ffa.status !== 'released') return res.status(400).json({ error: 'FFA-Challenge nicht im Status released' });

    const players = JSON.parse(ffa.players);
    if (!players.includes(player)) return res.status(403).json({ error: 'Nicht Teilnehmer dieser Challenge' });

    const collected = JSON.parse(ffa.collected || '[]');
    if (collected.includes(player)) return res.status(400).json({ error: 'Bereits eingesammelt' });

    const payoutAmounts = JSON.parse(ffa.payoutAmounts || '{}');
    const payoutStarAmounts = JSON.parse(ffa.payoutStarAmounts || '{}');
    const coins = payoutAmounts[player] || 0;
    const stars = payoutStarAmounts[player] || 0;
    const now = Date.now();

    const collectTx = db.transaction(() => {
        if (coins > 0) {
            db.prepare('UPDATE coins SET amount = amount + ? WHERE player = ?').run(coins, player);
        }
        if (stars > 0) {
            db.prepare('UPDATE stars SET amount = amount + ? WHERE player = ?').run(stars, player);
        }
        db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)')
            .run(player, coins, `FFA-Challenge Auszahlung (${ffa.game})`, now);
        collected.push(player);
        db.prepare('UPDATE ffa_challenges SET collected = ? WHERE id = ?').run(JSON.stringify(collected), ffa.id);
    });
    collectTx();

    const allCollected = players.every(p => collected.includes(p));
    if (allCollected) {
        db.prepare('UPDATE ffa_challenges SET status = ?, resolvedAt = ? WHERE id = ?').run('paid', now, ffa.id);
    }

    broadcast({ type: 'update' });
    res.json({ success: true, coins, stars });
});

// DELETE /api/ffa-challenges/:id
app.delete('/api/ffa-challenges/:id', (req, res) => {
    const ffa = db.prepare('SELECT * FROM ffa_challenges WHERE id = ?').get(req.params.id);
    if (!ffa) return res.status(404).json({ error: 'FFA-Challenge nicht gefunden' });

    if (ffa.status === 'accepted') {
        const players = JSON.parse(ffa.players);
        const refund = db.transaction(() => {
            for (const p of players) {
                if (ffa.stakeCoinsPerPerson > 0) db.prepare('UPDATE coins SET amount = amount + ? WHERE player = ?').run(ffa.stakeCoinsPerPerson, p);
                if (ffa.stakeStarsPerPerson > 0) db.prepare('UPDATE stars SET amount = amount + ? WHERE player = ?').run(ffa.stakeStarsPerPerson, p);
            }
        });
        refund();
    }

    db.prepare('DELETE FROM ffa_challenges WHERE id = ?').run(req.params.id);
    broadcast({ type: 'update' });
    res.json({ success: true });
});

// ---- Payout Helpers ----

function validatePayoutConfig(payoutMode, payoutConfig) {
    if (!payoutMode || payoutMode === 'winner_takes_all') return null;
    if (payoutMode !== 'percentage') return 'Ungültiger payoutMode';
    if (!payoutConfig || typeof payoutConfig !== 'object') return 'payoutConfig fehlt';
    const w = Number(payoutConfig.winner), l = Number(payoutConfig.loser);
    if (!Number.isInteger(w) || !Number.isInteger(l)) return 'Prozente müssen ganzzahlig sein';
    if (w < 50 || l < 0 || w + l !== 100) return 'Gewinner ≥50%, Summe = 100%';
    return null;
}

function calcPayout(totalPot, payoutMode, payoutConfig) {
    if (payoutMode === 'percentage' && payoutConfig) {
        const cfg = typeof payoutConfig === 'string' ? JSON.parse(payoutConfig) : payoutConfig;
        const winnerCoins = Math.floor(totalPot * cfg.winner / 100);
        return { winnerCoins, loserCoins: totalPot - winnerCoins };
    }
    return { winnerCoins: totalPot, loserCoins: 0 };
}

function validateFFAPayoutConfig(payoutConfig, playerCount) {
    if (!Array.isArray(payoutConfig)) return 'payoutConfig muss Array sein';
    const totalPct = payoutConfig.reduce((s, e) => s + Number(e.pct), 0);
    if (totalPct !== 100) return `Prozente ergeben ${totalPct}%, müssen 100% sein`;
    if (payoutConfig.some(e => e.pct < 0)) return 'Keine negativen Prozente';
    if (payoutConfig.some(e => e.place < 1 || e.place > playerCount)) return 'Ungültiger Platz';
    const places = payoutConfig.map(e => e.place);
    if (new Set(places).size !== places.length) return 'Plätze dürfen nicht doppelt vorkommen';
    return null;
}

// ---- Duel Voting ----

function _duelPayout(session, winnerOverride, db, releaseOnly = false) {
    if (session.challenge_type === '1v1') {
        const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(session.challenge_id);
        if (!c) return;
        const winner = winnerOverride || c.winner;
        if (!winner) return;
        const loser = winner === c.challenger ? c.opponent : c.challenger;
        if (releaseOnly) {
            const { winnerCoins, loserCoins } = calcPayout(c.stakeCoins * 2, c.payoutMode, c.payoutConfig);
            const { winnerCoins: winnerStars, loserCoins: loserStars } = calcPayout(c.stakeStars * 2, c.payoutMode, c.payoutConfig);
            const payoutAmounts = { [winner]: winnerCoins, [loser]: loserCoins };
            const payoutStarAmounts = { [winner]: winnerStars, [loser]: loserStars };
            db.prepare("UPDATE challenges SET status='released', winner=?, payoutAmounts=?, payoutStarAmounts=?, collected='[]' WHERE id=?")
                .run(winner, JSON.stringify(payoutAmounts), JSON.stringify(payoutStarAmounts), c.id);
            return;
        }
        const now = Date.now();
        const payout = db.transaction(() => {
            if (c.stakeCoins > 0) {
                const { winnerCoins, loserCoins } = calcPayout(c.stakeCoins * 2, c.payoutMode, c.payoutConfig);
                db.prepare('INSERT INTO coins (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(winner, winnerCoins, winnerCoins);
                db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(winner, winnerCoins, `Duell gewonnen vs ${loser} (${c.game})`, now);
                if (loserCoins > 0) {
                    db.prepare('INSERT INTO coins (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(loser, loserCoins, loserCoins);
                }
                db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(loser, loserCoins - c.stakeCoins, `Duell verloren vs ${winner} (${c.game})`, now);
            }
            if (c.stakeStars > 0) {
                const { winnerCoins: winnerStars, loserCoins: loserStars } = calcPayout(c.stakeStars * 2, c.payoutMode, c.payoutConfig);
                db.prepare('INSERT INTO stars (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(winner, winnerStars, winnerStars);
                if (loserStars > 0) {
                    db.prepare('INSERT INTO stars (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(loser, loserStars, loserStars);
                }
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
    } else if (session.challenge_type === 'ffa') {
        const ffa = db.prepare('SELECT * FROM ffa_challenges WHERE id = ?').get(session.challenge_id);
        if (!ffa) return;

        const players = JSON.parse(ffa.players);
        const placements = JSON.parse(ffa.placements || '{}');
        const config = JSON.parse(ffa.payoutConfig || '[]');

        const totalPot = ffa.stakeCoinsPerPerson * players.length;
        const totalStarPot = ffa.stakeStarsPerPerson * players.length;

        const coinPayouts = {};
        let coinRemainder = totalPot;
        for (const entry of config) {
            const pct = Number(entry.pct);
            const playerForPlace = players.find(p => placements[p] === entry.place);
            if (playerForPlace) {
                const amount = Math.floor(totalPot * pct / 100);
                coinPayouts[playerForPlace] = amount;
                coinRemainder -= amount;
            }
        }
        const place1Player = players.find(p => placements[p] === 1);
        if (place1Player && coinRemainder > 0) {
            coinPayouts[place1Player] = (coinPayouts[place1Player] || 0) + coinRemainder;
        }

        const starPayouts = {};
        let starRemainder = totalStarPot;
        for (const entry of config) {
            const pct = Number(entry.pct);
            const playerForPlace = players.find(p => placements[p] === entry.place);
            if (playerForPlace) {
                const amount = Math.floor(totalStarPot * pct / 100);
                starPayouts[playerForPlace] = amount;
                starRemainder -= amount;
            }
        }
        if (place1Player && starRemainder > 0) {
            starPayouts[place1Player] = (starPayouts[place1Player] || 0) + starRemainder;
        }

        for (const p of players) {
            if (coinPayouts[p] === undefined) coinPayouts[p] = 0;
            if (starPayouts[p] === undefined) starPayouts[p] = 0;
        }

        db.prepare("UPDATE ffa_challenges SET status='released', payoutAmounts=?, payoutStarAmounts=?, collected='[]' WHERE id=?")
            .run(JSON.stringify(coinPayouts), JSON.stringify(starPayouts), ffa.id);
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
        const { winnerCoins: winnerTeamCoins, loserCoins: loserTeamCoins } = calcPayout(totalPot, tc.payoutMode, tc.payoutConfig);
        const { winnerCoins: winnerTeamStars, loserCoins: loserTeamStars } = calcPayout(totalStarPot, tc.payoutMode, tc.payoutConfig);
        const baseCoins = Math.floor(winnerTeamCoins / winners.length);
        const remainder = winnerTeamCoins - baseCoins * winners.length;
        const baseStars = Math.floor(winnerTeamStars / winners.length);
        const starRemainder = winnerTeamStars - baseStars * winners.length;
        const baseLoserCoins = loserTeamCoins > 0 ? Math.floor(loserTeamCoins / losers.length) : 0;
        const loserRemainder = loserTeamCoins > 0 ? loserTeamCoins - baseLoserCoins * losers.length : 0;
        const baseLoserStars = loserTeamStars > 0 ? Math.floor(loserTeamStars / losers.length) : 0;
        const loserStarRemainder = loserTeamStars > 0 ? loserTeamStars - baseLoserStars * losers.length : 0;
        if (releaseOnly) {
            const payoutAmounts = {};
            const payoutStarAmounts = {};
            winners.forEach((p, idx) => {
                payoutAmounts[p] = baseCoins + (idx === 0 ? remainder : 0);
                payoutStarAmounts[p] = baseStars + (idx === 0 ? starRemainder : 0);
            });
            losers.forEach((p, idx) => {
                payoutAmounts[p] = loserTeamCoins > 0 ? baseLoserCoins + (idx === 0 ? loserRemainder : 0) : 0;
                payoutStarAmounts[p] = loserTeamStars > 0 ? baseLoserStars + (idx === 0 ? loserStarRemainder : 0) : 0;
            });
            db.prepare("UPDATE team_challenges SET status='released', winnerTeam=?, payoutAmounts=?, payoutStarAmounts=?, collected='[]' WHERE id=?")
                .run(winnerTeam, JSON.stringify(payoutAmounts), JSON.stringify(payoutStarAmounts), tc.id);
            return;
        }
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
            losers.forEach((p, idx) => {
                if (loserTeamCoins > 0) {
                    const loserCoinAmount = baseLoserCoins + (idx === 0 ? loserRemainder : 0);
                    if (loserCoinAmount > 0) {
                        db.prepare('INSERT INTO coins (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(p, loserCoinAmount, loserCoinAmount);
                    }
                }
                if (tc.stakeCoinsPerPerson > 0) {
                    const netAmount = (loserTeamCoins > 0 ? (baseLoserCoins + (idx === 0 ? loserRemainder : 0)) : 0) - tc.stakeCoinsPerPerson;
                    db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(p, netAmount, `Team-Duell verloren (${loserTeamLabel}) – ${tc.game}`, now);
                }
                if (loserTeamStars > 0) {
                    const loserStarAmount = baseLoserStars + (idx === 0 ? loserStarRemainder : 0);
                    if (loserStarAmount > 0) {
                        db.prepare('INSERT INTO stars (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(p, loserStarAmount, loserStarAmount);
                    }
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
    if (req.authRole !== 'admin') return res.status(403).json({ error: 'Nur Admins können auflösen' });

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
    const validPlayer = db.prepare('SELECT 1 FROM live_session_players WHERE session_id = ? AND player = ?').get(sessionId, votedFor);
    if (!validPlayer) return res.status(400).json({ error: 'votedFor ist kein Teilnehmer dieser Session' });
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
            // KONSENS: 1v1 direkte Auszahlung; team/ffa → Status 'voted', Admin muss freigeben
            if (session.challenge_type === '1v1') {
                db.prepare(`UPDATE challenges SET winner = ? WHERE id = ?`)
                    .run(unique[0], session.challenge_id);
                _duelPayout(session, unique[0], db);
            } else if (session.challenge_type === 'team') {
                db.prepare(`UPDATE team_challenges SET winnerTeam = ?, status = 'voted' WHERE id = ?`)
                    .run(unique[0], session.challenge_id);
            } else if (session.challenge_type === 'ffa') {
                db.prepare(`UPDATE ffa_challenges SET status = 'voted' WHERE id = ?`)
                    .run(session.challenge_id);
            }
        } else {
            if (session.challenge_type === '1v1') {
                db.prepare(`UPDATE challenges SET status = 'conflict' WHERE id = ?`)
                    .run(session.challenge_id);
            } else if (session.challenge_type === 'team') {
                db.prepare(`UPDATE team_challenges SET status = 'conflict' WHERE id = ?`)
                    .run(session.challenge_id);
            } else if (session.challenge_type === 'ffa') {
                db.prepare(`UPDATE ffa_challenges SET status = 'conflict' WHERE id = ?`)
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
        "SELECT * FROM player_events WHERE target = ? AND type IN ('force_play', 'drink_order') AND status = 'active' ORDER BY createdAt ASC"
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
        s.players = db.prepare('SELECT player, slot_number FROM live_session_players WHERE session_id = ? ORDER BY COALESCE(slot_number, 999) ASC, joinedAt ASC').all(s.id);
    });
    res.json(sessions);
});

// POST /api/live-sessions — Raum erstellen (status: lobby)
app.post('/api/live-sessions', (req, res) => {
    const { game, leader, medium = 'lan', account = null, maxSlots = 0 } = req.body;
    if (!game || !leader) return res.status(400).json({ error: 'game und leader erforderlich' });
    const activeGame = getActiveSessionForPlayer(leader);
    if (activeGame) return res.status(400).json({ error: `Du bist bereits in einer laufenden Session: ${activeGame}` });
    const id = 'ls_' + Date.now();
    const slots = parseInt(maxSlots) || 0;
    db.prepare("INSERT INTO live_sessions (id, game, leader, status, medium, medium_account, max_slots) VALUES (?, ?, ?, 'lobby', ?, ?, ?)").run(id, game, leader, medium, account, slots);
    db.prepare('INSERT INTO live_session_players (session_id, player, joinedAt, slot_number) VALUES (?, ?, ?, 1)').run(id, leader, Date.now());
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
    const session = db.prepare('SELECT status, game, leader, max_slots FROM live_sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (session.status !== 'lobby') return res.status(400).json({ error: 'Session läuft bereits, kein Beitritt möglich' });
    if (session.leader === player) return res.status(400).json({ error: 'Leader kann nicht dem eigenen Raum beitreten' });
    const activeGame = getActiveSessionForPlayer(player);
    if (activeGame) return res.status(400).json({ error: `Du bist bereits in einer laufenden Session: ${activeGame}` });
    const slots = parseInt(session.max_slots) || 0;
    let slotNumber = null;
    if (slots > 0) {
        const taken = db.prepare('SELECT slot_number FROM live_session_players WHERE session_id = ?').all(req.params.id).map(r => r.slot_number);
        slotNumber = Array.from({ length: slots }, (_, i) => i + 1).find(n => !taken.includes(n));
        if (!slotNumber) return res.status(400).json({ error: 'Sitzung ist voll' });
    }
    try {
        db.prepare('INSERT OR IGNORE INTO live_session_players (session_id, player, joinedAt, slot_number) VALUES (?, ?, ?, ?)').run(req.params.id, player, Date.now(), slotNumber);
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
            if (req.authRole !== 'admin') {
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
    const durationMinRaw = sessionData?.startedAt ? (endedAt - sessionData.startedAt) / 60000 : 0;
    const durationMin = Math.round(durationMinRaw);
    const pendingCoins = Math.round(durationMinRaw * playerRate);
    db.prepare("UPDATE live_sessions SET status = 'ended', endedAt = ?, pending_coins = ?, duration_min = ?, coin_rate = ? WHERE id = ?").run(endedAt, pendingCoins, durationMin, playerRate, req.params.id);
    res.json({ success: true });
});

// POST /api/live-sessions/:id/approve — releases session for player collect (does NOT credit coins yet)
app.post('/api/live-sessions/:id/approve', (req, res) => {
    const { coinsPerPlayer: bodyCoins, player } = req.body;
    const session = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    const _isLeader1 = session.leader === player;
    if (req.authRole !== 'admin' && !_isLeader1) return res.status(403).json({ error: 'Nicht berechtigt' });
    const coinsPerPlayer = session.pending_coins > 0 ? session.pending_coins : Math.max(0, parseInt(bodyCoins) || 0);
    const players = db.prepare('SELECT player FROM live_session_players WHERE session_id = ?').all(req.params.id).map(r => r.player);
    // Build per-player payout amounts (same amount for each player)
    const payoutAmounts = {};
    for (const p of players) { payoutAmounts[p] = coinsPerPlayer; }
    db.prepare("UPDATE live_sessions SET status = 'released', sessionPayoutAmounts = ?, sessionCollected = '[]' WHERE id = ?").run(JSON.stringify(payoutAmounts), req.params.id);
    // Notify all participants via player_events (inform that coins are ready to collect)
    if (coinsPerPlayer > 0) {
        const payoutPayload = JSON.stringify({ sessionId: req.params.id, game: session.game, coins: coinsPerPlayer, playerCount: players.length, durationMin: session.duration_min || 0, coinRate: session.coin_rate || 0 });
        const payoutNow = Date.now();
        for (const p of players) {
            db.prepare('INSERT INTO player_events (target, type, from_player, message, createdAt, status, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(p, 'session_payout', '', payoutPayload, payoutNow, 'active', req.params.id);
        }
    }
    broadcast({ type: 'update' });
    res.json({ success: true });
});

// PUT /api/live-sessions/:id/collect — player collects their coins from a released session
app.put('/api/live-sessions/:id/collect', (req, res) => {
    const { player } = req.body;
    if (!player) return res.status(400).json({ error: 'player erforderlich' });
    const session = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (session.status !== 'released') return res.status(400).json({ error: 'Session nicht im released-Status' });
    const allPlayers = db.prepare('SELECT player FROM live_session_players WHERE session_id = ?').all(req.params.id).map(r => r.player);
    if (!allPlayers.includes(player)) return res.status(403).json({ error: 'Spieler nicht in dieser Session' });
    const sessionCollected = JSON.parse(session.sessionCollected || '[]');
    if (sessionCollected.includes(player)) return res.status(400).json({ error: 'Bereits eingesammelt' });
    const payoutAmounts = JSON.parse(session.sessionPayoutAmounts || '{}');
    const coinsToCredit = payoutAmounts[player] || 0;
    const now = Date.now();
    const collectTx = db.transaction(() => {
        db.prepare('INSERT INTO coins (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(player, coinsToCredit, coinsToCredit);
        db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(player, coinsToCredit, `Session: ${session.game} (${allPlayers.length} Spieler)`, now);
        const newCollected = JSON.stringify([...sessionCollected, player]);
        db.prepare('UPDATE live_sessions SET sessionCollected = ? WHERE id = ?').run(newCollected, req.params.id);
        db.prepare("DELETE FROM player_events WHERE target = ? AND type = 'session_payout' AND session_id = ?").run(player, req.params.id);
    });
    collectTx();
    // Check if all players have now collected
    const newCollectedArr = [...sessionCollected, player];
    if (newCollectedArr.length >= allPlayers.length) {
        // Archive to sessions table and clean up
        const coinsPerPlayer = allPlayers.length > 0 ? (payoutAmounts[allPlayers[0]] || 0) : 0;
        db.prepare('INSERT INTO sessions (game, players, coinsPerPlayer, timestamp, medium, duration_min) VALUES (?, ?, ?, ?, ?, ?)').run(session.game, JSON.stringify(allPlayers), coinsPerPlayer, now, session.medium, session.duration_min || 0);
        db.prepare('DELETE FROM live_session_players WHERE session_id = ?').run(req.params.id);
        db.prepare('DELETE FROM live_sessions WHERE id = ?').run(req.params.id);
    }
    broadcast({ type: 'update' });
    res.json({ success: true, coins: coinsToCredit });
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
        } else if (session.challenge_type === 'ffa') {
            const ffa = db.prepare('SELECT * FROM ffa_challenges WHERE id = ?').get(session.challenge_id);
            if (ffa) {
                const players = JSON.parse(ffa.players || '[]');
                for (const p of players) {
                    if (ffa.stakeCoinsPerPerson > 0) db.prepare('UPDATE coins SET amount = amount + ? WHERE player = ?').run(ffa.stakeCoinsPerPerson, p);
                    if (ffa.stakeStarsPerPerson > 0) db.prepare('UPDATE stars SET amount = amount + ? WHERE player = ?').run(ffa.stakeStarsPerPerson, p);
                }
                db.prepare("UPDATE ffa_challenges SET status = 'cancelled' WHERE id = ?").run(ffa.id);
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

// GET /api/rawg/status
app.get('/api/rawg/status', (req, res) => {
    const enabled = db.prepare("SELECT value FROM settings WHERE key='rawg_enabled'").get()?.value === '1';
    res.json({ enabled, configured: !!process.env.RAWG_API_KEY });
});

// GET /api/rawg/game/:id — full detail + store URLs for a single game (used by suggest autocomplete)
app.get('/api/rawg/game/:id', async (req, res) => {
    const enabled = db.prepare("SELECT value FROM settings WHERE key='rawg_enabled'").get()?.value === '1';
    if (!enabled) return res.status(400).json({ error: 'RAWG nicht aktiviert' });
    const key = process.env.RAWG_API_KEY;
    if (!key) return res.status(500).json({ error: 'RAWG_API_KEY not set' });
    try {
        const [detailRes, storesRes, ssRes] = await Promise.all([
            fetch(`https://api.rawg.io/api/games/${req.params.id}?key=${key}`),
            fetch(`https://api.rawg.io/api/games/${req.params.id}/stores?key=${key}`),
            fetch(`https://api.rawg.io/api/games/${req.params.id}/screenshots?key=${key}&page_size=6`)
        ]);
        const d = await detailRes.json();
        const storesData = await storesRes.json();
        const ssData = await ssRes.json();
        // Count 3 calls
        const cc = parseInt(db.prepare("SELECT value FROM settings WHERE key='rawg_calls_total'").get()?.value || '0');
        db.prepare("INSERT INTO settings (key,value) VALUES ('rawg_calls_total',?) ON CONFLICT(key) DO UPDATE SET value=?").run(String(cc+3), String(cc+3));
        const storeNameMap = {};
        (d.stores || []).forEach(s => { storeNameMap[s.store.id] = s.store.name; });
        let shops = (storesData.results || []).filter(s => s.url).map(s => ({ platform: storeNameMap[s.store_id] || `Store ${s.store_id}`, url: s.url }));
        if (d.website) shops = [{ platform: 'Website', url: d.website }, ...shops];
        // Download screenshots locally
        const safeName = d.name.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 50);
        const remoteUrls = (ssData.results || []).slice(0, 6).map(s => s.image).filter(Boolean);
        const screenshots = [];
        for (let i = 0; i < remoteUrls.length; i++) {
            const localPath = path.join(screenshotsDir, `${safeName}-${i}.jpg`);
            const localUrl = `/gamefiles/screenshots/${safeName}-${i}.jpg`;
            try {
                const imgRes = await fetch(remoteUrls[i]);
                const buf = await imgRes.arrayBuffer();
                fs.writeFileSync(localPath, Buffer.from(buf));
                screenshots.push(localUrl);
            } catch { screenshots.push(remoteUrls[i]); } // fallback to remote URL
        }
        res.json({
            id: d.id,
            name: d.name,
            cover: d.background_image || '',
            genres: (d.genres || []).map(x => x.name).join(', '),
            metacritic: d.metacritic || 0,
            description: (d.description_raw || '').slice(0, 2000),
            platforms: (d.platforms || []).map(p => p.platform.name),
            released: d.released || '',
            shops,
            screenshots
        });
    } catch (e) {
        logger.error('RAWG game detail error: ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/rawg/search
app.post('/api/rawg/search', async (req, res) => {
    const enabled = db.prepare("SELECT value FROM settings WHERE key='rawg_enabled'").get()?.value === '1';
    if (!enabled) return res.json({ results: [], configured: false });
    const key = process.env.RAWG_API_KEY;
    if (!key) return res.json({ results: [], configured: false });
    const { query } = req.body;
    if (!query) return res.json({ results: [] });
    logger.debug('RAWG search: ' + query);
    try {
        const r = await fetch(`https://api.rawg.io/api/games?search=${encodeURIComponent(query)}&key=${key}&page_size=5`);
        const data = await r.json();
        res.json({ results: (data.results || []).map(g => ({
            id: g.id,
            name: g.name,
            cover: g.background_image || '',
            genres: (g.genres || []).map(x => x.name).join(', '),
            metacritic: g.metacritic || 0,
            description: (g.description_raw || '').slice(0, 400),
            platforms: (g.platforms || []).map(p => p.platform.name),
            released: g.released || '',
        })), configured: true });
    } catch (e) {
        logger.error('RAWG search error: ' + e.message);
        res.json({ results: [], configured: true });
    }
});

// POST /api/games/enrich
app.post('/api/games/enrich', async (req, res) => {
    const enabled = db.prepare("SELECT value FROM settings WHERE key='rawg_enabled'").get()?.value === '1';
    if (!enabled) return res.status(400).json({ error: 'RAWG nicht aktiviert' });
    const key = process.env.RAWG_API_KEY;
    if (!key) return res.status(500).json({ error: 'RAWG_API_KEY not set' });

    // Process all approved games — full re-fetch and overwrite
    const { name: singleName } = req.body;
    const games = singleName
        ? db.prepare(`SELECT name, rawg_id, cover_url FROM games WHERE LOWER(name) = LOWER(?)`).all(singleName)
        : db.prepare(`SELECT name, rawg_id, cover_url FROM games WHERE status = 'approved'`).all();

    logger.info(`RAWG enrich started: ${games.length} games to process`);
    let enriched = 0, skipped = 0;

    for (const g of games) {
        try {
            let rawgId = g.rawg_id;

            // Step 1: If no rawg_id, search by name first
            if (!rawgId) {
                const searchUrl = `https://api.rawg.io/api/games?search=${encodeURIComponent(g.name)}&key=***&page_size=1`;
                logger.debug(`[${g.name}] SEARCH → GET ${searchUrl.replace(/key=[^&]+/, 'key=***')}`);
                const searchRes = await fetch(`https://api.rawg.io/api/games?search=${encodeURIComponent(g.name)}&key=${key}&page_size=1`);
                const searchData = await searchRes.json();
                rawgId = searchData.results?.[0]?.id;
                const sc = parseInt(db.prepare("SELECT value FROM settings WHERE key='rawg_calls_total'").get()?.value || '0');
                db.prepare("INSERT INTO settings (key,value) VALUES ('rawg_calls_total',?) ON CONFLICT(key) DO UPDATE SET value=?").run(String(sc+1), String(sc+1));
                if (!rawgId) {
                    logger.debug(`[${g.name}] SEARCH → no results, checking disk for existing screenshots`);
                    const safeNameFallback = g.name.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 50);
                    const existingScreenshots = [];
                    for (let i = 0; i < 6; i++) {
                        const lp = path.join(screenshotsDir, `${safeNameFallback}-${i}.jpg`);
                        if (fs.existsSync(lp)) existingScreenshots.push(`/gamefiles/screenshots/${safeNameFallback}-${i}.jpg`);
                        else break;
                    }
                    if (existingScreenshots.length > 0) {
                        db.prepare('UPDATE games SET screenshots=? WHERE name=?').run(JSON.stringify(existingScreenshots), g.name);
                        logger.debug(`[${g.name}] registered ${existingScreenshots.length} existing screenshots from disk (no RAWG match)`);
                    }
                    skipped++; continue;
                }
                logger.debug(`[${g.name}] SEARCH → found RAWG id=${rawgId} (${searchData.results[0]?.name}), HTTP ${searchRes.status}`);
            } else {
                logger.debug(`[${g.name}] rawg_id=${rawgId} already known, skipping search`);
            }

            // Step 2: Detail call
            logger.debug(`[${g.name}] DETAIL → GET /api/games/${rawgId}`);
            const detailRes = await fetch(`https://api.rawg.io/api/games/${rawgId}?key=${key}`);
            const d = await detailRes.json();
            logger.debug(`[${g.name}] DETAIL → HTTP ${detailRes.status}, slug="${d.slug}", metacritic=${d.metacritic ?? 'n/a'}, genres=${(d.genres||[]).map(x=>x.name).join('/')}, stores=${(d.stores||[]).length}, platforms=${(d.platforms||[]).length}`);

            // Count detail call
            const dc = parseInt(db.prepare("SELECT value FROM settings WHERE key='rawg_calls_total'").get()?.value || '0');
            db.prepare("INSERT INTO settings (key,value) VALUES ('rawg_calls_total',?) ON CONFLICT(key) DO UPDATE SET value=?").run(String(dc+1), String(dc+1));

            // Build fields
            const genres = (d.genres || []).map(x => x.name).join(', ');
            const platforms = JSON.stringify((d.platforms || []).map(p => p.platform.name));
            const released = d.released || '';
            const description = (d.description_raw || '').slice(0, 2000);
            const metacritic = d.metacritic || 0;

            // Shop links — fetch from sub-endpoint because d.stores[].url is always null in detail response
            let rawgStores = [];
            try {
                const storesRes = await fetch(`https://api.rawg.io/api/games/${rawgId}/stores?key=${key}`);
                const storesData = await storesRes.json();
                // Count this call
                const stc = parseInt(db.prepare("SELECT value FROM settings WHERE key='rawg_calls_total'").get()?.value || '0');
                db.prepare("INSERT INTO settings (key,value) VALUES ('rawg_calls_total',?) ON CONFLICT(key) DO UPDATE SET value=?").run(String(stc+1), String(stc+1));
                // Build store-name map from detail response (has names but no URLs)
                const storeNameMap = {};
                (d.stores || []).forEach(s => { storeNameMap[s.store.id] = s.store.name; });
                rawgStores = (storesData.results || [])
                    .filter(s => s.url)
                    .map(s => ({ platform: storeNameMap[s.store_id] || `Store ${s.store_id}`, url: s.url }));
                logger.debug(`[${g.name}] stores sub-call → ${rawgStores.length} store URLs`);
            } catch (stErr) {
                logger.debug(`[${g.name}] stores sub-call failed: ${stErr.message}`);
            }
            // Prepend official website if present
            if (d.website) {
                rawgStores = [{ platform: 'Website', url: d.website }, ...rawgStores];
                logger.debug(`[${g.name}] website: ${d.website}`);
            }
            logger.debug(`[${g.name}] shops=${rawgStores.map(s=>`${s.platform}(${s.url ? 'url✓' : 'no-url'})`).join(', ') || 'none'}`);

            // Safe filename for covers + screenshots
            const safeName = g.name.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 50);

            // Fetch and download screenshots locally
            let screenshotUrls = [];
            try {
                const ssRes = await fetch(`https://api.rawg.io/api/games/${rawgId}/screenshots?key=${key}&page_size=6`);
                const ssData = await ssRes.json();
                const ssc = parseInt(db.prepare("SELECT value FROM settings WHERE key='rawg_calls_total'").get()?.value || '0');
                db.prepare("INSERT INTO settings (key,value) VALUES ('rawg_calls_total',?) ON CONFLICT(key) DO UPDATE SET value=?").run(String(ssc+1), String(ssc+1));
                const remoteUrls = (ssData.results || []).slice(0, 6).map(s => s.image).filter(Boolean);
                for (let i = 0; i < remoteUrls.length; i++) {
                    const localPath = path.join(screenshotsDir, `${safeName}-${i}.jpg`);
                    const localUrl = `/gamefiles/screenshots/${safeName}-${i}.jpg`;
                    try {
                        const imgRes = await fetch(remoteUrls[i]);
                        const buf = await imgRes.arrayBuffer();
                        fs.writeFileSync(localPath, Buffer.from(buf));
                        screenshotUrls.push(localUrl);
                    } catch (dlErr) {
                        logger.debug(`[${g.name}] screenshot ${i} download failed: ${dlErr.message}`);
                        if (fs.existsSync(localPath)) {
                            screenshotUrls.push(localUrl);
                            logger.debug(`[${g.name}] screenshot ${i} already on disk, registering existing file`);
                        }
                    }
                }
                logger.debug(`[${g.name}] screenshots → ${screenshotUrls.length} downloaded locally`);
            } catch (ssErr) {
                logger.debug(`[${g.name}] screenshots fetch failed: ${ssErr.message}`);
            }

            // Fallback: if RAWG returned no screenshots (or all downloads failed), check for existing files on disk
            if (screenshotUrls.length === 0) {
                for (let i = 0; i < 6; i++) {
                    const localPath = path.join(screenshotsDir, `${safeName}-${i}.jpg`);
                    if (fs.existsSync(localPath)) screenshotUrls.push(`/gamefiles/screenshots/${safeName}-${i}.jpg`);
                    else break;
                }
                if (screenshotUrls.length > 0) logger.debug(`[${g.name}] screenshots → ${screenshotUrls.length} existing files registered from disk`);
            }

            // System requirements (prefer PC, fallback to first platform with requirements)
            const pcPlat = (d.platforms || []).find(p => p.platform.name === 'PC');
            const anyReq = (d.platforms || []).find(p => p.requirements_en?.minimum || p.requirements?.minimum);
            const reqSource = pcPlat || anyReq;
            const reqMin = reqSource?.requirements_en?.minimum || reqSource?.requirements?.minimum || '';
            const requirements = reqMin ? JSON.stringify({ minimum: reqMin }) : '';
            logger.debug(`[${g.name}] requirements=${reqMin ? 'found (PC=' + !!pcPlat + ')' : 'none'}`);

            // Cover download — keep existing value on failure so DB is never cleared
            let coverUrl = g.cover_url || '';
            if (d.background_image) {
                logger.debug(`[${g.name}] cover → downloading ${d.background_image}`);
                try {
                    const imgRes = await fetch(d.background_image);
                    const buf = await imgRes.arrayBuffer();
                    const filePath = path.join(coversDir, `${safeName}.jpg`);
                    fs.writeFileSync(filePath, Buffer.from(buf));
                    coverUrl = `/gamefiles/covers/${safeName}.jpg`;
                    logger.debug(`[${g.name}] cover → saved ${coverUrl} (${buf.byteLength} bytes)`);
                } catch (imgErr) {
                    logger.debug(`[${g.name}] cover → download failed: ${imgErr.message}`);
                }
            } else {
                logger.debug(`[${g.name}] cover → no background_image in RAWG response`);
            }

            // Update DB — only overwrite screenshots/shop_links if we actually got data
            const baseFields = `cover_url=?, description=?, rating=?, rawg_id=?, genre=?, platforms=?, released=?, requirements=?`;
            const baseParams = [coverUrl, description, metacritic, rawgId, genres, platforms, released, requirements];
            let extraFields = '';
            const extraParams = [];
            if (rawgStores.length > 0) { extraFields += ', shop_links=?'; extraParams.push(JSON.stringify(rawgStores)); }
            if (screenshotUrls.length > 0) { extraFields += ', screenshots=?'; extraParams.push(JSON.stringify(screenshotUrls)); }
            db.prepare(`UPDATE games SET ${baseFields}${extraFields} WHERE name=?`)
                .run(...baseParams, ...extraParams, g.name);

            logger.debug(`[${g.name}] ✓ enriched: genre="${genres}", released="${released}", cover=${coverUrl ? '✓' : '✗'}, shops=${rawgStores.length}`);
            enriched++;
            await new Promise(r => setTimeout(r, 250));
        } catch (e) {
            logger.debug(`RAWG error for "${g.name}": ${e.message}`);
            skipped++;
        }
    }

    logger.info('RAWG enrich done: ' + enriched + ' enriched, ' + skipped + ' skipped');
    broadcast();
    res.json({ enriched, skipped });
});

// ---- Global Error Handler ----
app.use((err, req, res, next) => {
    logger.error('Unhandled error: ' + err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// ---- Start Server ----
app.listen(PORT, () => {
    logger.info('Server started on port ' + PORT);
    console.log(`Gameparty Server laeuft auf http://localhost:${PORT}`);
});
