// ============================================================
// Gameparty - Konfiguration (Seed-Daten im Server)
// ============================================================

const CONFIG = {
    PLAYERS: ['Martin', 'Daniel', 'Kevin', 'Peter', 'Julian', 'Lars', 'Wolf'],
    USERS: [
        { name: 'Daniel',  pin: '1234', role: 'admin' },
        { name: 'Martin',  pin: '1111', role: 'player' },
        { name: 'Kevin',   pin: '2222', role: 'player' },
        { name: 'Peter',   pin: '3333', role: 'player' },
        { name: 'Julian',  pin: '4444', role: 'player' },
        { name: 'Lars',    pin: '5555', role: 'player' },
        { name: 'Wolf',    pin: '6666', role: 'player' }
    ],
    MIN_MATCH: 1,
    COIN_REWARDS: {
        SESSION_BASE: 1,        // Teilnahme an Session (mind. 3 Spieler)
        SESSION_FOUR_PLUS: 2,   // Session mit 4+ Spielern
        SESSION_ALL: 3,         // Session mit ALLEN anwesenden Spielern
        NEW_GENRE: 1            // Neues Genre ausprobiert
    },
    STAR_PRICE: 20,  // Coins, die ein Stern kostet
    SHOP_ITEMS: [
        {
            id: 'choose_next',
            name: 'Naechstes Spiel bestimmen',
            cost: 3,
            icon: '🎮',
            description: 'Du bestimmst, welches Spiel als naechstes gespielt wird.'
        },
        {
            id: 'force_play',
            name: 'Zwangsspielen',
            cost: 5,
            icon: '⛓️',
            description: 'Zwinge EINEN Mitspieler, bei einem Spiel deiner Wahl mitzumachen.',
            isPenalty: true
        },
        {
            id: 'skip_token',
            name: 'Skip-Token',
            cost: 2,
            icon: '⏭️',
            description: 'Ueberspringe ein Spiel, das du nicht spielen willst.'
        },
        {
            id: 'drink_order',
            name: 'Trink-Befehl',
            cost: 3,
            icon: '🍺',
            description: 'Befiehl einer Person sofort zu trinken — was auch immer gerade vor ihr steht.',
            isPenalty: true
        }
    ]
};

// Add star shop item
CONFIG.SHOP_ITEMS.unshift({
    id: 'buy_star',
    name: 'Controller-Punkt 🎮',
    cost: CONFIG.STAR_PRICE,
    icon: '🎮',
    description: `Kaufe einen Controller-Punkt für ${CONFIG.STAR_PRICE} Coins. Das sind dauerhafte Siegpunkte!`
});

