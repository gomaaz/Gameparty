// ============================================================
// Gameparty - Main Application Logic (API-backed)
// ============================================================

(function () {
    'use strict';

    // ---- State ----
    const state = {
        currentPlayer: null,
        role: null,
        games: [],
        attendees: [],
        players: [],
        coins: {},
        stars: {},
        soundEnabled: false
    };

    // ---- Bulk Select State ----
    const selectedGames = new Set();

    let challengePollInterval = null;
    let viewRefreshInterval = null;
    let sseSource = null;
    const notifiedChallengeIds = new Set();
    const pendingNotifications = []; // { id, challenger, game, stakeStr }
    let notifPanelOpen = false;
    let focusChallengeId = null;

    // ---- Session Storage (only auth + sound stay in localStorage) ----
    const LOCAL_KEYS = {
        PLAYER: 'gameparty_player',
        ROLE: 'gameparty_role',
        SOUND: 'gameparty_sound',
        VIEW: 'gameparty_view'
    };

    function getNotifPref(type) {
        if (!state.currentPlayer) return false;
        return localStorage.getItem(`gameparty_notif_${type}_${state.currentPlayer}`) === 'true';
    }
    function setNotifPref(type, value) {
        localStorage.setItem(`gameparty_notif_${type}_${state.currentPlayer}`, value ? 'true' : 'false');
    }

    // ---- API Helper ----
    async function api(method, path, body) {
        const opts = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch('/api' + path, opts);
        if (!res.ok) {
            try {
                const json = await res.json();
                throw new Error(json.error || res.statusText);
            } catch (e) {
                if (e instanceof SyntaxError) throw new Error(res.statusText);
                throw e;
            }
        }
        return res.json();
    }

    // ---- Sound ----
    function playSound(type) {
        if (!state.soundEnabled) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === 'coin') {
                osc.frequency.value = 880;
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.15, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.3);

                const osc2 = ctx.createOscillator();
                const gain2 = ctx.createGain();
                osc2.connect(gain2);
                gain2.connect(ctx.destination);
                osc2.frequency.value = 1320;
                osc2.type = 'sine';
                gain2.gain.setValueAtTime(0.15, ctx.currentTime + 0.1);
                gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
                osc2.start(ctx.currentTime + 0.1);
                osc2.stop(ctx.currentTime + 0.5);
            } else if (type === 'spend') {
                osc.frequency.value = 440;
                osc.type = 'triangle';
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.2);
            } else if (type === 'error') {
                osc.frequency.value = 200;
                osc.type = 'square';
                gain.gain.setValueAtTime(0.08, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.15);
            } else if (type === 'challenge') {
                osc.frequency.value = 660; osc.type = 'sawtooth';
                gain.gain.setValueAtTime(0.12, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
                osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
                const osc2 = ctx.createOscillator(); const gain2 = ctx.createGain();
                osc2.connect(gain2); gain2.connect(ctx.destination);
                osc2.frequency.value = 440; osc2.type = 'sawtooth';
                gain2.gain.setValueAtTime(0.12, ctx.currentTime + 0.2);
                gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
                osc2.start(ctx.currentTime + 0.2); osc2.stop(ctx.currentTime + 0.6);
            }
        } catch (e) {
            // Audio not available
        }
    }

    // ---- UI Helpers ----
    function $(sel) { return document.querySelector(sel); }
    function $$(sel) { return document.querySelectorAll(sel); }

    function showToast(message, type) {
        const container = $('.toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type || 'success'}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'toastOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function showCoinAnimation(amount) {
        const popup = document.createElement('div');
        popup.className = 'coin-popup';
        popup.textContent = `+${amount} Coins`;
        document.body.appendChild(popup);

        for (let i = 0; i < 6; i++) {
            const p = document.createElement('div');
            p.className = 'coin-particle';
            p.textContent = '\u26AA';
            p.style.left = (50 + (Math.random() - 0.5) * 30) + '%';
            p.style.top = (50 + (Math.random() - 0.5) * 20) + '%';
            p.style.animationDelay = (Math.random() * 0.3) + 's';
            document.body.appendChild(p);
            setTimeout(() => p.remove(), 1500);
        }

        playSound('coin');
        setTimeout(() => popup.remove(), 1500);
    }

    function formatTime(timestamp) {
        const d = new Date(timestamp);
        const pad = n => n.toString().padStart(2, '0');
        return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function formatTimeShort(timestamp) {
        const d = new Date(timestamp);
        const pad = n => n.toString().padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function formatDuration(ms) {
        const m = Math.floor(ms / 60000);
        if (m < 60) return `${m} Min.`;
        return `${Math.floor(m / 60)}h ${m % 60}m`;
    }

    function formatScheduleDate(dateStr) {
        if (!dateStr) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            const [y, m, d] = dateStr.split('-');
            return `${d}.${m}.${y}`;
        }
        return dateStr; // Fallback für alte "Freitag"-Einträge
    }

    // ---- Game Logic (local computations on cached state) ----
    function getMatchCount(game) {
        let count = 0;
        state.attendees.forEach(p => {
            if (game.players && game.players[p]) count++;
        });
        return count;
    }

    function getMatchingPlayers(game) {
        return state.attendees.filter(p => game.players && game.players[p]);
    }

    function getAllGenres() {
        const genres = new Set();
        state.games.forEach(g => {
            if (g.genre) {
                g.genre.split(',').forEach(genre => {
                    const trimmed = genre.trim();
                    if (trimmed) genres.add(trimmed);
                });
            }
        });
        return [...genres].sort();
    }

    function getTopMatchGame() {
        let best = null;
        let bestCount = 0;
        state.games.forEach(g => {
            if (g.status === 'suggested') return;
            const count = getMatchCount(g);
            if (count >= CONFIG.MIN_MATCH && count > bestCount) {
                bestCount = count;
                best = g;
            }
        });
        return best;
    }

    function calculateSessionCoins(playerCount, totalAttendees) {
        if (playerCount >= totalAttendees && totalAttendees >= 3) return CONFIG.COIN_REWARDS.SESSION_ALL;
        if (playerCount >= 4) return CONFIG.COIN_REWARDS.SESSION_FOUR_PLUS;
        if (playerCount >= 3) return CONFIG.COIN_REWARDS.SESSION_BASE;
        return 0;
    }

    function getPlayerCoins(player) {
        return state.coins[player] || 0;
    }

    function getPlayerStars(player) {
        return state.stars[player] || 0;
    }

    // ---- Navigation ----
    function navigateTo(viewId) {
        $$('.view').forEach(v => v.classList.remove('active'));
        $$('.nav-item').forEach(n => n.classList.remove('active'));

        const view = $(`#view-${viewId}`);
        const nav = $(`.nav-item[data-view="${viewId}"]`);

        if (view) view.classList.add('active');
        if (nav) nav.classList.add('active');

        localStorage.setItem(LOCAL_KEYS.VIEW, viewId);

        switch (viewId) {
            case 'dashboard': renderDashboard(); break;
            case 'matcher': renderMatcher(); break;
            case 'profile': renderProfile(); break;
            case 'session': renderSession(); break;
            case 'shop': renderShop(); break;
            case 'challenges': renderChallenges(); break;
        }
    }

    // ---- Auth Helpers ----
    function isAdmin() {
        return state.role === 'admin';
    }

    function updateNavVisibility() {
        document.querySelectorAll('.nav-item[data-admin="true"]').forEach(nav => {
            nav.style.display = isAdmin() ? '' : 'none';
        });
    }

    // ---- Render: Dashboard ----
    async function renderDashboard() {
        const container = $('#view-dashboard');

        try {
            const [coinsData, starsData, sessionsData, proposalsData, liveSessionsData] = await Promise.all([
                api('GET', '/coins'),
                api('GET', '/stars'),
                api('GET', '/sessions'),
                api('GET', '/proposals'),
                api('GET', '/live-sessions')
            ]);
            state.coins = coinsData;
            state.stars = starsData;
            const sessions = sessionsData;
            const allProposals = proposalsData;

            const topGame = getTopMatchGame();

            // Leaderboard - sort by stars first, then by coins
            const leaderboard = state.players
                .map(p => ({ name: p, coins: coinsData[p] || 0, stars: starsData[p] || 0 }))
                .sort((a, b) => b.stars - a.stars || b.coins - a.coins);

            let leaderboardHTML = '';
            leaderboard.forEach((p, i) => {
                const isCurrent = p.name === state.currentPlayer;
                const starsHTML = p.stars > 0
                    ? `<span class="leaderboard-stars">${'🎮'.repeat(Math.min(p.stars, 5))}${p.stars > 5 ? ` x${p.stars}` : ''}</span>`
                    : '';
                leaderboardHTML += `
                    <div class="leaderboard-item ${isCurrent ? 'current-player' : ''}">
                        <div class="leaderboard-rank">#${i + 1}</div>
                        <div class="leaderboard-name">${p.name}${starsHTML ? '<br>' + starsHTML : ''}</div>
                        <div class="leaderboard-coins">
                            <span>${p.coins}</span>
                            <span style="font-size:0.9em">Coins</span>
                        </div>
                    </div>`;
            });

            // Next game suggestion
            let nextGameHTML = '';
            if (topGame) {
                const matchPlayers = getMatchingPlayers(topGame);
                nextGameHTML = `
                    <div class="card next-game-card">
                        <div class="card-title">Naechstes Spiel - Empfehlung</div>
                        <div class="match-count">${matchPlayers.length}</div>
                        <div class="next-game-name">${topGame.name}</div>
                        <div class="match-players-list">
                            ${matchPlayers.map(p => `<span class="player-chip">${p}</span>`).join('')}
                        </div>
                        <div class="next-game-info">
                            <div class="info-tag">${topGame.genre || '?'}</div>
                            <div class="info-tag">Max ${topGame.maxPlayers} Spieler</div>
                        </div>
                    </div>`;
            } else {
                nextGameHTML = `
                    <div class="card next-game-card">
                        <div class="card-title">Naechstes Spiel - Empfehlung</div>
                        <div class="empty-state">
                            <div class="empty-state-icon">🎮</div>
                            <div class="empty-state-text">Noch keine Spiele mit ${CONFIG.MIN_MATCH}+ Uebereinstimmungen.<br>Tragt euch in der Spieleliste ein!</div>
                        </div>
                    </div>`;
            }

            // Geplante Sessions (pending + approved) und aktive Proposals (active)
            const activeProposals = allProposals.filter(p => p.status === 'active');
            const plannedProposals = allProposals.filter(p => ['pending', 'approved'].includes(p.status));
            const plannedSessionsHTML = plannedProposals.map(renderProposalCard).join('') ||
                `<div class="empty-state-text" style="padding:0.5rem 0;font-size:0.85rem;color:var(--text-secondary)">Keine geplanten Sessions</div>`;

            // Recent sessions
            const recentSessions = sessions.slice(0, 5);
            let sessionsHTML = '';
            if (recentSessions.length > 0) {
                sessionsHTML = `
                    <div class="card">
                        <div class="card-title">Letzte Sessions</div>
                        <div style="display:flex;flex-direction:column;gap:0.4rem">
                            ${recentSessions.map(s => `
                                <div class="session-history-item">
                                    <div class="session-history-header">
                                        <span class="session-history-game">${s.game}</span>
                                        <span class="session-history-time">${formatTime(s.timestamp)}</span>
                                    </div>
                                    <div class="session-history-players">
                                        ${s.players.map(p => `<span class="player-chip">${p}</span>`).join('')}
                                    </div>
                                    <div class="session-history-coins">${s.coinsPerPlayer} Coins pro Spieler</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>`;
            }

            let liveSessionsHTML = '';
            if (liveSessionsData.length > 0) {
                liveSessionsHTML = liveSessionsData.map(s => {
                    const isLeader = s.leader === state.currentPlayer;
                    const isInSession = s.players.includes(state.currentPlayer);
                    const duration = s.startedAt ? formatDuration(Date.now() - s.startedAt) : '';
                    const playersHTML = s.players.map(p =>
                        `<span class="player-chip">${p}${p === s.leader ? '<span class="session-leader-badge">GL</span>' : ''}</span>`
                    ).join('');

                    let statusBadge = '';
                    let actionsHTML = '';

                    if (s.status === 'lobby') {
                        statusBadge = `<span style="color:#6699ff;font-size:0.8rem">🚪 Wartezimmer</span>`;
                        if (!isInSession) {
                            actionsHTML += `<button class="btn-session-join" data-sid="${s.id}" data-action="join">+ Beitreten</button>`;
                        } else if (!isLeader) {
                            actionsHTML += `<button class="btn-session-leave" data-sid="${s.id}" data-action="leave">Verlassen</button>`;
                        }
                        if (isLeader || isAdmin()) {
                            actionsHTML += `<button class="btn-session-start" data-sid="${s.id}" data-action="start">▶ Session starten</button>`;
                            actionsHTML += `<button class="btn-session-end" data-sid="${s.id}" data-action="cancel" style="font-size:0.75rem;opacity:0.6">Abbrechen</button>`;
                        }
                    } else if (s.status === 'running') {
                        statusBadge = `<span style="color:var(--accent-green);font-size:0.8rem">● läuft${duration ? ` · ${duration}` : ''}</span>`;
                        if (isLeader || isAdmin()) {
                            actionsHTML += `<button class="btn-session-end" data-sid="${s.id}" data-action="end">Beenden</button>`;
                        }
                    } else if (s.status === 'ended') {
                        statusBadge = `<span class="pending-approval-badge">⏳ Wartet auf Admin-Freigabe</span>`;
                    }

                    return `
                        <div class="card live-session-card ${s.status}">
                            <div class="live-session-header">
                                <span class="live-session-game">${s.game}</span>
                                ${statusBadge}
                            </div>
                            <div class="live-session-meta">Gruppenleiter: ${s.leader}</div>
                            <div>${playersHTML}</div>
                            ${actionsHTML ? `<div class="live-session-actions">${actionsHTML}</div>` : ''}
                        </div>`;
                }).join('');
            }

            const activeProposalsHTML = activeProposals.map(renderProposalCard).join('');
            const hasAnything = liveSessionsData.length > 0 || activeProposals.length > 0;

            container.innerHTML = `
                <div class="card" id="live-sessions-container">
                    <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
                        Laufende Sessions
                        ${state.currentPlayer ? `<button class="btn-session-join" id="btn-start-session">+ Raum erstellen</button>` : ''}
                    </div>
                    ${hasAnything
                        ? liveSessionsHTML + activeProposalsHTML
                        : `<div class="empty-state-text" style="padding:0.5rem 0;font-size:0.85rem;color:var(--text-secondary)">Keine aktiven Sessions</div>`}
                </div>
                <div class="card" id="planned-sessions-container">
                    <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
                        Geplante Sessions
                        ${state.currentPlayer ? `<button class="btn-session-join" id="btn-plan-session">+ Planen</button>` : ''}
                    </div>
                    ${plannedSessionsHTML}
                </div>
                ${nextGameHTML}
                <div class="card">
                    <div class="card-title">Leaderboard</div>
                    <div class="leaderboard">${leaderboardHTML}</div>
                </div>
                ${sessionsHTML}
            `;

            if ($('#btn-start-session')) {
                $('#btn-start-session').addEventListener('click', showStartSessionModal);
            }
            if ($('#btn-plan-session')) {
                $('#btn-plan-session').addEventListener('click', showPlanSessionModal);
            }
            const plannedContainer = $('#planned-sessions-container');
            if (plannedContainer) bindProposalCardEvents(plannedContainer);
            const liveContainer = $('#live-sessions-container');
            if (liveContainer) bindProposalCardEvents(liveContainer);
            container.querySelectorAll('[data-action]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const sid = btn.dataset.sid, action = btn.dataset.action;
                    try {
                        if (action === 'join') {
                            await api('POST', `/live-sessions/${sid}/join`, { player: state.currentPlayer });
                        } else if (action === 'leave') {
                            await api('POST', `/live-sessions/${sid}/leave`, { player: state.currentPlayer });
                        } else if (action === 'start') {
                            await api('PUT', `/live-sessions/${sid}/start`);
                        } else if (action === 'end') {
                            if (confirm('Session beenden? Sie landet dann in der Admin-Freigabe.')) {
                                await api('PUT', `/live-sessions/${sid}/end`);
                            }
                        } else if (action === 'cancel') {
                            if (confirm('Raum abbrechen ohne Coins zu vergeben?')) {
                                await api('DELETE', `/live-sessions/${sid}`);
                            }
                        }
                    } catch (e) {
                        showToast(e.message || 'Fehler', 'error');
                    }
                    renderDashboard();
                });
            });

            // Update header coins
            updateHeaderCoins();
        } catch (e) {
            console.error('Dashboard error:', e);
        }
    }

    // ---- Render: Matcher ----
    async function renderMatcher() {
        const container = $('#view-matcher');
        const admin = isAdmin();

        try {
            const [gamesData, genresData] = await Promise.all([
                api('GET', '/games'),
                api('GET', '/genres')
            ]);
            state.games = gamesData;

            const approvedGames = state.games
                .filter(g => g.status !== 'suggested')
                .map(g => ({ ...g, matchCount: getMatchCount(g), matchPlayers: getMatchingPlayers(g) }))
                .sort((a, b) => b.matchCount - a.matchCount);

            const suggestedGames = state.games.filter(g => g.status === 'suggested');

            const attendeesHTML = admin ? `
                <div class="attendees-config card">
                    <div class="card-title">Wer ist auf der LAN? <span class="admin-badge">Admin</span></div>
                    <div class="attendees-grid" id="attendees-grid">
                        ${state.players.map(p => `
                            <button class="attendee-toggle ${state.attendees.includes(p) ? 'active' : ''}" data-player="${p}">
                                ${p}
                            </button>
                        `).join('')}
                    </div>
                </div>` : `
                <div class="card">
                    <div class="card-title">Anwesend</div>
                    <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
                        ${state.attendees.map(p => `<span class="player-chip">${p}</span>`).join('')}
                    </div>
                </div>`;

            // Genre-Dropdown fuer Suggest-Form
            const genreSelectHTML = `<select id="suggest-genre" class="genre-select">
                <option value="">Genre waehlen...</option>
                ${genresData.map(g => `<option value="${g}">${g}</option>`).join('')}
            </select>`;

            const suggestFormHTML = state.currentPlayer ? `
                <div class="card">
                    <div class="card-title">Spiel vorschlagen</div>
                    <div class="proposal-form">
                        <input type="text" id="suggest-name" placeholder="Spielname">
                        ${genreSelectHTML}
                        <div class="proposal-row">
                            <input type="number" id="suggest-maxplayers" placeholder="Max Spieler" min="2" max="64" inputmode="numeric">
                        </div>
                        <button class="btn-propose" id="btn-suggest-game" disabled>Vorschlagen</button>
                    </div>
                </div>` : '';

            let suggestedHTML = '';
            if (suggestedGames.length > 0) {
                suggestedHTML = `
                    <div class="proposal-section-title">Vorgeschlagene Spiele (${suggestedGames.length})</div>
                    <div class="game-list" id="suggested-game-list">
                        ${suggestedGames.map(g => renderSuggestedGameCard(g, admin)).join('')}
                    </div>`;
            }

            container.innerHTML = `
                <div class="section-title">Spieleliste</div>
                ${attendeesHTML}
                ${suggestFormHTML}
                ${suggestedHTML}
                <div class="proposal-section-title">Freigegebene Spiele (${approvedGames.length})</div>
                <div class="filter-bar">
                    <input type="text" id="filter-search" class="search-input" placeholder="Spiel suchen..." style="margin-bottom:0">
                    <select id="filter-genre">
                        <option value="">Alle Genres</option>
                        ${genresData.map(g => `<option value="${g}">${g}</option>`).join('')}
                    </select>
                    <input type="number" id="filter-min-players" min="0" max="99" step="1" value="0" placeholder="Min. Uebereinstimmungen" title="Min. Uebereinstimmungen">
                </div>
                <div class="filter-bar">
                    <div class="player-filter-chips" id="player-filter-chips">
                        ${state.attendees.map(p => `
                            <button class="player-filter-chip" data-player="${p}">${p}</button>
                        `).join('')}
                    </div>
                </div>
                <div class="game-table-header ${admin ? 'admin-header' : ''}" id="game-table-header">
                    ${admin ? '<input type="checkbox" id="select-all-games" title="Alle auswählen">' : ''}
                    <span class="gth-nr">#</span>
                    <span class="gth-name">Spiel / Genre / Max</span>
                    <span class="gth-like">Like</span>
                    ${admin ? '<span class="gth-coins">Coins</span>' : ''}
                    ${admin ? '<span class="gth-actions">Edit</span>' : ''}
                </div>
                <div class="game-list" id="game-list"></div>
            `;

            renderGameList(approvedGames);

            // --- Filter Events ---
            $('#filter-search').addEventListener('input', () => filterGames());
            $('#filter-genre').addEventListener('change', () => filterGames());
            $('#filter-min-players').addEventListener('input', () => filterGames());

            container.querySelectorAll('.player-filter-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    chip.classList.toggle('active');
                    filterGames();
                });
            });

            // --- Attendees (Admin) ---
            if (admin) {
                $$('#attendees-grid .attendee-toggle').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const player = btn.dataset.player;
                        if (state.attendees.includes(player)) {
                            state.attendees = state.attendees.filter(p => p !== player);
                        } else {
                            state.attendees.push(player);
                        }
                        btn.classList.toggle('active');
                        try {
                            await api('PUT', '/attendees', { attendees: state.attendees });
                        } catch (e) { console.error(e); }
                        filterGames();
                    });
                });
            }

            // --- Suggest Game ---
            const suggestNameEl = $('#suggest-name');
            if (suggestNameEl) {
                const suggestBtn = $('#btn-suggest-game');
                suggestNameEl.addEventListener('input', () => {
                    suggestBtn.disabled = !suggestNameEl.value.trim();
                });
                suggestBtn.addEventListener('click', async () => {
                    const name = suggestNameEl.value.trim();
                    const genre = ($('#suggest-genre') || {}).value || '';
                    const maxPlayers = parseInt(($('#suggest-maxplayers') || {}).value) || 4;
                    if (!name) return;
                    try {
                        await api('POST', '/games/suggest', { name, genre, maxPlayers, suggestedBy: state.currentPlayer });
                        showToast(`"${name}" vorgeschlagen!`, 'success');
                        playSound('coin');
                        renderMatcher();
                    } catch (e) {
                        showToast('Spiel existiert bereits!', 'error');
                        playSound('error');
                    }
                });
            }

            // --- Suggested Game Actions ---
            bindSuggestedGameEvents(container);

            // --- Game List Events (Like, Edit, Delete, Coins) ---
            bindGameListEvents();
        } catch (e) {
            console.error('Matcher error:', e);
        }
    }

    function renderSuggestedGameCard(g, admin) {
        const matchCount = getMatchCount(g);
        const playerChips = Object.keys(g.players || {})
            .filter(p => g.players[p])
            .map(p => `<span class="player-chip">${p}</span>`).join('');

        let adminHTML = '';
        if (admin) {
            adminHTML = `
                <div class="leader-edit-row mt-1">
                    <input type="number" class="approve-coins-input" data-game="${g.name}" placeholder="Coins/Session" min="0" max="10" inputmode="numeric" value="">
                    <button class="btn-approve" data-game="${g.name}">Freigeben</button>
                    <button class="btn-reject" data-game="${g.name}">&#x2716;</button>
                </div>`;
        }

        return `
            <div class="proposal-card">
                <div class="proposal-card-header">
                    <span class="proposal-game-name">${g.name}</span>
                    <span class="status-badge pending">Vorschlag</span>
                </div>
                <div class="leader-badge">💡 ${g.suggestedBy || '?'}</div>
                <div class="game-meta mb-1">
                    ${g.genre ? `<span>${g.genre}</span>` : ''}
                    <span>Max ${g.maxPlayers}</span>
                </div>
                <div class="proposal-players">
                    ${playerChips}
                    ${!g.players[state.currentPlayer] ? `<button class="btn-join" data-game="${g.name}" data-action="interest">Interesse</button>` :
                    (g.suggestedBy !== state.currentPlayer ? `<button class="btn-leave" data-game="${g.name}" data-action="interest">Austragen</button>` : '')}
                </div>
                ${adminHTML}
            </div>`;
    }

    function bindSuggestedGameEvents(container) {
        container.querySelectorAll('#suggested-game-list .btn-approve').forEach(btn => {
            btn.addEventListener('click', async () => {
                const gameName = btn.dataset.game;
                const coinsInput = container.querySelector(`.approve-coins-input[data-game="${gameName}"]`);
                const coins = parseInt((coinsInput || {}).value) || 0;
                try {
                    await api('PUT', `/games/${encodeURIComponent(gameName)}/approve`, { sessionCoins: coins });
                    showToast(`"${gameName}" freigegeben (${coins} Coins/Session)!`, 'success');
                    playSound('coin');
                    renderMatcher();
                } catch (e) { console.error(e); }
            });
        });

        container.querySelectorAll('#suggested-game-list .btn-reject').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm(`"${btn.dataset.game}" ablehnen und entfernen?`)) {
                    try {
                        await api('DELETE', `/games/${encodeURIComponent(btn.dataset.game)}`);
                        showToast('Vorschlag abgelehnt.', 'error');
                        renderMatcher();
                    } catch (e) { console.error(e); }
                }
            });
        });

        container.querySelectorAll('#suggested-game-list [data-action="interest"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api('POST', `/games/${encodeURIComponent(btn.dataset.game)}/interest`, { player: state.currentPlayer });
                    renderMatcher();
                } catch (e) { console.error(e); }
            });
        });
    }

    // Event-Delegation: einmal auf #game-list registriert, ueberlebt innerHTML-Ersetzungen nicht,
    // daher nach jedem renderGameList() neu binden.
    function bindGameListEvents() {
        const list = $('#game-list');
        if (!list) return;

        list.addEventListener('click', async (e) => {
            // Checkbox
            const chk = e.target.closest('.game-checkbox');
            if (chk) {
                if (chk.checked) selectedGames.add(chk.dataset.game);
                else selectedGames.delete(chk.dataset.game);
                updateBulkBar();
                chk.closest('.game-item').classList.toggle('selected', chk.checked);
                return;
            }

            // Bulk-Delete
            const bulkDeleteBtn = e.target.closest('#bulk-delete-btn');
            if (bulkDeleteBtn) {
                const names = [...selectedGames];
                if (!names.length) return;
                if (!confirm(`${names.length} Spiel(e) wirklich löschen?`)) return;
                for (const name of names) {
                    try {
                        await api('DELETE', `/games/${encodeURIComponent(name)}`);
                    } catch (err) { console.error(err); }
                }
                selectedGames.clear();
                showToast(`${names.length} Spiel(e) gelöscht.`, 'error');
                renderMatcher();
                return;
            }

            // Bulk-Edit Modal
            const bulkEditBtn = e.target.closest('#bulk-edit-btn');
            if (bulkEditBtn && selectedGames.size > 0) {
                showBulkEditModal([...selectedGames]);
                return;
            }

            // Abwählen
            const bulkDeselect = e.target.closest('#bulk-deselect-btn');
            if (bulkDeselect) {
                selectedGames.clear();
                filterGames();
                return;
            }

            const interestBtn = e.target.closest('.game-interest-btn');
            if (interestBtn) {
                e.stopPropagation();
                try {
                    await api('POST', `/games/${encodeURIComponent(interestBtn.dataset.game)}/interest`, { player: state.currentPlayer });
                    renderMatcher();
                } catch (e2) { console.error(e2); }
                return;
            }

            const deleteBtn = e.target.closest('.game-delete-btn');
            if (deleteBtn) {
                e.stopPropagation();
                if (confirm(`"${deleteBtn.dataset.game}" wirklich loeschen?`)) {
                    try {
                        await api('DELETE', `/games/${encodeURIComponent(deleteBtn.dataset.game)}`);
                        showToast('Spiel geloescht.', 'error');
                        renderMatcher();
                    } catch (e2) { console.error(e2); }
                }
                return;
            }

            const editBtn = e.target.closest('.game-edit-btn');
            if (editBtn) {
                e.stopPropagation();
                const game = state.games.find(g => g.name === editBtn.dataset.game);
                if (game) showEditGameModal(game);
                return;
            }
        });

        list.addEventListener('change', async (e) => {
            const coinsInput = e.target.closest('.game-coins-input');
            if (coinsInput) {
                try {
                    await api('PUT', `/games/${encodeURIComponent(coinsInput.dataset.game)}`, { sessionCoins: parseInt(coinsInput.value) || 0 });
                    showToast('Coins aktualisiert.', 'gold');
                } catch (err) { console.error(err); }
            }
        });

        // "Alle auswählen"-Checkbox Event-Listener – einmalig auf document gebunden
        document.removeEventListener('change', handleSelectAllGames);
        document.addEventListener('change', handleSelectAllGames);
    }

    function handleSelectAllGames(e) {
        if (e.target.id !== 'select-all-games') return;
        document.querySelectorAll('.game-checkbox').forEach(chk => {
            chk.checked = e.target.checked;
            if (e.target.checked) selectedGames.add(chk.dataset.game);
            else selectedGames.delete(chk.dataset.game);
            chk.closest('.game-item').classList.toggle('selected', e.target.checked);
        });
        updateBulkBar();
    }

    function updateBulkBar() {
        const bar = $('#bulk-action-bar');
        const count = $('#bulk-count');
        if (!bar) return;
        if (selectedGames.size > 0) {
            bar.classList.add('show');
            if (count) count.textContent = `${selectedGames.size} Spiel(e) ausgewählt`;
        } else {
            bar.classList.remove('show');
        }
    }

    function showBulkEditModal(names) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        modal.innerHTML = `
            <div class="modal-title">Mehrere Spiele bearbeiten (${names.length})</div>
            <div class="proposal-form">
                <p style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:0.75rem">
                    Nur ausgefüllte Felder werden übernommen.
                </p>
                <label style="font-size:0.75rem;color:var(--text-secondary)">Genre (alle überschreiben)</label>
                <input type="text" id="bulk-genre" placeholder="z.B. Strategie, Taktik">
                <label style="font-size:0.75rem;color:var(--text-secondary)">Max. Spieler (alle überschreiben)</label>
                <input type="number" id="bulk-maxplayers" placeholder="z.B. 4" min="2" max="64" inputmode="numeric">
                <div class="proposal-row" style="margin-top:0.75rem">
                    <button class="btn-propose" id="bulk-save">Speichern</button>
                    <button class="btn-leave" id="bulk-cancel">Abbrechen</button>
                </div>
            </div>
        `;
        overlay.classList.add('show');
        $('#bulk-cancel').addEventListener('click', () => overlay.classList.remove('show'));
        $('#bulk-save').addEventListener('click', async () => {
            const genre = $('#bulk-genre').value.trim();
            const maxPlayers = parseInt($('#bulk-maxplayers').value);
            const payload = {};
            if (genre) payload.genre = genre;
            if (!isNaN(maxPlayers) && maxPlayers >= 2) payload.maxPlayers = maxPlayers;
            if (!Object.keys(payload).length) { showToast('Kein Feld ausgefüllt.', 'error'); return; }
            for (const name of names) {
                try {
                    await api('PUT', `/games/${encodeURIComponent(name)}`, payload);
                } catch (err) { console.error(err); }
            }
            overlay.classList.remove('show');
            selectedGames.clear();
            showToast(`${names.length} Spiel(e) aktualisiert.`, 'success');
            renderMatcher();
        });
    }

    function showEditGameModal(game) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        modal.innerHTML = `
            <div class="modal-title">Spiel bearbeiten</div>
            <div class="proposal-form">
                <label style="font-size:0.75rem;color:var(--text-secondary)">Name</label>
                <input type="text" id="edit-game-name" value="${game.name}">
                <label style="font-size:0.75rem;color:var(--text-secondary)">Genre</label>
                <input type="text" id="edit-game-genre" value="${game.genre || ''}">
                <div class="proposal-row">
                    <div>
                        <label style="font-size:0.75rem;color:var(--text-secondary)">Max Spieler</label>
                        <input type="number" id="edit-game-maxplayers" value="${game.maxPlayers}" min="2" max="64" inputmode="numeric">
                    </div>
                    <div>
                        <label style="font-size:0.75rem;color:var(--text-secondary)">Vorschau-Link (YouTube)</label>
                        <input type="url" id="edit-game-previewurl" value="${game.previewUrl || ''}" placeholder="https://www.youtube.com/watch?v=...">
                    </div>
                </div>
                <div class="proposal-row" style="margin-top:0.75rem">
                    <button class="btn-propose" id="edit-game-save">Speichern</button>
                    <button class="btn-leave" id="edit-game-cancel">Abbrechen</button>
                </div>
            </div>
        `;
        overlay.classList.add('show');

        $('#edit-game-save').addEventListener('click', async () => {
            const newName = $('#edit-game-name').value.trim();
            if (!newName) return;
            try {
                await api('PUT', `/games/${encodeURIComponent(game.name)}`, {
                    newName,
                    genre: $('#edit-game-genre').value.trim(),
                    maxPlayers: parseInt($('#edit-game-maxplayers').value) || game.maxPlayers,
                    previewUrl: $('#edit-game-previewurl').value.trim()
                });
                overlay.classList.remove('show');
                showToast('Spiel aktualisiert.', 'success');
                renderMatcher();
            } catch (e) {
                showToast('Fehler beim Speichern.', 'error');
            }
        });

        $('#edit-game-cancel').addEventListener('click', () => {
            overlay.classList.remove('show');
        });
    }

    function extractYouTubeId(url) {
        const match = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
        return match ? match[1] : null;
    }

    function showPreviewModal(url) {
        const videoId = extractYouTubeId(url);
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        modal.innerHTML = videoId ? `
            <div class="modal-title">Spielvorschau</div>
            <div class="video-container">
                <iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1"
                    frameborder="0" allowfullscreen allow="autoplay; encrypted-media"></iframe>
            </div>
            <button class="modal-close-btn" id="modal-cancel">Schliessen</button>
        ` : `
            <div class="modal-title">Ungültiger Link</div>
            <p style="padding:1rem;color:var(--text-secondary)">Kein gültiges YouTube-Video gefunden.</p>
            <button class="modal-close-btn" id="modal-cancel">Schliessen</button>
        `;
        overlay.classList.add('show');
        $('#modal-cancel').addEventListener('click', () => overlay.classList.remove('show'));
    }

    function filterGames() {
        const search = ($('#filter-search') || {}).value || '';
        const genre = ($('#filter-genre') || {}).value || '';
        const minPlayers = parseInt(($('#filter-min-players') || {}).value || '0');

        const activePlayerChips = [];
        document.querySelectorAll('.player-filter-chip.active').forEach(chip => {
            activePlayerChips.push(chip.dataset.player);
        });

        let filtered = state.games
            .filter(g => g.status !== 'suggested')
            .map(g => ({
                ...g,
                matchCount: getMatchCount(g),
                matchPlayers: getMatchingPlayers(g)
            }));

        if (search) {
            const s = search.toLowerCase();
            filtered = filtered.filter(g => g.name.toLowerCase().includes(s));
        }

        if (genre) {
            filtered = filtered.filter(g => g.genre && g.genre.includes(genre));
        }

        if (minPlayers > 0) {
            filtered = filtered.filter(g => g.matchCount >= minPlayers);
        }

        if (activePlayerChips.length > 0) {
            filtered = filtered.filter(g =>
                activePlayerChips.every(p => g.players && g.players[p])
            );
        }

        filtered.sort((a, b) => b.matchCount - a.matchCount);
        renderGameList(filtered);
    }

    function renderGameList(games) {
        const container = $('#game-list');
        if (!container) return;
        const admin = isAdmin();
        const player = state.currentPlayer;

        if (games.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🔍</div>
                    <div class="empty-state-text">Keine Spiele gefunden</div>
                </div>`;
            return;
        }

        const bulkBar = admin ? `
            <div id="bulk-action-bar" class="bulk-action-bar ${selectedGames.size > 0 ? 'show' : ''}">
                <span id="bulk-count">${selectedGames.size} Spiel(e) ausgewählt</span>
                <button id="bulk-edit-btn" class="btn-bulk-action">Genre / Spieler</button>
                <button id="bulk-delete-btn" class="btn-bulk-action danger">Löschen</button>
                <button id="bulk-deselect-btn" class="btn-bulk-clear">✕ Abwählen</button>
            </div>` : '';

        container.innerHTML = bulkBar + games.map((g, idx) => {
            const noMatch = g.matchCount < CONFIG.MIN_MATCH ? 'no-match' : '';
            const hasMatch = g.matchCount >= CONFIG.MIN_MATCH ? 'has-match' : '';
            const isInterested = player && g.players && g.players[player];

            const playerDots = state.attendees.map(p =>
                `<div class="game-player-dot ${g.players && g.players[p] ? '' : 'empty'}">${p.charAt(0)}</div>`
            ).join('');

            const interestBtn = player ? `
                <button class="game-interest-btn ${isInterested ? 'active' : ''}" data-game="${g.name}" title="${isInterested ? 'Austragen' : 'Interesse zeigen'}">
                    ${isInterested ? '\u2713' : '+'}
                </button>` : '<span></span>';

            const adminCoins = admin ? `
                <input type="number" class="game-coins-input" data-game="${g.name}" value="${g.sessionCoins || 0}" min="0" max="10" title="Coins/Session">` : '';

            const adminBtns = admin ? `
                <div class="game-admin-controls">
                    <button class="game-action-btn edit game-edit-btn" data-game="${g.name}" title="Bearbeiten">&#x270E;</button>
                    <button class="game-action-btn delete game-delete-btn" data-game="${g.name}" title="Loeschen">&#x2716;</button>
                </div>` : '';

            const coinsTag = g.sessionCoins ? `<span class="game-coins-tag">🪙${g.sessionCoins}</span>` : '';

            const checkbox = admin ? `<input type="checkbox" class="game-checkbox" data-game="${g.name}" ${selectedGames.has(g.name) ? 'checked' : ''}>` : '';

            return `
                <div class="game-item ${noMatch} ${hasMatch} ${admin ? 'admin-row' : ''} ${selectedGames.has(g.name) ? 'selected' : ''}">
                    ${checkbox}
                    <div class="game-nr">#${idx + 1}</div>
                    <div class="game-info">
                        <div class="game-name">
                            ${g.name}${coinsTag}
                            ${g.previewUrl ? `<button class="preview-btn" data-url="${g.previewUrl}" title="Vorschau">▶</button>` : ''}
                        </div>
                        <div class="game-meta">
                            <span>${g.genre || '?'}</span>
                            <span>Max ${g.maxPlayers}</span>
                            <span>${g.matchCount} Likes</span>
                        </div>
                        <div class="game-players-row">${playerDots}</div>
                    </div>
                    ${interestBtn}
                    ${adminCoins}
                    ${adminBtns}
                </div>`;
        }).join('');

        container.querySelectorAll('.preview-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                showPreviewModal(btn.dataset.url);
            });
        });
    }


    function renderProposalCard(p) {
        const player = state.currentPlayer;
        const isLeader = p.leader === player;
        const isJoined = p.players.includes(player);
        const admin = isAdmin();

        const statusLabels = {
            pending: 'Ausstehend', approved: 'Freigegeben',
            active: 'Laeuft', completed: 'Beendet', rejected: 'Abgelehnt'
        };

        let coinStatusHTML = '';
        if (p.status === 'completed' && p.coinsApproved === false) {
            coinStatusHTML = `<div class="proposal-schedule" style="color:var(--accent-gold)">&#x1FA99; ${p.pendingCoins || 0} Coins warten auf Freigabe</div>`;
        } else if (p.status === 'completed' && p.coinsApproved === true) {
            coinStatusHTML = `<div class="proposal-schedule" style="color:var(--accent-green)">&#x2713; ${p.pendingCoins || 0} Coins ausgezahlt</div>`;
        }

        let scheduleHTML = '';
        if (p.scheduledDay || p.scheduledTime) {
            scheduleHTML = `<div class="proposal-schedule">📅 ${formatScheduleDate(p.scheduledDay)} ${p.scheduledTime || ''}</div>`;
        }

        let messageHTML = '';
        if (p.message) {
            messageHTML = `<div class="proposal-message">${p.message}</div>`;
        }

        let leaderEditHTML = '';
        if (isLeader && ['pending', 'approved'].includes(p.status)) {
            leaderEditHTML = `
                <div class="leader-edit-row">
                    <input type="date" class="leader-day" data-id="${p.id}" value="${/^\d{4}-\d{2}-\d{2}$/.test(p.scheduledDay || '') ? p.scheduledDay : ''}" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);font-size:0.85rem">
                    <input type="time" class="leader-time" data-id="${p.id}" value="${p.scheduledTime || ''}" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);font-size:0.85rem">
                </div>`;
        }

        let actionsHTML = '';
        const actions = [];

        if (!isJoined && ['pending', 'approved'].includes(p.status)) {
            actions.push(`<button class="btn-join" data-id="${p.id}">Mitmachen</button>`);
        }
        if (isJoined && !isLeader && ['pending', 'approved'].includes(p.status)) {
            actions.push(`<button class="btn-leave" data-id="${p.id}">Austragen</button>`);
        }

        if (isLeader && ['pending', 'approved'].includes(p.status)) {
            actions.push(`<button class="btn-start-session" data-id="${p.id}">▶ Jetzt starten</button>`);
        }
        if (isLeader && p.status === 'active') {
            actions.push(`<button class="btn-end-session" data-id="${p.id}">Session beenden</button>`);
        }
        if (isLeader && ['pending', 'approved'].includes(p.status)) {
            actions.push(`<button class="btn-withdraw" data-id="${p.id}" style="font-size:0.75rem;opacity:0.6">Zurückziehen</button>`);
        }

        if (admin && p.status === 'pending') {
            actions.push(`<button class="btn-approve" data-id="${p.id}">Freigeben</button>`);
            actions.push(`<button class="btn-reject" data-id="${p.id}">Ablehnen</button>`);
        }

        if (admin && p.status === 'completed' && p.coinsApproved === false) {
            actions.push(`<button class="btn-approve-coins" data-id="${p.id}">&#x1FA99; ${p.pendingCoins || '?'} Coins freigeben</button>`);
        }

        if (admin) {
            actions.push(`<button class="btn-withdraw" data-id="${p.id}" data-admin-delete="true" title="Loeschen">&#x2716;</button>`);
        }

        if (actions.length) {
            actionsHTML = `<div class="proposal-actions">${actions.join('')}</div>`;
        }

        return `
            <div class="proposal-card ${p.status === 'active' ? 'status-active' : ''}" data-proposal-id="${p.id}">
                <div class="proposal-card-header">
                    <span class="proposal-game-name">${p.game}${p.isNewGame ? ' <span class="genre-tag">Neu</span>' : ''}</span>
                    <span class="status-badge ${p.status}">${statusLabels[p.status]}</span>
                </div>
                <div class="leader-badge">👑 ${p.leader}</div>
                ${messageHTML}
                ${scheduleHTML}
                ${coinStatusHTML}
                ${leaderEditHTML}
                <div class="proposal-players">
                    ${p.players.map(n => `<span class="player-chip">${n}</span>`).join('')}
                </div>
                ${actionsHTML}
            </div>`;
    }

    function bindProposalCardEvents(container) {
        container.querySelectorAll('.btn-join').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api('POST', `/proposals/${btn.dataset.id}/join`, { player: state.currentPlayer });
                    showToast('Eingetragen!', 'success');
                    renderProposals();
                } catch (e) { console.error(e); }
            });
        });

        container.querySelectorAll('.btn-leave').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api('POST', `/proposals/${btn.dataset.id}/leave`, { player: state.currentPlayer });
                    showToast('Ausgetragen.', 'gold');
                    renderProposals();
                } catch (e) { console.error(e); }
            });
        });

        container.querySelectorAll('.btn-start-session').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api('PUT', `/proposals/${btn.dataset.id}`, { status: 'active', startedAt: Date.now() });
                    showToast('Session gestartet!', 'success');
                    playSound('coin');
                    renderProposals();
                } catch (e) { console.error(e); }
            });
        });

        container.querySelectorAll('.btn-end-session').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    const proposals = await api('GET', '/proposals');
                    const proposal = proposals.find(x => x.id === btn.dataset.id);
                    if (!proposal) return;
                    const gameObj = state.games.find(g => g.name === proposal.game);
                    const gameCoins = gameObj && gameObj.sessionCoins ? gameObj.sessionCoins : 0;
                    const coinsAmount = gameCoins || calculateSessionCoins(proposal.players.length, state.attendees.length);
                    await api('PUT', `/proposals/${btn.dataset.id}`, {
                        status: 'completed',
                        completedAt: Date.now(),
                        pendingCoins: coinsAmount,
                        coinsApproved: 0
                    });
                    showToast(`Session beendet. ${coinsAmount} Coins warten auf Freigabe.`, 'gold');
                    renderProposals();
                } catch (e) { console.error(e); }
            });
        });

        container.querySelectorAll('.btn-approve-coins').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    const proposals = await api('GET', '/proposals');
                    const proposal = proposals.find(x => x.id === btn.dataset.id);
                    if (!proposal || proposal.coinsApproved) return;

                    const coinsPerPlayer = proposal.pendingCoins || 0;
                    const gameObj = state.games.find(g => g.name === proposal.game);
                    const gameGenres = gameObj && gameObj.genre
                        ? gameObj.genre.split(',').map(g => g.trim()).filter(g => g)
                        : [];

                    for (const player of proposal.players) {
                        await api('POST', '/coins/add', { player, amount: coinsPerPlayer, reason: `Session: ${proposal.game} (${proposal.players.length} Spieler)` });
                        for (const genre of gameGenres) {
                            const result = await api('POST', '/genres-played', { player, genre });
                            if (result.isNew) {
                                await api('POST', '/coins/add', { player, amount: CONFIG.COIN_REWARDS.NEW_GENRE, reason: `Neues Genre: ${genre}` });
                            }
                        }
                    }

                    await api('POST', '/sessions', {
                        game: proposal.game,
                        players: [...proposal.players],
                        coinsPerPlayer
                    });

                    await api('PUT', `/proposals/${btn.dataset.id}`, { coinsApproved: 1 });
                    showCoinAnimation(coinsPerPlayer);
                    showToast(`${coinsPerPlayer} Coins an ${proposal.players.length} Spieler freigegeben!`, 'success');
                    renderProposals();
                } catch (e) { console.error(e); }
            });
        });

        container.querySelectorAll('.btn-withdraw').forEach(btn => {
            btn.addEventListener('click', async () => {
                const isAdminDelete = btn.dataset.adminDelete === 'true';
                const label = isAdminDelete ? 'Vorschlag loeschen?' : 'Vorschlag zurueckziehen?';
                if (confirm(label)) {
                    try {
                        await api('DELETE', `/proposals/${btn.dataset.id}`);
                        showToast('Vorschlag entfernt.', 'error');
                        renderProposals();
                    } catch (e) { console.error(e); }
                }
            });
        });

        container.querySelectorAll('.btn-approve').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api('PUT', `/proposals/${btn.dataset.id}`, { status: 'approved', approvedAt: Date.now() });
                    showToast('Vorschlag freigegeben!', 'success');
                    playSound('coin');
                    renderProposals();
                } catch (e) { console.error(e); }
            });
        });

        container.querySelectorAll('.btn-reject').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm('Vorschlag ablehnen?')) {
                    try {
                        await api('PUT', `/proposals/${btn.dataset.id}`, { status: 'rejected' });
                        showToast('Vorschlag abgelehnt.', 'error');
                        renderProposals();
                    } catch (e) { console.error(e); }
                }
            });
        });

        container.querySelectorAll('.leader-day').forEach(sel => {
            sel.addEventListener('change', async () => {
                try {
                    await api('PUT', `/proposals/${sel.dataset.id}`, { scheduledDay: sel.value });
                } catch (e) { console.error(e); }
            });
        });
        container.querySelectorAll('.leader-time').forEach(inp => {
            inp.addEventListener('change', async () => {
                try {
                    await api('PUT', `/proposals/${inp.dataset.id}`, { scheduledTime: inp.value });
                } catch (e) { console.error(e); }
            });
        });
    }

    function renderProposals() {
        renderDashboard();
    }

    // ---- Render: Profile ----
    async function renderProfile() {
        const container = $('#view-profile');
        if (!state.currentPlayer) {
            container.innerHTML = `
                <div class="empty-state mt-2">
                    <div class="empty-state-icon">👤</div>
                    <div class="empty-state-text">Waehle oben deinen Namen aus,<br>um dein Profil zu sehen.</div>
                </div>`;
            return;
        }

        try {
            const player = state.currentPlayer;
            const [coinsData, starsData, history, tokens, sessions] = await Promise.all([
                api('GET', '/coins'),
                api('GET', '/stars'),
                api('GET', `/history/${encodeURIComponent(player)}`),
                api('GET', `/tokens/${encodeURIComponent(player)}`),
                api('GET', '/sessions')
            ]);
            state.coins = coinsData;
            state.stars = starsData;
            const coins = coinsData[player] || 0;
            const playerStars = starsData[player] || 0;
            const earned = history.filter(h => h.amount > 0).reduce((s, h) => s + h.amount, 0);
            const spent = history.filter(h => h.amount < 0).reduce((s, h) => s + Math.abs(h.amount), 0);
            const sessionCount = sessions.filter(s => s.players.includes(player)).length;

            const skipTokens = tokens.filter(t => t.type === 'skip_token');
            const forceTokens = tokens.filter(t => t.type === 'force_play');
            const chooseTokens = tokens.filter(t => t.type === 'choose_next');

            let tokensHTML = '';
            if (skipTokens.length || forceTokens.length || chooseTokens.length) {
                tokensHTML = `
                    <div class="card">
                        <div class="card-title">Aktive Tokens</div>
                        <div class="tokens-row">
                            ${skipTokens.map((_, i) => `<button class="token-badge" data-type="skip_token" data-idx="${i}">Skip-Token</button>`).join('')}
                            ${forceTokens.map((_, i) => `<button class="token-badge force-play" data-type="force_play" data-idx="${i}">Zwangsspielen</button>`).join('')}
                            ${chooseTokens.map((_, i) => `<button class="token-badge choose-next" data-type="choose_next" data-idx="${i}">Spiel bestimmen</button>`).join('')}
                        </div>
                        <div class="text-sm text-muted mt-1">Antippen zum Einloesen</div>
                    </div>`;
            }

            const recentHistory = history.slice(0, 20);
            let historyHTML = '';
            if (recentHistory.length > 0) {
                historyHTML = `
                    <div class="card">
                        <div class="card-title">Verlauf</div>
                        <div class="history-list">
                            ${recentHistory.map(h => {
                                const cls = h.amount > 0 ? 'positive' : 'negative';
                                return `
                                    <div class="history-item">
                                        <div class="history-icon">${h.amount > 0 ? '+' : '-'}</div>
                                        <div>
                                            <div class="history-text">${h.reason}</div>
                                            <div class="history-time">${formatTime(h.timestamp)}</div>
                                        </div>
                                        <div class="history-coins ${cls}">${h.amount > 0 ? '+' : ''}${h.amount}</div>
                                    </div>`;
                            }).join('')}
                        </div>
                    </div>`;
            }

            container.innerHTML = `
                <div class="card profile-header">
                    <div class="profile-name">${player}${isAdmin() ? ' <span class="admin-badge">Admin</span>' : ''}</div>
                    <div class="profile-coins-big">${coins} Coins</div>
                    ${playerStars > 0 ? `<div class="profile-stars">🎮 x${playerStars}</div>` : ''}
                    <div class="profile-stats">
                        <div class="stat-box">
                            <div class="stat-value earned">${earned}</div>
                            <div class="stat-label">Verdient</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value spent">${spent}</div>
                            <div class="stat-label">Ausgegeben</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value sessions">${sessionCount}</div>
                            <div class="stat-label">Sessions</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value">${playerStars}</div>
                            <div class="stat-label">Controller-Punkte</div>
                        </div>
                    </div>
                </div>
                ${tokensHTML}
                <div class="card">
                    <div class="card-title">PIN aendern</div>
                    <div class="admin-coins-form">
                        <input type="number" id="pin-old" placeholder="Alte PIN" inputmode="numeric" maxlength="4" autocomplete="off">
                        <input type="number" id="pin-new1" placeholder="Neue PIN (4 Ziffern)" inputmode="numeric" maxlength="4" autocomplete="off">
                        <input type="number" id="pin-new2" placeholder="Neue PIN wiederholen" inputmode="numeric" maxlength="4" autocomplete="off">
                        <button class="btn-admin-coins" id="btn-change-pin" disabled>PIN aendern</button>
                        <div class="pin-error" id="pin-change-error"></div>
                    </div>
                </div>
                ${historyHTML}
                <div class="card">
                    <div class="card-title">🔔 Benachrichtigungen</div>
                    <div class="notif-settings">
                        <div class="notif-row">
                            <span>Browser-Benachrichtigung (visuell)</span>
                            <button class="notif-toggle ${getNotifPref('visual') ? 'active' : ''}" id="notif-visual-btn">
                                ${getNotifPref('visual') ? 'An' : 'Aus'}
                            </button>
                        </div>
                        <div class="notif-row">
                            <span>Ton bei Herausforderung</span>
                            <button class="notif-toggle ${getNotifPref('sound') ? 'active' : ''}" id="notif-sound-btn">
                                ${getNotifPref('sound') ? 'An' : 'Aus'}
                            </button>
                        </div>
                        ${getNotifPref('visual') && Notification.permission === 'granted' ? `
                        <div class="notif-row">
                            <span>Test-Benachrichtigung senden</span>
                            <button class="btn-secondary" id="notif-test-btn">🔔 Testen</button>
                        </div>` : ''}
                    </div>
                </div>
            `;

            // Token einloesen
            container.querySelectorAll('.token-badge').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const type = btn.dataset.type;
                    const names = { skip_token: 'Skip-Token', force_play: 'Zwangsspielen', choose_next: 'Spiel bestimmen' };
                    if (confirm(`${names[type]} jetzt einloesen?`)) {
                        try {
                            await api('DELETE', `/tokens/${encodeURIComponent(player)}/${type}`);
                            showToast(`${names[type]} eingeloest!`, 'gold');
                            playSound('spend');
                            renderProfile();
                        } catch (e) { console.error(e); }
                    }
                });
            });

            // PIN aendern
            const pinOld = container.querySelector('#pin-old');
            const pinNew1 = container.querySelector('#pin-new1');
            const pinNew2 = container.querySelector('#pin-new2');
            const pinBtn = container.querySelector('#btn-change-pin');
            const pinError = container.querySelector('#pin-change-error');

            function validatePinForm() {
                pinBtn.disabled = !(pinOld.value && pinNew1.value.length >= 4 && pinNew2.value.length >= 4);
            }
            [pinOld, pinNew1, pinNew2].forEach(el => el.addEventListener('input', validatePinForm));

            pinBtn.addEventListener('click', async () => {
                if (pinNew1.value !== pinNew2.value) {
                    pinError.textContent = 'Neue PINs stimmen nicht ueberein!';
                    playSound('error');
                    return;
                }
                if (pinNew1.value.length < 4) {
                    pinError.textContent = 'PIN muss 4 Ziffern haben!';
                    playSound('error');
                    return;
                }
                try {
                    await api('PUT', `/users/${encodeURIComponent(player)}/pin`, { oldPin: pinOld.value, newPin: pinNew1.value });
                    pinError.textContent = '';
                    pinOld.value = '';
                    pinNew1.value = '';
                    pinNew2.value = '';
                    pinBtn.disabled = true;
                    showToast('PIN erfolgreich geaendert!', 'success');
                    playSound('coin');
                } catch (e) {
                    pinError.textContent = 'Alte PIN ist falsch!';
                    playSound('error');
                }
            });

            const visualBtn = container.querySelector('#notif-visual-btn');
            const soundNotifBtn = container.querySelector('#notif-sound-btn');

            visualBtn.addEventListener('click', async () => {
                const current = getNotifPref('visual');
                if (!current) {
                    if (!('Notification' in window)) {
                        showToast('Browser unterstützt keine Benachrichtigungen', 'error'); return;
                    }
                    if (Notification.permission === 'default') {
                        const perm = await Notification.requestPermission();
                        if (perm !== 'granted') { showToast('Berechtigung verweigert', 'error'); return; }
                    } else if (Notification.permission === 'denied') {
                        showToast('Berechtigung in Browser-Einstellungen blockiert', 'error'); return;
                    }
                }
                setNotifPref('visual', !current);
                renderProfile();
            });

            soundNotifBtn.addEventListener('click', () => {
                const current = getNotifPref('sound');
                setNotifPref('sound', !current);
                if (!current) playSound('challenge'); // Vorschau
                renderProfile();
            });

            const testBtn = container.querySelector('#notif-test-btn');
            if (testBtn) {
                testBtn.addEventListener('click', () => {
                    new Notification('🔔 Test-Benachrichtigung', {
                        body: `Hey ${player}, Benachrichtigungen funktionieren!`
                    });
                });
            }

            updateHeaderCoins();
        } catch (e) {
            console.error('Profile error:', e);
        }
    }

    // ---- Render: Session (Admin) ----
    let sessionState = { selectedGame: null, selectedPlayers: [] };

    async function renderSession() {
        const container = $('#view-session');

        if (!isAdmin()) {
            container.innerHTML = `
                <div class="empty-state mt-2">
                    <div class="empty-state-icon">🔒</div>
                    <div class="empty-state-text">Nur die Turnierleitung kann Sessions starten.</div>
                </div>`;
            return;
        }

        try {
            const [gamesData, usersData, liveSessionsData, allProposals] = await Promise.all([
                api('GET', '/games'),
                api('GET', '/users'),
                api('GET', '/live-sessions'),
                api('GET', '/proposals')
            ]);
            state.games = gamesData;

            const endedSessions = liveSessionsData.filter(s => s.status === 'ended');
            const completedProposals = allProposals.filter(p => p.status === 'completed' && !p.coinsApproved);

            const sortedGames = [...state.games].sort((a, b) => {
                return getMatchCount(b) - getMatchCount(a);
            });

            const hasFreigabe = endedSessions.length > 0 || completedProposals.length > 0;
            const freigabeHTML = hasFreigabe ? `
                <div class="freigabe-section" id="freigabe-container">
                    <div class="section-title" style="color:#ff9800">⏳ Freigabe ausstehend</div>
                    ${endedSessions.map(s => {
                        const coins = calculateSessionCoins(s.players.length, state.attendees.length);
                        return `
                            <div class="freigabe-item">
                                <strong>${s.game}</strong> · GL: ${s.leader} · ${s.players.length} Spieler<br>
                                <div>${s.players.map(p => `<span class="player-chip">${p}</span>`).join('')}</div>
                                <div class="freigabe-coins-row">
                                    <span style="font-size:0.85rem;color:var(--text-secondary)">Coins/Spieler:</span>
                                    <input type="number" class="freigabe-coins-input" data-sid="${s.id}" value="${coins}" min="0" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary)">
                                    <button class="btn-approve freigabe-approve-btn" data-sid="${s.id}">✅ Freigeben</button>
                                    <button class="btn-danger freigabe-cancel-btn" data-sid="${s.id}" style="padding:4px 10px;font-size:0.8rem">🗑️</button>
                                </div>
                            </div>`;
                    }).join('')}
                    ${completedProposals.map(renderProposalCard).join('')}
                </div>` : '';

            container.innerHTML = `
                ${freigabeHTML}
                <div class="section-title"><span class="admin-badge">Admin</span> Session starten</div>

                <div class="session-step">
                    <div class="mb-1"><span class="step-number">1</span> <strong>Spiel auswaehlen</strong></div>
                    <input type="text" id="session-game-search" class="search-input" placeholder="Spiel suchen...">
                    <div class="game-select-grid" id="session-game-grid">
                        ${sortedGames.map(g => {
                            const mc = getMatchCount(g);
                            return `<div class="game-select-item ${sessionState.selectedGame === g.name ? 'selected' : ''}" data-game="${g.name}">
                                ${g.name}${mc > 0 ? ` (${mc})` : ''}
                            </div>`;
                        }).join('')}
                    </div>
                </div>

                <div class="session-step">
                    <div class="mb-1"><span class="step-number">2</span> <strong>Wer war dabei?</strong></div>
                    <div class="player-toggle-grid" id="session-player-grid">
                        ${state.attendees.map(p => `
                            <div class="player-toggle ${sessionState.selectedPlayers.includes(p) ? 'active' : ''}" data-player="${p}">
                                <div class="toggle-check">${sessionState.selectedPlayers.includes(p) ? '\u2713' : ''}</div>
                                ${p}
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="session-step">
                    <div class="mb-1"><span class="step-number">3</span> <strong>Bestaetigen</strong></div>
                    <div id="session-preview" class="card" style="display:${sessionState.selectedGame ? 'block' : 'none'}">
                        <div style="text-align:center">
                            <div class="text-muted text-sm">Spiel</div>
                            <div style="font-size:1.2rem;font-weight:700">${sessionState.selectedGame || '-'}</div>
                            <div class="text-muted text-sm mt-1">Spieler: ${sessionState.selectedPlayers.length}</div>
                            <div style="font-size:1.5rem;font-weight:800;color:var(--accent-gold);margin-top:0.5rem">
                                ${calculateSessionCoins(sessionState.selectedPlayers.length, state.attendees.length)} Coins pro Spieler
                            </div>
                        </div>
                    </div>
                    <button class="btn-session-confirm" id="btn-confirm-session"
                        ${(!sessionState.selectedGame || sessionState.selectedPlayers.length < 3) ? 'disabled' : ''}>
                        Session bestaetigen & Coins verteilen
                    </button>
                    ${sessionState.selectedPlayers.length > 0 && sessionState.selectedPlayers.length < 3
                        ? '<div class="text-muted text-sm text-center mt-1">Mindestens 3 Spieler noetig</div>' : ''}
                </div>

                <div class="card">
                    <div class="card-title">Spielerverwaltung <span class="admin-badge">Admin</span></div>
                    <div class="player-mgmt-list" id="player-mgmt-list">
                        ${usersData.map(u => `
                            <div class="player-mgmt-item">
                                <div class="player-mgmt-info">
                                    <span class="player-mgmt-name">${u.name}</span>
                                    ${u.role === 'admin' ? '<span class="admin-badge">Admin</span>' : ''}
                                </div>
                                <div class="player-mgmt-actions">
                                    <button class="player-mgmt-btn edit" data-name="${u.name}" title="Bearbeiten">&#x270E;</button>
                                    <button class="player-mgmt-btn pin" data-name="${u.name}" title="PIN zuruecksetzen">&#x1F511;</button>
                                    ${u.name !== state.currentPlayer ? `<button class="player-mgmt-btn delete" data-name="${u.name}" title="Loeschen">&#x2716;</button>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="admin-coins-form mt-2" id="add-player-form">
                        <div class="card-title" style="margin-bottom:0.25rem">Neuer Spieler</div>
                        <input type="text" id="new-player-name" placeholder="Name">
                        <input type="number" id="new-player-pin" placeholder="PIN (4 Ziffern)" inputmode="numeric" maxlength="4">
                        <select id="new-player-role">
                            <option value="player">Spieler</option>
                            <option value="admin">Admin</option>
                        </select>
                        <button class="btn-admin-coins" id="btn-add-player" disabled>Spieler hinzufuegen</button>
                    </div>
                </div>

                <div class="card">
                    <div class="card-title">Coins manuell vergeben <span class="admin-badge">Admin</span></div>
                    <div class="admin-coins-form">
                        <select id="admin-coin-player">
                            <option value="">Spieler waehlen...</option>
                            ${state.players.map(p => `<option value="${p}">${p}</option>`).join('')}
                        </select>
                        <input type="number" id="admin-coin-amount" placeholder="Anzahl (z.B. 5 oder -2)" inputmode="numeric">
                        <input type="text" id="admin-coin-reason" placeholder="Grund (z.B. Turniersieg)">
                        <button class="btn-admin-coins" id="btn-admin-coins" disabled>Coins vergeben</button>
                    </div>
                </div>

                <div class="danger-zone">
                    <div class="card-title">Gefahrenzone <span class="admin-badge">Admin</span></div>
                    <button class="btn-danger" id="btn-reset-all">Alle Daten zuruecksetzen</button>
                </div>
            `;

            // Event: Freigabe — Proposal-Karten (completed)
            const freigabeContainer = $('#freigabe-container');
            if (freigabeContainer) bindProposalCardEvents(freigabeContainer);

            // Event: Freigabe buttons (live-sessions)
            container.querySelectorAll('.freigabe-approve-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const sid = btn.dataset.sid;
                    const coinsInput = container.querySelector(`.freigabe-coins-input[data-sid="${sid}"]`);
                    const coinsPerPlayer = parseInt(coinsInput?.value ?? 0);
                    try {
                        await api('POST', `/live-sessions/${sid}/approve`, { coinsPerPlayer });
                        showCoinAnimation(coinsPerPlayer);
                        showToast(`Session freigegeben! ${coinsPerPlayer} Coins verteilt.`, 'success');
                        renderSession();
                    } catch (e) { showToast('Fehler beim Freigeben.', 'error'); }
                });
            });
            container.querySelectorAll('.freigabe-cancel-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (confirm('Session verwerfen ohne Coins zu vergeben?')) {
                        await api('DELETE', `/live-sessions/${btn.dataset.sid}`);
                        renderSession();
                    }
                });
            });

            // Event: Game search
            $('#session-game-search').addEventListener('input', (e) => {
                const search = e.target.value.toLowerCase();
                $$('#session-game-grid .game-select-item').forEach(item => {
                    const match = item.dataset.game.toLowerCase().includes(search);
                    item.style.display = match ? '' : 'none';
                });
            });

            // Event: Game selection
            $$('#session-game-grid .game-select-item').forEach(item => {
                item.addEventListener('click', () => {
                    $$('#session-game-grid .game-select-item').forEach(i => i.classList.remove('selected'));
                    item.classList.add('selected');
                    sessionState.selectedGame = item.dataset.game;
                    renderSession();
                });
            });

            // Event: Player toggles
            $$('#session-player-grid .player-toggle').forEach(toggle => {
                toggle.addEventListener('click', () => {
                    const player = toggle.dataset.player;
                    if (sessionState.selectedPlayers.includes(player)) {
                        sessionState.selectedPlayers = sessionState.selectedPlayers.filter(p => p !== player);
                    } else {
                        sessionState.selectedPlayers.push(player);
                    }
                    renderSession();
                });
            });

            // Event: Confirm session
            $('#btn-confirm-session').addEventListener('click', () => confirmSession());

            // Event: Player management
            $$('#player-mgmt-list .player-mgmt-btn.edit').forEach(btn => {
                btn.addEventListener('click', () => showEditPlayerModal(btn.dataset.name));
            });
            $$('#player-mgmt-list .player-mgmt-btn.pin').forEach(btn => {
                btn.addEventListener('click', () => showAdminPinResetModal(btn.dataset.name));
            });
            $$('#player-mgmt-list .player-mgmt-btn.delete').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const name = btn.dataset.name;
                    if (confirm(`"${name}" wirklich loeschen? Coins und History bleiben erhalten.`)) {
                        try {
                            await api('DELETE', `/users/${encodeURIComponent(name)}`);
                            showToast(`${name} geloescht.`, 'error');
                            await refreshPlayers();
                            renderSession();
                        } catch (e) { console.error(e); }
                    }
                });
            });

            // Event: Add player
            const newName = $('#new-player-name');
            const newPin = $('#new-player-pin');
            const newRole = $('#new-player-role');
            const addBtn = $('#btn-add-player');

            function validateAddPlayer() {
                addBtn.disabled = !(newName.value.trim() && newPin.value.length >= 4);
            }
            newName.addEventListener('input', validateAddPlayer);
            newPin.addEventListener('input', validateAddPlayer);

            addBtn.addEventListener('click', async () => {
                const name = newName.value.trim();
                const pin = newPin.value;
                const role = newRole.value;
                if (!name || pin.length < 4) return;
                try {
                    await api('POST', '/users', { name, pin, role });
                    showToast(`${name} hinzugefuegt!`, 'success');
                    playSound('coin');
                    await refreshPlayers();
                    renderSession();
                } catch (e) {
                    showToast(`"${name}" existiert bereits!`, 'error');
                    playSound('error');
                }
            });

            // Event: Admin manual coins
            const adminCoinPlayer = $('#admin-coin-player');
            const adminCoinAmount = $('#admin-coin-amount');
            const adminCoinReason = $('#admin-coin-reason');
            const adminCoinBtn = $('#btn-admin-coins');

            function updateAdminCoinBtn() {
                const valid = adminCoinPlayer.value && adminCoinAmount.value && parseInt(adminCoinAmount.value) !== 0;
                adminCoinBtn.disabled = !valid;
            }

            adminCoinPlayer.addEventListener('change', updateAdminCoinBtn);
            adminCoinAmount.addEventListener('input', updateAdminCoinBtn);

            adminCoinBtn.addEventListener('click', async () => {
                const player = adminCoinPlayer.value;
                const amount = parseInt(adminCoinAmount.value);
                const reason = adminCoinReason.value.trim() || 'Manuelle Vergabe (Admin)';
                if (!player || !amount) return;

                try {
                    if (amount > 0) {
                        await api('POST', '/coins/add', { player, amount, reason });
                        showCoinAnimation(amount);
                        showToast(`${amount} Coins an ${player} vergeben!`, 'success');
                    } else {
                        await api('POST', '/coins/add', { player, amount, reason });
                        showToast(`${amount} Coins bei ${player} abgezogen.`, 'error');
                        playSound('spend');
                    }
                    adminCoinPlayer.value = '';
                    adminCoinAmount.value = '';
                    adminCoinReason.value = '';
                    adminCoinBtn.disabled = true;
                } catch (e) { console.error(e); }
            });

            // Event: Reset
            $('#btn-reset-all').addEventListener('click', async () => {
                if (confirm('WIRKLICH alle Gameparty Daten loeschen? Das kann nicht rueckgaengig gemacht werden!')) {
                    if (confirm('Bist du SICHER?')) {
                        try {
                            await api('DELETE', '/reset');
                            state.currentPlayer = null;
                            state.role = null;
                            localStorage.removeItem(LOCAL_KEYS.PLAYER);
                            localStorage.removeItem(LOCAL_KEYS.ROLE);
                            sessionState = { selectedGame: null, selectedPlayers: [] };
                            showToast('Alle Daten geloescht.', 'error');
                            updateHeader();
                            navigateTo('dashboard');
                        } catch (e) { console.error(e); }
                    }
                }
            });
        } catch (e) {
            console.error('Session error:', e);
        }
    }

    async function confirmSession() {
        const game = sessionState.selectedGame;
        const players = sessionState.selectedPlayers;

        if (!game || players.length < 3) return;

        const coinsPerPlayer = calculateSessionCoins(players.length, state.attendees.length);

        const gameObj = state.games.find(g => g.name === game);
        const gameGenres = gameObj && gameObj.genre
            ? gameObj.genre.split(',').map(g => g.trim()).filter(g => g)
            : [];

        try {
            for (const player of players) {
                await api('POST', '/coins/add', { player, amount: coinsPerPlayer, reason: `Session: ${game} (${players.length} Spieler)` });
                for (const genre of gameGenres) {
                    const result = await api('POST', '/genres-played', { player, genre });
                    if (result.isNew) {
                        await api('POST', '/coins/add', { player, amount: CONFIG.COIN_REWARDS.NEW_GENRE, reason: `Neues Genre: ${genre}` });
                    }
                }
            }

            await api('POST', '/sessions', { game, players: [...players], coinsPerPlayer });

            showCoinAnimation(coinsPerPlayer);
            showToast(`${coinsPerPlayer} Coins an ${players.length} Spieler verteilt!`, 'success');

            sessionState = { selectedGame: null, selectedPlayers: [] };
            setTimeout(() => navigateTo('dashboard'), 1500);
        } catch (e) {
            console.error('Session confirm error:', e);
            showToast('Fehler beim Session-Erstellen.', 'error');
        }
    }

    // ---- Render: Shop ----
    async function renderShop() {
        const container = $('#view-shop');

        if (!state.currentPlayer) {
            container.innerHTML = `
                <div class="section-title">Shop</div>
                <div class="empty-state mt-2">
                    <div class="empty-state-icon">?</div>
                    <div class="empty-state-text">Waehle oben deinen Namen aus,<br>um den Shop zu nutzen.</div>
                </div>`;
            return;
        }

        try {
            const coinsData = await api('GET', '/coins');
            state.coins = coinsData;
            const player = state.currentPlayer;
            const coins = coinsData[player] || 0;

            container.innerHTML = `
                <div class="section-title">Shop</div>
                <div class="card" style="text-align:center">
                    <div class="text-muted text-sm">Dein Guthaben</div>
                    <div style="font-size:2rem;font-weight:800;color:var(--accent-gold)">${coins} Coins</div>
                </div>
                <div class="shop-grid">
                    ${CONFIG.SHOP_ITEMS.map(item => `
                        <div class="shop-item ${item.id === 'buy_star' ? 'star-item' : ''}${item.isPenalty ? ' penalty-item' : ''}">
                            <div class="shop-icon">${item.icon}</div>
                            <div class="shop-info">
                                <div class="shop-name">${item.name}${item.isPenalty ? '<span class="penalty-badge">⏱ Strafbefehl</span>' : ''}</div>
                                <div class="shop-desc">${item.description}${item.isPenalty ? ' • 5 Min. Zeitlimit' : ''}</div>
                            </div>
                            <button class="shop-buy-btn" data-item="${item.id}" data-cost="${item.cost}"
                                ${coins < item.cost ? 'disabled' : ''}>
                                ${item.cost} Coins
                            </button>
                        </div>
                    `).join('')}
                </div>
            `;

            container.querySelectorAll('.shop-buy-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const itemId = btn.dataset.item;
                    const cost = parseInt(btn.dataset.cost);
                    handleShopPurchase(itemId, cost);
                });
            });

            updateHeaderCoins();
        } catch (e) {
            console.error('Shop error:', e);
        }
    }

    async function handleShopPurchase(itemId, cost) {
        const player = state.currentPlayer;
        if (!player) return;

        const item = CONFIG.SHOP_ITEMS.find(i => i.id === itemId);
        if (!item) return;

        if (itemId === 'buy_star') {
            if (confirm(`Einen Controller-Punkt für ${cost} Coins kaufen?`)) {
                try {
                    await api('POST', '/coins/spend', { player, amount: cost, reason: 'Shop: Controller-Punkt gekauft' });
                    await api('POST', '/stars/add', { player, amount: 1 });
                    state.coins[player] = (state.coins[player] || 0) - cost;
                    state.stars[player] = (state.stars[player] || 0) + 1;
                    showToast('🎮 Controller-Punkt gekauft! Du hast jetzt ' + state.stars[player] + ' Punkt(e)!', 'success');
                    updateHeader();
                    renderShop();
                } catch (e) { showToast('Nicht genug Coins!', 'error'); }
            }
            return;
        }

        if (itemId === 'force_play') {
            showTargetModal(itemId, cost, 'Wen willst du zwingen?', (target) => `${item.name} - ${target} muss mitspielen!`);
        } else if (itemId === 'drink_order') {
            showTargetModal(itemId, cost, 'Wer muss trinken? 🍺', (target) => `🍺 ${state.currentPlayer} befiehlt: ${target} TRINKEN!`);
        } else {
            if (confirm(`"${item.name}" fuer ${cost} Coins kaufen?`)) {
                try {
                    await api('POST', '/coins/spend', { player, amount: cost, reason: `Shop: ${item.name}` });
                    await api('POST', '/tokens', { player, type: itemId });
                    showToast(`${item.name} gekauft!`, 'gold');
                    playSound('spend');
                    renderShop();
                } catch (e) {
                    showToast('Nicht genug Coins!', 'error');
                    playSound('error');
                }
            }
        }
    }

    function showTargetModal(itemId, cost, title, toastFn) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        const item = CONFIG.SHOP_ITEMS.find(i => i.id === itemId);

        const otherPlayers = state.players.filter(p => p !== state.currentPlayer);

        modal.innerHTML = `
            <div class="modal-title">${title}</div>
            <div class="shop-modal-content">
                ${otherPlayers.map(p => `
                    <button class="shop-target-btn" data-target="${p}">${p}</button>
                `).join('')}
            </div>
            <button class="modal-close-btn" id="modal-cancel">Abbrechen</button>
        `;

        overlay.classList.add('show');

        modal.querySelectorAll('.shop-target-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const target = btn.dataset.target;
                overlay.classList.remove('show');
                try {
                    await api('POST', '/coins/spend', { player: state.currentPlayer, amount: cost, reason: `Shop: ${item.name} (Ziel: ${target})` });
                    await api('POST', '/tokens', { player: state.currentPlayer, type: itemId });
                    const msg = toastFn ? toastFn(target) : `${item.name} - ${target} muss mitspielen!`;
                    showToast(msg, 'gold');
                    // Ziel: Task mit Bestätigungspflicht
                    const deadline = item?.isPenalty ? Date.now() + 5 * 60 * 1000 : null;
                    await api('POST', '/player-events', {
                        target, type: itemId, from_player: state.currentPlayer, message: msg,
                        ...(deadline ? { deadline } : {})
                    });
                    playSound('spend');
                    renderShop();
                } catch (e) {
                    showToast('Nicht genug Coins!', 'error');
                    playSound('error');
                }
            });
        });

        $('#modal-cancel').addEventListener('click', () => {
            overlay.classList.remove('show');
        });
    }

    function showTaskModal(ev) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        const item = CONFIG.SHOP_ITEMS.find(i => i.id === ev.type);
        const hasTimer = !!(ev.deadline);
        let timerInterval = null;

        function renderTimer(remainingMs) {
            const sec = Math.max(0, Math.ceil(remainingMs / 1000));
            const m = Math.floor(sec / 60), s = sec % 60;
            const col = sec < 60 ? 'var(--accent-red)' : sec < 120 ? '#ff9800' : 'var(--text-secondary)';
            return hasTimer ? `
                <div id="task-timer" style="text-align:center;font-size:1.6rem;font-weight:800;color:${col};padding:0.4rem 0">
                    ⏱️ ${m}:${s.toString().padStart(2,'0')}
                </div>
                <div style="text-align:center;font-size:0.78rem;color:var(--text-secondary);padding-bottom:0.5rem">
                    Strafe bei Ablauf: −${item?.cost ?? '?'} Coins
                </div>` : '';
        }

        modal.innerHTML = `
            <div class="modal-title">🎯 Aufgabe für dich!</div>
            <div style="text-align:center;padding:1rem;font-size:1.1rem">${ev.message}</div>
            ${renderTimer(ev.deadline ? ev.deadline - Date.now() : 0)}
            <button class="btn-propose" id="task-confirm-btn">✅ OK (Erledigt)</button>
        `;
        overlay.classList.add('show');

        if (hasTimer) {
            timerInterval = setInterval(() => {
                const rem = ev.deadline - Date.now();
                if (rem <= 0) {
                    clearInterval(timerInterval);
                    applyPenalty(ev, item);
                    return;
                }
                const el = $('#task-timer');
                if (!el) { clearInterval(timerInterval); return; }
                const sec = Math.ceil(rem / 1000), m = Math.floor(sec/60), s = sec%60;
                el.textContent = `⏱️ ${m}:${s.toString().padStart(2,'0')}`;
                el.style.color = sec < 60 ? 'var(--accent-red)' : sec < 120 ? '#ff9800' : 'var(--text-secondary)';
            }, 1000);
        }

        $('#task-confirm-btn').addEventListener('click', async () => {
            if (timerInterval) clearInterval(timerInterval);
            overlay.classList.remove('show');
            const ackMessages = {
                drink_order: `🍺 ${state.currentPlayer} hat getrunken!`,
                force_play: `🎮 ${state.currentPlayer} spielt mit!`,
            };
            const ackMsg = ackMessages[ev.type] || `✅ ${state.currentPlayer} hat die Aufgabe erledigt!`;
            try {
                await api('POST', '/player-events', { target: ev.from_player, type: 'task_ack', from_player: state.currentPlayer, message: ackMsg });
            } catch {}
        });
    }

    async function applyPenalty(ev, item) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        const penalty = item?.cost ?? 0;
        try {
            await api('POST', '/coins/spend', {
                player: state.currentPlayer,
                amount: penalty,
                reason: `Strafe: "${item?.name}" nicht rechtzeitig erledigt`
            });
        } catch { /* ignorieren wenn nicht genug Coins */ }
        modal.innerHTML = `
            <div class="modal-title">⏰ Zeit abgelaufen!</div>
            <div style="text-align:center;padding:1rem;font-size:1.1rem">
                Du hast die Aufgabe nicht rechtzeitig erledigt!<br>
                <span style="color:var(--accent-red);font-weight:700">−${penalty} Coins</span> wurden abgezogen.
            </div>
            <button class="btn-propose" id="penalty-close-btn">OK</button>
        `;
        overlay.classList.add('show');
        $('#penalty-close-btn').addEventListener('click', () => overlay.classList.remove('show'));
        try {
            await api('POST', '/player-events', {
                target: ev.from_player, type: 'task_ack',
                from_player: state.currentPlayer,
                message: `⏰ ${state.currentPlayer} hat "${item?.name}" NICHT rechtzeitig erledigt! −${penalty} Coins Strafe.`
            });
        } catch {}
    }

    function showAckModal(msg) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        modal.innerHTML = `
            <div class="modal-title">✅ Bestätigung</div>
            <div style="text-align:center; padding: 1rem; font-size: 1.1rem;">${msg}</div>
            <button class="btn-propose" id="ack-close-btn">OK</button>
        `;
        overlay.classList.add('show');
        $('#ack-close-btn').addEventListener('click', () => overlay.classList.remove('show'));
    }

    async function showStartSessionModal() {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        const gamesData = await api('GET', '/games');
        const sortedGames = [...gamesData].sort((a, b) => getMatchCount(b) - getMatchCount(a));
        modal.innerHTML = `
            <div class="modal-title">🎮 Raum erstellen</div>
            <input type="text" id="ss-search" class="search-input" placeholder="Spiel suchen..." style="margin-bottom:0.5rem">
            <div class="game-select-grid" id="ss-game-grid" style="max-height:50vh;overflow-y:auto">
                ${sortedGames.map(g => `<div class="game-select-item" data-game="${g.name}">${g.name}</div>`).join('')}
            </div>
            <button class="modal-close-btn" id="ss-cancel">Abbrechen</button>
        `;
        overlay.classList.add('show');
        $('#ss-search').addEventListener('input', e => {
            const s = e.target.value.toLowerCase();
            modal.querySelectorAll('.game-select-item').forEach(el => {
                el.style.display = el.dataset.game.toLowerCase().includes(s) ? '' : 'none';
            });
        });
        modal.querySelectorAll('.game-select-item').forEach(el => {
            el.addEventListener('click', async () => {
                overlay.classList.remove('show');
                try {
                    await api('POST', '/live-sessions', { game: el.dataset.game, leader: state.currentPlayer });
                    showToast(`Raum "${el.dataset.game}" erstellt — warte auf Spieler.`, 'success');
                    renderDashboard();
                } catch (e) { showToast(e.message || 'Fehler beim Erstellen des Raums.', 'error'); }
            });
        });
        $('#ss-cancel').addEventListener('click', () => overlay.classList.remove('show'));
    }

    async function showPlanSessionModal() {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        const gamesData = await api('GET', '/games');
        const sortedGames = [...gamesData].sort((a, b) => getMatchCount(b) - getMatchCount(a));
        let selectedGame = null;
        modal.innerHTML = `
            <div class="modal-title">📅 Session planen</div>
            <input type="text" id="ps-search" class="search-input" placeholder="Spiel suchen..." style="margin-bottom:0.5rem">
            <div class="game-select-grid" id="ps-game-grid" style="max-height:35vh;overflow-y:auto">
                ${sortedGames.map(g => `<div class="game-select-item" data-game="${g.name}">${g.name}</div>`).join('')}
            </div>
            <div style="display:flex;gap:0.5rem;margin-top:0.75rem;align-items:center">
                <input type="date" id="ps-day" style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary)">
                <input type="time" id="ps-time" style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary)">
            </div>
            <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
                <button class="btn-propose" id="ps-confirm" disabled>Planen</button>
                <button class="modal-close-btn" id="ps-cancel">Abbrechen</button>
            </div>
        `;
        overlay.classList.add('show');
        $('#ps-search').addEventListener('input', e => {
            const s = e.target.value.toLowerCase();
            modal.querySelectorAll('.game-select-item').forEach(el => {
                el.style.display = el.dataset.game.toLowerCase().includes(s) ? '' : 'none';
            });
        });
        modal.querySelectorAll('.game-select-item').forEach(el => {
            el.addEventListener('click', () => {
                modal.querySelectorAll('.game-select-item').forEach(i => i.classList.remove('selected'));
                el.classList.add('selected');
                selectedGame = el.dataset.game;
                $('#ps-confirm').disabled = false;
            });
        });
        $('#ps-confirm').addEventListener('click', async () => {
            if (!selectedGame) return;
            const day = $('#ps-day').value;
            const time = $('#ps-time').value;
            overlay.classList.remove('show');
            try {
                await api('POST', '/proposals', {
                    game: selectedGame,
                    leader: state.currentPlayer,
                    scheduledDay: day,
                    scheduledTime: time,
                    isNewGame: 0
                });
                showToast(`"${selectedGame}" geplant!`, 'success');
                renderDashboard();
            } catch (e) { showToast('Fehler beim Planen.', 'error'); }
        });
        $('#ps-cancel').addEventListener('click', () => overlay.classList.remove('show'));
    }

    // ---- Header ----
    function updateHeader() {
        const playerBtn = $('#header-player-btn');
        const logoutBtn = $('#header-logout-btn');
        const coinsDisplay = $('#header-coins');
        const starsDisplay = $('#header-stars');

        if (state.currentPlayer) {
            playerBtn.textContent = state.currentPlayer + (isAdmin() ? ' (Admin)' : '');
            playerBtn.style.display = 'inline-block';
            logoutBtn.style.display = 'inline-block';
            coinsDisplay.textContent = getPlayerCoins(state.currentPlayer);
            coinsDisplay.parentElement.style.display = 'flex';
            const playerStars = getPlayerStars(state.currentPlayer);
            if (starsDisplay) {
                starsDisplay.textContent = playerStars;
                starsDisplay.parentElement.style.display = playerStars > 0 ? 'flex' : 'none';
            }
        } else {
            playerBtn.textContent = 'Einloggen';
            playerBtn.style.display = 'inline-block';
            logoutBtn.style.display = 'none';
            coinsDisplay.parentElement.style.display = 'none';
            if (starsDisplay) starsDisplay.parentElement.style.display = 'none';
        }

        const bellBtn = $('#notif-bell-btn');
        if (bellBtn) bellBtn.style.display = state.currentPlayer ? '' : 'none';
    }

    // ---- Render: Challenges (Duelle) ----
    async function renderChallenges() {
        const container = $('#view-challenges');
        if (!state.currentPlayer) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚔️</div><div class="empty-state-text">Bitte einloggen um Duelle zu sehen.</div></div>';
            return;
        }

        try {
            const [challenges, coinsData, starsData] = await Promise.all([
                api('GET', '/challenges'),
                api('GET', '/coins'),
                api('GET', '/stars')
            ]);
            state.coins = coinsData;
            state.stars = starsData;

            const myCoins = getPlayerCoins(state.currentPlayer);
            const myStars = getPlayerStars(state.currentPlayer);
            const opponents = state.players.filter(p => p !== state.currentPlayer);

            const statusLabels = { pending: 'Offen', accepted: 'Angenommen', completed: 'Gewinner steht', paid: 'Ausgezahlt', rejected: 'Abgelehnt' };

            function renderCard(c) {
                const isChallenger = c.challenger === state.currentPlayer;
                const isOpponent = c.opponent === state.currentPlayer;
                const admin = isAdmin();
                const pot = [];
                if (c.stakeCoins > 0) pot.push(`${c.stakeCoins * 2} Coins`);
                if (c.stakeStars > 0) pot.push(`${c.stakeStars * 2} 🎮`);
                const potStr = pot.length ? pot.join(' + ') : 'Kein Einsatz';

                let actionsHTML = '';

                if (c.status === 'pending' && isOpponent) {
                    actionsHTML = `
                        <div class="proposal-actions">
                            <button class="btn-join ch-accept" data-id="${c.id}">Annehmen</button>
                            <button class="btn-leave ch-reject" data-id="${c.id}">Ablehnen</button>
                        </div>`;
                } else if (c.status === 'accepted' && isChallenger) {
                    actionsHTML = `
                        <div class="proposal-actions">
                            <select class="ch-winner-select" data-id="${c.id}" style="background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.3rem 0.5rem;font-size:0.85rem;">
                                <option value="">Gewinner wählen…</option>
                                <option value="${c.challenger}">${c.challenger}</option>
                                <option value="${c.opponent}">${c.opponent}</option>
                            </select>
                            <button class="btn-approve ch-complete" data-id="${c.id}">Bestätigen</button>
                        </div>`;
                } else if (c.status === 'completed' && admin) {
                    actionsHTML = `
                        <div class="proposal-actions">
                            <button class="btn-approve ch-payout" data-id="${c.id}">🏆 Pott freigeben</button>
                        </div>`;
                }

                if (admin && c.status !== 'paid') {
                    actionsHTML += `<div class="proposal-actions"><button class="btn-leave ch-delete" data-id="${c.id}">✖ Löschen</button></div>`;
                }

                const winnerInfo = c.winner ? `<div class="game-meta" style="margin-top:0.3rem;">🏆 ${c.winner}</div>` : '';

                const highlightClass = String(c.id) === String(focusChallengeId) ? ' highlight-challenge' : '';
                return `
                    <div class="proposal-card${highlightClass}" data-id="${c.id}">
                        <div class="proposal-card-header">
                            <span style="font-weight:700;">${c.challenger} ⚔️ ${c.opponent}</span>
                            <span class="status-badge ${c.status}">${statusLabels[c.status] || c.status}</span>
                        </div>
                        <div class="game-meta">${c.game}</div>
                        <div class="game-meta">Pott: ${potStr}</div>
                        ${winnerInfo}
                        ${actionsHTML}
                    </div>`;
            }

            const cardsHTML = challenges.length
                ? challenges.map(renderCard).join('')
                : '<div class="empty-state"><div class="empty-state-text">Noch keine Duelle. Fordere jemanden heraus!</div></div>';

            container.innerHTML = `
                <div class="proposal-form">
                    <div class="card-title" style="margin-bottom:0.75rem;">⚔️ Neues Duell</div>
                    <div class="proposal-row">
                        <select id="ch-opponent" style="flex:1;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem;font-size:0.9rem;">
                            <option value="">Gegner wählen…</option>
                            ${opponents.map(p => `<option value="${p}">${p}</option>`).join('')}
                        </select>
                    </div>
                    <div class="proposal-row">
                        <select id="ch-game" style="flex:1;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem;font-size:0.9rem;">
                            <option value="">Spiel wählen…</option>
                            ${state.games.filter(g => g.status === 'approved').sort((a, b) => a.name.localeCompare(b.name)).map(g => `<option value="${g.name}">${g.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="proposal-row">
                        <input id="ch-coins" type="number" min="0" max="${myCoins}" placeholder="Coins (max ${myCoins})" style="flex:1;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem;font-size:0.9rem;">
                        <input id="ch-stars" type="number" min="0" max="${myStars}" placeholder="🎮 (max ${myStars})" style="flex:1;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem;font-size:0.9rem;">
                    </div>
                    <button class="btn-propose" id="ch-create">Herausfordern!</button>
                </div>
                ${cardsHTML}
            `;

            // Event: Create challenge
            $('#ch-create').addEventListener('click', async () => {
                const opponent = $('#ch-opponent').value;
                const game = $('#ch-game').value;
                const stakeCoins = parseInt($('#ch-coins').value) || 0;
                const stakeStars = parseInt($('#ch-stars').value) || 0;
                if (!opponent) { showToast('Bitte Gegner wählen', 'error'); playSound('error'); return; }
                if (!game) { showToast('Bitte Spiel angeben', 'error'); playSound('error'); return; }
                if (stakeCoins === 0 && stakeStars === 0) { showToast('Bitte einen Einsatz angeben', 'error'); playSound('error'); return; }
                try {
                    await api('POST', '/challenges', { challenger: state.currentPlayer, opponent, game, stakeCoins, stakeStars });
                    showToast(`Duell gegen ${opponent} erstellt!`, 'success');
                    playSound('coin');
                    renderChallenges();
                } catch (e) {
                    showToast('Fehler: ' + (JSON.parse(e.message).error || e.message), 'error');
                    playSound('error');
                }
            });

            // Event: Accept
            container.querySelectorAll('.ch-accept').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        await api('PUT', `/challenges/${btn.dataset.id}/accept`, { player: state.currentPlayer });
                        showToast('Duell angenommen!', 'success');
                        playSound('coin');
                        renderChallenges();
                    } catch (e) {
                        showToast('Fehler: ' + (JSON.parse(e.message).error || e.message), 'error');
                        playSound('error');
                    }
                });
            });

            // Event: Reject
            container.querySelectorAll('.ch-reject').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        await api('PUT', `/challenges/${btn.dataset.id}/reject`, { player: state.currentPlayer });
                        showToast('Duell abgelehnt', 'success');
                        renderChallenges();
                    } catch (e) {
                        showToast('Fehler: ' + (JSON.parse(e.message).error || e.message), 'error');
                        playSound('error');
                    }
                });
            });

            // Event: Complete (set winner)
            container.querySelectorAll('.ch-complete').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const select = container.querySelector(`.ch-winner-select[data-id="${btn.dataset.id}"]`);
                    const winner = select ? select.value : '';
                    if (!winner) { showToast('Bitte Gewinner wählen', 'error'); playSound('error'); return; }
                    try {
                        await api('PUT', `/challenges/${btn.dataset.id}/complete`, { player: state.currentPlayer, winner });
                        showToast(`Gewinner: ${winner}`, 'success');
                        playSound('coin');
                        renderChallenges();
                    } catch (e) {
                        showToast('Fehler: ' + (JSON.parse(e.message).error || e.message), 'error');
                        playSound('error');
                    }
                });
            });

            // Event: Payout (admin)
            container.querySelectorAll('.ch-payout').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        const result = await api('PUT', `/challenges/${btn.dataset.id}/payout`);
                        showToast(`Pott ausgezahlt! ${result.winner} gewinnt!`, 'success');
                        playSound('coin');
                        showCoinAnimation(0);
                        const coinsData = await api('GET', '/coins');
                        state.coins = coinsData;
                        updateHeaderCoins();
                        renderChallenges();
                    } catch (e) {
                        showToast('Fehler: ' + (JSON.parse(e.message).error || e.message), 'error');
                        playSound('error');
                    }
                });
            });

            // Event: Delete (admin)
            container.querySelectorAll('.ch-delete').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        await api('DELETE', `/challenges/${btn.dataset.id}`);
                        showToast('Duell gelöscht', 'success');
                        renderChallenges();
                    } catch (e) {
                        showToast('Fehler beim Löschen', 'error');
                        playSound('error');
                    }
                });
            });

            updateHeaderCoins();

            if (focusChallengeId) {
                const el = container.querySelector(`.proposal-card[data-id="${focusChallengeId}"]`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                focusChallengeId = null;
            }

        } catch (e) {
            console.error('renderChallenges error:', e);
            container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Fehler beim Laden der Duelle.</div></div>';
        }
    }

    function renderNotifPanel() {
        const panel = $('#notif-panel');
        const badge = $('#notif-badge');
        if (!panel) return;

        const count = pendingNotifications.length;
        if (badge) { badge.textContent = count; badge.style.display = count > 0 ? '' : 'none'; }

        if (count === 0) {
            panel.classList.remove('open');
            notifPanelOpen = false;
            panel.innerHTML = '';
            return;
        }

        panel.innerHTML = `
            <div class="notif-panel-header">
                <span>⚔️ Herausforderungen</span>
                <button class="notif-panel-close" id="notif-panel-close">✕</button>
            </div>
            ${pendingNotifications.map(n => `
                <div class="notif-panel-item" data-id="${n.id}">
                    <div class="notif-panel-body">
                        <div class="notif-panel-title">${n.challenger} fordert dich heraus!</div>
                        <div class="notif-panel-sub">${n.game} · ${n.stakeStr}</div>
                    </div>
                    <div class="notif-panel-actions">
                        <button class="notif-accept" data-id="${n.id}" title="Annehmen">✓</button>
                        <button class="notif-reject" data-id="${n.id}" title="Ablehnen">✕</button>
                    </div>
                </div>
            `).join('')}
        `;

        if (notifPanelOpen) panel.classList.add('open');

        $('#notif-panel-close').addEventListener('click', (e) => {
            e.stopPropagation();
            notifPanelOpen = false;
            panel.classList.remove('open');
        });

        panel.querySelectorAll('.notif-accept').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                try {
                    await api('PUT', `/challenges/${id}/accept`, { player: state.currentPlayer });
                    removeNotification(id);
                    showToast('Duell angenommen!', 'success');
                    playSound('coin');
                    if ($('#view-challenges').classList.contains('active')) renderChallenges();
                } catch { showToast('Fehler beim Annehmen', 'error'); }
            });
        });

        panel.querySelectorAll('.notif-reject').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                try {
                    await api('PUT', `/challenges/${id}/reject`, { player: state.currentPlayer });
                    removeNotification(id);
                    showToast('Duell abgelehnt.', 'error');
                    if ($('#view-challenges').classList.contains('active')) renderChallenges();
                } catch { showToast('Fehler beim Ablehnen', 'error'); }
            });
        });

        panel.querySelectorAll('.notif-panel-item').forEach(item => {
            item.addEventListener('click', () => {
                focusChallengeId = item.dataset.id;
                notifPanelOpen = false;
                panel.classList.remove('open');
                navigateTo('challenges');
            });
        });
    }

    function removeNotification(id) {
        const idx = pendingNotifications.findIndex(n => n.id == id);
        if (idx !== -1) pendingNotifications.splice(idx, 1);
        renderNotifPanel();
    }

    async function pollChallenges() {
        if (!state.currentPlayer) return;
        try {
            const events = await api('GET', `/player-events/${encodeURIComponent(state.currentPlayer)}`);
            for (const ev of events) {
                if (ev.type === 'task_ack') {
                    // Bestätigung für den Auftraggeber
                    showAckModal(ev.message);
                    if (Notification.permission === 'granted') new Notification('✅ Bestätigt', { body: ev.message });
                } else {
                    showTaskModal(ev);
                    if (Notification.permission === 'granted') new Notification('🎮 Gameparty', { body: ev.message });
                }
                if (getNotifPref('sound')) playSound('challenge');
                try { await api('DELETE', `/player-events/${ev.id}`); } catch {}
            }
        } catch (e) { /* ignorieren */ }
        try {
            const challenges = await api('GET', '/challenges');
            const newOnes = challenges.filter(c =>
                c.status === 'pending' &&
                c.opponent === state.currentPlayer &&
                !notifiedChallengeIds.has(c.id)
            );
            for (const c of newOnes) {
                notifiedChallengeIds.add(c.id);
                const stakeStr = [
                    c.stakeCoins > 0 ? `${c.stakeCoins} Coins` : '',
                    c.stakeStars > 0 ? `${c.stakeStars} 🎮` : ''
                ].filter(Boolean).join(' + ') || 'Kein Einsatz';
                pendingNotifications.push({ id: c.id, challenger: c.challenger, game: c.game, stakeStr });
                notifPanelOpen = true;
                renderNotifPanel();
                if (getNotifPref('visual') && Notification.permission === 'granted') {
                    new Notification('⚔️ Duell-Herausforderung!', {
                        body: `${c.challenger} fordert dich heraus!\n${c.game} – Einsatz: ${stakeStr}`
                    });
                }
                if (getNotifPref('sound')) {
                    playSound('challenge');
                }
            }
        } catch (e) { /* Polling-Fehler ignorieren */ }
    }

    function refreshActiveView() {
        if (!state.currentPlayer) return;
        const activeView = document.querySelector('.view.active');
        if (!activeView) return;
        const viewId = activeView.id.replace('view-', '');
        switch (viewId) {
            case 'dashboard': renderDashboard(); break;
            case 'matcher': renderMatcher(); break;
            case 'profile': renderProfile(); break;
            case 'session': renderSession(); break;
            case 'shop': renderShop(); break;
            case 'challenges': renderChallenges(); break;
        }
    }

    function startChallengePoll() {
        stopChallengePoll();
        // Fallback-Polling falls SSE abbricht
        challengePollInterval = setInterval(pollChallenges, 10000);
        viewRefreshInterval = setInterval(refreshActiveView, 10000);
        // SSE fuer sofortige Live-Updates
        if (typeof EventSource !== 'undefined') {
            sseSource = new EventSource('/api/events');
            sseSource.addEventListener('update', () => {
                refreshActiveView();
                pollChallenges();
            });
            sseSource.onerror = () => {
                // Bei Fehler schliesst der Browser die Verbindung und versucht selbst neu
            };
        }
    }

    function stopChallengePoll() {
        if (challengePollInterval) { clearInterval(challengePollInterval); challengePollInterval = null; }
        if (viewRefreshInterval) { clearInterval(viewRefreshInterval); viewRefreshInterval = null; }
        if (sseSource) { sseSource.close(); sseSource = null; }
    }

    async function updateHeaderCoins() {
        if (state.currentPlayer) {
            const coinsDisplay = $('#header-coins');
            coinsDisplay.textContent = getPlayerCoins(state.currentPlayer);
            const starsDisplay = $('#header-stars');
            if (starsDisplay) starsDisplay.textContent = getPlayerStars(state.currentPlayer);
        }
    }

    function logout() {
        stopChallengePoll();
        notifiedChallengeIds.clear();
        pendingNotifications.length = 0;
        renderNotifPanel();
        state.currentPlayer = null;
        state.role = null;
        localStorage.removeItem(LOCAL_KEYS.PLAYER);
        localStorage.removeItem(LOCAL_KEYS.ROLE);
        updateHeader();
        updateNavVisibility();
        navigateTo('dashboard');
        setTimeout(() => showLoginModal(), 300);
    }

    // ---- Login Modal ----
    async function showLoginModal() {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');

        try {
            const users = await api('GET', '/users');
            modal.innerHTML = `
                <div class="modal-title">Einloggen</div>
                <div class="modal-player-grid">
                    ${users.map(u => `
                        <button class="modal-player-btn" data-player="${u.name}">${u.name}${u.role === 'admin' ? ' <span class="admin-badge">Admin</span>' : ''}</button>
                    `).join('')}
                </div>
            `;

            overlay.classList.add('show');

            modal.querySelectorAll('.modal-player-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    showPinInput(btn.dataset.player);
                });
            });
        } catch (e) {
            console.error('Login modal error:', e);
        }
    }

    function showPinInput(playerName) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');

        modal.innerHTML = `
            <div class="login-step">
                <button class="login-back-btn" id="pin-back">\u2190 Zurueck</button>
                <div class="login-player-name">${playerName}</div>
                <div style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:1rem">PIN eingeben</div>
                <div class="pin-input-row">
                    <input class="pin-digit" type="number" inputmode="numeric" maxlength="1" data-idx="0" autocomplete="off">
                    <input class="pin-digit" type="number" inputmode="numeric" maxlength="1" data-idx="1" autocomplete="off">
                    <input class="pin-digit" type="number" inputmode="numeric" maxlength="1" data-idx="2" autocomplete="off">
                    <input class="pin-digit" type="number" inputmode="numeric" maxlength="1" data-idx="3" autocomplete="off">
                </div>
                <div class="pin-error" id="pin-error"></div>
                <div class="pin-hint">4-stellige PIN</div>
            </div>
        `;

        const digits = modal.querySelectorAll('.pin-digit');
        digits[0].focus();

        digits.forEach((input, idx) => {
            input.addEventListener('input', (e) => {
                const val = e.target.value;
                if (val.length > 1) e.target.value = val.slice(-1);
                if (val && idx < 3) {
                    digits[idx + 1].focus();
                }
                const pin = Array.from(digits).map(d => d.value).join('');
                if (pin.length === 4) {
                    attemptLogin(playerName, pin);
                }
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !e.target.value && idx > 0) {
                    digits[idx - 1].focus();
                }
            });
        });

        modal.querySelector('#pin-back').addEventListener('click', () => {
            showLoginModal();
        });
    }

    async function attemptLogin(playerName, pin) {
        try {
            const result = await api('POST', '/login', { name: playerName, pin });
            // Login erfolgreich
            state.currentPlayer = playerName;
            state.role = result.role;
            localStorage.setItem(LOCAL_KEYS.PLAYER, JSON.stringify(state.currentPlayer));
            localStorage.setItem(LOCAL_KEYS.ROLE, JSON.stringify(state.role));
            notifiedChallengeIds.clear();
            startChallengePoll();

            const overlay = $('#modal-overlay');
            overlay.classList.remove('show');

            updateHeader();
            updateNavVisibility();
            showToast(`Willkommen, ${playerName}!`, result.role === 'admin' ? 'gold' : 'success');
            playSound('coin');

            const activeNav = document.querySelector('.nav-item.active');
            if (activeNav) navigateTo(activeNav.dataset.view);
        } catch (e) {
            const errorEl = document.querySelector('#pin-error');
            if (errorEl) errorEl.textContent = 'Falsche PIN!';
            playSound('error');
            document.querySelectorAll('.pin-digit').forEach(d => { d.value = ''; });
            document.querySelector('.pin-digit').focus();
        }
    }

    // ---- Admin Modals ----
    function showEditPlayerModal(playerName) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');

        const user = (state._usersCache || []).find(u => u.name === playerName);
        const role = user ? user.role : 'player';

        modal.innerHTML = `
            <div class="modal-title">Spieler bearbeiten</div>
            <div class="admin-coins-form">
                <input type="text" id="edit-player-name" value="${playerName}" placeholder="Name">
                <select id="edit-player-role">
                    <option value="player" ${role === 'player' ? 'selected' : ''}>Spieler</option>
                    <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
                <button class="btn-admin-coins" id="btn-save-player">Speichern</button>
            </div>
            <button class="modal-close-btn" id="modal-cancel">Abbrechen</button>
        `;

        overlay.classList.add('show');

        modal.querySelector('#btn-save-player').addEventListener('click', async () => {
            const newName = modal.querySelector('#edit-player-name').value.trim();
            const newRole = modal.querySelector('#edit-player-role').value;
            if (!newName) return;
            try {
                await api('PUT', `/users/${encodeURIComponent(playerName)}`, { newName, role: newRole });
                overlay.classList.remove('show');
                showToast(`${newName} aktualisiert!`, 'success');
                if (state.currentPlayer === playerName) {
                    state.currentPlayer = newName;
                    state.role = newRole;
                    localStorage.setItem(LOCAL_KEYS.PLAYER, JSON.stringify(newName));
                    localStorage.setItem(LOCAL_KEYS.ROLE, JSON.stringify(newRole));
                }
                await refreshPlayers();
                updateHeader();
                renderSession();
            } catch (e) {
                showToast('Name existiert bereits!', 'error');
                playSound('error');
            }
        });

        modal.querySelector('#modal-cancel').addEventListener('click', () => {
            overlay.classList.remove('show');
        });
    }

    function showAdminPinResetModal(playerName) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');

        modal.innerHTML = `
            <div class="modal-title">PIN zuruecksetzen</div>
            <div style="text-align:center;margin-bottom:1rem">
                <div style="color:var(--text-secondary)">Spieler</div>
                <div style="font-size:1.2rem;font-weight:700;color:var(--accent-gold)">${playerName}</div>
            </div>
            <div class="admin-coins-form">
                <input type="number" id="admin-new-pin" placeholder="Neue PIN (4 Ziffern)" inputmode="numeric" maxlength="4" autocomplete="off">
                <button class="btn-admin-coins" id="btn-admin-set-pin" disabled>PIN setzen</button>
            </div>
            <button class="modal-close-btn" id="modal-cancel">Abbrechen</button>
        `;

        overlay.classList.add('show');

        const pinInput = modal.querySelector('#admin-new-pin');
        const setBtn = modal.querySelector('#btn-admin-set-pin');

        pinInput.addEventListener('input', () => {
            setBtn.disabled = pinInput.value.length < 4;
        });

        setBtn.addEventListener('click', async () => {
            const newPin = pinInput.value;
            if (newPin.length < 4) return;
            try {
                await api('PUT', `/users/${encodeURIComponent(playerName)}/pin`, { newPin });
                overlay.classList.remove('show');
                showToast(`PIN von ${playerName} geaendert!`, 'gold');
                playSound('coin');
            } catch (e) { console.error(e); }
        });

        modal.querySelector('#modal-cancel').addEventListener('click', () => {
            overlay.classList.remove('show');
        });
    }

    // ---- Helper: Refresh players list ----
    async function refreshPlayers() {
        try {
            const users = await api('GET', '/users');
            state.players = users.map(u => u.name);
            state._usersCache = users;
        } catch (e) { console.error(e); }
    }

    // ---- Init ----
    async function init() {
        // Restore session from localStorage
        try {
            state.currentPlayer = JSON.parse(localStorage.getItem(LOCAL_KEYS.PLAYER));
        } catch { state.currentPlayer = null; }
        try {
            state.role = JSON.parse(localStorage.getItem(LOCAL_KEYS.ROLE));
        } catch { state.role = null; }
        try {
            state.soundEnabled = JSON.parse(localStorage.getItem(LOCAL_KEYS.SOUND));
        } catch { state.soundEnabled = false; }

        // Load initial data from server
        try {
            const data = await api('GET', '/init');
            state.games = data.games;
            state.players = data.players;
            state.attendees = data.attendees;
            state.coins = data.coins;
            state.stars = data.stars || {};
            state._usersCache = data.users;

            // Validate that current player still exists
            if (state.currentPlayer && !data.players.includes(state.currentPlayer)) {
                state.currentPlayer = null;
                state.role = null;
                localStorage.removeItem(LOCAL_KEYS.PLAYER);
                localStorage.removeItem(LOCAL_KEYS.ROLE);
            }

            console.log(`Gameparty: ${state.games.length} Spiele geladen.`);
        } catch (e) {
            console.error('Init error - Server nicht erreichbar?', e);
            showToast('Server nicht erreichbar!', 'error');
        }

        // Setup navigation
        $$('.nav-item').forEach(nav => {
            nav.addEventListener('click', () => navigateTo(nav.dataset.view));
        });

        // Header player selection + logout
        $('#header-player-btn').addEventListener('click', showLoginModal);
        $('#header-logout-btn').addEventListener('click', logout);

        // Notification bell toggle
        $('#notif-bell-btn').addEventListener('click', () => {
            if (pendingNotifications.length === 0) return;
            notifPanelOpen = !notifPanelOpen;
            $('#notif-panel').classList.toggle('open', notifPanelOpen);
        });

        // Sound toggle
        const soundBtn = $('#sound-toggle');
        if (soundBtn) {
            soundBtn.classList.toggle('active', state.soundEnabled);
            soundBtn.addEventListener('click', () => {
                state.soundEnabled = !state.soundEnabled;
                localStorage.setItem(LOCAL_KEYS.SOUND, JSON.stringify(state.soundEnabled));
                soundBtn.classList.toggle('active', state.soundEnabled);
                if (state.soundEnabled) playSound('coin');
            });
        }

        // Close modal on overlay click
        $('#modal-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget && state.currentPlayer) {
                e.currentTarget.classList.remove('show');
            }
        });

        updateHeader();
        updateNavVisibility();
        const savedView = localStorage.getItem(LOCAL_KEYS.VIEW) || 'dashboard';
        navigateTo(savedView);

        if (state.currentPlayer) {
            startChallengePoll();
        } else {
            setTimeout(() => showLoginModal(), 500);
        }
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
