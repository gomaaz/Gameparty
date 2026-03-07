// ============================================================
// Gameparty - Express + SQLite Backend
// ============================================================
const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
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
const db = new Database(path.join(__dirname, 'gameparty.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, pin TEXT, role TEXT DEFAULT 'player');
    CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, maxPlayers INT, genre TEXT, lanRating INT DEFAULT 0, previewUrl TEXT, ready INT DEFAULT 0, status TEXT DEFAULT 'approved', suggestedBy TEXT, sessionCoins INT DEFAULT 0);
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
        status TEXT DEFAULT 'lobby'
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

// ---- Migration: Rename steamRating to previewUrl ----
try {
    db.exec('ALTER TABLE games RENAME COLUMN steamRating TO previewUrl');
    console.log('Migration: steamRating → previewUrl');
} catch (e) { /* bereits migriert oder Spalte existiert nicht */ }

// ---- Migration: live_sessions vor Lobby-System hatten status='running' ab Erstellung ----
// Solche Einträge (running, kein endedAt) sind alte Testdaten → löschen
try {
    const stale = db.prepare("SELECT id FROM live_sessions WHERE status = 'running' AND endedAt IS NULL").all();
    if (stale.length > 0) {
        const del = db.transaction(() => {
            for (const s of stale) {
                db.prepare('DELETE FROM live_session_players WHERE session_id = ?').run(s.id);
                db.prepare('DELETE FROM live_sessions WHERE id = ?').run(s.id);
            }
        });
        del();
        console.log(`Migration: ${stale.length} alte live_sessions (running ohne endedAt) bereinigt`);
    }
} catch (e) { /* Tabelle existiert noch nicht beim ersten Start */ }

// ---- Seed Data (from data.js CONFIG + FALLBACK_GAMES) ----
function seedIfEmpty() {
    const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    if (userCount === 0) {
        console.log('Seeding users...');
        const insertUser = db.prepare('INSERT OR IGNORE INTO users (name, pin, role) VALUES (?, ?, ?)');
        const insertAttendee = db.prepare('INSERT OR IGNORE INTO attendees (player) VALUES (?)');
        const insertCoin = db.prepare('INSERT OR IGNORE INTO coins (player, amount) VALUES (?, 0)');
        const insertStar = db.prepare('INSERT OR IGNORE INTO stars (player, amount) VALUES (?, 0)');

        const users = [
            { name: 'Daniel', pin: '1234', role: 'admin' },
            { name: 'Martin', pin: '1111', role: 'player' },
            { name: 'Kevin', pin: '2222', role: 'player' },
            { name: 'Peter', pin: '3333', role: 'player' },
            { name: 'Julian', pin: '4444', role: 'player' },
            { name: 'Lars', pin: '5555', role: 'player' },
            { name: 'Wolf', pin: '6666', role: 'player' }
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

    const gameCount = db.prepare('SELECT COUNT(*) as c FROM games').get().c;
    if (gameCount === 0) {
        console.log('Seeding games...');
        const insertGame = db.prepare('INSERT OR IGNORE INTO games (name, maxPlayers, genre, lanRating, ready, status, suggestedBy, sessionCoins) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        const insertPlayer = db.prepare('INSERT OR IGNORE INTO game_players (game_id, player) VALUES (?, ?)');

        const FALLBACK_GAMES = [
            { name: "63 Days", maxPlayers: 4, genre: "Strategie, Topdown", lanRating: 0, steamRating: "75%", ready: false, players: {} },
            { name: "8-Bit Armies", maxPlayers: 7, genre: "Strategie", lanRating: 0, steamRating: "78%", ready: false, players: {} },
            { name: "9Bit Armies", maxPlayers: 8, genre: "Strategie", lanRating: 1, steamRating: "80%", ready: true, players: { Daniel: true } },
            { name: "Abiotic Factor", maxPlayers: 6, genre: "Survival, Crafting", lanRating: 0, steamRating: "94%", ready: false, players: {} },
            { name: "Age of Empires IV", maxPlayers: 7, genre: "Strategie", lanRating: 0, steamRating: "84%", ready: false, players: {} },
            { name: "Ale & Tale Tavern", maxPlayers: 4, genre: "Action, Simulation, Indie", lanRating: 0, steamRating: "85%", ready: false, players: {} },
            { name: "Among us", maxPlayers: 7, genre: "Indie", lanRating: 0, steamRating: "91%", ready: false, players: {} },
            { name: "Anno 1800", maxPlayers: 16, genre: "Strategie, Simulation", lanRating: 1, steamRating: "", ready: true, players: { Daniel: true } },
            { name: "AOE 2 Definitive Edition", maxPlayers: 7, genre: "Strategie", lanRating: 0, steamRating: "78%", ready: false, players: {} },
            { name: "Backrooms Escape Together", maxPlayers: 6, genre: "Horror", lanRating: 0, steamRating: "84%", ready: false, players: {} },
            { name: "Backrooms Rec", maxPlayers: 5, genre: "Horror", lanRating: 0, steamRating: "66%", ready: false, players: {} },
            { name: "Baldurs Gate 3", maxPlayers: 4, genre: "Rollenspiel", lanRating: 0, steamRating: "96%", ready: false, players: {} },
            { name: "Barely Racing", maxPlayers: 4, genre: "Sport, Action, Indie", lanRating: 0, steamRating: "76%", ready: false, players: {} },
            { name: "Barotrauma", maxPlayers: 7, genre: "2D Plattformer, Indie", lanRating: 0, steamRating: "92%", ready: false, players: {} },
            { name: "Battlefield V", maxPlayers: 7, genre: "Egoshooter, Taktik", lanRating: 0, steamRating: "70%", ready: false, players: {} },
            { name: "BeamNG.drive", maxPlayers: 2, genre: "Racing", lanRating: 0, steamRating: "96%", ready: false, players: {} },
            { name: "Beyond all reason", maxPlayers: 7, genre: "Strategie", lanRating: 1, steamRating: "", ready: false, players: { Daniel: true } },
            { name: "Blur", maxPlayers: 7, genre: "Racing, Sport, Action", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Broforce", maxPlayers: 4, genre: "2D Plattformer", lanRating: 0, steamRating: "95%", ready: false, players: {} },
            { name: "Bus Simulator 21", maxPlayers: 4, genre: "Simulation", lanRating: 0, steamRating: "68%", ready: false, players: {} },
            { name: "C&C Tiberium Wars", maxPlayers: 7, genre: "Strategie", lanRating: 0, steamRating: "87%", ready: false, players: {} },
            { name: "Call of Duty Warzone", maxPlayers: 7, genre: "Taktik, Egoshooter, Battle Royale", lanRating: 0, steamRating: "32%", ready: false, players: {} },
            { name: "Chained together", maxPlayers: 4, genre: "3D Plattformer", lanRating: 0, steamRating: "89%", ready: false, players: {} },
            { name: "Command & Conquer Remastered Collection", maxPlayers: 8, genre: "Strategie", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Company of Heroes 3", maxPlayers: 7, genre: "Strategie", lanRating: 0, steamRating: "55%", ready: false, players: {} },
            { name: "Crime Boss Rockay City", maxPlayers: 4, genre: "Taktik, Egoshooter", lanRating: 0, steamRating: "70%", ready: false, players: {} },
            { name: "CS 2", maxPlayers: 8, genre: "Egoshooter", lanRating: 1, steamRating: "86%", ready: false, players: { Daniel: true } },
            { name: "Deep Rock Galactic", maxPlayers: 4, genre: "Egoshooter", lanRating: 0, steamRating: "96%", ready: false, players: {} },
            { name: "Diablo 3", maxPlayers: 4, genre: "Rollenspiel, Action", lanRating: 0, steamRating: "93%", ready: false, players: {} },
            { name: "Division 2", maxPlayers: 4, genre: "Taktik, Egoshooter", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Drug Dealer Simulator 2", maxPlayers: 3, genre: "Egoshooter, Simulation", lanRating: 0, steamRating: "70%", ready: false, players: {} },
            { name: "Dungeon Defenders", maxPlayers: 4, genre: "Taktik, Strategie", lanRating: 0, steamRating: "90%", ready: false, players: {} },
            { name: "Dungeon Defenders 2", maxPlayers: 4, genre: "Taktik, Strategie", lanRating: 0, steamRating: "76%", ready: false, players: {} },
            { name: "Dungeon Defenders Going Rogue", maxPlayers: 4, genre: "Strategie, Taktik, Survival", lanRating: 0, steamRating: "46%", ready: false, players: {} },
            { name: "EvilVEvil", maxPlayers: 4, genre: "Action", lanRating: 0, steamRating: "70%", ready: false, players: {} },
            { name: "Factorio", maxPlayers: 7, genre: "Strategie", lanRating: 0, steamRating: "95%", ready: false, players: {} },
            { name: "Fall Guys", maxPlayers: 7, genre: "3D Plattformer", lanRating: 0, steamRating: "80%", ready: false, players: {} },
            { name: "Farming Simulator 25", maxPlayers: 16, genre: "Simulation", lanRating: 0, steamRating: "81%", ready: false, players: {} },
            { name: "Fast Food Simulator", maxPlayers: 4, genre: "Egoshooter, Strategie, Indie", lanRating: 0, steamRating: "91%", ready: false, players: {} },
            { name: "Finnish Cottage Simulator", maxPlayers: 6, genre: "Simulation", lanRating: 0, steamRating: "89%", ready: false, players: {} },
            { name: "Flatout 2", maxPlayers: 8, genre: "Racing", lanRating: 0, steamRating: "93%", ready: false, players: {} },
            { name: "Forza V", maxPlayers: 7, genre: "Racing, Sport", lanRating: 0, steamRating: "87%", ready: false, players: {} },
            { name: "Gang Beasts", maxPlayers: 8, genre: "3D Plattformer, Action", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Generals Zero Hour", maxPlayers: 7, genre: "Strategie", lanRating: 0, steamRating: "86%", ready: false, players: {} },
            { name: "Ghost Recon Wildlands", maxPlayers: 4, genre: "Egoshooter", lanRating: 0, steamRating: "78%", ready: false, players: {} },
            { name: "Ghostbusters Spirits unleashed", maxPlayers: 4, genre: "Egoshooter, Taktik, Action", lanRating: 0, steamRating: "85%", ready: false, players: {} },
            { name: "Goldeneye Source", maxPlayers: 7, genre: "Egoshooter", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Golf with your friends", maxPlayers: 7, genre: "Sport, Indie", lanRating: 0, steamRating: "86%", ready: false, players: {} },
            { name: "GTA 2", maxPlayers: 4, genre: "Topdown, Action", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Heroes of the Storm", maxPlayers: 5, genre: "Strategie, Topdown", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "House Flipper 2", maxPlayers: 4, genre: "Simulation", lanRating: 0, steamRating: "82%", ready: false, players: {} },
            { name: "In Sink: Coop Escape Adventure", maxPlayers: 2, genre: "Adventure", lanRating: 0, steamRating: "84%", ready: false, players: {} },
            { name: "Jedi Knight Acadamy", maxPlayers: 8, genre: "Action, Egoshooter", lanRating: 0, steamRating: "93%", ready: false, players: {} },
            { name: "Make Way", maxPlayers: 4, genre: "Action, Racing, Indie", lanRating: 0, steamRating: "87%", ready: false, players: {} },
            { name: "Mario Kart 8 (Emulator)", maxPlayers: 8, genre: "Racing", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Mario Party (Emulator)", maxPlayers: 4, genre: "Battle Royale", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Marvel vs. Capcom Arcade Classics", maxPlayers: 8, genre: "Action, Beat em Up", lanRating: 0, steamRating: "89%", ready: false, players: {} },
            { name: "Micromachines V4", maxPlayers: 4, genre: "Battle Royale, Racing", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Midnight Club 2", maxPlayers: 8, genre: "Racing", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Modern Warship", maxPlayers: 5, genre: "Strategie, Taktik", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Multiplayer Platform Golf", maxPlayers: 12, genre: "Sport, Indie", lanRating: 0, steamRating: "84%", ready: false, players: {} },
            { name: "Northgard", maxPlayers: 7, genre: "Strategie", lanRating: 0, steamRating: "85%", ready: false, players: {} },
            { name: "OpenRA", maxPlayers: 20, genre: "Strategie", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Operation Flashpoint CWC", maxPlayers: 8, genre: "Taktik, Egoshooter", lanRating: 0, steamRating: "67%", ready: false, players: {} },
            { name: "Overwatch 2", maxPlayers: 5, genre: "Egoshooter, Action", lanRating: 0, steamRating: "22%", ready: false, players: {} },
            { name: "Palworld", maxPlayers: 32, genre: "Adventure, Openworld, Crafting", lanRating: 0, steamRating: "93%", ready: false, players: {} },
            { name: "Path of Exile 2", maxPlayers: 6, genre: "Rollenspiel, Topdown", lanRating: 0, steamRating: "80%", ready: false, players: {} },
            { name: "Pathless Woods", maxPlayers: 4, genre: "Survival, Crafting", lanRating: 0, steamRating: "75%", ready: false, players: {} },
            { name: "Perfect Heist 2", maxPlayers: 12, genre: "Egoshooter, Taktik", lanRating: 0, steamRating: "89%", ready: false, players: {} },
            { name: "PUBG", maxPlayers: 7, genre: "Egoshooter", lanRating: 0, steamRating: "58%", ready: false, players: {} },
            { name: "Raft", maxPlayers: 7, genre: "Survival, Crafting", lanRating: 0, steamRating: "92%", ready: false, players: {} },
            { name: "Ready or not", maxPlayers: 5, genre: "Taktik, Egoshooter", lanRating: 0, steamRating: "87%", ready: false, players: {} },
            { name: "Rocket League", maxPlayers: 4, genre: "Sport, Taktik", lanRating: 1, steamRating: "86%", ready: false, players: { Daniel: true } },
            { name: "S.W.I.N.E. HD Remaster", maxPlayers: 8, genre: "Strategie", lanRating: 0, steamRating: "86%", ready: false, players: {} },
            { name: "Satisfactory", maxPlayers: 4, genre: "Survival, Crafting", lanRating: 0, steamRating: "95%", ready: false, players: {} },
            { name: "Serious Sam 4", maxPlayers: 16, genre: "Egoshooter, Action", lanRating: 0, steamRating: "81%", ready: false, players: {} },
            { name: "Six Days in Fallujah", maxPlayers: 4, genre: "Taktik, Egoshooter", lanRating: 0, steamRating: "81%", ready: false, players: {} },
            { name: "Sons of the Forest", maxPlayers: 7, genre: "Survival", lanRating: 0, steamRating: "86%", ready: false, players: {} },
            { name: "StarCraft 2", maxPlayers: 7, genre: "Strategie", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Survivor World", maxPlayers: 4, genre: "Sport", lanRating: 0, steamRating: "74%", ready: false, players: {} },
            { name: "Swat 4", maxPlayers: 10, genre: "Taktik, Egoshooter", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Tactical Ops", maxPlayers: 7, genre: "Egoshooter, Taktik", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Team Fortress 2", maxPlayers: 7, genre: "Egoshooter, Action", lanRating: 0, steamRating: "88%", ready: false, players: {} },
            { name: "The Forever Winter", maxPlayers: 4, genre: "Action, Egoshooter", lanRating: 0, steamRating: "71%", ready: false, players: {} },
            { name: "Tiny Tinas Wonderland", maxPlayers: 4, genre: "Rollenspiel, Action, Adventure, Egoshooter", lanRating: 0, steamRating: "72%", ready: false, players: {} },
            { name: "Titanfall 2", maxPlayers: 6, genre: "Action", lanRating: 0, steamRating: "94%", ready: false, players: {} },
            { name: "Tobacco Shop Simulator", maxPlayers: 4, genre: "Simulation", lanRating: 0, steamRating: "84%", ready: false, players: {} },
            { name: "Toybox Turbos", maxPlayers: 4, genre: "Racing, Sport, Topdown, Indie", lanRating: 0, steamRating: "81%", ready: false, players: {} },
            { name: "Travellers Rest", maxPlayers: 4, genre: "Simulation, Indie", lanRating: 0, steamRating: "", ready: false, players: {} },
            { name: "Ultimate Chicken Horse", maxPlayers: 4, genre: "Indie, 2D Plattformer", lanRating: 0, steamRating: "94%", ready: false, players: {} },
            { name: "Ultimate Zombie Defense 2", maxPlayers: 4, genre: "Survival, Action", lanRating: 0, steamRating: "71%", ready: false, players: {} },
            { name: "Unreal Tournament 2004", maxPlayers: 7, genre: "Egoshooter, Action", lanRating: 0, steamRating: "92%", ready: false, players: {} },
            { name: "Unreal Tournament 3", maxPlayers: 7, genre: "Egoshooter", lanRating: 0, steamRating: "84%", ready: false, players: {} },
            { name: "UT 99", maxPlayers: 7, genre: "Egoshooter", lanRating: 0, steamRating: "92%", ready: false, players: {} },
            { name: "Wild Woods", maxPlayers: 4, genre: "Topdown, Indie", lanRating: 0, steamRating: "73%", ready: false, players: {} },
            { name: "Worms World Party Remastered", maxPlayers: 4, genre: "Strategie, 2D Plattformer", lanRating: 0, steamRating: "50%", ready: false, players: {} },
            { name: "Wreckfest 2", maxPlayers: 4, genre: "Racing, Action", lanRating: 0, steamRating: "72%", ready: true, players: {} },
            { name: "Zombie Builder Defense 2", maxPlayers: 4, genre: "Topdown, Action, Indie", lanRating: 0, steamRating: "78%", ready: false, players: {} },
            { name: "Zombie Raid", maxPlayers: 4, genre: "", lanRating: 0, steamRating: "", ready: false, players: {} }
        ];

        const seedGames = db.transaction(() => {
            for (const g of FALLBACK_GAMES) {
                const result = insertGame.run(g.name, g.maxPlayers, g.genre, g.lanRating, g.ready ? 1 : 0, 'approved', null, 0);
                const gameId = result.lastInsertRowid;
                for (const [player, val] of Object.entries(g.players || {})) {
                    if (val) insertPlayer.run(gameId, player);
                }
            }
        });
        seedGames();
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
    const users = db.prepare('SELECT name, role FROM users').all();
    const games = getAllGamesWithPlayers();
    const coins = {};
    db.prepare('SELECT player, amount FROM coins').all().forEach(r => { coins[r.player] = r.amount; });
    const stars = {};
    db.prepare('SELECT player, amount FROM stars').all().forEach(r => { stars[r.player] = r.amount; });
    const attendees = db.prepare('SELECT player FROM attendees').all().map(r => r.player);
    const settings = {};
    db.prepare('SELECT key, value FROM settings').all().forEach(r => { settings[r.key] = r.value; });
    const players = users.map(u => u.name);

    res.json({ users, games, coins, stars, attendees, settings, players });
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
    db.prepare('DELETE FROM game_players WHERE game_id = ?').run(game.id);
    db.prepare('DELETE FROM games WHERE id = ?').run(game.id);
    res.json({ success: true });
});

// PUT /api/games/:name
app.put('/api/games/:name', (req, res) => {
    const game = db.prepare('SELECT id FROM games WHERE name = ?').get(req.params.name);
    if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden' });
    const { newName, genre, maxPlayers, previewUrl, sessionCoins } = req.body;
    const updates = [];
    const params = [];
    if (newName !== undefined) { updates.push('name = ?'); params.push(newName); }
    if (genre !== undefined) { updates.push('genre = ?'); params.push(genre); }
    if (maxPlayers !== undefined) { updates.push('maxPlayers = ?'); params.push(maxPlayers); }
    if (previewUrl !== undefined) { updates.push('previewUrl = ?'); params.push(previewUrl); }
    if (sessionCoins !== undefined) { updates.push('sessionCoins = ?'); params.push(sessionCoins); }
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
app.get('/api/genres', (req, res) => {
    const games = db.prepare("SELECT genre FROM games WHERE genre IS NOT NULL AND genre != ''").all();
    const genres = new Set();
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
    db.prepare('INSERT INTO coins (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(player, amount, amount);
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

// GET /api/stars
app.get('/api/stars', (req, res) => {
    const stars = {};
    db.prepare('SELECT player, amount FROM stars').all().forEach(r => { stars[r.player] = r.amount; });
    res.json(stars);
});

// POST /api/stars/add
app.post('/api/stars/add', (req, res) => {
    const { player, amount } = req.body;
    if (!player || !amount) return res.status(400).json({ error: 'player und amount erforderlich' });
    db.prepare('INSERT INTO stars (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(player, amount, amount);
    const row = db.prepare('SELECT amount FROM stars WHERE player = ?').get(player);
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
    const { id, game, isNewGame, leader, message, scheduledDay, scheduledTime } = req.body;
    const proposalId = id || 'p_' + Date.now();
    db.prepare('INSERT INTO proposals (id, game, isNewGame, leader, status, scheduledTime, scheduledDay, message, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(proposalId, game, isNewGame ? 1 : 0, leader, 'pending', scheduledTime || '', scheduledDay || '', message || '', Date.now());
    db.prepare('INSERT INTO proposal_players (proposal_id, player) VALUES (?, ?)').run(proposalId, leader);
    res.json({ success: true, id: proposalId });
});

// PUT /api/proposals/:id
app.put('/api/proposals/:id', (req, res) => {
    const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Proposal nicht gefunden' });
    const updates = [];
    const params = [];
    for (const [key, value] of Object.entries(req.body)) {
        if (['status', 'scheduledTime', 'scheduledDay', 'message', 'approvedAt', 'startedAt', 'completedAt', 'pendingCoins', 'coinsApproved'].includes(key)) {
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
    db.prepare('DELETE FROM proposal_players WHERE proposal_id = ?').run(req.params.id);
    db.prepare('DELETE FROM proposals WHERE id = ?').run(req.params.id);
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

// GET /api/attendees
app.get('/api/attendees', (req, res) => {
    const attendees = db.prepare('SELECT player FROM attendees').all().map(r => r.player);
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
    const users = db.prepare('SELECT name, role FROM users').all();
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
    res.json({ success: true });
});

// PUT /api/users/:name/ip
app.put('/api/users/:name/ip', (req, res) => {
    const { ip } = req.body;
    if (ip === undefined) return res.status(400).json({ error: 'ip erforderlich' });
    db.prepare('UPDATE users SET ip = ? WHERE name = ?').run(ip, req.params.name);
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
    db.exec(`
        DELETE FROM users; DELETE FROM games; DELETE FROM game_players;
        DELETE FROM coins; DELETE FROM stars; DELETE FROM history; DELETE FROM sessions;
        DELETE FROM tokens; DELETE FROM genres_played; DELETE FROM proposals;
        DELETE FROM proposal_players; DELETE FROM attendees; DELETE FROM settings;
        DELETE FROM challenges;
    `);
    seedIfEmpty();
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

    db.prepare('UPDATE challenges SET status = ? WHERE id = ?').run('accepted', req.params.id);
    res.json({ success: true });
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
        // Coins: Loser pays, Winner receives double
        if (c.stakeCoins > 0) {
            db.prepare('UPDATE coins SET amount = amount - ? WHERE player = ?').run(c.stakeCoins, loser);
            db.prepare('UPDATE coins SET amount = amount + ? WHERE player = ?').run(c.stakeCoins * 2, c.winner);
            db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(loser, -c.stakeCoins, `Duell verloren vs ${c.winner} (${c.game})`, now);
            db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(c.winner, c.stakeCoins * 2, `Duell gewonnen vs ${loser} (${c.game})`, now);
        }
        // Stars: same logic
        if (c.stakeStars > 0) {
            db.prepare('UPDATE stars SET amount = amount - ? WHERE player = ?').run(c.stakeStars, loser);
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
    const { game, leader } = req.body;
    if (!game || !leader) return res.status(400).json({ error: 'game und leader erforderlich' });
    const activeGame = getActiveSessionForPlayer(leader);
    if (activeGame) return res.status(400).json({ error: `Du bist bereits in einer laufenden Session: ${activeGame}` });
    const id = 'ls_' + Date.now();
    db.prepare("INSERT INTO live_sessions (id, game, leader, status) VALUES (?, ?, ?, 'lobby')").run(id, game, leader);
    db.prepare('INSERT INTO live_session_players (session_id, player, joinedAt) VALUES (?, ?, ?)').run(id, leader, Date.now());
    res.json({ id });
});

// PUT /api/live-sessions/:id/start — Session starten (lobby → running)
app.put('/api/live-sessions/:id/start', (req, res) => {
    const session = db.prepare('SELECT status FROM live_sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (session.status !== 'lobby') return res.status(400).json({ error: 'Session nicht im Lobby-Status' });
    db.prepare("UPDATE live_sessions SET status = 'running', startedAt = ? WHERE id = ?").run(Date.now(), req.params.id);
    res.json({ success: true });
});

// POST /api/live-sessions/:id/join — nur im lobby-Status möglich
app.post('/api/live-sessions/:id/join', (req, res) => {
    const { player } = req.body;
    const session = db.prepare('SELECT status, game FROM live_sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (session.status !== 'lobby') return res.status(400).json({ error: 'Session läuft bereits, kein Beitritt möglich' });
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
    db.prepare("UPDATE live_sessions SET status = 'ended', endedAt = ? WHERE id = ?").run(Date.now(), req.params.id);
    res.json({ success: true });
});

// POST /api/live-sessions/:id/approve
app.post('/api/live-sessions/:id/approve', (req, res) => {
    const { coinsPerPlayer } = req.body;
    const session = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    const players = db.prepare('SELECT player FROM live_session_players WHERE session_id = ?').all(req.params.id).map(r => r.player);
    const now = Date.now();
    const approve = db.transaction(() => {
        for (const player of players) {
            db.prepare('INSERT INTO coins (player, amount) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET amount = amount + ?').run(player, coinsPerPlayer, coinsPerPlayer);
            db.prepare('INSERT INTO history (player, amount, reason, timestamp) VALUES (?, ?, ?, ?)').run(player, coinsPerPlayer, `Session: ${session.game} (${players.length} Spieler)`, now);
        }
        db.prepare('INSERT INTO sessions (game, players, coinsPerPlayer, timestamp) VALUES (?, ?, ?, ?)').run(session.game, JSON.stringify(players), coinsPerPlayer, now);
        db.prepare('DELETE FROM live_session_players WHERE session_id = ?').run(req.params.id);
        db.prepare('DELETE FROM live_sessions WHERE id = ?').run(req.params.id);
    });
    approve();
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
