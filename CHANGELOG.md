# Changelog

## v2.3.128 (2026-03-10)
- fix: "Duel" → "Duell" in session card badge (German spelling)
- fix: "Pot" → "Pott" everywhere in German UI (badges, labels, i18n key)
- feat: ⭐ and 🎮 replaced with controller SVG icon throughout (pot, modal, notifications)
- feat: controllerSvgIcon() helper function added
- feat: Session-Coins shown in paid duel card; "Session schließen" now approves + pays out
- feat: loser coin popup (red, negative amount) on duel payout modal close
- fix: "Admin schließt die Session" → "Gamemaster schließt die Session"

## v2.3.127 (2026-03-10)
- feat: ⚔️ Duel badge on lobby/running session cards with challenge_id
- feat: pot displayed under live coin counter in running duel sessions
- feat: pot shown right-aligned with coin icon in 1v1 challenge card (Duelle tab)
- feat: duel payout modal for winner (+coins animation) and loser after auto-payout
- feat: duel_payout and tc_payout player_events sent after _duelPayout
- fix: remove double ⚠️ in vote conflict label (emoji moved to template only)
- fix: "Warte auf andere..." → "Warte auf Gamemaster..."
- fix: "Admin entscheidet..." → "Gamemaster entscheidet..."

## v2.3.126 (2026-03-10)
- feat: duel session card shows pot (coins/stars) in voting section
- feat: isPaid state — after auto-payout card shows winner + "Session schließen" for admin
- fix: remove confirm popup when ending a session

## v2.3.124 (2026-03-10)
- fix: notifications load immediately on page reload, badge shows instantly
- fix: notif-toasts only appear once per notification (persisted via localStorage)
- feat: timestamp shown above notif-item-title with muted styling

## v2.3.122 (2026-03-10)
- fix: remove duplicate showToast function that was overriding the correct implementation

## v2.3.121 (2026-03-10)
- fix: toast fade-in/out via CSS transition instead of animation for reliable behavior

## v2.3.120 (2026-03-10)
- fix: toast stacking with column-reverse and fixed width

## v2.3.119 (2026-03-10)
- fix: toast positioned above nav-bar, SSE starts with 1s delay

## v2.3.118 (2026-03-10)
- fix: SSE reconnect re-enabled (NPM proxy_buffering off configured)

## v2.3.117 (2026-03-10)
- fix: cache-busting via versioned asset URLs in index.html
- fix: SSE reconnect loop suppressed on connection error

## v2.3.116 (2026-03-10)
- test: toast success/gold/error with colored background

## v2.3.115 (2026-03-10)
- feat: toast centered at bottom, 6s visible, stacking, fade

## v2.3.114 (2026-03-10)
- fix: admin cancel button always visible on stuck duel sessions

## v2.3.113 (2026-03-10)
- feat: admin approve/cancel in duel session card after vote consensus

## v2.3.112 (2026-03-10)
- feat: defer duel payout to admin approve after vote consensus

## v2.3.111 (2026-03-10)
- fix: suppress duel_conflict modal, color winner/loser in duels tab

## v2.3.110 (2026-03-10)
- fix: increase success toast duration to 7s

## v2.3.109 (2026-03-10)
- feat: defer duel payout to admin approve after vote consensus

## v2.3.108 (2026-03-09)
- feat: team challenge payout modal and card labels

## v2.3.107 (2026-03-09)
- feat: add payout notifications to team challenge payout

## v2.3.106 (2026-03-09)
- feat: individual acceptance flow for team challenges

## v2.3.105 (2026-03-09)
- feat: per-player acceptance flow for team challenges

## v2.3.104 (2026-03-09)
- fix: cap challenge stakes to min balance of all players

## v2.3.83 (2026-03-09)
- feat: Team Duels in Challenge tab — tab toggle 1v1/Team, checkbox form, live pot preview
- feat: stake deducted from all players on both teams upon acceptance (db.transaction)
- feat: payout with floor division, first player receives remainder
- feat: DELETE with refund when already accepted
- feat: notification panel and polling for team challenges (tc_ prefix)
- fix: 4 challenge bugs: duplicate name, DUELS label, stake deduction, payout animation

## v2.3.74 (2026-03-09)
- feat: direct coin rate per player count, remove coins_per_minute multiplier

## v2.3.46 (2026-03-09)
- feat: add coins_per_minute setting and pending_coins in admin

## v2.3.45 (2026-03-09)
- feat: time-based pending_coins for live sessions

## v2.3.44 (2026-03-09)
- style: game list grid, name link, shop link badges

## v2.3.43 (2026-03-09)
- feat: add shop links to game list and edit modal

## v2.3.42 (2026-03-09)
- feat: add shop_links support to games feature

## v2.3.41 (2026-03-09)
- style: silver coin symbol filter

## v2.3.40 (2026-03-09)
- fix: hide header-stars-display when player has no stars

## v2.3.39 (2026-03-08)
- feat: validate min 2 players and no duplicate sessions

## v2.3.38 (2026-03-08)
- style: add player info modal CSS classes
- fix: admin panel reloads on SSE update and after renderProposals() when open
- fix: planned sessions appear immediately in admin approval after being ended by group leader

## v2.3.37 (2026-03-08)
- feat: add player info modal on name click
- feat: implement backend endpoint POST /api/proposals/:id/approve (coin payout, genre tracking, session record)
- fix: approval button in admin panel for planned sessions now works correctly

