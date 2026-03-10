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
        allUsers: [],
        settings: {}
    };

    // ---- Medium Options ----
    const MEDIUM_OPTIONS = [
        { id: 'lan',       label: 'LAN',        icon: '🖥️',   svg: null },
        { id: 'steam',     label: 'Steam',      icon: null,    svg: '/svg/steam.svg' },
        { id: 'ubisoft',   label: 'Ubisoft',    icon: null,    svg: '/svg/ubisoft.svg' },
        { id: 'battlenet', label: 'Battle.net', icon: null,    svg: '/svg/battledotnet.svg' },
        { id: 'epic',      label: 'Epic Games', icon: null,    svg: '/svg/epicgames.svg' },
        { id: 'ea',        label: 'EA App',     icon: null,    svg: '/svg/ea.svg' },
        { id: 'riot',      label: 'Riot Games', icon: null,    svg: '/svg/riotgames.svg' },
        { id: 'other',     label: 'Andere',     icon: '🗂️',   svg: null }
    ];

    // ---- Bulk Select State ----
    const selectedGames = new Set();

    let challengePollInterval = null;
    let viewRefreshInterval = null;
    let sseDropViewInterval = null;
    let sseSource = null;
    let activeTaskTimer = null; // Globaler Timer fuer showTaskModal – verhindert doppelte Timer
    let coinAccumulatorInterval = null; // Interval fuer Live-Coin-Accumulator in laufenden Sessions
    const notifiedChallengeIds = new Set(JSON.parse(localStorage.getItem('gameparty_notified_challenge_ids') || '[]'));
    const shownPenaltyIds = new Set(); // Penalties die bereits als Modal gezeigt wurden
    const shownDuelStartSessions = new Set(); // Duel-Start Modals die bereits gezeigt wurden
    const dismissedRobIds = new Set(); // Rob-Benachrichtigungen die bereits bestätigt wurden
    const pendingNotifications = []; // { id, challenger, game, stakeStr }
    const shownNotifToastIds = new Set(JSON.parse(localStorage.getItem('gameparty_shown_notif_toast_ids') || '[]'));
    let notifPanelOpen = false;
    let focusChallengeId = null;
    let challengeActiveTab = '1v1'; // '1v1' | 'team'
    let tcFormState = { teamA: [], teamB: [], game: '', coins: '', stars: '' };
    let v1FormState = { opponent: '', coins: '', stars: '' };

    // ---- Coin Rate Helper ----
    function getPlayerRate(playerCount) {
        const settings = state.settings || {};
        const maxMult = parseInt(settings.max_multiplier || '10');
        const map = (() => { try { return JSON.parse(settings.player_multipliers || '{}'); } catch { return {}; } })();
        const capped = Math.min(playerCount, maxMult);
        for (let c = capped; c >= 2; c--) {
            if (map[String(c)] !== undefined) return parseFloat(map[String(c)]);
        }
        return 0;
    }

    function coinSvgIcon(size) {
        const s = size || '';
        const style = s ? ` style="width:${s};height:${s};vertical-align:middle"` : '';
        return `<img src="svg/coins.svg" class="coin-svg-icon" alt="coins"${style}>`;
    }

    function controllerSvgIcon(size) {
        const s = size || '1em';
        return `<img src="svg/console-controller.svg" class="coin-svg-icon" alt="controller" style="width:${s};height:${s};vertical-align:middle">`;
    }

    function buildTeamNotifTitle(teamA, teamB, createdBy, currentPlayer) {
        const fmt = arr => {
            if (arr.length === 0) return '';
            if (arr.length === 1) return arr[0];
            return arr.slice(0, -1).join(', ') + ' und ' + arr[arr.length - 1];
        };
        const inTeamA = teamA.includes(currentPlayer);
        if (inTeamA) {
            // Same team as creator → "X (+ others) möchte(n) mit dir gegen [B] spielen"
            const senders = [createdBy, ...teamA.filter(p => p !== createdBy && p !== currentPlayer)];
            const verb = senders.length > 1 ? 'möchten' : 'möchte';
            return `${fmt(senders)} ${verb} mit dir gegen ${fmt(teamB)} spielen`;
        } else {
            // Opposing team → "[A] möchte(n) gegen dich (und [other B]) spielen"
            const verb = teamA.length > 1 ? 'möchten' : 'möchte';
            const otherB = teamB.filter(p => p !== currentPlayer);
            const suffix = otherB.length > 0 ? ` und ${fmt(otherB)}` : '';
            return `${fmt(teamA)} ${verb} gegen dich${suffix} spielen`;
        }
    }

    function showNegativeCoinAnimation(coins, stars) {
        const popup = document.createElement('div');
        popup.className = 'coin-popup';
        popup.style.color = 'var(--danger, #ff4444)';
        popup.style.textShadow = '0 0 40px rgba(255,68,68,0.6)';
        const parts = [];
        if (coins > 0) parts.push(`-${coins} ${coinSvgIcon('1.2em')}`);
        if (stars > 0) parts.push(`-${stars} ${controllerSvgIcon('1.2em')}`);
        popup.innerHTML = parts.join(' ');
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

        playSound('error');
        setTimeout(() => popup.remove(), 1500);
    }

    function startCoinAccumulatorInterval() {
        if (coinAccumulatorInterval) clearInterval(coinAccumulatorInterval);
        coinAccumulatorInterval = setInterval(() => {
            document.querySelectorAll('.session-coin-accumulator').forEach(el => {
                const startedAt = parseInt(el.dataset.startedAt || '0');
                const rate = parseFloat(el.dataset.rate || '0');
                if (!startedAt || !rate) return;
                const minutes = (Date.now() - startedAt) / 60000;
                const coins = Math.ceil(minutes * rate);
                el.innerHTML = `~${coins} ${coinSvgIcon()}`;
            });
            document.querySelectorAll('.session-runtime').forEach(el => {
                const startedAt = parseInt(el.dataset.startedAt || '0');
                if (!startedAt) return;
                const mins = Math.floor((Date.now() - startedAt) / 60000);
                el.textContent = `${mins} Min.`;
            });
            if (!document.querySelector('.session-coin-accumulator') && !document.querySelector('.session-runtime')) {
                clearInterval(coinAccumulatorInterval);
                coinAccumulatorInterval = null;
            }
        }, 1000);
    }

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
        const opts = { method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
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
        container.prepend(toast);
        // Einblenden: zwei rAF sichern Reflow vor Transition
        requestAnimationFrame(() => {
            requestAnimationFrame(() => { toast.classList.add('visible'); });
        });
        // Nach 6s ausblenden und entfernen
        setTimeout(() => {
            toast.classList.remove('visible');
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 400);
        }, 6000);
    }

    function showConfirm(message, onConfirm) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        modal.innerHTML = `
            <div class="modal-title" style="margin-bottom:1rem">${message}</div>
            <div style="display:flex;gap:0.5rem;justify-content:flex-end">
                <button class="btn-secondary" id="confirm-no" style="padding:0.5rem 1rem">${t('btn_cancel')}</button>
                <button class="btn-danger" id="confirm-yes" style="padding:0.5rem 1rem">${t('btn_confirm') || 'Ja'}</button>
            </div>`;
        overlay.classList.add('show');
        modal.querySelector('#confirm-yes').onclick = () => { overlay.classList.remove('show'); onConfirm(); };
        modal.querySelector('#confirm-no').onclick = () => overlay.classList.remove('show');
    }

    function showCoinAnimation(coins, stars) {
        const popup = document.createElement('div');
        popup.className = 'coin-popup';
        const parts = [];
        if (coins > 0) parts.push(`+${coins} ${coinSvgIcon('1.2em')}`);
        if (stars > 0) parts.push(`+${stars} ${controllerSvgIcon('1.2em')}`);
        popup.innerHTML = parts.join(' ');
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

function getNowPlus10() {
        const d = new Date(Date.now() + 10 * 60 * 1000);
        const date = d.toISOString().slice(0, 10);
        const time = d.toTimeString().slice(0, 5);
        return { date, time };
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

        if (!hasData) return `<span class="player-chip player-name-clickable" data-player-info="${playerName}">${playerName}</span>`;

        return `<span class="player-chip player-chip-info player-name-clickable" data-player="${playerName}" data-player-info="${playerName}" data-tooltip="${tooltipLines.replace(/"/g, '&quot;')}">
            ${playerName}
            <span class="player-chip-icons">${icons}</span>
        </span>`;
    }

    function renderLeaderIcons(leaderName, medium, account) {
        const info = getUserInfo(leaderName);
        const icons = [];
        if (medium) {
            // Show only the selected platform icon
            const MEDIUM_META = {
                lan:       { label: 'LAN-IP',          icon: () => '🖥️',                         fallback: () => info.ip },
                steam:     { label: 'Steam',            icon: () => createIconSvg('steam',     '16px'), fallback: () => info.steam },
                ubisoft:   { label: 'Ubisoft Connect',  icon: () => createIconSvg('ubisoft',   '16px'), fallback: () => info.ubisoft },
                battlenet: { label: 'Battle.net',       icon: () => createIconSvg('battlenet', '16px'), fallback: () => info.battlenet },
                epic:      { label: 'Epic Games',       icon: () => createIconSvg('epic',      '16px'), fallback: () => info.epic },
                ea:        { label: 'EA App',           icon: () => createIconSvg('ea',        '16px'), fallback: () => info.ea },
                riot:      { label: 'Riot Games',       icon: () => createIconSvg('riot',      '16px'), fallback: () => info.riot },
            };
            const meta = MEDIUM_META[medium];
            const value = account || (meta && meta.fallback()) || '';
            if (meta && value) {
                icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="${meta.label}<br>${value}" data-copy-value="${value}">${meta.icon()}</span>`);
            } else if (value) {
                icons.push(`<span class="leader-info-icon player-chip-info" style="cursor:pointer" data-tooltip="${medium}<br>${value}">${value}</span>`);
            }
        } else {
            if (info.ip)        icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="🖥️ LAN-IP<br>${info.ip}" data-copy-value="${info.ip}">🖥️</span>`);
            if (info.steam)     icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="Steam<br>${info.steam}" data-copy-value="${info.steam}">${createIconSvg('steam', '16px')}</span>`);
            if (info.ubisoft)   icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="Ubisoft Connect<br>${info.ubisoft}" data-copy-value="${info.ubisoft}">${createIconSvg('ubisoft', '16px')}</span>`);
            if (info.battlenet) icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="Battle.net<br>${info.battlenet}" data-copy-value="${info.battlenet}">${createIconSvg('battlenet', '16px')}</span>`);
            if (info.epic)      icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="Epic Games<br>${info.epic}" data-copy-value="${info.epic}">${createIconSvg('epic', '16px')}</span>`);
            if (info.ea)        icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="EA App<br>${info.ea}" data-copy-value="${info.ea}">${createIconSvg('ea', '16px')}</span>`);
            if (info.riot)      icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="Riot Games<br>${info.riot}" data-copy-value="${info.riot}">${createIconSvg('riot', '16px')}</span>`);
            if (info.discord)   icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="Discord<br>${info.discord}" data-copy-value="${info.discord}">${createIconSvg('discord', '16px')}</span>`);
            if (info.teamspeak) icons.push(`<span class="leader-info-icon player-chip-info icon-copy" style="cursor:pointer" data-tooltip="TeamSpeak<br>${info.teamspeak}" data-copy-value="${info.teamspeak}">${createIconSvg('teamspeak', '16px')}</span>`);
        }
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
            const [coinsData, starsData, proposalsData, liveSessionsData, usersData, settingsData, challengesData, teamChallengesData] = await Promise.all([
                api('GET', '/coins'),
                api('GET', '/stars'),
                api('GET', '/proposals'),
                api('GET', '/live-sessions'),
                api('GET', '/users'),
                api('GET', '/settings'),
                api('GET', '/challenges'),
                api('GET', '/team-challenges')
            ]);

            // Load votes for all ended duel sessions
            const duelSessions = liveSessionsData.filter(s => s.status === 'ended' && s.challenge_id);
            const duelVotesMap = {};
            if (duelSessions.length > 0) {
                const voteResults = await Promise.all(duelSessions.map(s => api('GET', `/duel-votes/${s.id}`)));
                duelSessions.forEach((s, i) => {
                    duelVotesMap[s.id] = voteResults[i].votes || [];
                });
            }

            // Build challenge status lookup
            const challengeStatusMap = {};
            const challengeMap = {};
            (challengesData || []).forEach(c => { challengeStatusMap[c.id] = c.status; challengeMap[c.id] = c; });
            (teamChallengesData || []).forEach(tc => { challengeStatusMap[tc.id] = tc.status; challengeMap[tc.id] = tc; });
            const userIpMap = Object.fromEntries((usersData || []).map(u => [u.name, u.ip || '']));
            state.coins = coinsData;
            state.stars = starsData;
            if (settingsData && typeof settingsData === 'object') state.settings = settingsData;
            const allProposals = proposalsData;

            const topGame = getTopMatchGame();

            // Leaderboard - sort by stars first, then by coins
            const leaderboard = state.players
                .map(p => ({ name: p, coins: coinsData[p] || 0, stars: starsData[p] || 0 }))
                .sort((a, b) => b.stars - a.stars || b.coins - a.coins);

            let leaderboardHTML = '';
            leaderboard.forEach((p, i) => {
                const isCurrent = p.name === state.currentPlayer;
                const starsBlock = p.stars > 0
                    ? `<span class="lb-stat lb-stat-stars">${p.stars} <img src="svg/console-controller.svg" class="lb-icon"></span>`
                    : `<span class="lb-stat lb-stat-stars" style="visibility:hidden">0 <img src="svg/console-controller.svg" class="lb-icon"></span>`;
                leaderboardHTML += `
                    <div class="leaderboard-item ${isCurrent ? 'current-player' : ''}">
                        <div class="leaderboard-rank">#${i + 1}</div>
                        <div class="leaderboard-name player-name-clickable" data-player-info="${p.name}">${p.name}</div>
                        <div class="leaderboard-stats">
                            <span class="lb-stat">${p.coins} <img src="svg/coins.svg" class="lb-icon"></span>
                            ${starsBlock}
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
            const plannedProposals = allProposals.filter(p => ['pending', 'approved'].includes(p.status) || (p.status === 'completed' && !p.coinsApproved));
            const plannedSessionsHTML = plannedProposals.map(renderProposalCard).join('') ||
                `<div class="empty-state-text" style="padding:0.5rem 0;font-size:0.85rem;color:var(--text-secondary)">${t('no_planned_sessions')}</div>`;

            // Recent sessions moved to profile
            let sessionsHTML = '';

            let liveSessionsHTML = '';
            if (liveSessionsData.length > 0) {
                liveSessionsHTML = liveSessionsData.map(s => {
                    const isLeader = s.leader === state.currentPlayer;
                    const isInSession = s.players.includes(state.currentPlayer);
                    const sortedPlayers = [s.leader, ...s.players.filter(p => p !== s.leader).sort()];
                    let playersHTML = sortedPlayers.map(p =>
                        `<span class="player-chip player-name-clickable" data-player-info="${p}">${p === s.leader ? '<span class="session-leader-badge">GL</span>' : ''}${p}</span>`
                    ).join('');

                    let statusBadge = '';
                    let actionsHTML = '';
                    let coinInfoHTML = '';

                    const playerCount = s.players.length;
                    const rate = getPlayerRate(playerCount);

                    if (s.status === 'lobby') {
                        statusBadge = `<span style="color:#6699ff;font-size:0.8rem">${s.challenge_id ? '⚔️ ' + t('duel_label') + ' · ' : ''}${t('session_lobby')}</span>`;
                        if (rate > 0) {
                            coinInfoHTML = `<div class="session-coin-rate">${rate} ${coinSvgIcon()} / min</div>`;
                        }
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
                        const initialMins0 = s.startedAt ? Math.floor((Date.now() - s.startedAt) / 60000) : 0;
                        statusBadge = `<span class="session-runtime-badge" style="color:var(--accent-green);font-size:0.8rem">${s.challenge_id ? '⚔️ ' + t('duel_label') + ' · ' : ''}${t('session_running')} · <span class="session-runtime" data-started-at="${s.startedAt || 0}">${initialMins0} Min.</span></span>`;
                        if (rate > 0 && s.startedAt) {
                            const initialMinutes = (Date.now() - s.startedAt) / 60000;
                            const initialCoins = Math.ceil(initialMinutes * rate);
                            const sd = new Date(s.startedAt);
                            const startTimeStr = `${sd.toLocaleDateString('de-DE')} ${sd.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'})}`;
                            coinInfoHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
        <div class="live-session-meta"><span class="datetime-label">${t('start_time_label')}</span> ${startTimeStr}</div>
        <span class="session-coin-accumulator" data-started-at="${s.startedAt}" data-rate="${rate}">~${initialCoins} ${coinSvgIcon()}</span>
    </div>`;
                        }
                        if (s.challenge_id) {
                            const chRun = challengeMap[s.challenge_id];
                            let potRunStr = '';
                            if (s.challenge_type === '1v1') {
                                if (chRun?.stakeCoins > 0) potRunStr += `${chRun.stakeCoins * 2} ${coinSvgIcon()}`;
                                if (chRun?.stakeStars > 0) potRunStr += (potRunStr ? ' + ' : '') + `${chRun.stakeStars * 2} ${controllerSvgIcon()}`;
                            } else {
                                const tp = s.players?.length || 0;
                                if (chRun?.stakeCoinsPerPerson > 0) potRunStr += `${chRun.stakeCoinsPerPerson * tp} ${coinSvgIcon()}`;
                                if (chRun?.stakeStarsPerPerson > 0) potRunStr += (potRunStr ? ' + ' : '') + `${chRun.stakeStarsPerPerson * tp} ${controllerSvgIcon()}`;
                            }
                            if (potRunStr) {
                                coinInfoHTML += `<div class="vote-pot-display" style="text-align:right;margin-top:0.25rem">${t('pot_label')} ${potRunStr}</div>`;
                            }
                        }
                        if (isLeader || isAdmin()) {
                            actionsHTML += `<button class="btn-session-end" data-sid="${s.id}" data-action="end">${t('btn_end')}</button>`;
                        }
                        if (s.challenge_id) {
                            const chRun2 = challengeMap[s.challenge_id];
                            if (chRun2) {
                                if (s.challenge_type !== '1v1') {
                                    const tA = Array.isArray(chRun2.teamA) ? chRun2.teamA : JSON.parse(chRun2.teamA || '[]');
                                    const tB = Array.isArray(chRun2.teamB) ? chRun2.teamB : JSON.parse(chRun2.teamB || '[]');
                                    playersHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:0.75rem;margin:0.25rem 0;flex-wrap:wrap">
                                        <div style="text-align:right;color:var(--accent-purple);font-weight:600;font-size:0.9rem">${tA.join('<br>')}</div>
                                        <div style="color:var(--accent-gold);font-weight:900;font-size:1.1rem">vs</div>
                                        <div style="text-align:left;color:var(--accent-blue);font-weight:600;font-size:0.9rem">${tB.join('<br>')}</div>
                                    </div>`;
                                } else {
                                    playersHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:0.75rem;margin:0.25rem 0">
                                        <span style="color:var(--accent-purple);font-weight:600;font-size:0.9rem">${chRun2.challenger}</span>
                                        <span style="color:var(--accent-gold);font-weight:900;font-size:1.1rem">vs</span>
                                        <span style="color:var(--accent-blue);font-weight:600;font-size:0.9rem">${chRun2.opponent}</span>
                                    </div>`;
                                }
                            }
                        }
                        if (s.challenge_id && (isLeader || isAdmin())) {
                            actionsHTML += `<button class="btn-danger duel-running-cancel-btn" data-sid="${s.id}" style="font-size:0.8rem;padding:0.3rem 0.7rem">🗑️ ${t('btn_cancel')}</button>`;
                        }
                    } else if (s.status === 'ended' && s.challenge_id) {
                        // Duel session — show voting UI instead of admin approval
                        const duelVotes = duelVotesMap[s.id] || [];
                        const myVote = duelVotes.find(v => v.player === state.currentPlayer)?.voted_for;
                        const challengeStatus = challengeStatusMap[s.challenge_id];
                        const ch = challengeMap[s.challenge_id];
                        const isConflict = challengeStatus === 'conflict';
                        const isVoted = challengeStatus === 'voted';
                        const isPaid = challengeStatus === 'paid';

                        let options;
                        if (s.challenge_type === '1v1') {
                            options = s.players;
                        } else {
                            options = ['A', 'B'];
                        }
                        const optionLabel = (opt) => s.challenge_type !== '1v1' ? 'Team ' + opt : opt;

                        // Pot display
                        let potStr = '';
                        if (s.challenge_type === '1v1') {
                            if (ch?.stakeCoins > 0) potStr += `${ch.stakeCoins * 2} ${coinSvgIcon()}`;
                            if (ch?.stakeStars > 0) potStr += (potStr ? ' + ' : '') + `${ch.stakeStars * 2} ${controllerSvgIcon()}`;
                        } else {
                            const tp = s.players?.length || 0;
                            if (ch?.stakeCoinsPerPerson > 0) potStr += `${ch.stakeCoinsPerPerson * tp} ${coinSvgIcon()}`;
                            if (ch?.stakeStarsPerPerson > 0) potStr += (potStr ? ' + ' : '') + `${ch.stakeStarsPerPerson * tp} ${controllerSvgIcon()}`;
                        }
                        const potDisplay = potStr ? `<div class="vote-pot-display">${t('pot_label')} ${potStr}</div>` : '';

                        if (isPaid) {
                            const winner = s.challenge_type === '1v1' ? ch?.winner : (ch?.winnerTeam === 'A' ? 'Team A' : 'Team B');
                            statusBadge = `<span class="pending-approval-badge" style="background:var(--accent-green);color:#000">${t('duel_won_badge', winner)}</span>`;
                            const sessionCoins = s.pending_coins > 0 ? s.pending_coins : calculateSessionCoins(s.players.length, state.attendees.length);
                            const sessionCoinsDisplay = sessionCoins > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem"><span class="vote-label" style="margin:0">Session-Coins:</span><span style="font-weight:600;color:var(--text-primary)">${sessionCoins} ${coinSvgIcon()}</span></div>` : '';
                            if (isAdmin()) {
                                actionsHTML = `
                                    <div class="duel-vote-section">
                                        ${potDisplay}
                                        <div class="vote-label" style="color:var(--accent-green)">🏆 ${t('duel_pot_paid_out')}</div>
                                        ${sessionCoinsDisplay}
                                        <button class="btn-approve duel-close-btn" data-sid="${s.id}" data-coins="${sessionCoins}" style="margin-top:0.4rem">${t('btn_close_session')}</button>
                                    </div>`;
                            } else {
                                actionsHTML = `
                                    <div class="duel-vote-section">
                                        ${potDisplay}
                                        <div class="vote-label" style="color:var(--accent-green)">🏆 ${t('duel_pot_paid_out')}</div>
                                        ${sessionCoinsDisplay}
                                        <div class="vote-label" style="color:var(--text-secondary)">${t('duel_gm_closing')}</div>
                                    </div>`;
                            }
                        } else {
                            statusBadge = `<span class="pending-approval-badge">🗳️ ${t('duel_vote_header') || 'Wer hat gewonnen?'}</span>`;

                            if (isConflict && isAdmin()) {
                                const voteSummary = duelVotes.map(v => `${v.player} → ${optionLabel(v.voted_for)}`).join(' | ');
                                actionsHTML = `
                                    <div class="duel-vote-section">
                                        ${potDisplay}
                                        <div class="vote-label conflict-label">⚠️ ${t('duel_conflict') || 'Abstimmungskonflikt'}</div>
                                        ${voteSummary ? `<div class="vote-summary" style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:0.3rem">${voteSummary}</div>` : ''}
                                        ${options.map(opt => `<button class="duel-vote-btn admin-resolve-btn" data-sid="${s.id}" data-vote="${opt}">${optionLabel(opt)}</button>`).join('')}
                                        <button class="btn-danger duel-cancel-btn" data-sid="${s.id}" style="margin-top:0.3rem;padding:0.35rem 0.8rem;font-size:0.85rem;display:block;margin-left:auto;margin-right:auto">🗑️ Abbrechen</button>
                                    </div>`;
                            } else if (isConflict) {
                                actionsHTML = `
                                    <div class="duel-vote-section">
                                        ${potDisplay}
                                        <div class="vote-label conflict-label">⚠️ ${t('duel_conflict') || 'Abstimmungskonflikt'}</div>
                                        <div class="vote-label">${t('duel_conflict_waiting') || 'Admin entscheidet...'}</div>
                                    </div>`;
                            } else if (isVoted && isAdmin()) {
                                const winner = s.challenge_type !== '1v1' ? ('Team ' + (ch?.winnerTeam || '')) : (ch?.winner || ch?.winnerTeam);
                                actionsHTML = `
                                    <div class="duel-vote-section">
                                        ${potDisplay}
                                        <div class="vote-label" style="color:var(--accent-green);margin-bottom:0.5rem">
                                            🏆 ${t('duel_consensus')} <strong>${winner}</strong>
                                        </div>
                                        <button class="btn-approve duel-approve-btn" data-sid="${s.id}">${t('btn_freigabe_approve') || 'Freigeben'}</button>
                                        <button class="btn-danger duel-cancel-btn" data-sid="${s.id}" style="padding:0.35rem 0.8rem;font-size:0.85rem">🗑️ Abbrechen</button>
                                    </div>`;
                            } else if (isVoted && !isAdmin()) {
                                actionsHTML = `
                                    <div class="duel-vote-section">
                                        ${potDisplay}
                                        <div class="vote-label" style="color:var(--accent-green)">🏆 ${t('duel_voting_complete')}</div>
                                        <div class="vote-label">${t('duel_vote_waiting') || 'Warte auf Admin...'}</div>
                                    </div>`;
                            } else if (myVote) {
                                actionsHTML = `
                                    <div class="duel-vote-section">
                                        ${potDisplay}
                                        <div class="vote-label">${t('duel_vote_waiting_others') || 'Warte auf Abstimmung...'}</div>
                                        ${options.map(opt => `<button class="duel-vote-btn ${myVote === opt ? 'voted' : ''}" data-sid="${s.id}" data-vote="${opt}" disabled>${optionLabel(opt)}</button>`).join('')}
                                    </div>`;
                            } else {
                                actionsHTML = `
                                    <div class="duel-vote-section">
                                        ${potDisplay}
                                        <div class="vote-label">${t('duel_vote_label') || 'Stimme ab:'}</div>
                                        ${options.map(opt => `<button class="duel-vote-btn" data-sid="${s.id}" data-vote="${opt}">${optionLabel(opt)}</button>`).join('')}
                                    </div>`;
                            }
                            // Admin can cancel pending duel sessions
                            if (isAdmin() && !isVoted && !isConflict) {
                                actionsHTML += `<div style="margin-top:0.3rem;text-align:center"><button class="btn-danger duel-cancel-btn" data-sid="${s.id}" style="padding:0.35rem 0.8rem;font-size:0.85rem">🗑️ Abbrechen</button></div>`;
                            }
                        }
                    } else if (s.status === 'ended') {
                        statusBadge = `<span class="pending-approval-badge">${t('session_awaiting_approval')}</span>`;
                        const coins = s.pending_coins > 0 ? s.pending_coins : calculateSessionCoins(s.players.length, state.attendees.length);
                        if (coins > 0) {
                            coinInfoHTML = `<div style="display:flex;justify-content:space-between;align-items:center;"><span></span><span style="font-weight:600;color:var(--text-primary)">${coins} ${coinSvgIcon()}</span></div>`;
                        }
                        if (isAdmin()) {
                            actionsHTML += `<button class="btn-session-start" data-sid="${s.id}" data-action="approve" data-coins="${coins}">${t('btn_approve_coins', coins)}</button>`;
                            actionsHTML += `<button class="btn-session-end" data-sid="${s.id}" data-action="cancel" style="font-size:0.75rem;opacity:0.6">🗑️</button>`;
                        }
                    }

                    return `
                        <div class="card live-session-card ${s.status}">
                            <div class="live-session-header">
                                <span class="live-session-game">${renderLeaderIcons(s.leader, s.medium, s.medium_account)}${s.game}</span>
                                ${statusBadge}
                            </div>
                            ${coinInfoHTML}
                            <div>${playersHTML}</div>
                            ${actionsHTML ? `<div class="live-session-actions">${actionsHTML}</div>` : ''}
                        </div>`;
                }).join('');
            }

            const activeProposalsHTML = activeProposals.map(renderProposalCard).join('');
            const hasAnything = liveSessionsData.length > 0 || activeProposals.length > 0;

            // Detect new running duel sessions and show start modal
            liveSessionsData.filter(s =>
                s.status === 'running' &&
                s.challenge_id &&
                s.players && s.players.includes(state.currentPlayer) &&
                !shownDuelStartSessions.has(s.id)
            ).forEach(s => {
                shownDuelStartSessions.add(s.id);
                const ch = challengeMap[s.challenge_id];
                if (!ch) return;
                const payload = s.challenge_type !== '1v1' ? {
                    type: 'team', game: s.game,
                    teamA: ch.teamA, teamB: ch.teamB, createdBy: ch.createdBy,
                    stakeCoinsPerPerson: ch.stakeCoinsPerPerson,
                    stakeStarsPerPerson: ch.stakeStarsPerPerson,
                    sessionId: s.id
                } : {
                    type: '1v1', game: s.game,
                    challenger: ch.challenger, opponent: ch.opponent,
                    stakeCoins: ch.stakeCoins, stakeStars: ch.stakeStars,
                    sessionId: s.id
                };
                try { showDuelStartModal(payload); } catch(e) { console.error('DuelStart modal error:', e); }
            });

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
                            await api('PUT', `/live-sessions/${sid}/end`);
                        } else if (action === 'approve') {
                            const coinsPerPlayer = parseInt(btn.dataset.coins || 0);
                            await api('POST', `/live-sessions/${sid}/approve`, { coinsPerPlayer, player: state.currentPlayer });
                        } else if (action === 'cancel') {
                            showConfirm(t('confirm_cancel_room'), async () => {
                                await api('DELETE', `/live-sessions/${sid}`);
                            });
                        }
                    } catch (e) {
                        showToast(e.message || t('save_error'), 'error');
                    }
                    renderDashboard();
                });
            });

            // Duel vote buttons
            container.querySelectorAll('.duel-vote-btn:not(.admin-resolve-btn)').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const sid = btn.dataset.sid;
                    const vote = btn.dataset.vote;
                    if (!sid || !vote) return;
                    try {
                        await api('POST', '/duel-votes', { sessionId: sid, player: state.currentPlayer, votedFor: vote });
                    } catch (e) {
                        showToast(e.message || t('save_error'), 'error');
                    }
                    renderDashboard();
                });
            });

            // Admin resolve conflict buttons
            container.querySelectorAll('.admin-resolve-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const sid = btn.dataset.sid;
                    const winner = btn.dataset.vote;
                    if (!sid || !winner) return;
                    try {
                        await api('POST', '/duel-votes/resolve', { sessionId: sid, winner, admin: state.currentPlayer });
                    } catch (e) {
                        showToast(e.message || t('save_error'), 'error');
                    }
                    renderDashboard();
                });
            });

            // Admin: Duel-Payout freigeben
            container.querySelectorAll('.duel-approve-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const sid = btn.dataset.sid;
                    if (!sid) return;
                    try {
                        await api('POST', '/duel-votes/approve', { sessionId: sid, player: state.currentPlayer });
                    } catch (e) {
                        showToast(e.message || t('save_error'), 'error');
                    }
                });
            });

            // GL/Admin: Laufende Duell-Session abbrechen (mit Einsatz-Rückerstattung)
            container.querySelectorAll('.duel-running-cancel-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!confirm(t('discard_confirm') || 'Duell wirklich abbrechen? Einsätze werden erstattet.')) return;
                    try {
                        await api('POST', `/live-sessions/${btn.dataset.sid}/duel-cancel`);
                        showToast(t('duel_cancelled'), 'success');
                    } catch (e) {
                        showToast(e.message || t('save_error'), 'error');
                    }
                });
            });

            // Admin: Duel-Session abbrechen (Abstimmungsphase)
            container.querySelectorAll('.duel-cancel-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!confirm(t('discard_confirm') || 'Session wirklich abbrechen?')) return;
                    const sid = btn.dataset.sid;
                    if (!sid) return;
                    try {
                        await api('DELETE', `/live-sessions/${sid}`);
                    } catch (e) {
                        showToast(e.message || t('save_error'), 'error');
                    }
                });
            });

            // Admin: paid Duel-Session schließen — approve session coins and close
            container.querySelectorAll('.duel-close-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const sid = btn.dataset.sid;
                    if (!sid) return;
                    try {
                        const coinsPerPlayer = parseInt(btn.dataset.coins || 0);
                        await api('POST', `/live-sessions/${sid}/approve`, { coinsPerPlayer, player: state.currentPlayer });
                    } catch (e) {
                        showToast(e.message || t('save_error'), 'error');
                    }
                });
            });

            // Update header coins
            updateHeaderCoins();

            // Start live coin accumulator for running sessions
            if (document.querySelector('.session-coin-accumulator')) {
                startCoinAccumulatorInterval();
            }
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
                    <span class="gth-name">${t('col_game_genre_max')}</span>
                    <span></span>
                    <span class="gth-like">👍</span>
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
                showConfirm(t('confirm_reject_game', btn.dataset.game), async () => {
                    try {
                        await api('DELETE', `/games/${encodeURIComponent(btn.dataset.game)}`);
                        showToast(t('proposal_rejected'), 'error');
                        renderMatcher();
                    } catch (e) { console.error(e); }
                });
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

            const nameLink = e.target.closest('.game-name-link');
            if (nameLink && nameLink.dataset.preview && !e.target.closest('a')) {
                e.stopPropagation();
                showPreviewModal(nameLink.dataset.preview);
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
                showConfirm(t('confirm_delete_game', deleteBtn.dataset.game), async () => {
                    try {
                        await api('DELETE', `/games/${encodeURIComponent(deleteBtn.dataset.game)}`);
                        showToast(t('game_deleted'), 'error');
                        renderMatcher();
                    } catch (e2) { console.error(e2); }
                });
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
                showMediumSelectModal(gameName, async (medium, account) => {
                    try {
                        await api('POST', '/live-sessions', { game: gameName, leader: state.currentPlayer, medium, account });
                        showToast(t('room_created', gameName), 'success');
                        navigateTo('dashboard');
                    } catch (err) {
                        showToast(t('room_error'), 'error');
                    }
                });
                return;
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
        const shopLinks = [...(game.shopLinks || [])];

        function renderShopLinkRows() {
            const list = modal.querySelector('#shop-links-list');
            if (!list) return;
            list.innerHTML = shopLinks.length
                ? shopLinks.map((l, i) => `
                    <div class="shop-link-row">
                        <span class="game-shop-link">${l.platform}</span>
                        <span class="shop-link-url">${l.url}</span>
                        <button class="game-action-btn delete shop-link-remove" data-index="${i}">✕</button>
                    </div>`).join('')
                : `<span style="font-size:0.75rem;color:var(--text-muted)">${t('no_shop_links') || 'Keine Shop-Links'}</span>`;
            list.querySelectorAll('.shop-link-remove').forEach(btn => {
                btn.addEventListener('click', () => {
                    shopLinks.splice(parseInt(btn.dataset.index), 1);
                    renderShopLinkRows();
                });
            });
        }

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
                <label style="font-size:0.75rem;color:var(--text-secondary);margin-top:0.5rem;display:block">Shop-Links</label>
                <div id="shop-links-list"></div>
                <div class="proposal-row" style="margin-top:0.4rem;align-items:center">
                    <input type="text" id="new-shop-platform" placeholder="Plattform (Steam, Epic ...)" style="flex:1">
                    <input type="url" id="new-shop-url" placeholder="https://store.steampowered.com/..." style="flex:2">
                    <button class="game-action-btn edit" id="add-shop-link" style="width:auto;padding:0 0.6rem;font-size:0.9rem">+</button>
                </div>
                <div class="proposal-row" style="margin-top:0.75rem">
                    <button class="btn-propose" id="edit-game-save">${t('btn_save')}</button>
                    <button class="btn-leave" id="edit-game-cancel">${t('btn_cancel')}</button>
                </div>
            </div>
        `;
        overlay.classList.add('show');
        renderShopLinkRows();

        modal.querySelector('#add-shop-link').addEventListener('click', () => {
            const platform = modal.querySelector('#new-shop-platform').value.trim();
            const url = modal.querySelector('#new-shop-url').value.trim();
            if (platform && url) {
                shopLinks.push({ platform, url });
                renderShopLinkRows();
                modal.querySelector('#new-shop-platform').value = '';
                modal.querySelector('#new-shop-url').value = '';
            }
        });

        modal.querySelector('#edit-game-save').addEventListener('click', async () => {
            const newName = modal.querySelector('#edit-game-name').value.trim();
            if (!newName) return;
            try {
                await api('PUT', `/games/${encodeURIComponent(game.name)}`, {
                    newName,
                    genre: modal.querySelector('#edit-game-genre').value.trim(),
                    maxPlayers: parseInt(modal.querySelector('#edit-game-maxplayers').value) || game.maxPlayers,
                    previewUrl: modal.querySelector('#edit-game-previewurl').value.trim(),
                    shopLinks
                });
                overlay.classList.remove('show');
                showToast(t('game_updated'), 'success');
                renderMatcher();
            } catch (e) {
                showToast(t('save_error'), 'error');
            }
        });

        modal.querySelector('#edit-game-cancel').addEventListener('click', () => {
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

        container.innerHTML = bulkBar + games.map(g => {
            const noMatch = g.matchCount < CONFIG.MIN_MATCH ? 'no-match' : '';
            const hasMatch = g.matchCount >= CONFIG.MIN_MATCH ? 'has-match' : '';
            const isInterested = player && g.players && g.players[player];

            const playerDots = state.attendees.map(p =>
                `<div class="game-player-dot ${g.players && g.players[p] ? '' : 'empty'}" data-tooltip="${p}">${p.charAt(0)}</div>`
            ).join('');

            const interestBtn = player ? `
                <button class="game-interest-btn ${isInterested ? 'active' : ''}" data-game="${g.name}" title="${isInterested ? 'Austragen' : 'Interesse zeigen'}">
                    👍
                </button>` : '<span></span>';

            const adminBtns = admin ? `
                <div class="game-admin-controls">
                    <button class="game-action-btn edit game-edit-btn" data-game="${g.name}" title="Bearbeiten">&#x270E;</button>
                    <button class="game-action-btn delete game-delete-btn" data-game="${g.name}" title="Loeschen">&#x2716;</button>
                </div>` : '';

            const createRoomBtn = player ? `<button class="game-create-room-btn" data-game="${g.name}" title="${t('btn_create_room')}">🖥️</button>` : '<span></span>';

            const shopLinksHTML = (g.shopLinks && g.shopLinks.length)
                ? g.shopLinks.map(l => `<a class="game-shop-link" href="${l.url}" target="_blank" rel="noopener" title="${l.platform}">${l.platform}</a>`).join('')
                : '';

            const checkbox = admin ? `<input type="checkbox" class="game-checkbox" data-game="${g.name}" ${selectedGames.has(g.name) ? 'checked' : ''}>` : '';

            const matchPlayerNames = state.attendees.filter(p => g.players && g.players[p]);
            const likesTooltip = matchPlayerNames.length ? matchPlayerNames.join(', ') : '';

            return `
                <div class="game-item ${noMatch} ${hasMatch} ${admin ? 'admin-row' : ''} ${selectedGames.has(g.name) ? 'selected' : ''}">
                    ${checkbox}
                    <div class="game-info">
                        <div class="game-name ${g.previewUrl ? 'game-name-link' : ''}" ${g.previewUrl ? `data-preview="${g.previewUrl}"` : ''}>
                            ${g.name}${shopLinksHTML}
                        </div>
                        <div class="game-meta">
                            <span>${g.genre || '?'}</span>
                            <span>Max ${g.maxPlayers}</span>
                            <span class="game-likes-count"${likesTooltip ? ` data-tooltip="${likesTooltip}"` : ''}>${g.matchCount} Likes</span>
                        </div>
                        <div class="game-players-row">${playerDots}</div>
                    </div>
                    ${createRoomBtn}
                    ${interestBtn}
                    ${adminBtns}
                </div>`;
        }).join('');

    }


    function renderProposalCard(p) {
        const player = state.currentPlayer;
        const isLeader = p.leader === player;
        const isJoined = p.players.includes(player);
        const admin = isAdmin();

        // Status badge like live-session-card
        let statusBadge = '';
        if (p.status === 'pending') {
            statusBadge = `<span style="color:var(--text-secondary);font-size:0.8rem">${t('status_pending')}</span>`;
        } else if (p.status === 'approved') {
            statusBadge = `<span style="color:var(--accent-green);font-size:0.8rem">${t('status_approved')}</span>`;
        } else if (p.status === 'active') {
            const initialMins0 = p.startedAt ? Math.floor((Date.now() - p.startedAt) / 60000) : 0;
            statusBadge = `<span class="session-runtime-badge" style="color:var(--accent-green);font-size:0.8rem">● ${t('status_active')} · <span class="session-runtime" data-started-at="${p.startedAt || 0}">${initialMins0} Min.</span></span>`;
        } else if (p.status === 'completed' && !p.coinsApproved) {
            statusBadge = `<span class="pending-approval-badge">${t('session_awaiting_approval')}</span>`;
        } else if (p.status === 'completed' && p.coinsApproved) {
            statusBadge = `<span style="color:var(--accent-green);font-size:0.8rem">${t('status_completed')}</span>`;
        } else if (p.status === 'rejected') {
            statusBadge = `<span style="color:var(--accent-red);font-size:0.8rem">${t('status_rejected')}</span>`;
        }
        if (p.isNewGame) statusBadge += ` <span class="genre-tag">${t('status_new')}</span>`;

        let coinStatusHTML = '';
        if (p.status === 'completed' && !p.coinsApproved) {
            coinStatusHTML = `<div class="live-session-meta" style="color:var(--accent-gold)">🪙 ${p.pendingCoins || 0} C ${t('session_awaiting_approval')}</div>`;
        } else if (p.status === 'completed' && p.coinsApproved) {
            coinStatusHTML = `<div class="live-session-meta" style="color:var(--accent-green)">✓ ${p.pendingCoins || 0} C ${t('coins_paid_out') || 'paid out'}</div>`;
        }

        // Coin rate / accumulator based on player count
        let coinRateHTML = '';
        const proposalPlayerCount = p.players.length;
        const proposalRate = getPlayerRate(proposalPlayerCount);
        if (['pending', 'approved'].includes(p.status) && proposalRate > 0) {
            coinRateHTML = `<div class="session-coin-rate">${proposalRate} ${coinSvgIcon()} / min</div>`;
        } else if (p.status === 'active' && proposalRate > 0 && p.startedAt) {
            const initialMinutes = (Date.now() - p.startedAt) / 60000;
            const initialCoins = Math.ceil(initialMinutes * proposalRate);
            const pd = new Date(p.startedAt);
            const startTimeStr = `${pd.toLocaleDateString('de-DE')} ${pd.toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'})}`;
            coinRateHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
        <div class="live-session-meta"><span class="datetime-label">${t('start_time_label')}</span> ${startTimeStr}</div>
        <span class="session-coin-accumulator" data-started-at="${p.startedAt}" data-rate="${proposalRate}">~${initialCoins} ${coinSvgIcon()}</span>
    </div>`;
        }

        let scheduleHTML = '';
        if ((p.scheduledDay || p.scheduledTime) && p.status !== 'active') {
            scheduleHTML = `<div class="live-session-meta"><span class="datetime-label">${t('start_time_label')}</span> ${formatScheduleDate(p.scheduledDay)} ${p.scheduledTime || ''}</div>`;
        }

        let messageHTML = '';
        if (p.message && p.status !== 'active') {
            messageHTML = `<div class="live-session-meta">${p.message}</div>`;
        }

        let leaderEditHTML = '';
        if (isLeader && ['pending', 'approved'].includes(p.status)) {
            const minDate = getNowPlus10().date;
            leaderEditHTML = `
                <div class="leader-edit-row">
                    <span class="datetime-label">${t('start_time_label')}</span>
                    <input type="date" class="leader-day datetime-input" data-id="${p.id}" value="${/^\d{4}-\d{2}-\d{2}$/.test(p.scheduledDay || '') ? p.scheduledDay : ''}" min="${minDate}" required style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);font-size:0.85rem">
                    <input type="time" class="leader-time datetime-input" data-id="${p.id}" value="${p.scheduledTime || ''}" style="flex:1;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);font-size:0.85rem">
                </div>`;
        }

        const actions = [];

        if (!isJoined && ['pending', 'approved'].includes(p.status)) {
            actions.push(`<button class="btn-session-join btn-join" data-id="${p.id}">${t('btn_join_session')}</button>`);
        }
        if (isJoined && !isLeader && ['pending', 'approved'].includes(p.status)) {
            actions.push(`<button class="btn-session-leave btn-leave" data-id="${p.id}">${t('btn_leave_session')}</button>`);
        }
        if (isLeader && ['pending', 'approved'].includes(p.status)) {
            actions.push(`<button class="btn-session-start btn-start-session" data-id="${p.id}">${t('btn_start_now')}</button>`);
        }
        if ((isLeader || admin) && p.status === 'active') {
            actions.push(`<button class="btn-session-end btn-end-session" data-id="${p.id}">${t('btn_end_session')}</button>`);
        }
        if (isLeader && ['pending', 'approved'].includes(p.status)) {
            actions.push(`<button class="btn-session-end btn-withdraw" data-id="${p.id}" style="font-size:0.75rem;opacity:0.6">${t('btn_withdraw')}</button>`);
        }
        if (admin && p.status === 'pending') {
            actions.push(`<button class="btn-session-start btn-approve" data-id="${p.id}">${t('btn_approve')}</button>`);
            actions.push(`<button class="btn-session-end btn-reject" data-id="${p.id}">${t('btn_reject')}</button>`);
        }
        if (admin && p.status === 'completed' && p.coinsApproved === false) {
            actions.push(`<button class="btn-session-start btn-approve-coins" data-id="${p.id}">${t('btn_approve_coins', p.pendingCoins || '?')}</button>`);
        }
        if (admin) {
            actions.push(`<button class="btn-session-end btn-withdraw" data-id="${p.id}" data-admin-delete="true" title="Loeschen" style="font-size:0.75rem;opacity:0.6">&#x2716;</button>`);
        }

        const actionsHTML = actions.length ? `<div class="live-session-actions">${actions.join('')}</div>` : '';

        // Status-based CSS class like live-session-card
        const statusClass = { pending: 'proposal-pending', approved: 'proposal-approved', active: 'running', completed: 'ended', rejected: '' }[p.status] || '';

        return `
            <div class="card live-session-card ${statusClass}" data-proposal-id="${p.id}">
                <div class="live-session-header">
                    <span class="live-session-game">${p.medium ? renderLeaderIcons(p.leader, p.medium, p.medium_account) : renderLeaderIcons(p.leader)}${p.game}</span>
                    ${statusBadge}
                </div>
                ${messageHTML}
                ${scheduleHTML}
                ${coinStatusHTML}
                ${coinRateHTML}
                ${leaderEditHTML}
                <div>${[p.leader, ...p.players.filter(n => n !== p.leader).sort()].map(n => `<span class="player-chip player-name-clickable" data-player-info="${n}">${n === p.leader ? '<span class="session-leader-badge">GL</span>' : ''}${n}</span>`).join('')}</div>
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
                } catch (e) { showToast(e.message || t('save_error'), 'error'); }
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
                    refreshActiveView();
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
                    await api('POST', `/proposals/${btn.dataset.id}/approve`, { coins: coinsPerPlayer, approvedBy: state.currentPlayer });
                    showCoinAnimation(coinsPerPlayer);
                    showToast(t('coins_released', coinsPerPlayer, proposal.players.length), 'success');
                    renderDashboard();
                } catch (e) { console.error(e); }
            });
        });

        container.querySelectorAll('.btn-withdraw').forEach(btn => {
            btn.addEventListener('click', async () => {
                const isAdminDelete = btn.dataset.adminDelete === 'true';
                const label = isAdminDelete ? t('confirm_delete_proposal') : t('confirm_withdraw');
                showConfirm(label, async () => {
                    try {
                        await api('DELETE', `/proposals/${btn.dataset.id}`);
                        showToast(t('proposal_removed'), 'error');
                        renderProposals();
                    } catch (e) { console.error(e); }
                });
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
                showConfirm(t('confirm_reject_proposal'), async () => {
                    try {
                        await api('PUT', `/proposals/${btn.dataset.id}`, { status: 'rejected' });
                        showToast(t('proposal_rejected'), 'error');
                        renderProposals();
                    } catch (e) { console.error(e); }
                });
            });
        });

        container.querySelectorAll('.leader-day').forEach(sel => {
            sel.addEventListener('change', async () => {
                const timeInp = container.querySelector(`.leader-time[data-id="${sel.dataset.id}"]`);
                const day = sel.value;
                const time = timeInp?.value || '00:00';
                if (day && new Date(`${day}T${time}`) < new Date(Date.now() + 9 * 60 * 1000)) {
                    showToast(t('start_time_future_error'), 'error');
                    sel.value = getNowPlus10().date;
                    return;
                }
                try {
                    await api('PUT', `/proposals/${sel.dataset.id}`, { scheduledDay: day });
                } catch (e) { console.error(e); }
            });
        });
        container.querySelectorAll('.leader-time').forEach(inp => {
            inp.addEventListener('click', () => { try { inp.showPicker(); } catch(e) {} });
            inp.addEventListener('change', async () => {
                const dayInp = container.querySelector(`.leader-day[data-id="${inp.dataset.id}"]`);
                const day = dayInp?.value || getNowPlus10().date;
                const time = inp.value;
                if (time && new Date(`${day}T${time}`) < new Date(Date.now() + 9 * 60 * 1000)) {
                    showToast(t('start_time_future_error'), 'error');
                    inp.value = getNowPlus10().time;
                    return;
                }
                try {
                    await api('PUT', `/proposals/${inp.dataset.id}`, { scheduledTime: time });
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
                    ${playerStars > 0 ? `<div class="profile-stars"><img src="svg/console-controller.svg" class="controller-svg-icon"> x${playerStars}</div>` : ''}
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
                    showConfirm(t('token_redeem_confirm', names[type]), async () => {
                        try {
                            await api('DELETE', `/tokens/${encodeURIComponent(player)}/${type}`);
                            showToast(t('token_redeemed', names[type]), 'gold');
                            playSound('spend');
                            renderProfile();
                        } catch (e) { console.error(e); }
                    });
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

            const endedSessions = liveSessionsData.filter(s => s.status === 'ended' && !s.challenge_id);
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
                        await api('POST', `/live-sessions/${sid}/approve`, { coinsPerPlayer, player: state.currentPlayer });
                        showCoinAnimation(coinsPerPlayer);
                        showToast(t('session_approved', coinsPerPlayer), 'success');
                        renderSession();
                    } catch (e) { showToast(t('session_error_approve'), 'error'); }
                });
            });
            container.querySelectorAll('.freigabe-cancel-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    showConfirm(t('discard_confirm'), async () => {
                        await api('DELETE', `/live-sessions/${btn.dataset.sid}`);
                        renderSession();
                    });
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

        let usersData, liveSessionsData, allProposals, settingsData;
        try {
            [usersData, liveSessionsData, allProposals, settingsData] = await Promise.all([
                api('GET', '/users'),
                api('GET', '/live-sessions'),
                api('GET', '/proposals'),
                api('GET', '/settings')
            ]);
        } catch (e) {
            panel.innerHTML = `<div class="admin-panel-header"><span class="admin-panel-title">⚙️ Admin</span><button class="admin-panel-close" id="ap-close">✕</button></div><div class="admin-panel-body"><p class="text-muted">${t('error_loading')}</p></div>`;
            $('#ap-close').addEventListener('click', closeAdminPanel);
            return;
        }

        // Prepare freigabe section
        const endedSessions = liveSessionsData.filter(s => s.status === 'ended' && !s.challenge_id);
        const completedProposals = allProposals.filter(p => p.status === 'completed' && !p.coinsApproved);
        const hasFreigabe = endedSessions.length > 0 || completedProposals.length > 0;

        let freigabeHTML = '';
        if (hasFreigabe) {
            freigabeHTML = `
                <div class="card" style="border-left: 3px solid var(--accent-gold)">
                    <div class="card-title" style="color:var(--accent-gold)">📋 ${t('freigabe_pending', 'Ausstehende Freigaben')} (${endedSessions.length + completedProposals.length})</div>
                    ${endedSessions.map(s => {
                        const coins = s.pending_coins > 0 ? s.pending_coins : calculateSessionCoins(s.players.length, state.attendees.length);
                        return `
                            <div style="padding:0.5rem 0;border-bottom:1px solid var(--border);margin-bottom:0.5rem">
                                <div style="font-weight:600">${s.game}</div>
                                <div style="font-size:0.85rem;color:var(--text-secondary)">Leader: ${s.leader} · ${s.players.length} Spieler${s.startedAt && s.endedAt ? ` · ${Math.ceil((s.endedAt - s.startedAt) / 60000)} Min` : ''}</div>
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

        const maxMultiplier = parseInt(settingsData?.max_multiplier || '10');
        const playerMultipliersMap = (() => { try { return JSON.parse(settingsData?.player_multipliers || '{}'); } catch { return {}; } })();

        function buildMultipliersTable(maxMult, currentMap) {
            let rows = '';
            for (let i = 2; i <= maxMult; i++) {
                const val = currentMap[String(i)] !== undefined ? currentMap[String(i)] : 1.0;
                rows += `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.1rem 0">
                    <span style="font-size:0.82rem;color:var(--text-secondary);width:10rem">${t('session_coins_rate_row', i, i === maxMult ? '+' : '')}</span>
                    <input type="number" class="player-multiplier-input" data-count="${i}" value="${val}" min="0" max="999" step="0.1" style="width:5rem;padding:3px 6px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);text-align:center;font-size:0.85rem">
                </div>`;
            }
            return rows;
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

                <div class="card">
                    <div class="card-title">⚙️ ${t('session_coins_title')}</div>
                    <div style="display:flex;flex-direction:column;gap:0.5rem">
                        <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
                            <span style="font-size:0.85rem;color:var(--text-secondary);min-width:12rem">${t('label_max_player_limit')}</span>
                            <input type="number" id="max-multiplier-input" value="${maxMultiplier}" min="2" max="100" step="1" style="width:5rem;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);text-align:center">
                        </div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.25rem">${t('session_coins_formula')}</div>
                        <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.2rem">${t('session_coins_rate_label')}</div>
                        <div id="player-multipliers-table">${buildMultipliersTable(maxMultiplier, playerMultipliersMap)}</div>
                    </div>
                </div>

                <div class="danger-zone">
                    <div class="card-title">${t('danger_zone')}</div>
                    <button class="btn-danger" id="ap-btn-reset-coins">${t('btn_reset_coins')}</button>
                    <button class="btn-danger" id="ap-btn-reset-stars">${t('btn_reset_stars')}</button>
                    <button class="btn-danger" id="ap-btn-reset-challenges">${t('btn_reset_challenges')}</button>
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
                        await api('POST', `/live-sessions/${sid}/approve`, { coinsPerPlayer: coins, player: state.currentPlayer });
                        showToast('Session freigegeben', 'success');
                        renderAdminPanel();
                    } catch (e) { showToast('Fehler beim Freigeben', 'error'); console.error(e); }
                } else if (pid) {
                    // Proposal approval
                    const coinsInput = panel.querySelector(`.freigabe-coins-input[data-pid="${pid}"]`);
                    const coins = parseInt(coinsInput.value) || 0;
                    try {
                        await api('POST', `/proposals/${pid}/approve`, { coins, approvedBy: state.currentPlayer });
                        showToast('Geplante Session freigegeben', 'success');
                        renderAdminPanel();
                    } catch (e) { showToast('Fehler beim Freigeben', 'error'); console.error(e); }
                }
            });
        });

        // Live-save: Max-Spieler-Limit + Tabelle neu aufbauen
        panel.querySelector('#max-multiplier-input')?.addEventListener('change', async (e) => {
            const val = parseInt(e.target.value);
            if (isNaN(val) || val < 2) return;
            try {
                await api('PUT', '/settings/max_multiplier', { value: val });
                showToast('Limit gespeichert', 'success');
                const currentMap = {};
                panel.querySelectorAll('.player-multiplier-input').forEach(inp => { currentMap[inp.dataset.count] = parseFloat(inp.value) || 0; });
                const tableEl = panel.querySelector('#player-multipliers-table');
                if (tableEl) { tableEl.innerHTML = buildMultipliersTable(val, currentMap); bindMultiplierInputs(); }
            } catch { showToast('Fehler', 'error'); }
        });

        // Live-save: Multiplikator pro Spieleranzahl
        function bindMultiplierInputs() {
            panel.querySelectorAll('.player-multiplier-input').forEach(inp => {
                inp.addEventListener('change', async () => {
                    const map = {};
                    panel.querySelectorAll('.player-multiplier-input').forEach(i => { map[i.dataset.count] = parseFloat(i.value) || 0; });
                    try { await api('PUT', '/settings/player_multipliers', { value: JSON.stringify(map) }); }
                    catch { showToast('Fehler', 'error'); }
                });
            });
        }
        bindMultiplierInputs();

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
                showConfirm(t('delete_player_confirm', name), async () => {
                    try {
                        await api('DELETE', `/users/${encodeURIComponent(name)}`);
                        showToast(t('player_deleted', name), 'error');
                        await refreshPlayers();
                        renderAdminPanel();
                    } catch (e) { console.error(e); }
                });
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
        $('#ap-btn-reset-coins').addEventListener('click', () => {
            showConfirm(t('confirm_reset_coins'), async () => {
                try { await api('DELETE', '/reset/coins', { requestedBy: state.currentPlayer }); showToast(t('reset_coins_done'), 'error'); }
                catch (e) { console.error(e); }
            });
        });
        $('#ap-btn-reset-stars').addEventListener('click', () => {
            showConfirm(t('confirm_reset_stars'), async () => {
                try { await api('DELETE', '/reset/stars', { requestedBy: state.currentPlayer }); showToast(t('reset_stars_done'), 'error'); }
                catch (e) { console.error(e); }
            });
        });
        $('#ap-btn-reset-challenges').addEventListener('click', () => {
            showConfirm(t('confirm_reset_challenges'), async () => {
                try { await api('DELETE', '/reset/challenges', { requestedBy: state.currentPlayer }); showToast(t('reset_challenges_done'), 'error'); }
                catch (e) { console.error(e); }
            });
        });
        $('#ap-btn-reset-all').addEventListener('click', () => {
            showConfirm(t('reset_confirm_1'), () => {
                showConfirm(t('reset_confirm_2'), async () => {
                    try {
                        await api('DELETE', '/reset', { requestedBy: state.currentPlayer });
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
                });
            });
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
            try {
                const result = await api('POST', '/shop/buy-star', { player, cost });
                state.coins[player] = (state.coins[player] || 0) - cost;
                state.stars[player] = result.newStars;
                showToast(t('star_bought', state.stars[player]), 'success');
                updateHeader();
                renderShop();
            } catch (e) { showToast(t('not_enough_coins'), 'error'); }
            return;
        }

        if (itemId === 'force_play') {
            showTargetModal(itemId, cost, t('who_to_force'), (target) => t('force_toast', item.name, target));
        } else if (itemId === 'drink_order') {
            showTargetModal(itemId, cost, t('who_to_drink'), (target) => t('drink_toast', state.currentPlayer, target));
        } else if (itemId === 'rob_coins') {
            showRobModal('rob_coins', cost);
        } else if (itemId === 'rob_controller') {
            showRobModal('rob_controller', cost);
        } else {
            showConfirm(t('buy_item_confirm', item.name, cost), async () => {
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
            });
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

    async function showRobModal(itemId, cost) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        const isController = itemId === 'rob_controller';

        const otherPlayers = state.players.filter(p => p !== state.currentPlayer);

        modal.innerHTML = `
            <div class="modal-title">${isController ? t('rob_controller_pick_target') : t('rob_coins_pick_target')}</div>
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
                    if (isController) {
                        const result = await api('POST', '/shop/rob-controller', { thief: state.currentPlayer, target, cost });
                        playSound('spend');
                        if (result.success) {
                            showToast(t('rob_controller_success', target), 'gold');
                            await api('POST', '/player-events', {
                                target, type: 'rob_controller_victim', from_player: state.currentPlayer,
                                message: JSON.stringify({ thief: state.currentPlayer, success: true })
                            });
                        } else {
                            showToast(t('rob_controller_fail', target), 'error');
                            await api('POST', '/player-events', {
                                target, type: 'rob_controller_victim', from_player: state.currentPlayer,
                                message: JSON.stringify({ thief: state.currentPlayer, success: false })
                            });
                        }
                    } else {
                        const result = await api('POST', '/shop/rob-coins', { thief: state.currentPlayer, target, cost });
                        playSound('spend');
                        if (result.stolen > 0) {
                            showToast(t('rob_coins_success', result.stolen, target), 'gold');
                            await api('POST', '/player-events', {
                                target, type: 'rob_coins_victim', from_player: state.currentPlayer,
                                message: JSON.stringify({ thief: state.currentPlayer, stolen: result.stolen })
                            });
                        } else {
                            showToast(t('rob_coins_fail', target), 'error');
                        }
                    }
                    updateHeader();
                    renderShop();
                } catch (e) {
                    showToast(t('not_enough_coins'), 'error');
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

    function showDuelStartModal(data) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:9999;';

        const isTeam = data.type === 'team';
        let leftLabel, rightLabel;
        if (isTeam) {
            const teamA = Array.isArray(data.teamA) ? data.teamA : JSON.parse(data.teamA || '[]');
            const teamB = Array.isArray(data.teamB) ? data.teamB : JSON.parse(data.teamB || '[]');
            leftLabel = teamA.join('<br>');
            rightLabel = teamB.join('<br>');
        } else {
            leftLabel = data.challenger;
            rightLabel = data.opponent;
        }

        const potParts = [];
        if (isTeam) {
            if (data.stakeCoinsPerPerson > 0) potParts.push(`${data.stakeCoinsPerPerson} ${coinSvgIcon()} ${t('per_person')}`);
            if (data.stakeStarsPerPerson > 0) potParts.push(`${data.stakeStarsPerPerson} ${controllerSvgIcon()} ${t('per_person')}`);
        } else {
            if (data.stakeCoins > 0) potParts.push(`${data.stakeCoins * 2} ${coinSvgIcon()}`);
            if (data.stakeStars > 0) potParts.push(`${data.stakeStars * 2} ${controllerSvgIcon()}`);
        }
        const potStr = potParts.length ? potParts.join(' + ') : '';

        overlay.innerHTML = `
            <div style="background:var(--bg-card);border:1px solid var(--accent-gold);border-radius:var(--radius);padding:2rem 1.5rem;max-width:380px;width:90%;text-align:center;box-shadow:0 0 40px rgba(255,215,0,0.25);">
                <div style="font-size:1rem;font-weight:700;color:var(--accent-gold);letter-spacing:0.05em;margin-bottom:0.25rem;">⚔️ ${t('duel_start_title')}</div>
                <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:1.2rem;">${data.game}</div>
                <div style="display:flex;align-items:center;justify-content:center;gap:1rem;margin-bottom:1rem;">
                    <div style="flex:1;text-align:right;font-weight:700;font-size:1rem;color:var(--accent-purple);">${leftLabel}</div>
                    <div style="font-size:1.4rem;font-weight:900;color:var(--accent-gold);flex-shrink:0;">vs</div>
                    <div style="flex:1;text-align:left;font-weight:700;font-size:1rem;color:var(--accent-blue);">${rightLabel}</div>
                </div>
                ${potStr ? `<div style="font-size:0.85rem;color:var(--accent-gold);margin-bottom:1rem;">${t('pot_label')} ${potStr}</div>` : ''}
                <div style="font-size:2rem;font-weight:900;letter-spacing:0.1em;color:var(--accent-green);text-shadow:0 0 20px rgba(0,230,118,0.6);margin-bottom:1.5rem;">${t('duel_fight')}</div>
                <button class="duel-start-goto-btn" style="background:var(--accent-gold);color:#000;border:none;border-radius:var(--radius-sm);padding:0.6rem 1.5rem;font-weight:700;font-size:0.95rem;cursor:pointer;">${t('btn_to_session')}</button>
            </div>`;

        overlay.querySelector('.duel-start-goto-btn').addEventListener('click', () => {
            overlay.remove();
            // Navigate to dashboard (home tab)
            const homeTab = document.querySelector('[data-tab="home"]') || document.querySelector('.nav-tab');
            if (homeTab) homeTab.click();
        });

        document.body.appendChild(overlay);
        if (getNotifPref('sound')) playSound('challenge');
    }

    function showDuelPayoutModal(data) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        const isWinner = data.isWinner;
        const opponent = isWinner ? data.loser : data.winner;

        const stakeCoins = data.stakeCoins || 0;
        const stakeStars = data.stakeStars || 0;
        const wonCoins = stakeCoins * 2;
        const wonStars = stakeStars * 2;

        const resultParts = [];
        if (isWinner) {
            if (wonCoins > 0) resultParts.push(`+${wonCoins} ${coinSvgIcon()}`);
            if (wonStars > 0) resultParts.push(`+${wonStars} ${controllerSvgIcon()}`);
        } else {
            if (stakeCoins > 0) resultParts.push(`-${stakeCoins} ${coinSvgIcon()}`);
            if (stakeStars > 0) resultParts.push(`-${stakeStars} ${controllerSvgIcon()}`);
        }
        const resultStr = resultParts.join(' + ') || '–';

        modal.innerHTML = `
            <div class="modal-title" style="color:${isWinner ? 'var(--accent-green, #00e676)' : 'var(--danger)'};">
                ${isWinner ? t('duel_payout_title_won') : t('duel_payout_title_lost')}
            </div>
            <div style="text-align:center;font-size:1.1rem;font-weight:700;margin:0.75rem 0;color:${isWinner ? 'var(--accent-green)' : 'var(--danger)'};">
                ${resultStr}
            </div>
            <div style="font-size:0.85rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.5rem;">
                🎮 ${data.game}
            </div>
            <div style="font-size:0.85rem;color:var(--text-secondary);">
                ${isWinner ? data.winner : data.loser} ${t('duel_payout_vs')} ${opponent}
            </div>
            <button class="btn-propose" id="duel-payout-close" style="margin-top:1.25rem;">OK</button>
        `;
        overlay.classList.add('show');
        const closeBtn = $('#duel-payout-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                overlay.classList.remove('show');
                if (isWinner) {
                    if (wonCoins > 0 || wonStars > 0) showCoinAnimation(wonCoins, wonStars);
                } else {
                    if (stakeCoins > 0 || stakeStars > 0) showNegativeCoinAnimation(stakeCoins, stakeStars);
                }
            });
        }
    }

    function showTcPayoutModal(data) {
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');
        const isWinner = (data.winnerTeam === 'A' ? data.teamA : data.teamB).includes(state.currentPlayer);
        const winnerTeamLabel = data.winnerTeam === 'A' ? t('team_a') : t('team_b');
        const loserTeamLabel  = data.winnerTeam === 'A' ? t('team_b') : t('team_a');
        const winners = data.winnerTeam === 'A' ? data.teamA : data.teamB;
        const losers  = data.winnerTeam === 'A' ? data.teamB : data.teamA;

        const rows = [];
        winners.forEach((p, idx) => {
            const coins = data.baseCoins + (idx === 0 ? data.remainder : 0);
            const stars = (data.baseStars || 0) + (idx === 0 ? (data.starRemainder || 0) : 0);
            const parts = [];
            if (coins > 0) parts.push(`+${coins} Coins`);
            if (stars > 0) parts.push(`+${stars} ${controllerSvgIcon()}`);
            rows.push({ player: p, text: parts.join(' + ') || '–', winner: true });
        });
        losers.forEach(p => {
            const parts = [];
            if (data.stakeCoinsPerPerson > 0) parts.push(`-${data.stakeCoinsPerPerson} Coins`);
            if (data.stakeStarsPerPerson > 0) parts.push(`-${data.stakeStarsPerPerson} ${controllerSvgIcon()}`);
            rows.push({ player: p, text: parts.join(' + ') || '–', winner: false });
        });

        const rowsHTML = rows.map(r => `
            <div style="display:flex;justify-content:space-between;padding:0.35rem 0;border-bottom:1px solid var(--border);">
                <span>${r.player}</span>
                <span style="font-weight:600;color:${r.winner ? 'var(--accent-green, #00e676)' : 'var(--danger)'};">${r.text}</span>
            </div>`).join('');

        const potParts = [];
        if (data.totalPot > 0) potParts.push(`${data.totalPot} Coins`);
        if (data.totalStarPot > 0) potParts.push(`${data.totalStarPot} ${controllerSvgIcon()}`);
        const potStr = potParts.join(' + ') || '–';

        const stakeParts = [];
        if (data.stakeCoinsPerPerson > 0) stakeParts.push(`${data.stakeCoinsPerPerson} Coins`);
        if (data.stakeStarsPerPerson > 0) stakeParts.push(`${data.stakeStarsPerPerson} ${controllerSvgIcon()}`);
        const stakeStr = stakeParts.join(' + ') || '–';

        modal.innerHTML = `
            <div class="modal-title" style="color:${isWinner ? 'var(--accent-green, #00e676)' : 'var(--danger)'};">
                ${isWinner ? t('tc_payout_won', winnerTeamLabel) : t('tc_payout_lost', loserTeamLabel)}
            </div>
            <div style="text-align:center;font-size:1rem;margin-bottom:1rem;color:var(--text-secondary);">
                ${isWinner ? t('tc_payout_won_sub') : t('tc_payout_lost_sub')}
            </div>
            <div style="font-size:0.85rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.5rem;">
                🎮 ${data.game}
            </div>
            <div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.25rem;">
                ${t('tc_payout_stake')}: <strong>${stakeStr}</strong> &nbsp;·&nbsp; ${t('total_pot_preview', potStr)}
            </div>
            <div style="font-weight:700;margin:0.75rem 0 0.4rem;">📋 ${t('tc_payout_breakdown')}</div>
            <div style="font-size:0.9rem;">${rowsHTML}</div>
            <button class="btn-propose" id="tc-payout-close" style="margin-top:1.25rem;">OK</button>
        `;
        overlay.classList.add('show');
        $('#tc-payout-close').addEventListener('click', () => overlay.classList.remove('show'));
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

        function showGrid() {
            const mediumGrid = MEDIUM_OPTIONS.map(opt => {
                const iconHtml = opt.svg
                    ? `<img src="${opt.svg}" alt="${opt.label}" style="width:1.4rem;height:1.4rem;object-fit:contain;filter:brightness(0) invert(1) opacity(0.85)">`
                    : `<span style="font-size:1.4rem">${opt.icon}</span>`;
                return `
                <button class="medium-select-btn" data-medium="${opt.id}" style="display:flex;flex-direction:column;align-items:center;gap:0.35rem;padding:0.5rem;border:2px solid var(--border);border-radius:8px;background:var(--bg-secondary);cursor:pointer;transition:all 0.2s;text-align:center;color:var(--text-primary)">
                    ${iconHtml}
                    <span style="font-size:0.7rem;font-weight:600">${opt.label}</span>
                </button>
            `;
            }).join('');

            modal.innerHTML = `
                <div class="modal-title">Wie wird gespielt?</div>
                <div style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:1rem">${gameName}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:0.5rem;margin-bottom:1rem;overflow:hidden" id="medium-grid">
                    ${mediumGrid}
                </div>
                <div style="display:flex;gap:0.5rem">
                    <button class="modal-close-btn" id="medium-cancel-btn" style="flex:1">${t('btn_cancel')}</button>
                </div>
            `;

            modal.querySelectorAll('.medium-select-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const optId = btn.dataset.medium;
                    const opt = MEDIUM_OPTIONS.find(o => o.id === optId);
                    if (opt) showAccountStep(opt);
                });
            });

            document.getElementById('medium-cancel-btn').addEventListener('click', () => {
                overlay.classList.remove('show');
            });
        }

        function showAccountStep(opt) {
            const u = getUserInfo(state.currentPlayer) || {};
            const savedValue = opt.id === 'lan' ? (u.ip || '') : (opt.id === 'other' ? '' : (u[opt.id] || ''));

            const icon = opt.svg
                ? `<img src="${opt.svg}" style="width:2rem;height:2rem;filter:invert(1);">`
                : `<span style="font-size:2rem">${opt.icon}</span>`;

            modal.innerHTML = `
                <div style="padding:0.5rem 0 1rem;display:flex;flex-direction:column;gap:1rem;">
                    <div style="display:flex;align-items:center;gap:0.75rem;">
                        ${icon}
                        <h3 style="margin:0;color:var(--text-primary)">${opt.label}</h3>
                    </div>
                    <p style="margin:0;color:var(--text-secondary);font-size:0.85rem">
                        ${t('medium_account_hint')}
                    </p>
                    <input id="medium-account-input" type="text"
                        placeholder="${opt.label} ID / Link"
                        value="${savedValue}"
                        style="padding:0.75rem;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:var(--text-primary);font-size:0.9rem;width:100%;box-sizing:border-box;">
                    <div style="display:flex;gap:0.5rem;">
                        <button id="medium-back-btn" style="flex:1;padding:0.75rem;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text-primary);cursor:pointer;">
                            ${t('back')}
                        </button>
                        <button id="medium-start-btn" style="flex:2;padding:0.75rem;border:none;border-radius:8px;background:var(--gradient-primary);color:white;cursor:pointer;font-weight:600;">
                            ${t('btn_start')}
                        </button>
                    </div>
                </div>
            `;

            document.getElementById('medium-back-btn').addEventListener('click', showGrid);
            document.getElementById('medium-start-btn').addEventListener('click', () => {
                const accountValue = document.getElementById('medium-account-input').value.trim();
                overlay.classList.remove('show');
                if (callback) callback(opt.id, accountValue);
            });
        }

        overlay.classList.add('show');
        showGrid();
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
                showMediumSelectModal(el.dataset.game, async (medium, account) => {
                    try {
                        await api('POST', '/live-sessions', { game: el.dataset.game, leader: state.currentPlayer, medium, account });
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
        const { date: defaultDate, time: defaultTime } = getNowPlus10();
        let selectedGame = null;
        modal.innerHTML = `
            <div class="modal-title">${t('modal_plan_session_title')}</div>
            <input type="text" id="ps-search" class="search-input" placeholder="Spiel suchen..." style="margin-bottom:0.5rem">
            <div class="game-select-grid" id="ps-game-grid" style="max-height:35vh;overflow-y:auto">
                ${sortedGames.map(g => `<div class="game-select-item" data-game="${g.name}">${g.name}</div>`).join('')}
            </div>
            <div class="leader-edit-row" style="margin-top:0.75rem">
                <span class="datetime-label">${t('start_time_label')}</span>
                <input type="date" id="ps-day" class="datetime-input" value="${defaultDate}" min="${defaultDate}" required style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary)">
                <input type="time" id="ps-time" class="datetime-input" value="${defaultTime}" style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary)">
            </div>
            <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
                <button class="btn-propose" id="ps-confirm" disabled>${t('btn_plan')}</button>
                <button class="modal-close-btn" id="ps-cancel">${t('btn_cancel')}</button>
            </div>
        `;
        overlay.classList.add('show');
        $('#ps-time').addEventListener('click', () => { try { $('#ps-time').showPicker(); } catch(e) {} });
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
        $('#ps-confirm').addEventListener('click', () => {
            if (!selectedGame) return;
            const day = $('#ps-day').value;
            const time = $('#ps-time').value;
            if (!day) { showToast('Datum ist ein Pflichtfeld', 'error'); return; }
            const selectedDT = new Date(`${day}T${time || '00:00'}`);
            if (selectedDT < new Date(Date.now() + 9 * 60 * 1000)) {
                showToast(t('start_time_future_error'), 'error');
                return;
            }
            overlay.classList.remove('show');
            showMediumSelectModal(selectedGame, async (medium, account) => {
                try {
                    await api('POST', '/proposals', {
                        game: selectedGame,
                        leader: state.currentPlayer,
                        scheduledDay: day,
                        scheduledTime: time,
                        isNewGame: 0,
                        medium,
                        medium_account: account
                    });
                    showToast(t('session_planned', selectedGame), 'success');
                    renderDashboard();
                } catch (e) { showToast(t('plan_error'), 'error'); }
            });
        });
        $('#ps-cancel').addEventListener('click', () => overlay.classList.remove('show'));
    }

    // ---- Header ----
    function updateHeader() {
        const playerBtn = $('#header-player-btn');
        const coinsDisplay = $('#header-coins');
        const starsDisplay = $('#header-stars');
        const starsContainer = $('#header-stars-display');

        if (state.currentPlayer) {
            playerBtn.textContent = state.currentPlayer;
            playerBtn.style.display = 'inline-block';
            coinsDisplay.textContent = getPlayerCoins(state.currentPlayer);
            coinsDisplay.parentElement.style.display = 'flex';
            const playerStars = getPlayerStars(state.currentPlayer);
            if (starsDisplay) starsDisplay.textContent = playerStars;
            if (starsContainer) starsContainer.style.display = playerStars > 0 ? 'flex' : 'none';
        } else {
            playerBtn.textContent = t('header_login');
            playerBtn.style.display = 'inline-block';
            coinsDisplay.parentElement.style.display = 'none';
            if (starsContainer) starsContainer.style.display = 'none';
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
            const [challenges, teamChallenges, coinsData, starsData] = await Promise.all([
                api('GET', '/challenges'),
                api('GET', '/team-challenges'),
                api('GET', '/coins'),
                api('GET', '/stars')
            ]);
            state.coins = coinsData;
            state.stars = starsData;

            const myCoins = getPlayerCoins(state.currentPlayer);
            const myStars = getPlayerStars(state.currentPlayer);
            const opponents = state.attendees.filter(p => p !== state.currentPlayer);

            const statusLabels = { pending: t('duel_status_pending'), accepted: t('duel_status_accepted'), completed: t('duel_status_completed'), paid: t('duel_status_paid'), rejected: t('duel_status_rejected'), conflict: t('duel_status_conflict') || 'Konflikt' };

            function renderCard(c) {
                const isOpponent = c.opponent === state.currentPlayer;
                const admin = isAdmin();
                const pot = [];
                if (c.stakeCoins > 0) pot.push(`${c.stakeCoins * 2} ${coinSvgIcon()}`);
                if (c.stakeStars > 0) pot.push(`${c.stakeStars * 2} ${controllerSvgIcon()}`);
                const potStr = pot.length ? pot.join(' + ') : t('no_stake');

                let actionsHTML = '';

                if (c.status === 'pending' && isOpponent) {
                    actionsHTML = `
                        <div class="proposal-actions">
                            <button class="btn-join ch-accept" data-id="${c.id}" data-game="${c.game}" data-challenger="${c.challenger}" data-opponent="${c.opponent}" data-stake-coins="${c.stakeCoins || 0}" data-stake-stars="${c.stakeStars || 0}">${t('notif_accept')}</button>
                            <button class="btn-leave ch-reject" data-id="${c.id}">${t('notif_reject')}</button>
                        </div>`;
                }

                // GL (challenger) can cancel their own pending challenge
                const isChallenger = c.challenger === state.currentPlayer;
                if (c.status === 'pending' && isChallenger) {
                    actionsHTML += `<div class="proposal-actions"><button class="btn-leave ch-cancel-gl" data-id="${c.id}">${t('btn_cancel')}</button></div>`;
                }

                if (admin && c.status !== 'paid') {
                    actionsHTML += `<div class="proposal-actions"><button class="btn-leave ch-delete" data-id="${c.id}">${t('btn_delete_duel')}</button></div>`;
                }

                const winnerInfo = c.winner ? `<div class="game-meta" style="margin-top:0.3rem;">🏆 ${c.winner}</div>` : '';

                const highlightClass = String(c.id) === String(focusChallengeId) ? ' highlight-challenge' : '';
                let challengerStyle = '';
                let opponentStyle = '';
                if (c.status === 'paid' && c.winner) {
                    challengerStyle = c.challenger === c.winner ? 'color:var(--accent-green);font-weight:700' : 'color:var(--accent-red);font-weight:700';
                    opponentStyle   = c.opponent   === c.winner ? 'color:var(--accent-green);font-weight:700' : 'color:var(--accent-red);font-weight:700';
                }
                return `
                    <div class="proposal-card${highlightClass}" data-id="${c.id}">
                        <div class="proposal-card-header">
                            <span><span style="${challengerStyle}">${c.challenger}</span> ⚔️ <span style="${opponentStyle}">${c.opponent}</span></span>
                            <span class="status-badge ${c.status}">${statusLabels[c.status] || c.status}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div class="game-meta">${c.game}</div>
                            <div class="vote-pot-display" style="margin:0">${t('pot_label')} ${potStr}</div>
                        </div>
                        ${winnerInfo}
                        ${actionsHTML}
                    </div>`;
            }

            function renderTeamCard(tc) {
                const teamA = JSON.parse(tc.teamA);
                const teamB = JSON.parse(tc.teamB);
                const admin = isAdmin();
                const inTeamA = teamA.includes(state.currentPlayer);
                const inTeamB = teamB.includes(state.currentPlayer);
                const inChallenge = inTeamA || inTeamB;
                const totalPlayers = teamA.length + teamB.length;
                const totalPot = tc.stakeCoinsPerPerson * totalPlayers;
                const totalStarPot = tc.stakeStarsPerPerson * totalPlayers;
                const acceptances = JSON.parse(tc.acceptances || '[]');
                const allPlayers = [...teamA, ...teamB];
                const hasAccepted = acceptances.includes(state.currentPlayer);

                const statusLabels = {
                    pending: t('duel_status_pending'),
                    accepted: t('duel_status_accepted'),
                    completed: t('duel_status_completed'),
                    paid: t('duel_status_paid'),
                    rejected: t('duel_status_rejected'),
                    conflict: t('duel_status_conflict') || 'Konflikt'
                };

                const potParts = [];
                if (tc.stakeCoinsPerPerson > 0) potParts.push(`${tc.stakeCoinsPerPerson} Coins/Person · ${t('total_pot_preview', totalPot + ' Coins')}`);
                if (tc.stakeStarsPerPerson > 0) potParts.push(`${tc.stakeStarsPerPerson} ${controllerSvgIcon()}/Person · ${t('total_pot_preview', totalStarPot + ' ' + controllerSvgIcon())}`);
                const potStr = potParts.length ? potParts.join(' · ') : t('no_stake');

                const winnerLabel = tc.winnerTeam === 'A' ? t('team_a_wins') : tc.winnerTeam === 'B' ? t('team_b_wins') : '';
                const highlightClass = inChallenge ? ' highlight' : '';

                // Acceptance status list (only shown while pending)
                let acceptanceHTML = '';
                if (tc.status === 'pending') {
                    const acceptanceItems = allPlayers.map(p => {
                        const accepted = acceptances.includes(p);
                        const inA = teamA.includes(p);
                        const teamColor = inA ? 'var(--accent-purple)' : 'var(--accent-blue)';
                        return `<span style="display:inline-flex;align-items:center;gap:0.25rem;font-size:0.8rem;padding:0.15rem 0.4rem;border-radius:var(--radius-sm);background:${accepted ? 'rgba(0,230,118,0.12)' : 'rgba(255,255,255,0.05)'};color:${accepted ? 'var(--accent-green, #00e676)' : 'var(--text-secondary)'};border:1px solid ${accepted ? 'rgba(0,230,118,0.3)' : 'var(--border)'};">
                            <span style="font-size:0.65rem;color:${teamColor};">●</span>${p}${accepted ? ' ✓' : ' ⏳'}
                        </span>`;
                    }).join('');
                    acceptanceHTML = `<div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin:0.4rem 0;">${acceptanceItems}</div>`;
                }

                let actionsHTML = '';
                if (tc.status === 'pending' && inChallenge && !hasAccepted) {
                    actionsHTML = `
                        <div class="proposal-actions">
                            <button class="btn-join tc-accept" data-id="${tc.id}">${t('notif_accept')}</button>
                            <button class="btn-leave tc-reject" data-id="${tc.id}">${t('notif_reject')}</button>
                        </div>`;
                }
                // GL (creator) can cancel their own pending team challenge
                if (tc.status === 'pending' && tc.createdBy === state.currentPlayer) {
                    actionsHTML += `<div class="proposal-actions"><button class="btn-leave tc-cancel-gl" data-id="${tc.id}">${t('btn_cancel')}</button></div>`;
                }

                if (admin && tc.status !== 'paid') {
                    actionsHTML += `<div class="proposal-actions"><button class="btn-leave tc-delete" data-id="${tc.id}">${t('btn_delete_duel')}</button></div>`;
                }

                // Sort creator first in their team; render GL badge for creator
                const sortCreatorFirst = (arr) => [...arr].sort((a, b) => a === tc.createdBy ? -1 : b === tc.createdBy ? 1 : 0);
                const renderPlayerName = (name) => name === tc.createdBy
                    ? `<span style="font-size:0.65rem;background:var(--accent-gold,#ffd700);color:#000;padding:0.1rem 0.3rem;border-radius:3px;font-weight:700;margin-right:0.2rem;vertical-align:middle;">GL</span>${name}`
                    : name;
                const teamADisplay = sortCreatorFirst(teamA).map(renderPlayerName).join(', ');
                const teamBDisplay = sortCreatorFirst(teamB).map(renderPlayerName).join(', ');

                let teamALabelColor = 'var(--accent-purple)';
                let teamBLabelColor = 'var(--accent-blue)';
                if (tc.status === 'paid' && tc.winnerTeam) {
                    teamALabelColor = tc.winnerTeam === 'A' ? 'var(--accent-green)' : 'var(--accent-red)';
                    teamBLabelColor = tc.winnerTeam === 'B' ? 'var(--accent-green)' : 'var(--accent-red)';
                }

                return `
                    <div class="proposal-card${highlightClass}" data-id="${tc.id}">
                        <div class="proposal-card-header">
                            <span style="font-weight:700;">👥 <span style="color:${teamALabelColor}">${t('team_a')}:</span> ${teamADisplay} <span style="color:var(--text-secondary)">vs</span> <span style="color:${teamBLabelColor}">${t('team_b')}:</span> ${teamBDisplay}</span>
                            <span class="status-badge ${tc.status}">${statusLabels[tc.status] || tc.status}</span>
                        </div>
                        <div class="game-meta">${tc.game}</div>
                        <div class="game-meta">${potStr}</div>
                        ${acceptanceHTML}
                        ${winnerLabel ? `<div class="game-meta" style="margin-top:0.3rem;">🏆 ${winnerLabel}</div>` : ''}
                        ${actionsHTML}
                    </div>`;
            }

            const tabToggleHTML = `
                <div style="display:flex;gap:0.5rem;margin-bottom:1rem;">
                    <button class="ch-tab-btn" data-tab="1v1" style="flex:1;padding:0.5rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:${challengeActiveTab === '1v1' ? 'var(--accent-purple)' : 'var(--bg-input)'};color:${challengeActiveTab === '1v1' ? '#fff' : 'var(--text-secondary)'};cursor:pointer;font-weight:${challengeActiveTab === '1v1' ? '700' : '400'};">⚔️ ${t('tab_1v1')}</button>
                    <button class="ch-tab-btn" data-tab="team" style="flex:1;padding:0.5rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:${challengeActiveTab === 'team' ? 'var(--accent-purple)' : 'var(--bg-input)'};color:${challengeActiveTab === 'team' ? '#fff' : 'var(--text-secondary)'};cursor:pointer;font-weight:${challengeActiveTab === 'team' ? '700' : '400'};">👥 ${t('tab_team')}</button>
                </div>`;

            const allPlayers = state.attendees;

            const teamFormHTML = challengeActiveTab === 'team' ? `
                <div class="proposal-form">
                    <div class="card-title" style="margin-bottom:0.75rem;">${t('new_team_duel')}</div>
                    <div style="display:flex;gap:1rem;align-items:flex-start;margin-bottom:0.75rem;">
                        <div style="flex:1;">
                            <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.4rem;font-weight:600;">${t('team_a')}</div>
                            ${allPlayers.map(p => `
                                <button type="button" class="tc-player-btn tc-team-a-btn${p === state.currentPlayer ? ' active' : ''}" data-player="${p}">${p}</button>
                            `).join('')}
                        </div>
                        <div style="flex:1;">
                            <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.4rem;font-weight:600;">${t('team_b')}</div>
                            ${allPlayers.map(p => `
                                <button type="button" class="tc-player-btn tc-team-b-btn" data-player="${p}">${p}</button>
                            `).join('')}
                        </div>
                    </div>
                    <div class="proposal-row">
                        <select id="tc-game" style="flex:1;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem;font-size:0.9rem;">
                            <option value="">${t('select_game')}</option>
                            ${state.games.filter(g => g.status === 'approved').sort((a, b) => a.name.localeCompare(b.name)).map(g => `<option value="${g.name}">${g.name}</option>`).join('')}
                        </select>
                    </div>
                    <div style="font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin:0.5rem 0 0.3rem;">${t('stake_label') || 'Einsatz'}</div>
                    <div class="proposal-row">
                        <div style="display:flex;align-items:center;gap:0.4rem;flex:1;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.25rem 0.5rem;">
                            ${coinSvgIcon()}
                            <input id="tc-coins" type="number" min="0" max="${myCoins}" placeholder="max ${myCoins}"
                                style="flex:1;background:transparent;color:var(--text-primary);border:none;outline:none;padding:0.25rem 0;font-size:0.9rem;width:0;">
                        </div>
                        <div style="display:flex;align-items:center;gap:0.4rem;flex:1;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.25rem 0.5rem;">
                            ${controllerSvgIcon()}
                            <input id="tc-stars" type="number" min="0" max="${myStars}" placeholder="max ${myStars}"
                                style="flex:1;background:transparent;color:var(--text-primary);border:none;outline:none;padding:0.25rem 0;font-size:0.9rem;width:0;">
                        </div>
                    </div>
                    <div id="tc-pot-preview" style="font-size:0.85rem;color:var(--accent-gold);margin-top:0.25rem;min-height:1.2rem;"></div>
                    <div id="tc-stake-error" style="color:var(--danger,#ff4444);font-size:0.78rem;min-height:1rem;"></div>
                    <button class="btn-propose" id="tc-create">${t('btn_challenge')}</button>
                </div>
            ` : '';

            const cardsHTML = challenges.length
                ? challenges.map(renderCard).join('')
                : `<div class="empty-state"><div class="empty-state-text">${t('no_duels')}</div></div>`;

            const teamCardsHTML = teamChallenges.length
                ? teamChallenges.map(renderTeamCard).join('')
                : `<div class="empty-state"><div class="empty-state-text">${t('no_team_duels')}</div></div>`;

            const oneVOneContentHTML = challengeActiveTab === '1v1' ? `
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
                    <div style="font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin:0.5rem 0 0.3rem;">${t('stake_label') || 'Einsatz'}</div>
                    <div class="proposal-row">
                        <div style="display:flex;align-items:center;gap:0.4rem;flex:1;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.25rem 0.5rem;">
                            ${coinSvgIcon()}
                            <input id="ch-coins" type="number" min="0" max="${myCoins}" placeholder="max ${myCoins}"
                                style="flex:1;background:transparent;color:var(--text-primary);border:none;outline:none;padding:0.25rem 0;font-size:0.9rem;width:0;">
                        </div>
                        <div style="display:flex;align-items:center;gap:0.4rem;flex:1;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.25rem 0.5rem;">
                            ${controllerSvgIcon()}
                            <input id="ch-stars" type="number" min="0" max="${myStars}" placeholder="max ${myStars}"
                                style="flex:1;background:transparent;color:var(--text-primary);border:none;outline:none;padding:0.25rem 0;font-size:0.9rem;width:0;">
                        </div>
                    </div>
                    <div id="ch-stake-error" style="color:var(--danger,#ff4444);font-size:0.78rem;min-height:1rem;margin-bottom:0.25rem;"></div>
                    <button class="btn-propose" id="ch-create">${t('btn_challenge')}</button>
                </div>
                ${cardsHTML}
            ` : '';

            // Save form state before re-render
            const prevTcTeamA = [...container.querySelectorAll('.tc-team-a-btn.active')].map(b => b.dataset.player);
            const prevTcTeamB = [...container.querySelectorAll('.tc-team-b-btn.active')].map(b => b.dataset.player);
            if (prevTcTeamA.length || prevTcTeamB.length) {
                tcFormState.teamA = prevTcTeamA;
                tcFormState.teamB = prevTcTeamB;
                tcFormState.game = container.querySelector('#tc-game')?.value || tcFormState.game;
                tcFormState.coins = container.querySelector('#tc-coins')?.value || tcFormState.coins;
                tcFormState.stars = container.querySelector('#tc-stars')?.value || tcFormState.stars;
            }
            const prevOpponent = container.querySelector('#ch-opponent')?.value;
            if (prevOpponent) {
                v1FormState.opponent = prevOpponent;
                v1FormState.coins = container.querySelector('#ch-coins')?.value || v1FormState.coins;
                v1FormState.stars = container.querySelector('#ch-stars')?.value || v1FormState.stars;
            }

            container.innerHTML = tabToggleHTML + (challengeActiveTab === '1v1' ? oneVOneContentHTML : teamFormHTML + teamCardsHTML);

            // Wire tab buttons
            container.querySelectorAll('.ch-tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    challengeActiveTab = btn.dataset.tab;
                    renderChallenges();
                });
            });

            if (challengeActiveTab === '1v1') {
                // Stake cap: update max based on selected opponent
                const chOpponent = container.querySelector('#ch-opponent');
                const chCoins = container.querySelector('#ch-coins');
                const chStars = container.querySelector('#ch-stars');
                if (chOpponent && chCoins && chStars) {
                    const chStakeError = container.querySelector('#ch-stake-error');

                    function validate1v1Stake() {
                        if (!chStakeError) return true;
                        const opp = chOpponent.value;
                        const coins = parseInt(chCoins.value) || 0;
                        const stars = parseInt(chStars.value) || 0;
                        const maxCoins = opp ? Math.min(myCoins, getPlayerCoins(opp)) : myCoins;
                        const maxStars = opp ? Math.min(myStars, getPlayerStars(opp)) : myStars;
                        if (coins > maxCoins) {
                            chStakeError.textContent = t('stake_coins_too_high');
                            return false;
                        }
                        if (stars > maxStars) {
                            chStakeError.textContent = t('stake_stars_too_high');
                            return false;
                        }
                        chStakeError.textContent = '';
                        return true;
                    }

                    chOpponent.addEventListener('change', () => {
                        const opp = chOpponent.value;
                        if (!opp) {
                            chCoins.max = myCoins;
                            chCoins.placeholder = `max ${myCoins}`;
                            chStars.max = myStars;
                            chStars.placeholder = `max ${myStars}`;
                        } else {
                            const effCoins = Math.min(myCoins, getPlayerCoins(opp));
                            const effStars = Math.min(myStars, getPlayerStars(opp));
                            chCoins.max = effCoins;
                            chCoins.placeholder = `max ${effCoins}`;
                            chStars.max = effStars;
                            chStars.placeholder = `max ${effStars}`;
                            if (parseInt(chCoins.value) > effCoins) chCoins.value = effCoins;
                            if (parseInt(chStars.value) > effStars) chStars.value = effStars;
                        }
                        validate1v1Stake();
                    });
                    chCoins.addEventListener('input', validate1v1Stake);
                    chStars.addEventListener('input', validate1v1Stake);
                }

                // Event: Create challenge
                $('#ch-create').addEventListener('click', async () => {
                    const opponent = $('#ch-opponent').value;
                    const game = $('#ch-game').value;
                    const stakeCoins = parseInt($('#ch-coins').value) || 0;
                    const stakeStars = parseInt($('#ch-stars').value) || 0;
                    if (!opponent) { showToast(t('select_opponent_error'), 'error'); playSound('error'); return; }
                    if (!game) { showToast(t('select_game_error'), 'error'); playSound('error'); return; }
                    if (stakeCoins === 0 && stakeStars === 0) { showToast(t('select_stake_error'), 'error'); playSound('error'); return; }
                    if (opponent) {
                        if (stakeCoins > 0 && (stakeCoins > myCoins || stakeCoins > getPlayerCoins(opponent))) { showToast(t('stake_coins_too_high'), 'error'); playSound('error'); return; }
                        if (stakeStars > 0 && (stakeStars > myStars || stakeStars > getPlayerStars(opponent))) { showToast(t('stake_stars_too_high'), 'error'); playSound('error'); return; }
                    }
                    try {
                        await api('POST', '/challenges', { challenger: state.currentPlayer, opponent, game, stakeCoins, stakeStars });
                        showToast(t('duel_created', opponent), 'success');
                        playSound('coin');
                        v1FormState = { opponent: '', coins: '', stars: '' };
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
                            const result = await api('PUT', `/challenges/${btn.dataset.id}/accept`, { player: state.currentPlayer });
                            showToast(t('duel_accepted'), 'success');
                            playSound('coin');
                            if (result.sessionId) {
                                shownDuelStartSessions.add(result.sessionId);
                                try {
                                    showDuelStartModal({
                                        type: '1v1', game: btn.dataset.game,
                                        challenger: btn.dataset.challenger, opponent: btn.dataset.opponent,
                                        stakeCoins: parseInt(btn.dataset.stakeCoins) || 0,
                                        stakeStars: parseInt(btn.dataset.stakeStars) || 0,
                                        sessionId: result.sessionId
                                    });
                                } catch(e) { console.error('DuelStart modal error:', e); }
                            }
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
                            const wonCoins = parseInt(btn.dataset.stakeCoins || 0) * 2;
                            if (wonCoins > 0) showCoinAnimation(wonCoins);
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

                // Event: GL cancel own pending challenge
                container.querySelectorAll('.ch-cancel-gl').forEach(btn => {
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
            }

            // Live pot preview + stake cap based on selected players
            function updateTcPotPreview() {
                if (challengeActiveTab !== 'team') return;
                    const checkedA = [...container.querySelectorAll('.tc-team-a-btn.active')].map(btn => btn.dataset.player);
                    const checkedB = [...container.querySelectorAll('.tc-team-b-btn.active')].map(btn => btn.dataset.player);
                    const allChecked = [...new Set([...checkedA, ...checkedB])];
                    const totalCount = checkedA.length + checkedB.length;

                    const tcCoinsInput = container.querySelector('#tc-coins');
                    const tcStarsInput = container.querySelector('#tc-stars');
                    const preview = container.querySelector('#tc-pot-preview');

                    if (allChecked.length > 0) {
                        const minCoins = Math.min(...allChecked.map(p => getPlayerCoins(p)));
                        const minStars = Math.min(...allChecked.map(p => getPlayerStars(p)));
                        if (tcCoinsInput) {
                            tcCoinsInput.max = minCoins;
                            tcCoinsInput.placeholder = `max ${minCoins}`;
                        }
                        if (tcStarsInput) {
                            tcStarsInput.max = minStars;
                            tcStarsInput.placeholder = `max ${minStars}`;
                        }
                    } else {
                        if (tcCoinsInput) {
                            tcCoinsInput.max = myCoins;
                            tcCoinsInput.placeholder = `max ${myCoins}`;
                        }
                        if (tcStarsInput) {
                            tcStarsInput.max = myStars;
                            tcStarsInput.placeholder = `max ${myStars}`;
                        }
                    }

                    const coinsVal = parseInt(tcCoinsInput?.value) || 0;
                    const starsVal = parseInt(tcStarsInput?.value) || 0;

                    // Inline stake validation
                    const tcStakeError = container.querySelector('#tc-stake-error');
                    if (tcStakeError && allChecked.length > 0) {
                        const minCoins = Math.min(...allChecked.map(p => getPlayerCoins(p)));
                        const minStars  = Math.min(...allChecked.map(p => getPlayerStars(p)));
                        if (coinsVal > minCoins) {
                            tcStakeError.textContent = t('stake_coins_too_high');
                        } else if (starsVal > minStars) {
                            tcStakeError.textContent = t('stake_stars_too_high');
                        } else {
                            tcStakeError.textContent = '';
                        }
                    } else if (tcStakeError) {
                        tcStakeError.textContent = '';
                    }

                    if (!preview) return;
                    if (totalCount > 0 && (coinsVal > 0 || starsVal > 0)) {
                        const parts = [];
                        if (coinsVal > 0) parts.push(`${coinsVal * totalCount} Coins`);
                        if (starsVal > 0) parts.push(`${starsVal * totalCount} 🎮`);
                        preview.textContent = t('total_pot_preview', parts.join(' + '));
                    } else {
                        preview.textContent = '';
                    }
            }
            if (challengeActiveTab === 'team') {
                // Mutual exclusion: a player cannot be on both teams simultaneously
                container.querySelectorAll('.tc-team-a-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        btn.classList.toggle('active');
                        if (btn.classList.contains('active')) {
                            const opp = container.querySelector(`.tc-team-b-btn[data-player="${btn.dataset.player}"]`);
                            if (opp) opp.classList.remove('active');
                        }
                        updateTcPotPreview();
                    });
                });
                container.querySelectorAll('.tc-team-b-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        btn.classList.toggle('active');
                        if (btn.classList.contains('active')) {
                            const opp = container.querySelector(`.tc-team-a-btn[data-player="${btn.dataset.player}"]`);
                            if (opp) opp.classList.remove('active');
                        }
                        updateTcPotPreview();
                    });
                });
                const tcCoins = container.querySelector('#tc-coins');
                if (tcCoins) tcCoins.addEventListener('input', updateTcPotPreview);
                const tcStars = container.querySelector('#tc-stars');
                if (tcStars) tcStars.addEventListener('input', updateTcPotPreview);

                // Create
                const tcCreateBtn = container.querySelector('#tc-create');
                if (tcCreateBtn) {
                    tcCreateBtn.addEventListener('click', async () => {
                        const teamA = [...container.querySelectorAll('.tc-team-a-btn.active')].map(btn => btn.dataset.player);
                        const teamB = [...container.querySelectorAll('.tc-team-b-btn.active')].map(btn => btn.dataset.player);
                        const game = container.querySelector('#tc-game')?.value;
                        const stakeCoinsPerPerson = parseInt(container.querySelector('#tc-coins')?.value) || 0;
                        const stakeStarsPerPerson = parseInt(container.querySelector('#tc-stars')?.value) || 0;
                        if (teamA.length < 2 || teamB.length < 2) { showToast(t('team_select_teams_error'), 'error'); playSound('error'); return; }
                        const overlap = teamA.filter(p => teamB.includes(p));
                        if (overlap.length > 0) { showToast(t('team_overlap_error'), 'error'); playSound('error'); return; }
                        if (!teamA.includes(state.currentPlayer) && !teamB.includes(state.currentPlayer)) { showToast(t('team_creator_not_in_team_error'), 'error'); playSound('error'); return; }
                        if (!game) { showToast(t('select_game_error'), 'error'); playSound('error'); return; }
                        if (stakeCoinsPerPerson === 0 && stakeStarsPerPerson === 0) { showToast(t('team_stake_error'), 'error'); playSound('error'); return; }
                        const allInTeams = [...new Set([...teamA, ...teamB])];
                        if (allInTeams.length > 0) {
                            const minCoins = Math.min(...allInTeams.map(p => getPlayerCoins(p)));
                            const minStars  = Math.min(...allInTeams.map(p => getPlayerStars(p)));
                            if (stakeCoinsPerPerson > minCoins) { showToast(t('stake_coins_too_high'), 'error'); playSound('error'); return; }
                            if (stakeStarsPerPerson > minStars) { showToast(t('stake_stars_too_high'), 'error'); playSound('error'); return; }
                        }
                        try {
                            await api('POST', '/team-challenges', { createdBy: state.currentPlayer, game, stakeCoinsPerPerson, stakeStarsPerPerson, teamA, teamB });
                            showToast(t('team_duel_created'), 'success');
                            playSound('coin');
                            tcFormState = { teamA: [], teamB: [], game: '', coins: '', stars: '' };
                            renderChallenges();
                        } catch (e) {
                            showToast('Fehler: ' + (JSON.parse(e.message).error || e.message), 'error');
                            playSound('error');
                        }
                    });
                }

                // Accept
                container.querySelectorAll('.tc-accept').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        try {
                            const result = await api('PUT', `/team-challenges/${btn.dataset.id}/accept`, { player: state.currentPlayer });
                            showToast(t('team_duel_accepted'), 'success');
                            playSound('coin');
                            if (result.allAccepted) {
                                navigateTo('dashboard');
                            } else {
                                renderChallenges();
                            }
                        } catch (e) {
                            showToast('Fehler: ' + (JSON.parse(e.message).error || e.message), 'error');
                            playSound('error');
                        }
                    });
                });

                // Reject
                container.querySelectorAll('.tc-reject').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        try {
                            await api('PUT', `/team-challenges/${btn.dataset.id}/reject`, { player: state.currentPlayer });
                            showToast(t('team_duel_rejected'), 'success');
                            renderChallenges();
                        } catch (e) {
                            showToast('Fehler: ' + (JSON.parse(e.message).error || e.message), 'error');
                            playSound('error');
                        }
                    });
                });

                // Complete (set winner team)
                container.querySelectorAll('.tc-complete').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const select = container.querySelector(`.tc-winner-select[data-id="${btn.dataset.id}"]`);
                        const winnerTeam = select ? select.value : '';
                        if (!winnerTeam) { showToast(t('select_winner_error'), 'error'); playSound('error'); return; }
                        try {
                            await api('PUT', `/team-challenges/${btn.dataset.id}/complete`, { player: state.currentPlayer, winnerTeam });
                            showToast(t('team_winner_set', winnerTeam === 'A' ? t('team_a_wins') : t('team_b_wins')), 'success');
                            playSound('coin');
                            renderChallenges();
                        } catch (e) {
                            showToast('Fehler: ' + (JSON.parse(e.message).error || e.message), 'error');
                            playSound('error');
                        }
                    });
                });

                // Payout (admin)
                container.querySelectorAll('.tc-payout').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        try {
                            const result = await api('PUT', `/team-challenges/${btn.dataset.id}/payout`);
                            const label = result.winnerTeam === 'A' ? t('team_a_wins') : t('team_b_wins');
                            showToast(t('team_duel_payout', label), 'success');
                            playSound('coin');
                            const wonCoins = parseInt(btn.dataset.total || 0);
                            if (wonCoins > 0) showCoinAnimation(wonCoins);
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

                // Delete (admin)
                container.querySelectorAll('.tc-delete').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        try {
                            await api('DELETE', `/team-challenges/${btn.dataset.id}`);
                            showToast(t('duel_deleted'), 'success');
                            renderChallenges();
                        } catch (e) {
                            showToast(t('duel_delete_error'), 'error');
                            playSound('error');
                        }
                    });
                });

                // GL cancel own pending team challenge
                container.querySelectorAll('.tc-cancel-gl').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        try {
                            await api('DELETE', `/team-challenges/${btn.dataset.id}`);
                            showToast(t('duel_deleted'), 'success');
                            renderChallenges();
                        } catch (e) {
                            showToast(t('duel_delete_error'), 'error');
                            playSound('error');
                        }
                    });
                });
            }

            updateHeaderCoins();

            if (focusChallengeId) {
                const el = container.querySelector(`.proposal-card[data-id="${focusChallengeId}"]`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                focusChallengeId = null;
            }

            // Restore form state after re-render
            if (challengeActiveTab === 'team') {
                if (tcFormState.teamA.length || tcFormState.teamB.length) {
                    tcFormState.teamA.forEach(p => {
                        container.querySelector(`.tc-team-a-btn[data-player="${p}"]`)?.classList.add('active');
                    });
                    tcFormState.teamB.forEach(p => {
                        container.querySelector(`.tc-team-b-btn[data-player="${p}"]`)?.classList.add('active');
                    });
                    if (tcFormState.game) {
                        const sel = container.querySelector('#tc-game');
                        if (sel) sel.value = tcFormState.game;
                    }
                    if (tcFormState.coins) {
                        const inp = container.querySelector('#tc-coins');
                        if (inp) inp.value = tcFormState.coins;
                    }
                    if (tcFormState.stars) {
                        const inp = container.querySelector('#tc-stars');
                        if (inp) inp.value = tcFormState.stars;
                    }
                    updateTcPotPreview();
                }
            } else {
                if (v1FormState.opponent) {
                    const sel = container.querySelector('#ch-opponent');
                    if (sel) { sel.value = v1FormState.opponent; sel.dispatchEvent(new Event('change')); }
                }
                if (v1FormState.coins) {
                    const inp = container.querySelector('#ch-coins');
                    if (inp) inp.value = v1FormState.coins;
                }
                if (v1FormState.stars) {
                    const inp = container.querySelector('#ch-stars');
                    if (inp) inp.value = v1FormState.stars;
                }
            }

        } catch (e) {
            console.error('renderChallenges error:', e);
            container.innerHTML = `<div class="empty-state"><div class="empty-state-text">${t('duel_load_error')}</div></div>`;
        }
    }

    function updateBadge() {
        const badge = $('#notif-badge');
        if (!badge) return;
        const count = pendingNotifications.length;
        badge.textContent = count;
        badge.style.display = count > 0 ? '' : 'none';
    }

    function showNotifToast(item) {
        if (item.id && shownNotifToastIds.has(item.id)) return;
        if (item.id) {
            shownNotifToastIds.add(item.id);
            localStorage.setItem('gameparty_shown_notif_toast_ids', JSON.stringify([...shownNotifToastIds]));
        }
        const container = $('#notif-toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'notif-toast';
        const icon = item.icon || (item.type === 'rob' ? '🥷' : item.type === 'review' ? '🏆' : item.isTeam ? '👥' : '⚔️');
        const titleText = item.title || (item.isTeam ? t('notif_team_challenge', item.challenger) : item.challenger ? t('notif_challenge_from', item.challenger) : '');
        const subText = item.sub || ((!item.title && (item.game || item.stakeStr)) ? `${item.game || ''}${item.game && item.stakeStr ? ' · ' : ''}${item.stakeStr || ''}` : '');
        toast.innerHTML = `<span class="notif-toast-icon">${icon}</span><span class="notif-toast-text">${titleText}${subText ? `<br><small>${subText}</small>` : ''}</span>`;
        toast.addEventListener('click', () => {
            toast.remove();
            notifPanelOpen = true;
            $('#notif-panel').classList.add('open');
            renderNotifPanel();
        });
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('notif-toast-fadeout'), 7000);
        setTimeout(() => toast.remove(), 7600);
    }

    async function renderNotifPanel() {
        const panel = $('#notif-panel');
        const badge = $('#notif-badge');
        if (!panel) return;

        let incomingActivities = [];
        if (state.currentPlayer) {
            try {
                const data = await api('GET', `/activities/${encodeURIComponent(state.currentPlayer)}`);
                incomingActivities = data.incoming.filter(a => a.status === 'active');
            } catch {}
        }

        const totalCount = pendingNotifications.length + incomingActivities.length;
        if (badge) { badge.textContent = totalCount; badge.style.display = totalCount > 0 ? '' : 'none'; }

        if (totalCount === 0) {
            panel.classList.remove('open');
            notifPanelOpen = false;
            panel.innerHTML = '';
            return;
        }

        // Unified item builder
        const btnOk  = (cls, attrs) => `<button class="notif-btn notif-btn-ok ${cls}" ${attrs}>✓</button>`;
        const btnNo  = (cls, attrs) => `<button class="notif-btn notif-btn-no ${cls}" ${attrs}>✕</button>`;

        function itemHtml({ id, icon, title, sub, actions, accent, navigate, ts }) {
            const timeStr = ts ? new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
            return `
                <div class="notif-item${accent ? ' notif-accent-' + accent : ''}"
                     data-id="${id}"${navigate ? ` data-navigate="${navigate}"` : ''}>
                    <div class="notif-item-icon">${icon}</div>
                    <div class="notif-item-body">
                        ${timeStr ? `<div class="notif-item-time">${timeStr}</div>` : ''}
                        <div class="notif-item-title">${title}</div>
                        ${sub ? `<div class="notif-item-sub">${sub}</div>` : ''}
                    </div>
                    ${actions ? `<div class="notif-item-actions">${actions}</div>` : ''}
                </div>`;
        }

        const TASK_ICONS = { force_play: '🎮', drink_order: '🍺' };

        const sorted = [...pendingNotifications].sort((a, b) => (b.ts || 0) - (a.ts || 0));
        const itemsHtml = [
            ...sorted.map(n => {
                const isRob    = n.type === 'rob';
                const isReview = n.type === 'review';
                const isTeam   = n.isTeam;
                const icon   = isRob ? '🥷' : isReview ? '🏆' : isTeam ? '👥' : '⚔️';
                const accent = isRob ? 'red' : isReview ? 'gold' : null;
                const title  = (isRob || isReview) ? n.title
                             : isTeam ? (n.title || t('notif_team_challenge', n.challenger))
                             : t('notif_challenge_from', n.challenger);
                const sub    = (!isRob && !isReview && (n.game || n.stakeStr))
                             ? `${n.game}${n.game && n.stakeStr ? ' · ' : ''}${n.stakeStr}` : '';
                const navigate = !isRob ? (n.id.startsWith('tc_') || n.id.startsWith('tcw_') || isReview ? 'team' : 'duel') : null;
                let actions = '';
                if (isRob)         actions = btnOk('notif-dismiss', `data-id="${n.id}" data-ev-id="${n.evId}"`);
                else if (!isReview) actions = btnOk('notif-accept', `data-id="${n.id}"`) + btnNo('notif-reject', `data-id="${n.id}"`);
                return itemHtml({ id: n.id, icon, title, sub, actions, accent, navigate, ts: n.ts });
            }),
            ...incomingActivities.map(a => {
                const icon    = TASK_ICONS[a.type] || '⚡';
                const actions = btnOk('notif-task-done', `data-id="${a.id}" data-from="${a.from_player || ''}" data-type="${a.type}"`);
                return itemHtml({ id: 'activity-' + a.id, icon, title: a.message, sub: a.from_player || '', actions, accent: null, navigate: null, ts: a.ts });
            })
        ].join('');

        panel.innerHTML = `
            <div class="notif-panel-header">
                <span>${t('notif_panel_title')}</span>
                <div style="display:flex;gap:0.5rem;align-items:center;">
                    <button class="notif-clear-btn" id="notif-clear-btn">${t('notif_clear_all')}</button>
                    <button class="notif-panel-close" id="notif-panel-close">✕</button>
                </div>
            </div>
            ${itemsHtml}
        `;

        if (notifPanelOpen) panel.classList.add('open');

        $('#notif-panel-close').addEventListener('click', (e) => {
            e.stopPropagation();
            notifPanelOpen = false;
            panel.classList.remove('open');
        });

        const clearBtn = $('#notif-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                for (const item of pendingNotifications) {
                    if (item.evId) {
                        try { await api('DELETE', `/player-events/${item.evId}`); } catch {}
                    }
                }
                pendingNotifications.length = 0;
                updateBadge();
                renderNotifPanel();
            });
        }

        // Accept (1v1 + team duels)
        panel.querySelectorAll('.notif-accept').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                try {
                    if (id.startsWith('tc_')) {
                        const result = await api('PUT', `/team-challenges/${id.slice(3)}/accept`, { player: state.currentPlayer });
                        removeNotification(id);
                        showToast(t('team_duel_accepted'), 'success');
                        playSound('coin');
                        if (result.allAccepted) navigateTo('dashboard');
                        else if ($('#view-challenges').classList.contains('active')) renderChallenges();
                    } else {
                        await api('PUT', `/challenges/${id}/accept`, { player: state.currentPlayer });
                        removeNotification(id);
                        showToast(t('duel_accepted'), 'success');
                        playSound('coin');
                        navigateTo('dashboard');
                    }
                } catch { showToast('Fehler beim Annehmen', 'error'); }
            });
        });

        // Reject (1v1 + team duels)
        panel.querySelectorAll('.notif-reject').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                try {
                    if (id.startsWith('tc_')) {
                        await api('PUT', `/team-challenges/${id.slice(3)}/reject`, { player: state.currentPlayer });
                        removeNotification(id);
                        showToast(t('team_duel_rejected'), 'success');
                    } else {
                        await api('PUT', `/challenges/${id}/reject`, { player: state.currentPlayer });
                        removeNotification(id);
                        showToast('Duell abgelehnt.', 'error');
                    }
                    if ($('#view-challenges').classList.contains('active')) renderChallenges();
                } catch { showToast('Fehler beim Ablehnen', 'error'); }
            });
        });

        // Dismiss (rob/pickpocket)
        panel.querySelectorAll('.notif-dismiss').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                dismissedRobIds.add(id);
                try { await api('DELETE', `/player-events/${btn.dataset.evId}`); } catch {}
                removeNotification(id);
            });
        });

        // Done (shop tasks / penalties)
        panel.querySelectorAll('.notif-task-done').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const fromPlayer = btn.dataset.from;
                const type = btn.dataset.type;
                const ackMsg = { drink_order: `🍺 ${state.currentPlayer} hat getrunken!`, force_play: `🎮 ${state.currentPlayer} spielt mit!` }[type]
                              || `✅ ${state.currentPlayer} hat die Aufgabe erledigt!`;
                try {
                    if (fromPlayer) await api('POST', '/player-events', { target: fromPlayer, type: 'task_ack', from_player: state.currentPlayer, message: ackMsg });
                    await api('DELETE', `/player-events/${btn.dataset.id}`);
                    showToast('Aufgabe erledigt!', 'success');
                    playSound('coin');
                    renderNotifPanel();
                } catch {}
            });
        });

        // Click to navigate (duels, team duels, admin review)
        panel.querySelectorAll('.notif-item[data-navigate]').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.notif-item-actions')) return;
                const id  = item.dataset.id;
                const nav = item.dataset.navigate;
                if (nav === 'team') {
                    challengeActiveTab = 'team';
                    if (id.startsWith('tc_'))       focusChallengeId = id.slice(3);
                    else if (id.startsWith('tcw_')) { focusChallengeId = id.slice(4); removeNotification(id); }
                } else {
                    focusChallengeId = id;
                }
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
        // Coins und Sterne live refreshen (unabhängig von der aktiven View)
        try {
            const [coinsData, starsData] = await Promise.all([
                api('GET', '/coins'),
                api('GET', '/stars')
            ]);
            state.coins = coinsData;
            state.stars = starsData;
            updateHeaderCoins();
        } catch {}
        try {
            const events = await api('GET', `/player-events/${encodeURIComponent(state.currentPlayer)}`);
            for (const ev of events) {
                if (ev.type === 'duel_payout') {
                    try {
                        const data = JSON.parse(ev.message);
                        showDuelPayoutModal(data);
                        if (getNotifPref('sound')) playSound(data.isWinner ? 'coin' : 'error');
                    } catch {}
                    try { await api('DELETE', `/player-events/${ev.id}`); } catch {}
                    continue;
                }
                if (ev.type === 'tc_payout') {
                    try {
                        const data = JSON.parse(ev.message);
                        showTcPayoutModal(data);
                        if (getNotifPref('sound')) playSound('coin');
                    } catch {}
                    try { await api('DELETE', `/player-events/${ev.id}`); } catch {}
                    continue;
                }
                if (ev.type === 'tc_winner_review') {
                    try {
                        const data = JSON.parse(ev.message);
                        const winnerLabel = data.winnerTeam === 'A' ? t('team_a_wins') : t('team_b_wins');
                        const notifId = 'tcw_' + data.tcId;
                        if (!pendingNotifications.find(n => n.id === notifId)) {
                            pendingNotifications.push({ id: notifId, game: data.game, stakeStr: winnerLabel, isTeam: true, type: 'review', title: t('notif_tc_winner_review'), tcId: data.tcId, ts: ev.createdAt });
                            showNotifToast(pendingNotifications[pendingNotifications.length - 1]);
                            updateBadge();
                        }
                        if (getNotifPref('sound')) playSound('coin');
                    } catch {}
                    try { await api('DELETE', `/player-events/${ev.id}`); } catch {}
                    continue;
                }
                if (ev.type === 'rob_coins_victim') {
                    try {
                        const data = JSON.parse(ev.message);
                        const notifId = 'rob_' + ev.id;
                        if (!dismissedRobIds.has(notifId) && !pendingNotifications.find(n => n.id === notifId)) {
                            pendingNotifications.push({ id: notifId, evId: ev.id, type: 'rob', title: t('rob_coins_victim_notif', data.thief, data.stolen), ts: ev.createdAt });
                            showNotifToast(pendingNotifications[pendingNotifications.length - 1]);
                            updateBadge();
                            if (getNotifPref('sound')) playSound('error');
                        }
                    } catch {}
                    continue; // Event bleibt bis Nutzer bestätigt
                }
                if (ev.type === 'rob_controller_victim') {
                    try {
                        const data = JSON.parse(ev.message);
                        const notifId = 'rob_' + ev.id;
                        if (!dismissedRobIds.has(notifId) && !pendingNotifications.find(n => n.id === notifId)) {
                            const title = data.success ? t('rob_controller_victim_success', data.thief) : t('rob_controller_victim_fail', data.thief);
                            pendingNotifications.push({ id: notifId, evId: ev.id, type: 'rob', title, ts: ev.createdAt });
                            showNotifToast(pendingNotifications[pendingNotifications.length - 1]);
                            updateBadge();
                            if (getNotifPref('sound')) playSound(data.success ? 'error' : 'coin');
                        }
                        if (getNotifPref('sound')) playSound(data.success ? 'error' : 'coin');
                    } catch {}
                    continue; // Event bleibt bis Nutzer bestätigt
                }
                if (ev.type === 'duel_start') {
                    try {
                        const data = JSON.parse(ev.message);
                        if (data.sessionId && !shownDuelStartSessions.has(data.sessionId)) {
                            shownDuelStartSessions.add(data.sessionId);
                            showDuelStartModal(data);
                        }
                    } catch {}
                    try { await api('DELETE', `/player-events/${ev.id}`); } catch {}
                    continue;
                }
                if (ev.type === 'duel_conflict') {
                    // Kein Modal — Admin-Auflösung läuft über die Session-Karte
                    try { await api('DELETE', `/player-events/${ev.id}`); } catch(e) {}
                    continue;
                }
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
                localStorage.setItem('gameparty_notified_challenge_ids', JSON.stringify([...notifiedChallengeIds]));
                const stakeStr = [
                    c.stakeCoins > 0 ? `${c.stakeCoins} ${coinSvgIcon()}` : '',
                    c.stakeStars > 0 ? `${c.stakeStars} ${controllerSvgIcon()}` : ''
                ].filter(Boolean).join(' + ') || t('no_stake');
                pendingNotifications.push({ id: c.id, challenger: c.challenger, game: c.game, stakeStr, ts: c.createdAt });
                showNotifToast(pendingNotifications[pendingNotifications.length - 1]);
                updateBadge();
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
        try {
            const teamChallenges = await api('GET', '/team-challenges');
            const newTeamOnes = teamChallenges.filter(tc => {
                const teamA = JSON.parse(tc.teamA);
                const teamB = JSON.parse(tc.teamB);
                const allPlayers = [...teamA, ...teamB];
                const acceptances = JSON.parse(tc.acceptances || '[]');
                return tc.status === 'pending' &&
                       allPlayers.includes(state.currentPlayer) &&
                       !acceptances.includes(state.currentPlayer) &&
                       !notifiedChallengeIds.has('tc_' + tc.id);
            });
            for (const tc of newTeamOnes) {
                notifiedChallengeIds.add('tc_' + tc.id);
                localStorage.setItem('gameparty_notified_challenge_ids', JSON.stringify([...notifiedChallengeIds]));
                const stakeStr = tc.stakeCoinsPerPerson > 0 ? `${tc.stakeCoinsPerPerson} ${coinSvgIcon()}/Person` : t('no_stake');
                const teamA = JSON.parse(tc.teamA);
                const teamB = JSON.parse(tc.teamB);
                const notifTitle = buildTeamNotifTitle(teamA, teamB, tc.createdBy, state.currentPlayer);
                pendingNotifications.push({ id: 'tc_' + tc.id, challenger: tc.createdBy, game: tc.game, stakeStr, isTeam: true, ts: tc.createdAt, title: notifTitle });
                showNotifToast(pendingNotifications[pendingNotifications.length - 1]);
                updateBadge();
                if (getNotifPref('visual') && Notification.permission === 'granted') {
                    new Notification('👥 Team Duel!', {
                        body: t('notif_team_challenge', tc.createdBy) + '\n' + tc.game
                    });
                }
                if (getNotifPref('sound')) playSound('challenge');
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
        pollChallenges(); // sofort laden
        // Fallback-Polling falls SSE abbricht (30s reicht – SSE übernimmt im Normalfall)
        challengePollInterval = setInterval(pollChallenges, 30000);
        // SSE als primärer Live-Update-Mechanismus
        if (typeof EventSource !== 'undefined') {
            setTimeout(() => {
                sseSource = new EventSource('/api/events');
                sseSource.addEventListener('update', () => {
                    // SSE aktiv: View-Fallback-Timer stoppen
                    if (sseDropViewInterval) { clearInterval(sseDropViewInterval); sseDropViewInterval = null; }
                    refreshActiveView();
                    pollChallenges();
                });
                sseSource.onerror = () => {
                    // SSE unterbrochen: View alle 30s refreshen bis SSE zurückkommt
                    if (!sseDropViewInterval) {
                        sseDropViewInterval = setInterval(refreshActiveView, 30000);
                    }
                };
            }, 1000);
        }
    }

    function stopChallengePoll() {
        if (challengePollInterval) { clearInterval(challengePollInterval); challengePollInterval = null; }
        if (viewRefreshInterval) { clearInterval(viewRefreshInterval); viewRefreshInterval = null; }
        if (sseDropViewInterval) { clearInterval(sseDropViewInterval); sseDropViewInterval = null; }
        if (sseSource) { sseSource.close(); sseSource = null; }
        if (activeTaskTimer) { clearInterval(activeTaskTimer); activeTaskTimer = null; }
    }

    async function updateHeaderCoins() {
        if (state.currentPlayer) {
            const coinsDisplay = $('#header-coins');
            coinsDisplay.textContent = getPlayerCoins(state.currentPlayer);
            const starsDisplay = $('#header-stars');
            const starsContainer = $('#header-stars-display');
            const playerStars = getPlayerStars(state.currentPlayer);
            if (starsDisplay) starsDisplay.textContent = playerStars;
            if (starsContainer) starsContainer.style.display = playerStars > 0 ? 'flex' : 'none';
        }
    }

    function logout() {
        stopChallengePoll();
        closeAdminPanel();
        notifiedChallengeIds.clear();
        localStorage.removeItem('gameparty_notified_challenge_ids');
        shownNotifToastIds.clear();
        localStorage.removeItem('gameparty_shown_notif_toast_ids');
        shownPenaltyIds.clear();
        dismissedRobIds.clear();
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
            localStorage.removeItem('gameparty_notified_challenge_ids');
            shownNotifToastIds.clear();
            localStorage.removeItem('gameparty_shown_notif_toast_ids');
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
        const logoEl = $('.app-logo[data-view]');
        if (logoEl) logoEl.addEventListener('click', () => navigateTo('dashboard'));

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
            notifPanelOpen = !notifPanelOpen;
            $('#notif-panel').classList.toggle('open', notifPanelOpen);
            if (notifPanelOpen) renderNotifPanel();
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
    function showPlayerInfoModal(playerName) {
        const info = getUserInfo(playerName);
        const overlay = $('#modal-overlay');
        const modal = overlay.querySelector('.modal');

        const PLATFORMS = [
            { key: 'ip',        label: 'LAN-IP',          icon: () => '🖥️' },
            { key: 'steam',     label: 'Steam',            icon: () => createIconSvg('steam',     '16px') },
            { key: 'ubisoft',   label: 'Ubisoft Connect',  icon: () => createIconSvg('ubisoft',   '16px') },
            { key: 'battlenet', label: 'Battle.net',       icon: () => createIconSvg('battlenet', '16px') },
            { key: 'epic',      label: 'Epic Games',       icon: () => createIconSvg('epic',      '16px') },
            { key: 'ea',        label: 'EA App',           icon: () => createIconSvg('ea',        '16px') },
            { key: 'riot',      label: 'Riot Games',       icon: () => createIconSvg('riot',      '16px') },
            { key: 'discord',   label: 'Discord',          icon: () => createIconSvg('discord',   '16px') },
            { key: 'teamspeak', label: 'TeamSpeak',        icon: () => createIconSvg('teamspeak', '16px') },
        ];

        const rows = PLATFORMS
            .filter(p => info[p.key])
            .map(p => `
                <div class="player-info-modal-row icon-copy" data-copy-value="${info[p.key]}">
                    <span class="player-info-modal-icon">${p.icon()}</span>
                    <span class="player-info-modal-label">${p.label}</span>
                    <span class="player-info-modal-value">${info[p.key]}</span>
                    <span class="player-info-modal-copy">📋</span>
                </div>`)
            .join('');

        const empty = rows ? '' : `<p style="color:var(--text-secondary);text-align:center;font-size:0.85rem;padding:1rem 0">Keine Account-Daten hinterlegt.</p>`;

        modal.innerHTML = `
            <div class="modal-title">${playerName}</div>
            <div class="player-info-modal-rows">${rows}${empty}</div>
            <button class="modal-close-btn" id="player-info-close">Schließen</button>
        `;

        overlay.classList.add('show');
        $('#player-info-close').addEventListener('click', () => overlay.classList.remove('show'));
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

        // Player info modal on name click
        const playerInfoTarget = e.target.closest('[data-player-info]');
        if (playerInfoTarget) {
            hidePlayerTooltip();
            showPlayerInfoModal(playerInfoTarget.getAttribute('data-player-info'));
            e.stopPropagation();
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


})();
