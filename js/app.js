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
        soundEnabled: false,
        version: '',
        allUsers: []
    };

    // ---- Medium Options ----
    const MEDIUM_OPTIONS = [
        { id: 'lan',       label: 'LAN',        icon: '🖥️' },
        { id: 'steam',     label: 'Steam',      icon: '🎮' },
        { id: 'ubisoft',   label: 'Ubisoft',    icon: '📦' },
        { id: 'battlenet', label: 'Battle.net', icon: '💀' },
        { id: 'epic',      label: 'Epic Games', icon: '⚡' },
        { id: 'ea',        label: 'EA App',     icon: '🎯' },
        { id: 'riot',      label: 'Riot Games', icon: '💎' },
        { id: 'other',     label: 'Andere',     icon: '🗂️' }
    ];

    // ---- Bulk Select State ----
    const selectedGames = new Set();

    let challengePollInterval = null;
    let viewRefreshInterval = null;
    let sseSource = null;
    let activeTaskTimer = null; // Globaler Timer fuer showTaskModal – verhindert doppelte Timer
    const notifiedChallengeIds = new Set();
    const shownPenaltyIds = new Set(); // Penalties die bereits als Modal gezeigt wurden
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
        popup.textContent = t('coins_anim', amount);
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

    function getUserInfo(playerName) {
        return state.allUsers.find(u => u.name === playerName) || {};
    }

    function getPreferredMedium(playerName) {
        const u = getUserInfo(playerName);
        if (u.steam) return 'steam';
        if (u.ubisoft) return 'ubisoft';
        if (u.battlenet) return 'battlenet';
        if (u.epic) return 'epic';
        if (u.ea) return 'ea';
        if (u.riot) return 'riot';
        return 'lan';
    }

    function renderPlayerChip(playerName) {
        const info = getUserInfo(playerName);
        const hasData = info.ip || info.steam || info.ubisoft || info.battlenet || info.epic || info.ea || info.riot || info.discord || info.teamspeak;
        const icons = [
            info.ip ? `<span class="icon-copy" style="cursor:pointer" data-copy-value="${info.ip}">🖥️</span>` : '',
            info.steam ? `<span class="icon-copy" style="cursor:pointer" data-copy-value="${info.steam}">${createIconSvg('steam', '12px')}</span>` : '',
            info.ubisoft ? `<span class="icon-copy" style="cursor:pointer" data-copy-value="${info.ubisoft}">${createIconSvg('ubisoft', '12px')}</span>` : '',
            info.battlenet ? `<span class="icon-copy" style="cursor:pointer" data-copy-value="${info.battlenet}">${createIconSvg('battlenet', '12px')}</span>` : '',
            info.epic ? `<span class="icon-copy" style="cursor:pointer" data-copy-value="${info.epic}">${createIconSvg('epic', '12px')}</span>` : '',
            info.ea ? `<span class="icon-copy" style="cursor:pointer" data-copy-value="${info.ea}">${createIconSvg('ea', '12px')}</span>` : '',
            info.riot ? `<span class="icon-copy" style="cursor:pointer" data-copy-value="${info.riot}">${createIconSvg('riot', '12px')}</span>` : '',
            info.discord ? `<span class="icon-copy" style="cursor:pointer" data-copy-value="${info.discord}">${createIconSvg('discord', '12px')}</span>` : '',
            info.teamspeak ? `<span class="icon-copy" style="cursor:pointer" data-copy-value="${info.teamspeak}">${createIconSvg('teamspeak', '12px')}</span>` : '',
        ].filter(Boolean).join('');

        const tooltipLines = [
            info.ip ? `🖥️ ${info.ip}` : '',
            info.steam ? `Steam: ${info.steam}` : '',
            info.ubisoft ? `Ubisoft: ${info.ubisoft}` : '',
            info.battlenet ? `Battle.net: ${info.battlenet}` : '',
            info.epic ? `Epic: ${info.epic}` : '',
            info.ea ? `EA App: ${info.ea}` : '',
            info.riot ? `Riot: ${info.riot}` : '',
            info.discord ? `Discord: ${info.discord}` : '',
            info.teamspeak ? `TeamSpeak: ${info.teamspeak}` : '',
        ].filter(Boolean).join('<br>');

        if (!hasData) return `<span class="player-chip">${playerName}</span>`;

        return `<span class="player-chip player-chip-info" data-player="${playerName}" data-tooltip="${tooltipLines.replace(/"/g, '&quot;')}">
            ${playerName}
            <span class="player-chip-icons">${icons}</span>
        </span>`;
    }

    function renderLeaderIcons(leaderName) {
        const info = getUserInfo(leaderName);
        const icons = [];
        if (info.ip)       icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="🖥️ LAN-IP<br>${info.ip}" data-copy-value="${info.ip}">🖥️</span>`);
        if (info.steam)    icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="Steam<br>${info.steam}" data-copy-value="${info.steam}">${createIconSvg('steam', '16px')}</span>`);
        if (info.ubisoft)  icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="Ubisoft Connect<br>${info.ubisoft}" data-copy-value="${info.ubisoft}">${createIconSvg('ubisoft', '16px')}</span>`);
        if (info.battlenet)icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="Battle.net<br>${info.battlenet}" data-copy-value="${info.battlenet}">${createIconSvg('battlenet', '16px')}</span>`);
        if (info.epic)     icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="Epic Games<br>${info.epic}" data-copy-value="${info.epic}">${createIconSvg('epic', '16px')}</span>`);
        if (info.ea)       icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="EA App<br>${info.ea}" data-copy-value="${info.ea}">${createIconSvg('ea', '16px')}</span>`);
        if (info.riot)     icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="Riot Games<br>${info.riot}" data-copy-value="${info.riot}">${createIconSvg('riot', '16px')}</span>`);
        if (info.discord)  icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="Discord<br>${info.discord}" data-copy-value="${info.discord}">${createIconSvg('discord', '16px')}</span>`);
        if (info.teamspeak) icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="TeamSpeak<br>${info.teamspeak}" data-copy-value="${info.teamspeak}">${createIconSvg('teamspeak', '16px')}</span>`);
        if (!icons.length) return '';
        return `<div class="leader-info-icons">${icons.join('')}</div>`;
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
            case 'activities': renderActivities(); break;
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
            const [coinsData, starsData, proposalsData, liveSessionsData, usersData] = await Promise.all([
                api('GET', '/coins'),
                api('GET', '/stars'),
                api('GET', '/proposals'),
                api('GET', '/live-sessions'),
                api('GET', '/users')
            ]);
            const userIpMap = Object.fromEntries((usersData || []).map(u => [u.name, u.ip || '']));
            state.coins = coinsData;
            state.stars = starsData;
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
                            <span style="font-size:0.9em">C</span>
                        </div>
                    </div>`;
            });

            // Next game suggestion
            let nextGameHTML = '';
            if (topGame) {
                const matchPlayers = getMatchingPlayers(topGame);
                nextGameHTML = `
                    <div class="card next-game-card">
                        <div class="card-title">${t('next_game_title')}</div>
                        <div class="match-count">${matchPlayers.length}</div>
                        <div class="next-game-name">${topGame.name}</div>
                        <div class="match-players-list">
                            ${matchPlayers.map(p => `<span class="player-chip">${p}</span>`).join('')}
                        </div>
                        <div class="next-game-info">
                            <div class="info-tag">${topGame.genre || '?'}</div>
                            <div class="info-tag">Max ${topGame.maxPlayers}</div>
                        </div>
                    </div>`;
            } else {
                nextGameHTML = `
                    <div class="card next-game-card">
                        <div class="card-title">${t('next_game_title')}</div>
                        <div class="empty-state">
                            <div class="empty-state-icon">🎮</div>
                            <div class="empty-state-text">${t('next_game_empty', CONFIG.MIN_MATCH)}</div>
                        </div>
                    </div>`;
            }

            // Geplante Sessions (pending + approved) und aktive Proposals (active)
            const activeProposals = allProposals.filter(p => p.status === 'active');
            const plannedProposals = allProposals.filter(p => ['pending', 'approved'].includes(p.status));
            const plannedSessionsHTML = plannedProposals.map(renderProposalCard).join('') ||
                `<div class="empty-state-text" style="padding:0.5rem 0;font-size:0.85rem;color:var(--text-secondary)">${t('no_planned_sessions')}</div>`;

            // Recent sessions moved to profile
            let sessionsHTML = '';

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
                        statusBadge = `<span style="color:#6699ff;font-size:0.8rem">${t('session_lobby')}</span>`;
                        if (!isInSession) {
                            actionsHTML += `<button class="btn-session-join" data-sid="${s.id}" data-action="join">${t('btn_join')}</button>`;
                        } else if (!isLeader) {
                            actionsHTML += `<button class="btn-session-leave" data-sid="${s.id}" data-action="leave">${t('btn_leave')}</button>`;
                        }
                        if (isLeader || isAdmin()) {
                            actionsHTML += `<button class="btn-session-start" data-sid="${s.id}" data-action="start">${t('btn_start_session')}</button>`;
                            actionsHTML += `<button class="btn-session-end" data-sid="${s.id}" data-action="cancel" style="font-size:0.75rem;opacity:0.6">${t('btn_cancel')}</button>`;
                        }
                    } else if (s.status === 'running') {
                        statusBadge = `<span style="color:var(--accent-green);font-size:0.8rem">${t('session_running')}${duration ? ` · ${duration}` : ''}</span>`;
                        if (isLeader || isAdmin()) {
                            actionsHTML += `<button class="btn-session-end" data-sid="${s.id}" data-action="end">${t('btn_end')}</button>`;
                        }
                    } else if (s.status === 'ended') {
                        statusBadge = `<span class="pending-approval-badge">${t('session_awaiting_approval')}</span>`;
                    }

                    return `
                        <div class="card live-session-card ${s.status}">
                            <div class="live-session-header">
                                <span class="live-session-game">${s.game}</span>
                                ${statusBadge}
                            </div>
                            <div class="live-session-meta">${t('session_group_leader')} ${s.leader}</div>
                            ${renderLeaderIcons(s.leader)}
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
                        ${t('live_sessions')}
                        ${state.currentPlayer ? `<button class="btn-session-join" id="btn-start-session">${t('btn_create_room')}</button>` : ''}
                    </div>
                    ${hasAnything
                        ? liveSessionsHTML + activeProposalsHTML
                        : `<div class="empty-state-text" style="padding:0.5rem 0;font-size:0.85rem;color:var(--text-secondary)">${t('no_active_sessions')}</div>`}
                </div>
                <div class="card" id="planned-sessions-container">
                    <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
                        ${t('planned_sessions')}
                        ${state.currentPlayer ? `<button class="btn-session-join" id="btn-plan-session">${t('btn_plan_session')}</button>` : ''}
                    </div>
                    ${plannedSessionsHTML}
                </div>
                ${nextGameHTML}
                <div class="card">
                    <div class="card-title">${t('leaderboard')}</div>
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
                            if (confirm(t('confirm_end_session'))) {
                                await api('PUT', `/live-sessions/${sid}/end`);
                            }
                        } else if (action === 'cancel') {
                            if (confirm(t('confirm_cancel_room'))) {
                                await api('DELETE', `/live-sessions/${sid}`);
                            }
                        }
                    } catch (e) {
                        showToast(e.message || t('save_error'), 'error');
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

            const attendeesHTML = `
                <div class="card">
                    <div class="card-title">${t('present')}</div>
                    <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
                        ${state.attendees.map(p => `<span class="player-chip">${p}</span>`).join('')}
                    </div>
                </div>`;

            // Genre-Dropdown fuer Suggest-Form
            const genreSelectHTML = `<select id="suggest-genre" class="genre-select">
                <option value="">${t('select_genre')}</option>
                ${genresData.map(g => `<option value="${g}">${g}</option>`).join('')}
            </select>`;

            const suggestFormHTML = state.currentPlayer ? `
                <div class="card">
                    <div class="card-title">${t('suggest_game')}</div>
                    <div class="proposal-form">
                        <input type="text" id="suggest-name" placeholder="${t('label_name')}">
                        ${genreSelectHTML}
                        <div class="proposal-row">
                            <input type="number" id="suggest-maxplayers" placeholder="${t('label_max_players')}" min="2" max="64" inputmode="numeric">
                        </div>
                        <button class="btn-propose" id="btn-suggest-game" disabled>${t('btn_suggest')}</button>
                    </div>
                </div>` : '';

            let suggestedHTML = '';
            if (suggestedGames.length > 0) {
                suggestedHTML = `
                    <div class="proposal-section-title">${t('suggested_games', suggestedGames.length)}</div>
                    <div class="game-list" id="suggested-game-list">
                        ${suggestedGames.map(g => renderSuggestedGameCard(g, admin)).join('')}
                    </div>`;
            }

            container.innerHTML = `
                <div class="section-title">${t('games_title')}</div>
                ${attendeesHTML}
                ${suggestFormHTML}
                ${suggestedHTML}
                <div class="proposal-section-title">${t('approved_games', approvedGames.length)}</div>
                <div class="filter-bar">
                    <input type="text" id="filter-search" class="search-input" placeholder="${t('search_game')}" style="margin-bottom:0">
                    <select id="filter-genre">
                        <option value="">${t('all_genres')}</option>
                        ${genresData.map(g => `<option value="${g}">${g}</option>`).join('')}
                    </select>
                    <input type="number" id="filter-min-players" min="0" max="99" step="1" value="0" placeholder="${t('min_matches')}" title="${t('min_matches')}">
                </div>
                <div class="filter-bar">
                    <div class="player-filter-chips" id="player-filter-chips">
                        ${state.attendees.map(p => `
                            <button class="player-filter-chip" data-player="${p}">${p}</button>
                        `).join('')}
                    </div>
                </div>
                <div class="game-table-header ${admin ? 'admin-header' : ''}" id="game-table-header">
                    ${admin ? `<input type="checkbox" id="select-all-games" title="${t('btn_deselect')}">` : ''}
                    <span class="gth-nr">${t('col_number')}</span>
                    <span class="gth-name">${t('col_game_genre_max')}</span>
                    <span class="gth-like">${t('col_like')}</span>
                    ${admin ? `<span class="gth-coins">${t('col_coins')}</span>` : ''}
                    ${admin ? `<span class="gth-actions">${t('col_edit')}</span>` : ''}
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
                        showToast(t('game_suggested', name), 'success');
                        playSound('coin');
                        renderMatcher();
                    } catch (e) {
                        showToast(t('game_already_exists'), 'error');
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
                    ${!g.players[state.currentPlayer] ? `<button class="btn-join" data-game="${g.name}" data-action="interest">${t('btn_interest')}</button>` :
                    (g.suggestedBy !== state.currentPlayer ? `<button class="btn-leave" data-game="${g.name}" data-action="interest">${t('btn_unregister')}</button>` : '')}
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
                    showToast(`"${gameName}" ${t('btn_release')} (${coins} C/Session)!`, 'success');
                    playSound('coin');
                    renderMatcher();
                } catch (e) { console.error(e); }
            });
        });

        container.querySelectorAll('#suggested-game-list .btn-reject').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm(t('confirm_reject_game', btn.dataset.game))) {
                    try {
                        await api('DELETE', `/games/${encodeURIComponent(btn.dataset.game)}`);
                        showToast(t('proposal_rejected'), 'error');
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
                if (!confirm(t('confirm_delete_games', names.length))) return;
                for (const name of names) {
                    try {
                        await api('DELETE', `/games/${encodeURIComponent(name)}`);
                    } catch (err) { console.error(err); }
                }
                selectedGames.clear();
                showToast(t('n_games_deleted', names.length), 'error');
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
                if (confirm(t('confirm_delete_game', deleteBtn.dataset.game))) {
                    try {
                        await api('DELETE', `/games/${encodeURIComponent(deleteBtn.dataset.game)}`);
                        showToast(t('game_deleted'), 'error');
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

            const createRoomBtn = e.target.closest('.game-create-room-btn');
            if (createRoomBtn) {
                e.stopPropagation();
                const gameName = createRoomBtn.dataset.game;
                showMediumSelectModal(gameName, async (medium) => {
                    try {
                        await api('POST', '/live-sessions', { game: gameName, leader: state.currentPlayer, medium });
                        showToast(t('room_created', gameName), 'success');
                        navigateTo('dashboard');
                    } catch (err) {
                        showToast(t('room_error'), 'error');
                    }
                });
                return;
            }
        });

        list.addEventListener('change', async (e) => {
            const coinsInput = e.target.closest('.game-coins-input');
            if (coinsInput) {
                try {
                    await api('PUT', `/games/${encodeURIComponent(coinsInput.dataset.game)}`, { sessionCoins: parseInt(coinsInput.value) || 0 });
                    showToast(t('coins_updated'), 'gold');
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
            if (count) count.textContent = t('selected_count', selectedGames.size);
        } else {
            bar.classList.remove('show');
        }
    }

    function showBulkEditModal(names) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        modal.innerHTML = `
            <div class="modal-title">${t('modal_bulk_edit_title', names.length)}</div>
            <div class="proposal-form">
                <p style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:0.75rem">
                    ${t('bulk_edit_note')}
                </p>
                <label style="font-size:0.75rem;color:var(--text-secondary)">${t('label_genre_overwrite')}</label>
                <input type="text" id="bulk-genre" placeholder="${t('placeholder_genre')}">
                <label style="font-size:0.75rem;color:var(--text-secondary)">${t('label_max_players_overwrite')}</label>
                <input type="number" id="bulk-maxplayers" placeholder="${t('placeholder_max_players')}" min="2" max="64" inputmode="numeric">
                <div class="proposal-row" style="margin-top:0.75rem">
                    <button class="btn-propose" id="bulk-save">${t('btn_save')}</button>
                    <button class="btn-leave" id="bulk-cancel">${t('btn_cancel')}</button>
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
            if (!Object.keys(payload).length) { showToast(t('no_field_filled'), 'error'); return; }
            for (const name of names) {
                try {
                    await api('PUT', `/games/${encodeURIComponent(name)}`, payload);
                } catch (err) { console.error(err); }
            }
            overlay.classList.remove('show');
            selectedGames.clear();
            showToast(t('games_updated', names.length), 'success');
            renderMatcher();
        });
    }

    function showEditGameModal(game) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        modal.innerHTML = `
            <div class="modal-title">${t('modal_edit_game_title')}</div>
            <div class="proposal-form">
                <label style="font-size:0.75rem;color:var(--text-secondary)">${t('label_name')}</label>
                <input type="text" id="edit-game-name" value="${game.name}">
                <label style="font-size:0.75rem;color:var(--text-secondary)">${t('label_genre')}</label>
                <input type="text" id="edit-game-genre" value="${game.genre || ''}">
                <div class="proposal-row">
                    <div>
                        <label style="font-size:0.75rem;color:var(--text-secondary)">${t('label_max_players')}</label>
                        <input type="number" id="edit-game-maxplayers" value="${game.maxPlayers}" min="2" max="64" inputmode="numeric">
                    </div>
                    <div>
                        <label style="font-size:0.75rem;color:var(--text-secondary)">${t('label_preview_url')}</label>
                        <input type="url" id="edit-game-previewurl" value="${game.previewUrl || ''}" placeholder="https://www.youtube.com/watch?v=...">
                    </div>
                </div>
                <div class="proposal-row" style="margin-top:0.75rem">
                    <button class="btn-propose" id="edit-game-save">${t('btn_save')}</button>
                    <button class="btn-leave" id="edit-game-cancel">${t('btn_cancel')}</button>
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
                showToast(t('game_updated'), 'success');
                renderMatcher();
            } catch (e) {
                showToast(t('save_error'), 'error');
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
            <div class="modal-title">${t('modal_preview_title')}</div>
            <div class="video-container">
                <iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1"
                    frameborder="0" allowfullscreen allow="autoplay; encrypted-media"></iframe>
            </div>
            <button class="modal-close-btn" id="modal-cancel">${t('modal_close')}</button>
        ` : `
            <div class="modal-title">${t('invalid_link')}</div>
            <p style="padding:1rem;color:var(--text-secondary)">${t('invalid_link_text')}</p>
            <button class="modal-close-btn" id="modal-cancel">${t('modal_close')}</button>
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
                    <div class="empty-state-text">${t('no_games_found')}</div>
                </div>`;
            return;
        }

        const bulkBar = admin ? `
            <div id="bulk-action-bar" class="bulk-action-bar ${selectedGames.size > 0 ? 'show' : ''}">
                <span id="bulk-count">${t('selected_count', selectedGames.size)}</span>
                <button id="bulk-edit-btn" class="btn-bulk-action">${t('btn_bulk_edit')}</button>
                <button id="bulk-delete-btn" class="btn-bulk-action danger">${t('btn_bulk_delete')}</button>
                <button id="bulk-deselect-btn" class="btn-bulk-clear">${t('btn_deselect')}</button>
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

            const createRoomBtn = player ? `<button class="game-create-room-btn" data-game="${g.name}" title="${t('btn_create_room')}">🖥️</button>` : '';

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
                    ${createRoomBtn}
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
            pending: t('status_pending'), approved: t('status_approved'),
            active: t('status_active'), completed: t('status_completed'), rejected: t('status_rejected')
        };

        let coinStatusHTML = '';
        if (p.status === 'completed' && p.coinsApproved === false) {
            coinStatusHTML = `<div class="proposal-schedule" style="color:var(--accent-gold)">🪙 ${p.pendingCoins || 0} C ${t('session_awaiting_approval')}</div>`;
        } else if (p.status === 'completed' && p.coinsApproved === true) {
            coinStatusHTML = `<div class="proposal-schedule" style="color:var(--accent-green)">✓ ${p.pendingCoins || 0} C paid out</div>`;
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
            actions.push(`<button class="btn-join" data-id="${p.id}">${t('btn_join_session')}</button>`);
        }
        if (isJoined && !isLeader && ['pending', 'approved'].includes(p.status)) {
            actions.push(`<button class="btn-leave" data-id="${p.id}">${t('btn_leave_session')}</button>`);
        }

        if (isLeader && ['pending', 'approved'].includes(p.status)) {
            actions.push(`<button class="btn-start-session" data-id="${p.id}">${t('btn_start_now')}</button>`);
        }
        if (isLeader && p.status === 'active') {
            actions.push(`<button class="btn-end-session" data-id="${p.id}">${t('btn_end_session')}</button>`);
        }
        if (isLeader && ['pending', 'approved'].includes(p.status)) {
            actions.push(`<button class="btn-withdraw" data-id="${p.id}" style="font-size:0.75rem;opacity:0.6">${t('btn_withdraw')}</button>`);
        }

        if (admin && p.status === 'pending') {
            actions.push(`<button class="btn-approve" data-id="${p.id}">${t('btn_approve')}</button>`);
            actions.push(`<button class="btn-reject" data-id="${p.id}">${t('btn_reject')}</button>`);
        }

        if (admin && p.status === 'completed' && p.coinsApproved === false) {
            actions.push(`<button class="btn-approve-coins" data-id="${p.id}">${t('btn_approve_coins', p.pendingCoins || '?')}</button>`);
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
                    <span class="proposal-game-name">${p.game}${p.isNewGame ? ` <span class="genre-tag">${t('status_new')}</span>` : ''}</span>
                    <span class="status-badge ${p.status}">${statusLabels[p.status]}</span>
                </div>
                <div class="leader-badge">👑 ${p.leader}</div>
                ${renderLeaderIcons(p.leader)}
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
                    showToast(t('joined'), 'success');
                    renderProposals();
                } catch (e) { console.error(e); }
            });
        });

        container.querySelectorAll('.btn-leave').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api('POST', `/proposals/${btn.dataset.id}/leave`, { player: state.currentPlayer });
                    showToast(t('left'), 'gold');
                    renderProposals();
                } catch (e) { console.error(e); }
            });
        });

        container.querySelectorAll('.btn-start-session').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api('PUT', `/proposals/${btn.dataset.id}`, { status: 'active', startedAt: Date.now() });
                    showToast(t('session_started'), 'success');
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
                    showToast(t('session_ended', coinsAmount), 'gold');
                    renderProposals();
                    if (typeof renderDashboard === 'function') await renderDashboard();
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
                    showToast(t('coins_released', coinsPerPlayer, proposal.players.length), 'success');
                    renderProposals();
                } catch (e) { console.error(e); }
            });
        });

        container.querySelectorAll('.btn-withdraw').forEach(btn => {
            btn.addEventListener('click', async () => {
                const isAdminDelete = btn.dataset.adminDelete === 'true';
                const label = isAdminDelete ? t('confirm_delete_proposal') : t('confirm_withdraw');
                if (confirm(label)) {
                    try {
                        await api('DELETE', `/proposals/${btn.dataset.id}`);
                        showToast(t('proposal_removed'), 'error');
                        renderProposals();
                    } catch (e) { console.error(e); }
                }
            });
        });

        container.querySelectorAll('.btn-approve').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api('PUT', `/proposals/${btn.dataset.id}`, { status: 'approved', approvedAt: Date.now() });
                    showToast(t('proposal_approved'), 'success');
                    playSound('coin');
                    renderProposals();
                } catch (e) { console.error(e); }
            });
        });

        container.querySelectorAll('.btn-reject').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm(t('confirm_reject_proposal'))) {
                    try {
                        await api('PUT', `/proposals/${btn.dataset.id}`, { status: 'rejected' });
                        showToast(t('proposal_rejected'), 'error');
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
        if (adminPanelOpen) renderAdminPanel();
    }

    // ---- Render: Profile ----
    async function renderProfile() {
        const container = $('#view-profile');
        if (!state.currentPlayer) {
            container.innerHTML = `
                <div class="empty-state mt-2">
                    <div class="empty-state-icon">👤</div>
                    <div class="empty-state-text">${t('profile_not_logged_in').replace('\n', '<br>')}</div>
                </div>`;
            return;
        }

        try {
            const player = state.currentPlayer;
            const [coinsData, starsData, history, tokens, sessionsData, allUsers] = await Promise.all([
                api('GET', '/coins'),
                api('GET', '/stars'),
                api('GET', `/history/${encodeURIComponent(player)}`),
                api('GET', `/tokens/${encodeURIComponent(player)}`),
                api('GET', '/sessions'),
                api('GET', '/users')
            ]);
            const sessions = sessionsData;
            const currentUserIp = (allUsers.find(u => u.name === player) || {}).ip || '';
            const currentUser = allUsers.find(u => u.name === player) || {};
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

            // Recent sessions (letzte 5)
            const recentSessions = sessions.filter(s => s.players.includes(player)).slice(0, 5);
            let recentSessionsHTML = '';
            if (recentSessions.length > 0) {
                recentSessionsHTML = `
                    <div class="card">
                        <div class="card-title">${t('recent_sessions')}</div>
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
                                    <div class="session-history-coins">${s.coinsPerPlayer} ${t('coins_per_player')}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>`;
            }

            let tokensHTML = '';
            if (skipTokens.length || forceTokens.length || chooseTokens.length) {
                tokensHTML = `
                    <div class="card">
                        <div class="card-title">${t('active_tokens')}</div>
                        <div class="tokens-row">
                            ${skipTokens.map((_, i) => `<button class="token-badge" data-type="skip_token" data-idx="${i}">${t('token_names_skip')}</button>`).join('')}
                            ${forceTokens.map((_, i) => `<button class="token-badge force-play" data-type="force_play" data-idx="${i}">${t('token_names_force')}</button>`).join('')}
                            ${chooseTokens.map((_, i) => `<button class="token-badge choose-next" data-type="choose_next" data-idx="${i}">${t('token_names_choose')}</button>`).join('')}
                        </div>
                        <div class="text-sm text-muted mt-1">${t('token_tap_to_redeem')}</div>
                    </div>`;
            }

            const recentHistory = history.slice(0, 20);
            let historyHTML = '';
            if (recentHistory.length > 0) {
                historyHTML = `
                    <div class="card">
                        <div class="card-title">${t('history_title')}</div>
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
                            <div class="stat-label">${t('stat_earned')}</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value spent">${spent}</div>
                            <div class="stat-label">${t('stat_spent')}</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value sessions">${sessionCount}</div>
                            <div class="stat-label">${t('stat_sessions')}</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-value">${playerStars}</div>
                            <div class="stat-label">${t('stat_ctrl_points')}</div>
                        </div>
                    </div>
                </div>
                <div class="card">
                    <div class="card-title">🔗 ${t('profile_connection_title')}</div>
                    <div class="accounts-grid">
                        <label class="accounts-label">🖥️ LAN-IP</label>
                        <input type="text" id="profile-ip-input" class="accounts-input" placeholder="${t('profile_ip_placeholder')}" value="${currentUserIp}">
                        <label class="accounts-label">${createIconSvg('steam')} ${t('profile_steam')}</label>
                        <input type="text" id="profile-steam-input" class="accounts-input" placeholder="${t('profile_accounts_placeholder_steam')}" value="${(currentUser && currentUser.steam) || ''}">
                        <label class="accounts-label">${createIconSvg('ubisoft')} ${t('profile_ubisoft')}</label>
                        <input type="text" id="profile-ubisoft-input" class="accounts-input" placeholder="${t('profile_accounts_placeholder_ubisoft')}" value="${(currentUser && currentUser.ubisoft) || ''}">
                        <label class="accounts-label">${createIconSvg('battlenet')} ${t('profile_battlenet')}</label>
                        <input type="text" id="profile-battlenet-input" class="accounts-input" placeholder="${t('profile_accounts_placeholder_battlenet')}" value="${(currentUser && currentUser.battlenet) || ''}">
                        <label class="accounts-label">${createIconSvg('epic')} ${t('profile_epic')}</label>
                        <input type="text" id="profile-epic-input" class="accounts-input" placeholder="${t('profile_accounts_placeholder_epic')}" value="${(currentUser && currentUser.epic) || ''}">
                        <label class="accounts-label">${createIconSvg('ea')} ${t('profile_ea')}</label>
                        <input type="text" id="profile-ea-input" class="accounts-input" placeholder="${t('profile_accounts_placeholder_ea')}" value="${(currentUser && currentUser.ea) || ''}">
                        <label class="accounts-label">${createIconSvg('riot')} ${t('profile_riot')}</label>
                        <input type="text" id="profile-riot-input" class="accounts-input" placeholder="${t('profile_accounts_placeholder_riot')}" value="${(currentUser && currentUser.riot) || ''}">
                        <label class="accounts-label">${createIconSvg('discord')} ${t('profile_discord')}</label>
                        <input type="text" id="profile-discord-input" class="accounts-input" placeholder="${t('profile_accounts_placeholder_discord')}" value="${(currentUser && currentUser.discord) || ''}">
                        <label class="accounts-label">${createIconSvg('teamspeak')} ${t('profile_teamspeak')}</label>
                        <input type="text" id="profile-teamspeak-input" class="accounts-input" placeholder="${t('profile_accounts_placeholder_teamspeak')}" value="${(currentUser && currentUser.teamspeak) || ''}">
                    </div>
                    <button class="btn-admin-coins" id="btn-save-accounts" style="width:100%;margin-top:0.75rem">${t('btn_save_accounts')}</button>
                </div>
                ${tokensHTML}
                ${recentSessionsHTML}
                <div class="card">
                    <div class="card-title">${t('change_pin')}</div>
                    <div class="admin-coins-form">
                        <input type="number" id="pin-old" placeholder="${t('placeholder_old_pin')}" inputmode="numeric" maxlength="4" autocomplete="off">
                        <input type="number" id="pin-new1" placeholder="${t('placeholder_new_pin')}" inputmode="numeric" maxlength="4" autocomplete="off">
                        <input type="number" id="pin-new2" placeholder="${t('placeholder_new_pin_repeat')}" inputmode="numeric" maxlength="4" autocomplete="off">
                        <button class="btn-admin-coins" id="btn-change-pin" disabled>${t('btn_change_pin')}</button>
                        <div class="pin-error" id="pin-change-error"></div>
                    </div>
                </div>
                ${historyHTML}
                <div class="card">
                    <div class="card-title">${t('notifications_title')}</div>
                    <div class="notif-settings">
                        <div class="notif-row">
                            <span>${t('notif_visual')}</span>
                            <button class="notif-toggle ${getNotifPref('visual') ? 'active' : ''}" id="notif-visual-btn">
                                ${getNotifPref('visual') ? t('on') : t('off')}
                            </button>
                        </div>
                        <div class="notif-row">
                            <span>${t('notif_sound')}</span>
                            <button class="notif-toggle ${getNotifPref('sound') ? 'active' : ''}" id="notif-sound-btn">
                                ${getNotifPref('sound') ? t('on') : t('off')}
                            </button>
                        </div>
                        ${getNotifPref('visual') && Notification.permission === 'granted' ? `
                        <div class="notif-row">
                            <span>${t('notif_test')}</span>
                            <button class="btn-secondary" id="notif-test-btn">🔔 Testen</button>
                        </div>` : ''}
                    </div>
                </div>
                <div class="card">
                    <div class="card-title">${t('settings_title', '⚙️ Einstellungen')}</div>
                    <div class="notif-settings">
                        <div class="notif-row">
                            <span>🌐 ${_lang === 'de' ? 'Sprache' : 'Language'}</span>
                            <button class="lang-toggle-btn" id="lang-toggle-btn" title="Switch language">${_lang === 'de' ? '🇩🇪 DE' : '🇬🇧 EN'}</button>
                        </div>
                    </div>
                </div>
                <div class="card">
                    <button class="btn-danger" id="btn-logout" style="width:100%">🚪 ${t('btn_logout', 'Logout')}</button>
                </div>
            `;

            // Token einloesen
            container.querySelectorAll('.token-badge').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const type = btn.dataset.type;
                    const names = { skip_token: t('token_names_skip'), force_play: t('token_names_force'), choose_next: t('token_names_choose') };
                    if (confirm(t('token_redeem_confirm', names[type]))) {
                        try {
                            await api('DELETE', `/tokens/${encodeURIComponent(player)}/${type}`);
                            showToast(t('token_redeemed', names[type]), 'gold');
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
                    pinError.textContent = t('pin_mismatch');
                    playSound('error');
                    return;
                }
                if (pinNew1.value.length < 4) {
                    pinError.textContent = t('pin_too_short');
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
                    showToast(t('pin_changed'), 'success');
                    playSound('coin');
                } catch (e) {
                    pinError.textContent = t('pin_wrong_old');
                    playSound('error');
                }
            });

            const visualBtn = container.querySelector('#notif-visual-btn');
            const soundNotifBtn = container.querySelector('#notif-sound-btn');

            visualBtn.addEventListener('click', async () => {
                const current = getNotifPref('visual');
                if (!current) {
                    if (!('Notification' in window)) {
                        showToast(t('notif_no_support'), 'error'); return;
                    }
                    if (Notification.permission === 'default') {
                        const perm = await Notification.requestPermission();
                        if (perm !== 'granted') { showToast(t('notif_permission_rejected'), 'error'); return; }
                    } else if (Notification.permission === 'denied') {
                        showToast(t('notif_permission_denied'), 'error'); return;
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
                    new Notification(t('notif_test_title'), {
                        body: t('notif_test_body', player)
                    });
                });
            }

            // Save Accounts (IP + Steam + Ubisoft + Battle.net + Epic + EA + Riot + Discord + TeamSpeak)
            const saveAccountsBtn = $('#btn-save-accounts');
            if (saveAccountsBtn) {
                saveAccountsBtn.addEventListener('click', async () => {
                    const ip = ($('#profile-ip-input') || {}).value?.trim() || '';
                    const steam = ($('#profile-steam-input') || {}).value?.trim() || '';
                    const ubisoft = ($('#profile-ubisoft-input') || {}).value?.trim() || '';
                    const battlenet = ($('#profile-battlenet-input') || {}).value?.trim() || '';
                    const epic = ($('#profile-epic-input') || {}).value?.trim() || '';
                    const ea = ($('#profile-ea-input') || {}).value?.trim() || '';
                    const riot = ($('#profile-riot-input') || {}).value?.trim() || '';
                    const discord = ($('#profile-discord-input') || {}).value?.trim() || '';
                    const teamspeak = ($('#profile-teamspeak-input') || {}).value?.trim() || '';
                    try {
                        await Promise.all([
                            api('PUT', `/users/${encodeURIComponent(player)}/ip`, { ip }),
                            api('PUT', `/users/${encodeURIComponent(player)}/accounts`, { steam, ubisoft, battlenet, epic, ea, riot, discord, teamspeak }),
                        ]);
                        // Update state.allUsers lokal
                        const idx = state.allUsers.findIndex(u => u.name === player);
                        if (idx >= 0) Object.assign(state.allUsers[idx], { ip, steam, ubisoft, battlenet, epic, ea, riot, discord, teamspeak });
                        showToast(t('ip_saved'), 'success');
                    } catch (e2) { console.error(e2); }
                });
            }

            // Logout Button
            const logoutBtn = container.querySelector('#btn-logout');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', logout);
            }

            // Lang Toggle im Profil
            const langToggleBtn = container.querySelector('#lang-toggle-btn');
            if (langToggleBtn) {
                langToggleBtn.addEventListener('click', () => {
                    const currentLang = getLang();
                    const newLang = currentLang === 'de' ? 'en' : 'de';
                    setLang(newLang);
                    // setLang handles refresh via refreshActiveView() and updateNavLabels()
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
                    <div class="empty-state-text">${t('session_admin_only')}</div>
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
                    <div class="section-title" style="color:#ff9800">${t('freigabe_pending')}</div>
                    ${endedSessions.map(s => {
                        const coins = calculateSessionCoins(s.players.length, state.attendees.length);
                        return `
                            <div class="freigabe-item">
                                <strong>${s.game}</strong> · ${t('session_group_leader')} ${s.leader} · ${s.players.length} Spieler<br>
                                <div>${s.players.map(p => `<span class="player-chip">${p}</span>`).join('')}</div>
                                <div class="freigabe-coins-row">
                                    <span style="font-size:0.85rem;color:var(--text-secondary)">${t('coins_per_player_label')}</span>
                                    <input type="number" class="freigabe-coins-input" data-sid="${s.id}" value="${coins}" min="0" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary)">
                                    <button class="btn-approve freigabe-approve-btn" data-sid="${s.id}">${t('btn_freigabe_approve')}</button>
                                    <button class="btn-danger freigabe-cancel-btn" data-sid="${s.id}" style="padding:4px 10px;font-size:0.8rem">🗑️</button>
                                </div>
                            </div>`;
                    }).join('')}
                    ${completedProposals.map(renderProposalCard).join('')}
                </div>` : '';

            container.innerHTML = `
                ${freigabeHTML}
                <div class="section-title"><span class="admin-badge">Admin</span> ${t('session_start_title')}</div>

                <div class="session-step">
                    <div class="mb-1"><span class="step-number">1</span> <strong>${t('step_select_game')}</strong></div>
                    <input type="text" id="session-game-search" class="search-input" placeholder="${t('search_game_placeholder')}">
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
                    <div class="mb-1"><span class="step-number">2</span> <strong>${t('step_who_played')}</strong></div>
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
                    <div class="mb-1"><span class="step-number">3</span> <strong>${t('step_confirm')}</strong></div>
                    <div id="session-preview" class="card" style="display:${sessionState.selectedGame ? 'block' : 'none'}">
                        <div style="text-align:center">
                            <div class="text-muted text-sm">${t('label_game')}</div>
                            <div style="font-size:1.2rem;font-weight:700">${sessionState.selectedGame || '-'}</div>
                            <div class="text-muted text-sm mt-1">${t('label_players', sessionState.selectedPlayers.length)}</div>
                            <div style="font-size:1.5rem;font-weight:800;color:var(--accent-gold);margin-top:0.5rem">
                                ${calculateSessionCoins(sessionState.selectedPlayers.length, state.attendees.length)} C
                            </div>
                        </div>
                    </div>
                    <button class="btn-session-confirm" id="btn-confirm-session"
                        ${(!sessionState.selectedGame || sessionState.selectedPlayers.length < 3) ? 'disabled' : ''}>
                        ${t('btn_confirm_session')}
                    </button>
                    ${sessionState.selectedPlayers.length > 0 && sessionState.selectedPlayers.length < 3
                        ? `<div class="text-muted text-sm text-center mt-1">${t('min_players_needed')}</div>` : ''}
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
                        showToast(t('session_approved', coinsPerPlayer), 'success');
                        renderSession();
                    } catch (e) { showToast(t('session_error_approve'), 'error'); }
                });
            });
            container.querySelectorAll('.freigabe-cancel-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (confirm(t('discard_confirm'))) {
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

        } catch (e) {
            console.error('Session error:', e);
        }
    }

    // ---- Admin Panel ----
    let adminPanelOpen = false;

    function closeAdminPanel() {
        adminPanelOpen = false;
        $('#admin-panel').classList.remove('open');
        $('#admin-panel-backdrop').classList.remove('open');
        $('#admin-gear-btn').classList.remove('active');
    }

    function toggleAdminPanel() {
        if (adminPanelOpen) { closeAdminPanel(); return; }
        adminPanelOpen = true;
        $('#admin-gear-btn').classList.add('active');
        $('#admin-panel-backdrop').classList.add('open');
        renderAdminPanel();
        $('#admin-panel').classList.add('open');
    }

    async function renderAdminPanel() {
        const panel = $('#admin-panel');
        if (!panel) return;

        let usersData, liveSessionsData, allProposals;
        try {
            [usersData, liveSessionsData, allProposals] = await Promise.all([
                api('GET', '/users'),
                api('GET', '/live-sessions'),
                api('GET', '/proposals')
            ]);
        } catch (e) {
            panel.innerHTML = `<div class="admin-panel-header"><span class="admin-panel-title">⚙️ Admin</span><button class="admin-panel-close" id="ap-close">✕</button></div><div class="admin-panel-body"><p class="text-muted">${t('error_loading')}</p></div>`;
            $('#ap-close').addEventListener('click', closeAdminPanel);
            return;
        }

        // Prepare freigabe section
        const endedSessions = liveSessionsData.filter(s => s.status === 'ended');
        const completedProposals = allProposals.filter(p => p.status === 'completed' && !p.coinsApproved);
        const hasFreigabe = endedSessions.length > 0 || completedProposals.length > 0;

        let freigabeHTML = '';
        if (hasFreigabe) {
            freigabeHTML = `
                <div class="card" style="border-left: 3px solid var(--accent-gold)">
                    <div class="card-title" style="color:var(--accent-gold)">📋 ${t('freigabe_pending', 'Ausstehende Freigaben')} (${endedSessions.length + completedProposals.length})</div>
                    ${endedSessions.map(s => {
                        const coins = calculateSessionCoins(s.players.length, state.attendees.length);
                        return `
                            <div style="padding:0.5rem 0;border-bottom:1px solid var(--border);margin-bottom:0.5rem">
                                <div style="font-weight:600">${s.game}</div>
                                <div style="font-size:0.85rem;color:var(--text-secondary)">Leader: ${s.leader} · ${s.players.length} Spieler</div>
                                <div style="display:flex;gap:0.3rem;flex-wrap:wrap;margin:0.3rem 0">
                                    ${s.players.map(p => `<span class="player-chip">${p}</span>`).join('')}
                                </div>
                                <input type="number" class="freigabe-coins-input" data-sid="${s.id}" value="${coins}" min="0" style="padding:4px 6px;border-radius:4px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);width:60px;margin-right:0.5rem">
                                <button class="btn-approve freigabe-approve-btn" data-sid="${s.id}" style="padding:4px 8px;font-size:0.75rem">✓ Freigeben</button>
                            </div>`;
                    }).join('')}
                    ${completedProposals.map(p => {
                        const coins = p.pendingCoins || 0;
                        const playersList = p.players && Array.isArray(p.players) ? p.players : [];
                        return `
                            <div style="padding:0.5rem 0;border-bottom:1px solid var(--border);margin-bottom:0.5rem">
                                <div style="font-weight:600">${p.game}</div>
                                <div style="font-size:0.85rem;color:var(--text-secondary)">Leader: ${p.leader} · ${playersList.length} Spieler</div>
                                <div style="display:flex;gap:0.3rem;flex-wrap:wrap;margin:0.3rem 0">
                                    ${playersList.map(pl => `<span class="player-chip">${pl}</span>`).join('')}
                                </div>
                                <input type="number" class="freigabe-coins-input" data-pid="${p.id}" value="${coins}" min="0" style="padding:4px 6px;border-radius:4px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);width:60px;margin-right:0.5rem">
                                <button class="btn-approve freigabe-approve-btn" data-pid="${p.id}" style="padding:4px 8px;font-size:0.75rem">✓ Freigeben</button>
                            </div>`;
                    }).join('')}
                </div>`;
        }

        const attendeesGridHTML = `
            <div class="card">
                <div class="card-title">👥 ${t('who_is_present', 'Anwesenheit')}</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:0.5rem" id="attendees-grid-admin">
                    ${state.players.map(p => `
                        <button class="attendee-toggle ${state.attendees.includes(p) ? 'active' : ''}" data-player="${p}" style="padding:0.6rem;border-radius:6px;border:1px solid var(--border);background:${state.attendees.includes(p) ? 'rgba(0,230,118,0.1)' : 'var(--bg-card)'};color:var(--text-primary);cursor:pointer;font-size:0.85rem">
                            ${p}
                        </button>
                    `).join('')}
                </div>
            </div>`;

        panel.innerHTML = `
            <div class="admin-panel-header">
                <span class="admin-panel-title">⚙️ ${t('admin_panel_title')}</span>
                <button class="admin-panel-close" id="ap-close">✕</button>
            </div>
            <div class="admin-panel-body">

                ${freigabeHTML}
                ${attendeesGridHTML}

                <div class="card">
                    <div class="card-title">${t('player_management')}</div>
                    <div class="player-mgmt-list" id="ap-player-mgmt-list">
                        ${usersData.map(u => `
                            <div class="player-mgmt-item">
                                <div class="player-mgmt-info">
                                    <span class="player-mgmt-name">${u.name}</span>
                                    ${u.role === 'admin' ? `<span class="admin-badge">Admin</span>` : ''}
                                </div>
                                <div class="player-mgmt-actions">
                                    <button class="player-mgmt-btn edit" data-name="${u.name}" title="Bearbeiten">&#x270E;</button>
                                    <button class="player-mgmt-btn pin" data-name="${u.name}" title="${t('modal_reset_pin_title')}">&#x1F511;</button>
                                    ${u.name !== state.currentPlayer ? `<button class="player-mgmt-btn delete" data-name="${u.name}" title="Loeschen">&#x2716;</button>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="admin-coins-form mt-2">
                        <div class="card-title" style="margin-bottom:0.25rem">${t('new_player')}</div>
                        <input type="text" id="ap-new-player-name" placeholder="${t('placeholder_name')}">
                        <input type="number" id="ap-new-player-pin" placeholder="${t('placeholder_pin')}" inputmode="numeric" maxlength="4">
                        <select id="ap-new-player-role">
                            <option value="player">${t('role_player')}</option>
                            <option value="admin">${t('role_admin')}</option>
                        </select>
                        <button class="btn-admin-coins" id="ap-btn-add-player" disabled>${t('btn_add_player')}</button>
                    </div>
                </div>

                <div class="card">
                    <div class="card-title">${t('manual_coins')}</div>
                    <div class="admin-coins-form">
                        <select id="ap-coin-player">
                            <option value="">${t('placeholder_select_player')}</option>
                            ${state.players.map(p => `<option value="${p}">${p}</option>`).join('')}
                        </select>
                        <input type="number" id="ap-coin-amount" placeholder="${t('placeholder_coin_amount')}" inputmode="numeric">
                        <input type="text" id="ap-coin-reason" placeholder="${t('placeholder_coin_reason')}">
                        <button class="btn-admin-coins" id="ap-btn-coins" disabled>${t('btn_assign_coins')}</button>
                    </div>
                </div>

                <div class="danger-zone">
                    <div class="card-title">${t('danger_zone')}</div>
                    <button class="btn-danger" id="ap-btn-reset-all">${t('btn_reset_all')}</button>
                </div>

                <div style="text-align:center;margin-top:1rem;font-size:0.75rem;color:var(--text-secondary);opacity:0.5">v${state.version}</div>

            </div>`;

        $('#ap-close').addEventListener('click', closeAdminPanel);

        // Freigabe Events
        panel.querySelectorAll('.freigabe-approve-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const sid = btn.dataset.sid;
                const pid = btn.dataset.pid;

                if (sid) {
                    // Live Session approval
                    const coinsInput = panel.querySelector(`.freigabe-coins-input[data-sid="${sid}"]`);
                    const coins = parseInt(coinsInput.value) || 0;
                    try {
                        await api('POST', `/live-sessions/${sid}/approve`, { coinsPerPlayer: coins });
                        showToast('Session freigegeben', 'success');
                        renderAdminPanel();
                    } catch (e) { showToast('Fehler beim Freigeben', 'error'); console.error(e); }
                } else if (pid) {
                    // Proposal approval
                    const coinsInput = panel.querySelector(`.freigabe-coins-input[data-pid="${pid}"]`);
                    const coins = parseInt(coinsInput.value) || 0;
                    try {
                        await api('POST', `/proposals/${pid}/approve`, { coins });
                        showToast('Geplante Session freigegeben', 'success');
                        renderAdminPanel();
                    } catch (e) { showToast('Fehler beim Freigeben', 'error'); console.error(e); }
                }
            });
        });

        // Attendees Toggle Events
        panel.querySelectorAll('#attendees-grid-admin .attendee-toggle').forEach(btn => {
            btn.addEventListener('click', async () => {
                const player = btn.dataset.player;
                if (state.attendees.includes(player)) {
                    state.attendees = state.attendees.filter(p => p !== player);
                } else {
                    state.attendees.push(player);
                }
                try {
                    await api('PUT', '/attendees', { attendees: state.attendees });
                    renderAdminPanel(); // Re-render to update button styles
                } catch (e) { console.error(e); }
            });
        });

        // Player management events
        panel.querySelectorAll('#ap-player-mgmt-list .player-mgmt-btn.edit').forEach(btn => {
            btn.addEventListener('click', () => showEditPlayerModal(btn.dataset.name));
        });
        panel.querySelectorAll('#ap-player-mgmt-list .player-mgmt-btn.pin').forEach(btn => {
            btn.addEventListener('click', () => showAdminPinResetModal(btn.dataset.name));
        });
        panel.querySelectorAll('#ap-player-mgmt-list .player-mgmt-btn.delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const name = btn.dataset.name;
                if (confirm(t('delete_player_confirm', name))) {
                    try {
                        await api('DELETE', `/users/${encodeURIComponent(name)}`);
                        showToast(t('player_deleted', name), 'error');
                        await refreshPlayers();
                        renderAdminPanel();
                    } catch (e) { console.error(e); }
                }
            });
        });

        // Add player
        const newName = $('#ap-new-player-name');
        const newPin = $('#ap-new-player-pin');
        const newRole = $('#ap-new-player-role');
        const addBtn = $('#ap-btn-add-player');
        const validate = () => { addBtn.disabled = !(newName.value.trim() && newPin.value.length >= 4); };
        newName.addEventListener('input', validate);
        newPin.addEventListener('input', validate);
        addBtn.addEventListener('click', async () => {
            const name = newName.value.trim(), pin = newPin.value, role = newRole.value;
            if (!name || pin.length < 4) return;
            try {
                await api('POST', '/users', { name, pin, role });
                showToast(t('player_added', name), 'success');
                playSound('coin');
                await refreshPlayers();
                renderAdminPanel();
            } catch (e) { showToast(t('player_exists', name), 'error'); playSound('error'); }
        });

        // Assign coins
        const coinPlayer = $('#ap-coin-player');
        const coinAmount = $('#ap-coin-amount');
        const coinReason = $('#ap-coin-reason');
        const coinBtn = $('#ap-btn-coins');
        const updateCoinBtn = () => {
            coinBtn.disabled = !(coinPlayer.value && coinAmount.value && parseInt(coinAmount.value) !== 0);
        };
        coinPlayer.addEventListener('change', updateCoinBtn);
        coinAmount.addEventListener('input', updateCoinBtn);
        coinBtn.addEventListener('click', async () => {
            const player = coinPlayer.value, amount = parseInt(coinAmount.value);
            const reason = coinReason.value.trim() || 'Manuelle Vergabe (Admin)';
            if (!player || !amount) return;
            try {
                await api('POST', '/coins/add', { player, amount, reason });
                if (amount > 0) { showCoinAnimation(amount); showToast(t('coins_given', amount, player), 'success'); }
                else { showToast(t('coins_deducted', amount, player), 'error'); playSound('spend'); }
                coinPlayer.value = ''; coinAmount.value = ''; coinReason.value = '';
                coinBtn.disabled = true;
            } catch (e) { console.error(e); }
        });

        // Danger zone
        $('#ap-btn-reset-all').addEventListener('click', async () => {
            if (confirm(t('reset_confirm_1'))) {
                if (confirm(t('reset_confirm_2'))) {
                    try {
                        await api('DELETE', '/reset');
                        state.currentPlayer = null;
                        state.role = null;
                        localStorage.removeItem(LOCAL_KEYS.PLAYER);
                        localStorage.removeItem(LOCAL_KEYS.ROLE);
                        sessionState = { selectedGame: null, selectedPlayers: [] };
                        showToast(t('all_data_deleted'), 'error');
                        closeAdminPanel();
                        updateHeader();
                        navigateTo('dashboard');
                    } catch (e) { console.error(e); }
                }
            }
        });
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
            showToast(t('session_confirmed', coinsPerPlayer, players.length), 'success');

            sessionState = { selectedGame: null, selectedPlayers: [] };
            setTimeout(() => navigateTo('dashboard'), 1500);
        } catch (e) {
            console.error('Session confirm error:', e);
            showToast(t('session_error'), 'error');
        }
    }

    // ---- Render: Shop ----
    async function renderShop() {
        const container = $('#view-shop');

        if (!state.currentPlayer) {
            container.innerHTML = `
                <div class="section-title">${t('shop_title')}</div>
                <div class="empty-state mt-2">
                    <div class="empty-state-icon">?</div>
                    <div class="empty-state-text">${t('profile_not_logged_in').replace('\n', '<br>')}</div>
                </div>`;
            return;
        }

        try {
            const coinsData = await api('GET', '/coins');
            state.coins = coinsData;
            const player = state.currentPlayer;
            const coins = coinsData[player] || 0;

            container.innerHTML = `
                <div class="section-title">${t('shop_title')}</div>
                <div class="card" style="text-align:center">
                    <div class="text-muted text-sm">${t('your_balance')}</div>
                    <div style="font-size:2rem;font-weight:800;color:var(--accent-gold)">${coins} Coins</div>
                </div>
                <div class="shop-grid">
                    ${CONFIG.SHOP_ITEMS.map(item => `
                        <div class="shop-item ${item.id === 'buy_star' ? 'star-item' : ''}${item.isPenalty ? ' penalty-item' : ''}">
                            <div class="shop-icon">${item.icon}</div>
                            <div class="shop-info">
                                <div class="shop-name">${t('item_' + item.id + '_name')}${item.isPenalty ? `<span class="penalty-badge">${t('penalty_badge')}</span>` : ''}</div>
                                <div class="shop-desc">${t('item_' + item.id + '_desc', CONFIG.STAR_PRICE)}${item.isPenalty ? ` • ${t('penalty_timer')}` : ''}</div>
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
            if (confirm(t('buy_star_confirm', cost))) {
                try {
                    await api('POST', '/coins/spend', { player, amount: cost, reason: `Shop: ${t('item_buy_star_name')}` });
                    await api('POST', '/stars/add', { player, amount: 1 });
                    state.coins[player] = (state.coins[player] || 0) - cost;
                    state.stars[player] = (state.stars[player] || 0) + 1;
                    showToast(t('star_bought', state.stars[player]), 'success');
                    updateHeader();
                    renderShop();
                } catch (e) { showToast(t('not_enough_coins'), 'error'); }
            }
            return;
        }

        if (itemId === 'force_play') {
            showTargetModal(itemId, cost, t('who_to_force'), (target) => t('force_toast', item.name, target));
        } else if (itemId === 'drink_order') {
            showTargetModal(itemId, cost, t('who_to_drink'), (target) => t('drink_toast', state.currentPlayer, target));
        } else {
            if (confirm(t('buy_item_confirm', item.name, cost))) {
                try {
                    await api('POST', '/coins/spend', { player, amount: cost, reason: `Shop: ${item.name}` });
                    await api('POST', '/tokens', { player, type: itemId });
                    showToast(t('item_bought', item.name), 'gold');
                    playSound('spend');
                    renderShop();
                } catch (e) {
                    showToast(t('not_enough_coins'), 'error');
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
            <button class="modal-close-btn" id="modal-cancel">${t('btn_cancel')}</button>
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
        // Bestehenden Timer stoppen bevor ein neues Modal geöffnet wird
        if (activeTaskTimer) { clearInterval(activeTaskTimer); activeTaskTimer = null; }

        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        const item = CONFIG.SHOP_ITEMS.find(i => i.id === ev.type);
        const hasTimer = !!(ev.deadline);

        function renderTimer(remainingMs) {
            const sec = Math.max(0, Math.ceil(remainingMs / 1000));
            const m = Math.floor(sec / 60), s = sec % 60;
            const col = sec < 60 ? 'var(--accent-red)' : sec < 120 ? '#ff9800' : 'var(--text-secondary)';
            return hasTimer ? `
                <div id="task-timer" style="text-align:center;font-size:1.6rem;font-weight:800;color:${col};padding:0.4rem 0">
                    ⏱️ ${m}:${s.toString().padStart(2,'0')}
                </div>
                <div style="text-align:center;font-size:0.78rem;color:var(--text-secondary);padding-bottom:0.5rem">
                    ${t('task_penalty_label', item?.cost ?? '?')}
                </div>` : '';
        }

        modal.innerHTML = `
            <div class="modal-title">${t('task_title')}</div>
            <div style="text-align:center;padding:1rem;font-size:1.1rem">${ev.message}</div>
            ${renderTimer(ev.deadline ? ev.deadline - Date.now() : 0)}
            <button class="btn-propose" id="task-confirm-btn">${t('task_confirm_btn')}</button>
        `;
        overlay.classList.add('show');

        if (hasTimer) {
            activeTaskTimer = setInterval(() => {
                const rem = ev.deadline - Date.now();
                if (rem <= 0) {
                    clearInterval(activeTaskTimer); activeTaskTimer = null;
                    applyPenalty(ev, item);
                    return;
                }
                const el = $('#task-timer');
                if (!el) { clearInterval(activeTaskTimer); activeTaskTimer = null; return; }
                const sec = Math.ceil(rem / 1000), m = Math.floor(sec/60), s = sec%60;
                el.textContent = `⏱️ ${m}:${s.toString().padStart(2,'0')}`;
                el.style.color = sec < 60 ? 'var(--accent-red)' : sec < 120 ? '#ff9800' : 'var(--text-secondary)';
            }, 1000);
        }

        $('#task-confirm-btn').addEventListener('click', async () => {
            if (activeTaskTimer) { clearInterval(activeTaskTimer); activeTaskTimer = null; }
            overlay.classList.remove('show');
            const ackMessages = {
                drink_order: `🍺 ${state.currentPlayer} hat getrunken!`,
                force_play: `🎮 ${state.currentPlayer} spielt mit!`,
            };
            const ackMsg = ackMessages[ev.type] || `✅ ${state.currentPlayer} hat die Aufgabe erledigt!`;
            try {
                await api('POST', '/player-events', { target: ev.from_player, type: 'task_ack', from_player: state.currentPlayer, message: ackMsg });
            } catch {}
            // Penalty aus DB löschen – aktiviert die nächste gequeuete Penalty
            try { await api('DELETE', `/player-events/${ev.id}`); } catch {}
            shownPenaltyIds.delete(ev.id);
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
            <div class="modal-title">${t('time_up_title')}</div>
            <div style="text-align:center;padding:1rem;font-size:1.1rem">
                ${t('time_up_text', penalty).split('\n')[0]}<br>
                <span style="color:var(--accent-red);font-weight:700">−${penalty} Coins</span> wurden abgezogen.
            </div>
            <button class="btn-propose" id="penalty-close-btn">${t('time_up_ok')}</button>
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
        // Penalty aus DB löschen – aktiviert die nächste gequeuete Penalty
        try { await api('DELETE', `/player-events/${ev.id}`); } catch {}
        shownPenaltyIds.delete(ev.id);
    }

    function showAckModal(msg) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        modal.innerHTML = `
            <div class="modal-title">${t('ack_title')}</div>
            <div style="text-align:center; padding: 1rem; font-size: 1.1rem;">${msg}</div>
            <button class="btn-propose" id="ack-close-btn">OK</button>
        `;
        overlay.classList.add('show');
        $('#ack-close-btn').addEventListener('click', () => overlay.classList.remove('show'));
    }

    function showMediumSelectModal(gameName, callback) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        const preferredMedium = getPreferredMedium(state.currentPlayer);
        let selectedMedium = preferredMedium;
        let customText = '';

        const mediumGrid = MEDIUM_OPTIONS.map(opt => `
            <button class="medium-select-btn ${opt.id === preferredMedium ? 'selected' : ''}" data-medium="${opt.id}" style="display:flex;flex-direction:column;align-items:center;gap:0.5rem;padding:1rem;border:2px solid var(--border);border-radius:8px;background:var(--bg-secondary);cursor:pointer;transition:all 0.2s;text-align:center">
                <span style="font-size:2rem">${opt.icon}</span>
                <span style="font-size:0.9rem;font-weight:600">${opt.label}</span>
            </button>
        `).join('');

        modal.innerHTML = `
            <div class="modal-title">Wie wird gespielt?</div>
            <div style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:1rem">${gameName}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:0.75rem;margin-bottom:1rem" id="medium-grid">
                ${mediumGrid}
            </div>
            <div id="custom-input-container" style="display:${preferredMedium === 'other' ? 'block' : 'none'};margin-bottom:1rem">
                <input type="text" id="medium-custom-text" placeholder="Platform eingeben..." style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary)">
            </div>
            <div style="display:flex;gap:0.5rem">
                <button class="btn-propose" id="medium-start-btn" style="flex:1">${t('btn_start')}</button>
                <button class="modal-close-btn" id="medium-cancel-btn" style="flex:1">${t('btn_cancel')}</button>
            </div>
        `;

        overlay.classList.add('show');

        // Medium Selection Handler
        modal.querySelectorAll('.medium-select-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.medium-select-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                selectedMedium = btn.dataset.medium;

                // Custom input zeigen/verstecken
                const customContainer = $('#custom-input-container');
                if (selectedMedium === 'other') {
                    customContainer.style.display = 'block';
                    $('#medium-custom-text').focus();
                } else {
                    customContainer.style.display = 'none';
                    customText = '';
                }
            });
        });

        // Custom Text Input Handler
        $('#medium-custom-text')?.addEventListener('input', (e) => {
            customText = e.target.value.trim();
        });

        // Start Button Handler
        $('#medium-start-btn').addEventListener('click', async () => {
            const mediumValue = selectedMedium === 'other' ? customText : selectedMedium;
            if (!mediumValue) {
                showToast('Bitte wählen Sie eine Plattform', 'error');
                return;
            }
            overlay.classList.remove('show');
            if (callback) {
                callback(mediumValue);
            }
        });

        // Cancel Button Handler
        $('#medium-cancel-btn').addEventListener('click', () => {
            overlay.classList.remove('show');
        });
    }

    async function showStartSessionModal() {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        const gamesData = await api('GET', '/games');
        const sortedGames = [...gamesData].sort((a, b) => getMatchCount(b) - getMatchCount(a));
        modal.innerHTML = `
            <div class="modal-title">${t('modal_create_room_title')}</div>
            <input type="text" id="ss-search" class="search-input" placeholder="${t('search_game_placeholder')}" style="margin-bottom:0.5rem">
            <div class="game-select-grid" id="ss-game-grid" style="max-height:50vh;overflow-y:auto">
                ${sortedGames.map(g => `<div class="game-select-item" data-game="${g.name}">${g.name}</div>`).join('')}
            </div>
            <button class="modal-close-btn" id="ss-cancel">${t('btn_cancel')}</button>
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
                showMediumSelectModal(el.dataset.game, async (medium) => {
                    try {
                        await api('POST', '/live-sessions', { game: el.dataset.game, leader: state.currentPlayer, medium });
                        showToast(t('room_created', el.dataset.game), 'success');
                        renderDashboard();
                    } catch (e) { showToast(e.message || t('room_error'), 'error'); }
                });
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
            <div class="modal-title">${t('modal_plan_session_title')}</div>
            <input type="text" id="ps-search" class="search-input" placeholder="Spiel suchen..." style="margin-bottom:0.5rem">
            <div class="game-select-grid" id="ps-game-grid" style="max-height:35vh;overflow-y:auto">
                ${sortedGames.map(g => `<div class="game-select-item" data-game="${g.name}">${g.name}</div>`).join('')}
            </div>
            <div style="display:flex;gap:0.5rem;margin-top:0.75rem;align-items:center">
                <input type="date" id="ps-day" style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary)">
                <input type="time" id="ps-time" style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary)">
            </div>
            <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
                <button class="btn-propose" id="ps-confirm" disabled>${t('btn_plan')}</button>
                <button class="modal-close-btn" id="ps-cancel">${t('btn_cancel')}</button>
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
                showToast(t('session_planned', selectedGame), 'success');
                renderDashboard();
            } catch (e) { showToast(t('plan_error'), 'error'); }
        });
        $('#ps-cancel').addEventListener('click', () => overlay.classList.remove('show'));
    }

    // ---- Header ----
    function updateHeader() {
        const playerBtn = $('#header-player-btn');
        const coinsDisplay = $('#header-coins');
        const starsDisplay = $('#header-stars');

        if (state.currentPlayer) {
            playerBtn.textContent = state.currentPlayer + (isAdmin() ? ' (Admin)' : '');
            playerBtn.style.display = 'inline-block';
            coinsDisplay.textContent = getPlayerCoins(state.currentPlayer);
            coinsDisplay.parentElement.style.display = 'flex';
            const playerStars = getPlayerStars(state.currentPlayer);
            if (starsDisplay) {
                starsDisplay.textContent = playerStars;
                starsDisplay.parentElement.style.display = playerStars > 0 ? 'flex' : 'none';
            }
        } else {
            playerBtn.textContent = t('header_login');
            playerBtn.style.display = 'inline-block';
            coinsDisplay.parentElement.style.display = 'none';
            if (starsDisplay) starsDisplay.parentElement.style.display = 'none';
        }

        const bellBtn = $('#notif-bell-btn');
        if (bellBtn) bellBtn.style.display = state.currentPlayer ? '' : 'none';

        const gearBtn = $('#admin-gear-btn');
        if (gearBtn) gearBtn.style.display = isAdmin() ? '' : 'none';
    }

    // ---- Render: Challenges (Duelle) ----
    async function renderChallenges() {
        const container = $('#view-challenges');
        if (!state.currentPlayer) {
            container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚔️</div><div class="empty-state-text">${t('challenges_not_logged_in')}</div></div>`;
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

            const statusLabels = { pending: t('duel_status_pending'), accepted: t('duel_status_accepted'), completed: t('duel_status_completed'), paid: t('duel_status_paid'), rejected: t('duel_status_rejected') };

            function renderCard(c) {
                const isChallenger = c.challenger === state.currentPlayer;
                const isOpponent = c.opponent === state.currentPlayer;
                const admin = isAdmin();
                const pot = [];
                if (c.stakeCoins > 0) pot.push(`${c.stakeCoins * 2} Coins`);
                if (c.stakeStars > 0) pot.push(`${c.stakeStars * 2} 🎮`);
                const potStr = pot.length ? pot.join(' + ') : t('no_stake');

                let actionsHTML = '';

                if (c.status === 'pending' && isOpponent) {
                    actionsHTML = `
                        <div class="proposal-actions">
                            <button class="btn-join ch-accept" data-id="${c.id}">${t('notif_accept')}</button>
                            <button class="btn-leave ch-reject" data-id="${c.id}">${t('notif_reject')}</button>
                        </div>`;
                } else if (c.status === 'accepted' && isChallenger) {
                    actionsHTML = `
                        <div class="proposal-actions">
                            <select class="ch-winner-select" data-id="${c.id}" style="background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.3rem 0.5rem;font-size:0.85rem;">
                                <option value="">${t('select_winner')}</option>
                                <option value="${c.challenger}">${c.challenger}</option>
                                <option value="${c.opponent}">${c.opponent}</option>
                            </select>
                            <button class="btn-approve ch-complete" data-id="${c.id}">${t('btn_confirm_winner')}</button>
                        </div>`;
                } else if (c.status === 'completed' && admin) {
                    actionsHTML = `
                        <div class="proposal-actions">
                            <button class="btn-approve ch-payout" data-id="${c.id}">${t('btn_payout_pot')}</button>
                        </div>`;
                }

                if (admin && c.status !== 'paid') {
                    actionsHTML += `<div class="proposal-actions"><button class="btn-leave ch-delete" data-id="${c.id}">${t('btn_delete_duel')}</button></div>`;
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
                        <div class="game-meta">${t('pot', potStr)}</div>
                        ${winnerInfo}
                        ${actionsHTML}
                    </div>`;
            }

            const cardsHTML = challenges.length
                ? challenges.map(renderCard).join('')
                : `<div class="empty-state"><div class="empty-state-text">${t('no_duels')}</div></div>`;

            container.innerHTML = `
                <div class="proposal-form">
                    <div class="card-title" style="margin-bottom:0.75rem;">${t('new_duel')}</div>
                    <div class="proposal-row">
                        <select id="ch-opponent" style="flex:1;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem;font-size:0.9rem;">
                            <option value="">${t('select_opponent')}</option>
                            ${opponents.map(p => `<option value="${p}">${p}</option>`).join('')}
                        </select>
                    </div>
                    <div class="proposal-row">
                        <select id="ch-game" style="flex:1;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem;font-size:0.9rem;">
                            <option value="">${t('select_game')}</option>
                            ${state.games.filter(g => g.status === 'approved').sort((a, b) => a.name.localeCompare(b.name)).map(g => `<option value="${g.name}">${g.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="proposal-row">
                        <input id="ch-coins" type="number" min="0" max="${myCoins}" placeholder="Coins (max ${myCoins})" style="flex:1;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem;font-size:0.9rem;">
                        <input id="ch-stars" type="number" min="0" max="${myStars}" placeholder="🎮 (max ${myStars})" style="flex:1;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem;font-size:0.9rem;">
                    </div>
                    <button class="btn-propose" id="ch-create">${t('btn_challenge')}</button>
                </div>
                ${cardsHTML}
            `;

            // Event: Create challenge
            $('#ch-create').addEventListener('click', async () => {
                const opponent = $('#ch-opponent').value;
                const game = $('#ch-game').value;
                const stakeCoins = parseInt($('#ch-coins').value) || 0;
                const stakeStars = parseInt($('#ch-stars').value) || 0;
                if (!opponent) { showToast(t('select_opponent_error'), 'error'); playSound('error'); return; }
                if (!game) { showToast(t('select_game_error'), 'error'); playSound('error'); return; }
                if (stakeCoins === 0 && stakeStars === 0) { showToast(t('select_stake_error'), 'error'); playSound('error'); return; }
                try {
                    await api('POST', '/challenges', { challenger: state.currentPlayer, opponent, game, stakeCoins, stakeStars });
                    showToast(t('duel_created', opponent), 'success');
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
                        showToast(t('duel_accepted'), 'success');
                        playSound('coin');
                        navigateTo('dashboard');
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
                        showToast(t('duel_rejected'), 'success');
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
                    if (!winner) { showToast(t('select_winner_error'), 'error'); playSound('error'); return; }
                    try {
                        await api('PUT', `/challenges/${btn.dataset.id}/complete`, { player: state.currentPlayer, winner });
                        showToast(t('winner_set', winner), 'success');
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
                        showToast(t('duel_payout', result.winner), 'success');
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
                        showToast(t('duel_deleted'), 'success');
                        renderChallenges();
                    } catch (e) {
                        showToast(t('duel_delete_error'), 'error');
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
            container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${t('duel_load_error')}</div></div>`;
        }
    }

    async function renderNotifPanel() {
        const panel = $('#notif-panel');
        const badge = $('#notif-badge');
        if (!panel) return;

        let activitiesData = { incoming: [], outgoing: [] };
        if (state.currentPlayer) {
            try {
                activitiesData = await api('GET', `/activities/${encodeURIComponent(state.currentPlayer)}`);
            } catch (e) {
                // Fehler bei Activities ignorieren - nicht kritisch
            }
        }

        const duelCount = pendingNotifications.length;
        const activitiesCount = activitiesData.incoming.filter(a => a.status === 'active').length;
        const totalCount = duelCount + activitiesCount;

        if (badge) { badge.textContent = totalCount; badge.style.display = totalCount > 0 ? '' : 'none'; }

        if (totalCount === 0) {
            panel.classList.remove('open');
            notifPanelOpen = false;
            panel.innerHTML = '';
            return;
        }

        const PENALTY_ICONS = { force_play: '🎮', drink_order: '🍺' };
        const incomingActivities = activitiesData.incoming.filter(a => a.status === 'active');

        panel.innerHTML = `
            <div class="notif-panel-header">
                <span>${t('notif_panel_title')}</span>
                <button class="notif-panel-close" id="notif-panel-close">✕</button>
            </div>
            ${duelCount > 0 ? `<div style="border-bottom:1px solid var(--border);padding:0.5rem 0.75rem;font-size:0.75rem;color:var(--text-secondary);font-weight:600">⚔️ DUELS</div>` : ''}
            ${pendingNotifications.map(n => `
                <div class="notif-panel-item" data-id="${n.id}">
                    <div class="notif-panel-body">
                        <div class="notif-panel-title">${n.challenger} ${t('notif_challenge_from', n.challenger)}</div>
                        <div class="notif-panel-sub">${n.game} · ${n.stakeStr}</div>
                    </div>
                    <div class="notif-panel-actions">
                        <button class="notif-accept" data-id="${n.id}" title="${t('notif_accept')}">✓</button>
                        <button class="notif-reject" data-id="${n.id}" title="${t('notif_reject')}">✕</button>
                    </div>
                </div>
            `).join('')}
            ${incomingActivities.length > 0 ? `<div style="border-bottom:1px solid var(--border);padding:0.5rem 0.75rem;font-size:0.75rem;color:var(--text-secondary);font-weight:600">📋 TASKS</div>` : ''}
            ${incomingActivities.map(a => `
                <div class="notif-panel-item" data-id="activity-${a.id}" style="padding:0.6rem 0.75rem;border-bottom:1px solid var(--border)">
                    <div class="notif-panel-body" style="font-size:0.85rem">
                        <div style="display:flex;gap:0.3rem;align-items:center">
                            <span>${PENALTY_ICONS[a.type] || '⚡'}</span>
                            <span>${a.message}</span>
                        </div>
                        <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:0.2rem">${a.from_player || ''}</div>
                    </div>
                    <button class="activity-done-btn notif-activity-done" data-id="${a.id}" data-from="${a.from_player || ''}" data-type="${a.type}" style="padding:4px 8px;font-size:0.75rem;background:var(--accent-green);color:white;border:none;border-radius:4px;cursor:pointer">✓</button>
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
                    showToast(t('duel_accepted'), 'success');
                    playSound('coin');
                    navigateTo('dashboard');
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

        // Activity Done Button Events
        panel.querySelectorAll('.notif-activity-done').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const fromPlayer = btn.dataset.from;
                const type = btn.dataset.type;
                const ackMessages = {
                    drink_order: `🍺 ${state.currentPlayer} hat getrunken!`,
                    force_play: `🎮 ${state.currentPlayer} spielt mit!`,
                };
                const ackMsg = ackMessages[type] || `✅ ${state.currentPlayer} hat die Aufgabe erledigt!`;
                try {
                    if (fromPlayer) await api('POST', '/player-events', { target: fromPlayer, type: 'task_ack', from_player: state.currentPlayer, message: ackMsg });
                    await api('DELETE', `/player-events/${id}`);
                    showToast('Aufgabe erledigt!', 'success');
                    playSound('coin');
                    renderNotifPanel();
                } catch (e) { console.error(e); }
            });
        });

        // Duel notification items click to navigate
        panel.querySelectorAll('.notif-panel-item').forEach(item => {
            if (!item.classList.contains('notif-activity-done')) {
                item.addEventListener('click', () => {
                    focusChallengeId = item.dataset.id;
                    notifPanelOpen = false;
                    panel.classList.remove('open');
                    navigateTo('challenges');
                });
            }
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
                    // Bestätigung für den Auftraggeber – sofort löschen
                    showAckModal(ev.message);
                    if (getNotifPref('visual') && Notification.permission === 'granted') new Notification('✅ Bestätigt', { body: ev.message });
                    if (getNotifPref('sound')) playSound('challenge');
                    try { await api('DELETE', `/player-events/${ev.id}`); } catch {}
                } else {
                    // Penalty oder andere Task – nur einmal als Modal anzeigen
                    // Löschen passiert erst wenn der Spieler bestätigt (im Modal)
                    if (!shownPenaltyIds.has(ev.id)) {
                        shownPenaltyIds.add(ev.id);
                        showTaskModal(ev);
                        if (getNotifPref('visual') && Notification.permission === 'granted') new Notification('🎮 Gameparty', { body: ev.message });
                        if (getNotifPref('sound')) playSound('challenge');
                    }
                }
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
                    new Notification(t('duel_challenge_notif_title'), {
                        body: t('duel_challenge_notif_body', c.challenger, c.game, stakeStr)
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
        // Nicht refreshen wenn User gerade interagiert (Dropdown offen, Eingabefeld fokussiert, Modal offen)
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (document.querySelector('#modal-overlay.show')) return;
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
            case 'activities': renderActivities(); break;
        }
        if (adminPanelOpen) renderAdminPanel();
    }

    async function renderActivities() {
        if (!state.currentPlayer) return;
        const container = $('#view-activities');
        if (!container) return;

        let data;
        try {
            data = await api('GET', `/activities/${encodeURIComponent(state.currentPlayer)}`);
        } catch (e) {
            container.innerHTML = `<div class="card"><p class="text-muted">${t('error_loading')}</p></div>`;
            return;
        }

        const { incoming, outgoing } = data;
        const PENALTY_ICONS = { force_play: '🎮', drink_order: '🍺' };

        function penaltyCard(ev, isIncoming) {
            const icon = PENALTY_ICONS[ev.type] || '⚡';
            const statusLabel = ev.status === 'active' ? t('activities_status_active') : t('activities_status_queued');
            const statusClass = ev.status === 'active' ? 'status-active' : 'status-queued';
            const who = isIncoming
                ? (ev.from_player ? `<span class="text-muted">${t('activities_from', ev.from_player)}</span>` : '')
                : `<span class="text-muted">${t('activities_to', ev.target)}</span>`;
            const time = new Date(ev.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const doneBtn = (isIncoming && ev.status === 'active')
                ? `<button class="activity-done-btn" data-id="${ev.id}" data-from="${ev.from_player || ''}" data-type="${ev.type}">${t('activities_mark_done')}</button>`
                : '';
            return `
                <div class="activity-item ${statusClass}">
                    <span class="activity-icon">${icon}</span>
                    <div class="activity-body">
                        <div class="activity-msg">${ev.message}</div>
                        <div class="activity-meta">${who} · ${time}</div>
                        ${doneBtn}
                    </div>
                    <span class="activity-status">${statusLabel}</span>
                </div>`;
        }

        container.innerHTML = `
            <div class="view-header"><h2>${t('activities_title')}</h2></div>
            <div class="card mb-2">
                <div class="card-title">📥 ${t('activities_incoming')}</div>
                ${incoming.length === 0
                    ? `<p class="text-muted">${t('activities_empty_incoming')}</p>`
                    : incoming.map(ev => penaltyCard(ev, true)).join('')}
            </div>
            <div class="card">
                <div class="card-title">📤 ${t('activities_outgoing')}</div>
                ${outgoing.length === 0
                    ? `<p class="text-muted">${t('activities_empty_outgoing')}</p>`
                    : outgoing.map(ev => penaltyCard(ev, false)).join('')}
            </div>`;

        container.querySelectorAll('.activity-done-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                const { id, from: fromPlayer, type } = btn.dataset;
                const ackMessages = {
                    drink_order: `🍺 ${state.currentPlayer} hat getrunken!`,
                    force_play: `🎮 ${state.currentPlayer} spielt mit!`,
                };
                const ackMsg = ackMessages[type] || `✅ ${state.currentPlayer} hat die Aufgabe erledigt!`;
                try {
                    if (fromPlayer) await api('POST', '/player-events', { target: fromPlayer, type: 'task_ack', from_player: state.currentPlayer, message: ackMsg });
                } catch {}
                try { await api('DELETE', `/player-events/${id}`); } catch {}
                shownPenaltyIds.delete(Number(id));
                renderActivities();
            });
        });
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
        if (activeTaskTimer) { clearInterval(activeTaskTimer); activeTaskTimer = null; }
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
        closeAdminPanel();
        notifiedChallengeIds.clear();
        shownPenaltyIds.clear();
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
                <div class="modal-title">${t('modal_login_title')}</div>
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
                <button class="login-back-btn" id="pin-back">${t('modal_pin_back')}</button>
                <div class="login-player-name">${playerName}</div>
                <div style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:1rem">${t('modal_pin_enter')}</div>
                <div class="pin-input-row">
                    <input class="pin-digit" type="number" inputmode="numeric" maxlength="1" data-idx="0" autocomplete="off">
                    <input class="pin-digit" type="number" inputmode="numeric" maxlength="1" data-idx="1" autocomplete="off">
                    <input class="pin-digit" type="number" inputmode="numeric" maxlength="1" data-idx="2" autocomplete="off">
                    <input class="pin-digit" type="number" inputmode="numeric" maxlength="1" data-idx="3" autocomplete="off">
                </div>
                <div class="pin-error" id="pin-error"></div>
                <div class="pin-hint">${t('modal_pin_hint')}</div>
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
            shownPenaltyIds.clear();
            startChallengePoll();

            const overlay = $('#modal-overlay');
            overlay.classList.remove('show');

            updateHeader();
            updateNavVisibility();
            showToast(t('welcome', playerName), result.role === 'admin' ? 'gold' : 'success');
            playSound('coin');

            const activeNav = document.querySelector('.nav-item.active');
            if (activeNav) navigateTo(activeNav.dataset.view);
        } catch (e) {
            const errorEl = document.querySelector('#pin-error');
            if (errorEl) errorEl.textContent = t('pin_wrong');
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
            <div class="modal-title">${t('modal_edit_player_title')}</div>
            <div class="admin-coins-form">
                <input type="text" id="edit-player-name" value="${playerName}" placeholder="Name">
                <select id="edit-player-role">
                    <option value="player" ${role === 'player' ? 'selected' : ''}>${t('role_player')}</option>
                    <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
                <button class="btn-admin-coins" id="btn-save-player">${t('btn_save')}</button>
            </div>
            <button class="modal-close-btn" id="modal-cancel">${t('btn_cancel')}</button>
        `;

        overlay.classList.add('show');

        modal.querySelector('#btn-save-player').addEventListener('click', async () => {
            const newName = modal.querySelector('#edit-player-name').value.trim();
            const newRole = modal.querySelector('#edit-player-role').value;
            if (!newName) return;
            try {
                await api('PUT', `/users/${encodeURIComponent(playerName)}`, { newName, role: newRole });
                overlay.classList.remove('show');
                showToast(t('player_updated', newName), 'success');
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
                showToast(t('name_exists'), 'error');
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
            <div class="modal-title">${t('modal_reset_pin_title')}</div>
            <div style="text-align:center;margin-bottom:1rem">
                <div style="color:var(--text-secondary)">${t('label_player')}</div>
                <div style="font-size:1.2rem;font-weight:700;color:var(--accent-gold)">${playerName}</div>
            </div>
            <div class="admin-coins-form">
                <input type="number" id="admin-new-pin" placeholder="Neue PIN (4 Ziffern)" inputmode="numeric" maxlength="4" autocomplete="off">
                <button class="btn-admin-coins" id="btn-admin-set-pin" disabled>${t('btn_set_pin')}</button>
            </div>
            <button class="modal-close-btn" id="modal-cancel">${t('btn_cancel')}</button>
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
                showToast(t('pin_reset_done', playerName), 'gold');
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
            state.allUsers = data.users || [];
            state.version = data.version || '';
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
            showToast(t('server_unreachable'), 'error');
        }

        // Setup navigation
        $$('.nav-item').forEach(nav => {
            nav.addEventListener('click', () => navigateTo(nav.dataset.view));
        });

        // Language toggle
        const langBtn = $('#lang-toggle-btn');
        if (langBtn) {
            langBtn.addEventListener('click', () => {
                setLang(getLang() === 'en' ? 'de' : 'en');
            });
            updateLangBtn();
        }
        updateNavLabels();

        // Header player selection - always allow switching players
        $('#header-player-btn').addEventListener('click', () => {
            showLoginModal();
        });

        // Admin gear panel
        $('#admin-gear-btn').addEventListener('click', toggleAdminPanel);
        $('#admin-panel-backdrop').addEventListener('click', closeAdminPanel);

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

    // Export for i18n.js
    window.refreshActiveView = refreshActiveView;

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ---- Player Info Tooltip ----
    let activeTooltip = null;
    function showPlayerTooltip(chip) {
        hidePlayerTooltip();
        const tooltip = chip.getAttribute('data-tooltip');
        if (!tooltip) return;
        const el = document.createElement('div');
        el.className = 'player-info-tooltip';
        el.innerHTML = tooltip;
        el.style.visibility = 'hidden';
        document.body.appendChild(el);
        activeTooltip = el;
        const rect = chip.getBoundingClientRect();
        const h = el.offsetHeight || 60;
        const w = el.offsetWidth || 160;
        let top = rect.top - h - 8;
        let left = rect.left + rect.width / 2 - w / 2;
        if (top < 8) top = rect.bottom + 8;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        el.style.top = top + 'px';
        el.style.left = left + 'px';
        el.style.visibility = '';
        el.style.opacity = '1';
    }
    function hidePlayerTooltip() {
        if (activeTooltip) { activeTooltip.remove(); activeTooltip = null; }
    }
    // Desktop: hover zeigt Tooltip (nur echte Maus, kein Touch)
    document.addEventListener('pointerover', e => {
        if (e.pointerType !== 'mouse') return;
        const chip = e.target.closest('.player-chip-info');
        if (chip) showPlayerTooltip(chip);
    });
    document.addEventListener('pointerout', e => {
        if (e.pointerType !== 'mouse') return;
        if (e.target.closest('.player-chip-info')) hidePlayerTooltip();
    });
    // Mobile + Desktop: Klick/Tap toggelt Tooltip
    document.addEventListener('click', e => {
        // Copy icon value to clipboard
        const copyIcon = e.target.closest('.icon-copy');
        if (copyIcon && copyIcon.getAttribute('data-copy-value')) {
            const value = copyIcon.getAttribute('data-copy-value');
            navigator.clipboard.writeText(value).then(() => {
                showToast('✓ In Zwischenablage kopiert!');
            });
            return;
        }

        const chip = e.target.closest('.player-chip-info');
        if (chip) {
            if (activeTooltip) hidePlayerTooltip();
            else showPlayerTooltip(chip);
            return;
        }
        hidePlayerTooltip();
    });

    function showToast(message) {
        let toast = document.getElementById('toast-notification');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-notification';
            toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#4CAF50;color:white;padding:12px 20px;border-radius:4px;font-size:14px;z-index:10000;box-shadow:0 2px 5px rgba(0,0,0,0.2);animation:slideIn 0.3s ease-out';
            document.body.appendChild(toast);
            const style = document.createElement('style');
            style.textContent = '@keyframes slideIn { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }';
            document.head.appendChild(style);
        }
        toast.textContent = message;
        toast.style.display = 'block';
        clearTimeout(toast.timeout);
        toast.timeout = setTimeout(() => { toast.style.display = 'none'; }, 2000);
    }

})();
