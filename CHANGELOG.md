# Changelog

## v.1.1.1.1.1.1 (2026-03-09)
- fix: deduct duel stakes at acceptance not payout

## v.1.1.1.1.1 (2026-03-09)
- chore: add missing i18n keys, remove unused keys

## v2.3.74 (2026-03-09)
- feat: direct coin rate per player count, remove coins_per_minute multiplier

## v.1.1.1.1 (2026-03-09)
- feat: use player_multipliers map for coin multiplier calc

## v.1.1.1 (2026-03-09)
- feat: player multiplier for coins, remove genre tracking

## v.1.1 (2026-03-09)
- feat: unify active proposals with live sessions

## v.1 (2026-03-09)
- feat: genre tracking in live-session approve, broadcast proposals

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

## v2.3.37 (2026-03-08)
- feat: add player info modal on name click

## v2.3.42 (2026-03-08)

### Fixed
- Platform-Buttons im "Wie wird gespielt?"-Modal verkleinert (Icons 1.4rem, Padding 0.5rem) – Container ragte nicht mehr über das Panel hinaus

### Added
- Zwischenschritt nach Plattform-Auswahl: zeigt vorausgefüllten Account-Wert (Steam-ID, Ubisoft-Name, LAN-IP etc.) aus dem Profil, editierbar vor Raumstart
- Backend: `medium_account`-Feld in `live_sessions`-Tabelle gespeichert
- i18n: Keys `medium_account_hint` und `back` (EN/DE)

## v2.3.36 (2026-03-08)
- docs: add changelog entry for v2.3.38

## [2.3.38] - 2026-03-08

### Fixed
- Admin-Panel wird jetzt bei jedem SSE-Update und nach `renderProposals()` automatisch neu geladen, wenn es geöffnet ist
- Geplante Sessions erscheinen nach Beendigung durch den Gruppenleiter sofort in der Admin-Freigabe (Root Cause: Admin-Panel war nicht im SSE-Refresh-Zyklus registriert)

## [2.3.37] - 2026-03-08

### Added
- Backend-Endpoint `POST /api/proposals/:id/approve` implementiert (Coins auszahlen, Genre-Tracking, Session-Record erstellen)

### Fixed
- Freigabe-Button im Admin-Panel für geplante Sessions funktioniert jetzt korrekt

## [2.3.36] - 2026-03-08

### Fixed
- Geplante Sessions (Proposals) erschienen nicht im Freigabebereich nach Beendigung durch den Gruppenleader (Typkonflikt: `coinsApproved === 0` vs. Boolean `false`)

## v2.3.35 (2026-03-08)
- fix: type conflict coinsApproved in proposal approval filter
- fix: geplante sessions now correctly display in admin freigabe section (wrong field names)

## v2.3.34 (2026-03-08)
- fix: geplante sessions now appear in admin approval section after being ended (dashboard refresh)

## v2.3.33 (2026-03-08)
- fix: leader can now end their sessions (player field optional in PUT /live-sessions/:id/end)

## v2.3.32 (2026-03-08)
- fix: initialize coinsApproved=0 on proposal creation (prevents null values)
- fix: geplante sessions now appear in "Ausstehende Freigaben" (admin approval section)
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
- fix: three frontend issues - language toggle, logout button, player switch
- fix: correct session approval endpoint from PUT /approve-coins to POST /approve
- fix: re-render admin panel after attendees toggle for style update

## v2.3.27 (2026-03-08)
- refactor: use createIconSvg() in session cards (renderPlayerChip, renderLeaderIcons) – unified icon pool

## v2.3.26 (2026-03-08)
- fix: include svg/ folder in Docker image

## v2.3.25 (2026-03-08)
- fix: add fill color to all SVG icons for proper visibility in dark theme

## v2.3.24 (2026-03-08)
- refactor: use createIconSvg() for steam and ubisoft in profile card – full consistency

## v2.3.23 (2026-03-08)
- refactor: use SVG files from /svg/ folder instead of inline paths
- refactor: centralized icon management (ICON_FILES mapping, createIconSvg() helper)
- improvement: reduces code duplication, single source of truth for icons

## v2.3.22 (2026-03-08)
- refactor: centralize SVG icon management in js/icons.js
- feat: createIconSvg() helper function for consistent icon rendering
- improvement: prevents icon path inconsistencies between profile and session panel

## v2.3.21 (2026-03-08)
- fix: update SVG icon paths in profile card accounts section
- fix: Battle.net, EA, Riot Games icons now use official Simple Icons paths

## v2.3.20 (2026-03-08)
- fix: update SVG icon paths for Battle.net, EA, and Riot Games to official Simple Icons
- fix: renderPlayerChip and renderLeaderIcons now use correct paths

## v2.3.15 (2026-03-08)
- fix: hide "Gameparty" text on small screens (≤480px) – show only emoji logo for mobile

## v2.3.14 (2026-03-08)
- fix: tooltip not showing on mobile – replaced mouseover/mouseout with pointerover/pointerout (mouse only), click always toggles

## v2.3.13 (2026-03-08)
- fix: tooltip positioning for session leader icons (position: fixed, visibility trick for correct dimensions)

## v2.4.1 (2026-03-08)
- feat: leader account icons (IP, Steam, Ubisoft, Battle.net) in session cards – tap/click shows popup with value

## v2.4.0 (2026-03-08)
- fix: "Connection & Accounts" save button global styling (btn-admin-coins outside admin-coins-form)

## v2.3.9 (2026-03-08)
- feat: profile page redesigned – new "Connection & Accounts" card (LAN-IP, Steam, Ubisoft Connect, Battle.net)
- feat: session player chips show icons for available account data + hover/tap tooltip
- feat: app version displayed in admin panel (subtle, from package.json)
- fix: package.json copied into Docker runtime stage (server.js require fix)
- ci: Docker tags and GitHub tags synchronized (semver only, no more raw tag)
- ci: release script (`npm run release`) for automatic version bump + tag + push
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
