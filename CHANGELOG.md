# Changelog

## v2.3.11 (2026-03-08)
- chore: add missing change_language i18n key

## v2.3.10 (2026-03-08)
- style: fix admin badge CSS selector conflict

## v2.3.9 (2026-03-08)
- fix: three frontend issues - language toggle, logout button, player switch

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