// Fallback-Spieleliste (aus Google Sheet exportiert)
const FALLBACK_GAMES = [
    { name: "63 Days", maxPlayers: 4, genre: "Strategie, Topdown", lanRating: 0, ready: false, players: {} },
    { name: "8-Bit Armies", maxPlayers: 7, genre: "Strategie", lanRating: 0, ready: false, players: {} },
    { name: "9Bit Armies", maxPlayers: 8, genre: "Strategie", lanRating: 1, ready: true, players: { Daniel: true } },
    { name: "Abiotic Factor", maxPlayers: 6, genre: "Survival, Crafting", lanRating: 0, ready: false, players: {} },
    { name: "Age of Empires IV", maxPlayers: 7, genre: "Strategie", lanRating: 0, ready: false, players: {} },
    { name: "Ale & Tale Tavern", maxPlayers: 4, genre: "Action, Simulation, Indie", lanRating: 0, ready: false, players: {} },
    { name: "Among us", maxPlayers: 7, genre: "Indie", lanRating: 0, ready: false, players: {} },
    { name: "Anno 1800", maxPlayers: 16, genre: "Strategie, Simulation", lanRating: 1, ready: true, players: { Daniel: true } },
    { name: "AOE 2 Definitive Edition", maxPlayers: 7, genre: "Strategie", lanRating: 0, ready: false, players: {} },
    { name: "Backrooms Escape Together", maxPlayers: 6, genre: "Horror", lanRating: 0, ready: false, players: {} },
    { name: "Backrooms Rec", maxPlayers: 5, genre: "Horror", lanRating: 0, ready: false, players: {} },
    { name: "Baldurs Gate 3", maxPlayers: 4, genre: "Rollenspiel", lanRating: 0, ready: false, players: {} },
    { name: "Barely Racing", maxPlayers: 4, genre: "Sport, Action, Indie", lanRating: 0, ready: false, players: {} },
    { name: "Barotrauma", maxPlayers: 7, genre: "2D Plattformer, Indie", lanRating: 0, ready: false, players: {} },
    { name: "Battlefield V", maxPlayers: 7, genre: "Egoshooter, Taktik", lanRating: 0, ready: false, players: {} },
    { name: "BeamNG.drive", maxPlayers: 2, genre: "Racing", lanRating: 0, ready: false, players: {} },
    { name: "Beyond all reason", maxPlayers: 7, genre: "Strategie", lanRating: 1, ready: false, players: { Daniel: true } },
    { name: "Blur", maxPlayers: 7, genre: "Racing, Sport, Action", lanRating: 0, ready: false, players: {} },
    { name: "Broforce", maxPlayers: 4, genre: "2D Plattformer", lanRating: 0, ready: false, players: {} },
    { name: "Bus Simulator 21", maxPlayers: 4, genre: "Simulation", lanRating: 0, ready: false, players: {} },
    { name: "C&C Tiberium Wars", maxPlayers: 7, genre: "Strategie", lanRating: 0, ready: false, players: {} },
    { name: "Call of Duty Warzone", maxPlayers: 7, genre: "Taktik, Egoshooter, Battle Royale", lanRating: 0, ready: false, players: {} },
    { name: "Chained together", maxPlayers: 4, genre: "3D Plattformer", lanRating: 0, ready: false, players: {} },
    { name: "Command & Conquer Remastered Collection", maxPlayers: 8, genre: "Strategie", lanRating: 0, ready: false, players: {} },
    { name: "Company of Heroes 3", maxPlayers: 7, genre: "Strategie", lanRating: 0, ready: false, players: {} },
    { name: "Crime Boss Rockay City", maxPlayers: 4, genre: "Taktik, Egoshooter", lanRating: 0, ready: false, players: {} },
    { name: "CS 2", maxPlayers: 8, genre: "Egoshooter", lanRating: 1, ready: false, players: { Daniel: true } },
    { name: "Deep Rock Galactic", maxPlayers: 4, genre: "Egoshooter", lanRating: 0, ready: false, players: {} },
    { name: "Diablo 3", maxPlayers: 4, genre: "Rollenspiel, Action", lanRating: 0, ready: false, players: {} },
    { name: "Division 2", maxPlayers: 4, genre: "Taktik, Egoshooter", lanRating: 0, ready: false, players: {} },
    { name: "Drug Dealer Simulator 2", maxPlayers: 3, genre: "Egoshooter, Simulation", lanRating: 0, ready: false, players: {} },
    { name: "Dungeon Defenders", maxPlayers: 4, genre: "Taktik, Strategie", lanRating: 0, ready: false, players: {} },
    { name: "Dungeon Defenders 2", maxPlayers: 4, genre: "Taktik, Strategie", lanRating: 0, ready: false, players: {} },
    { name: "Dungeon Defenders Going Rogue", maxPlayers: 4, genre: "Strategie, Taktik, Survival", lanRating: 0, ready: false, players: {} },
    { name: "EvilVEvil", maxPlayers: 4, genre: "Action", lanRating: 0, ready: false, players: {} },
    { name: "Factorio", maxPlayers: 7, genre: "Strategie", lanRating: 0, ready: false, players: {} },
    { name: "Fall Guys", maxPlayers: 7, genre: "3D Plattformer", lanRating: 0, ready: false, players: {} },
    { name: "Farming Simulator 25", maxPlayers: 16, genre: "Simulation", lanRating: 0, ready: false, players: {} },
    { name: "Fast Food Simulator", maxPlayers: 4, genre: "Egoshooter, Strategie, Indie", lanRating: 0, ready: false, players: {} },
    { name: "Finnish Cottage Simulator", maxPlayers: 6, genre: "Simulation", lanRating: 0, ready: false, players: {} },
    { name: "Flatout 2", maxPlayers: 8, genre: "Racing", lanRating: 0, ready: false, players: {} },
    { name: "Forza V", maxPlayers: 7, genre: "Racing, Sport", lanRating: 0, ready: false, players: {} },
    { name: "Gang Beasts", maxPlayers: 8, genre: "3D Plattformer, Action", lanRating: 0, ready: false, players: {} },
    { name: "Generals Zero Hour", maxPlayers: 7, genre: "Strategie", lanRating: 0, ready: false, players: {} },
    { name: "Ghost Recon Wildlands", maxPlayers: 4, genre: "Egoshooter", lanRating: 0, ready: false, players: {} },
    { name: "Ghostbusters Spirits unleashed", maxPlayers: 4, genre: "Egoshooter, Taktik, Action", lanRating: 0, ready: false, players: {} },
    { name: "Goldeneye Source", maxPlayers: 7, genre: "Egoshooter", lanRating: 0, ready: false, players: {} },
    { name: "Golf with your friends", maxPlayers: 7, genre: "Sport, Indie", lanRating: 0, ready: false, players: {} },
    { name: "GTA 2", maxPlayers: 4, genre: "Topdown, Action", lanRating: 0, ready: false, players: {} },
    { name: "Heroes of the Storm", maxPlayers: 5, genre: "Strategie, Topdown", lanRating: 0, ready: false, players: {} },
    { name: "House Flipper 2", maxPlayers: 4, genre: "Simulation", lanRating: 0, ready: false, players: {} },
    { name: "In Sink: Coop Escape Adventure", maxPlayers: 2, genre: "Adventure", lanRating: 0, ready: false, players: {} },
    { name: "Jedi Knight Acadamy", maxPlayers: 8, genre: "Action, Egoshooter", lanRating: 0, ready: false, players: {} },
    { name: "Make Way", maxPlayers: 4, genre: "Action, Racing, Indie", lanRating: 0, ready: false, players: {} },
    { name: "Mario Kart 8 (Emulator)", maxPlayers: 8, genre: "Racing", lanRating: 0, ready: false, players: {} },
    { name: "Mario Party (Emulator)", maxPlayers: 4, genre: "Battle Royale", lanRating: 0, ready: false, players: {} },
    { name: "Marvel vs. Capcom Arcade Classics", maxPlayers: 8, genre: "Action, Beat em Up", lanRating: 0, ready: false, players: {} },
    { name: "Micromachines V4", maxPlayers: 4, genre: "Battle Royale, Racing", lanRating: 0, ready: false, players: {} },
    { name: "Midnight Club 2", maxPlayers: 8, genre: "Racing", lanRating: 0, ready: false, players: {} },
    { name: "Modern Warship", maxPlayers: 5, genre: "Strategie, Taktik", lanRating: 0, ready: false, players: {} },
    { name: "Multiplayer Platform Golf", maxPlayers: 12, genre: "Sport, Indie", lanRating: 0, ready: false, players: {} },
    { name: "Northgard", maxPlayers: 7, genre: "Strategie", lanRating: 0, ready: false, players: {} },
    { name: "OpenRA", maxPlayers: 20, genre: "Strategie", lanRating: 0, ready: false, players: {} },
    { name: "Operation Flashpoint CWC", maxPlayers: 8, genre: "Taktik, Egoshooter", lanRating: 0, ready: false, players: {} },
    { name: "Overwatch 2", maxPlayers: 5, genre: "Egoshooter, Action", lanRating: 0, ready: false, players: {} },
    { name: "Palworld", maxPlayers: 32, genre: "Adventure, Openworld, Crafting", lanRating: 0, ready: false, players: {} },
    { name: "Path of Exile 2", maxPlayers: 6, genre: "Rollenspiel, Topdown", lanRating: 0, ready: false, players: {} },
    { name: "Pathless Woods", maxPlayers: 4, genre: "Survival, Crafting", lanRating: 0, ready: false, players: {} },
    { name: "Perfect Heist 2", maxPlayers: 12, genre: "Egoshooter, Taktik", lanRating: 0, ready: false, players: {} },
    { name: "PUBG", maxPlayers: 7, genre: "Egoshooter", lanRating: 0, ready: false, players: {} },
    { name: "Raft", maxPlayers: 7, genre: "Survival, Crafting", lanRating: 0, ready: false, players: {} },
    { name: "Ready or not", maxPlayers: 5, genre: "Taktik, Egoshooter", lanRating: 0, ready: false, players: {} },
    { name: "Rocket League", maxPlayers: 4, genre: "Sport, Taktik", lanRating: 1, ready: false, players: { Daniel: true } },
    { name: "S.W.I.N.E. HD Remaster", maxPlayers: 8, genre: "Strategie", lanRating: 0, ready: false, players: {} },
    { name: "Satisfactory", maxPlayers: 4, genre: "Survival, Crafting", lanRating: 0, ready: false, players: {} },
    { name: "Serious Sam 4", maxPlayers: 16, genre: "Egoshooter, Action", lanRating: 0, ready: false, players: {} },
    { name: "Six Days in Fallujah", maxPlayers: 4, genre: "Taktik, Egoshooter", lanRating: 0, ready: false, players: {} },
    { name: "Sons of the Forest", maxPlayers: 7, genre: "Survival", lanRating: 0, ready: false, players: {} },
    { name: "StarCraft 2", maxPlayers: 7, genre: "Strategie", lanRating: 0, ready: false, players: {} },
    { name: "Survivor World", maxPlayers: 4, genre: "Sport", lanRating: 0, ready: false, players: {} },
    { name: "Swat 4", maxPlayers: 10, genre: "Taktik, Egoshooter", lanRating: 0, ready: false, players: {} },
    { name: "Tactical Ops", maxPlayers: 7, genre: "Egoshooter, Taktik", lanRating: 0, ready: false, players: {} },
    { name: "Team Fortress 2", maxPlayers: 7, genre: "Egoshooter, Action", lanRating: 0, ready: false, players: {} },
    { name: "The Forever Winter", maxPlayers: 4, genre: "Action, Egoshooter", lanRating: 0, ready: false, players: {} },
    { name: "Tiny Tinas Wonderland", maxPlayers: 4, genre: "Rollenspiel, Action, Adventure, Egoshooter", lanRating: 0, ready: false, players: {} },
    { name: "Titanfall 2", maxPlayers: 6, genre: "Action", lanRating: 0, ready: false, players: {} },
    { name: "Tobacco Shop Simulator", maxPlayers: 4, genre: "Simulation", lanRating: 0, ready: false, players: {} },
    { name: "Toybox Turbos", maxPlayers: 4, genre: "Racing, Sport, Topdown, Indie", lanRating: 0, ready: false, players: {} },
    { name: "Travellers Rest", maxPlayers: 4, genre: "Simulation, Indie", lanRating: 0, ready: false, players: {} },
    { name: "Ultimate Chicken Horse", maxPlayers: 4, genre: "Indie, 2D Plattformer", lanRating: 0, ready: false, players: {} },
    { name: "Ultimate Zombie Defense 2", maxPlayers: 4, genre: "Survival, Action", lanRating: 0, ready: false, players: {} },
    { name: "Unreal Tournament 2004", maxPlayers: 7, genre: "Egoshooter, Action", lanRating: 0, ready: false, players: {} },
    { name: "Unreal Tournament 3", maxPlayers: 7, genre: "Egoshooter", lanRating: 0, ready: false, players: {} },
    { name: "UT 99", maxPlayers: 7, genre: "Egoshooter", lanRating: 0, ready: false, players: {} },
    { name: "Wild Woods", maxPlayers: 4, genre: "Topdown, Indie", lanRating: 0, ready: false, players: {} },
    { name: "Worms World Party Remastered", maxPlayers: 4, genre: "Strategie, 2D Plattformer", lanRating: 0, ready: false, players: {} },
    { name: "Wreckfest 2", maxPlayers: 4, genre: "Racing, Action", lanRating: 0, ready: true, players: {} },
    { name: "Zombie Builder Defense 2", maxPlayers: 4, genre: "Topdown, Action, Indie", lanRating: 0, ready: false, players: {} },
    { name: "Zombie Raid", maxPlayers: 4, genre: "", lanRating: 0, ready: false, players: {} }
];