## v2.3.36 (2026-03-08)
- fix: planned sessions (proposals) now appear in approval section after being ended by group leader (type conflict: coinsApproved === 0 vs. boolean false)
- fix: platform buttons in "How to play?" modal resized (icons 1.4rem, padding 0.5rem)
- feat: intermediate step after platform selection showing pre-filled account value (Steam ID, Ubisoft name, LAN IP etc.) from profile, editable before room start
- feat: backend: medium_account field stored in live_sessions table
- feat: i18n: keys medium_account_hint and back (EN/DE)

## v2.3.35 (2026-03-08)
- fix: type conflict coinsApproved in proposal approval filter
- fix: planned sessions now correctly display in admin approval section

## v2.3.34 (2026-03-08)
- fix: planned sessions now appear in admin approval section after being ended

## v2.3.33 (2026-03-08)
- fix: leader can now end their sessions (player field optional in PUT /live-sessions/:id/end)

## v2.3.32 (2026-03-08)
- fix: initialize coinsApproved=0 on proposal creation (prevents null values)
- fix: planned sessions now appear in admin approval section
- fix: robust filter for completed proposals in admin panel

## v2.3.31 (2026-03-08)
- fix: prevent leader from joining own session (join validation)
- fix: prevent unauthorized session end (only leader or admin can end sessions)

## v2.3.30 (2026-03-08)
- feat: implement medium selection modal for room creation (LAN, Steam, Ubisoft, etc.)
- feat: add medium field for live sessions – stored in DB, previewed with preferred platform
- style: add medium selection grid styling (4 columns, responsive, icons + labels)

## v2.3.29 (2026-03-08)
- chore: add missing change_language i18n key
- style: fix admin badge CSS selector conflict
- fix: language toggle, logout button, player switch
- fix: correct session approval endpoint from PUT /approve-coins to POST /approve
- fix: re-render admin panel after attendees toggle for style update

## v2.3.27 (2026-03-08)
- refactor: use createIconSvg() in session cards (renderPlayerChip, renderLeaderIcons) – unified icon pool

## v2.3.26 (2026-03-08)
- fix: include svg/ folder in Docker image

## v2.3.25 (2026-03-08)
- fix: add fill color to all SVG icons for proper visibility in dark theme

## v2.3.24 (2026-03-08)
- refactor: use createIconSvg() for steam and ubisoft in profile card

## v2.3.23 (2026-03-08)
- refactor: use SVG files from /svg/ folder instead of inline paths
- refactor: centralized icon management (ICON_FILES mapping, createIconSvg() helper)

## v2.3.22 (2026-03-08)
- refactor: centralize SVG icon management in js/icons.js
- feat: createIconSvg() helper function for consistent icon rendering

## v2.3.21 (2026-03-08)
- fix: update SVG icon paths in profile card accounts section
- fix: Battle.net, EA, Riot Games icons now use official Simple Icons paths

## v2.3.20 (2026-03-08)
- fix: update SVG icon paths for Battle.net, EA, and Riot Games to official Simple Icons
- fix: renderPlayerChip and renderLeaderIcons now use correct paths

## v2.3.15 (2026-03-08)
- fix: hide "Gameparty" text on small screens (≤480px) – show only emoji logo for mobile

## v2.3.14 (2026-03-08)
- fix: tooltip not showing on mobile – replaced mouseover/mouseout with pointerover/pointerout, click always toggles

## v2.3.13 (2026-03-08)
- fix: tooltip positioning for session leader icons (position: fixed, visibility trick for correct dimensions)

## v2.4.1 (2026-03-08)
- feat: leader account icons (IP, Steam, Ubisoft, Battle.net) in session cards – tap/click shows popup with value

## v2.4.0 (2026-03-08)
- fix: "Connection & Accounts" save button global styling

## v2.3.9 (2026-03-08)
- feat: profile page redesigned – new "Connection & Accounts" card (LAN-IP, Steam, Ubisoft Connect, Battle.net)
- feat: session player chips show icons for available account data + hover/tap tooltip
- feat: app version displayed in admin panel (from package.json)
- fix: package.json copied into Docker runtime stage
- ci: Docker tags and GitHub tags synchronized (semver only)
- ci: release script (npm run release) for automatic version bump + tag + push
- docs: Docker Hub badge + GitHub link in README
- ci: README auto-synced to Docker Hub (continue-on-error)

## v2.3.8 (2026-03-08)
- fix: make btn-admin-coins work outside admin-coins-form

## v2.3.7 (2026-03-08)
- fix: filter attendees to existing users only, cleanup orphaned attendees on startup

## v2.3.6 (2026-03-07)
- fix: remove deleted player from attendees table

## v2.3.5 (2026-03-07)
- feat: add GitHub Actions workflow for Docker Hub publishing

## v2.3.4 (2026-03-07)
- docs: add vibe-coded disclaimer to README

## v2.3.3 (2026-03-07)
- feat: seed admin-only user via env vars for Docker deployments

## v2.3.2 (2026-03-07)
- docs: update README with motivation, Docker section, english-only commits

## v2.3.1 (2026-03-07)
- feat: add Docker support (Dockerfile, docker-compose, .dockerignore)

## v2.3 (2026-03-07)
- feat: accepting a challenge immediately starts a duel session

## v2.2 (2026-03-07)
- feat: room button in game list + LAN-IP management in profile

## v2.1 (2026-03-07)
- feat: admin panel via gear button in header

## v2.0 (2026-03-07)
- feat: mark penalty in activities as done
- fix: browser notifications respect profile setting
