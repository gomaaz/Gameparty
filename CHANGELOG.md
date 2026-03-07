# Changelog

## v2.4.1 (2026-03-08)
- feat: Leader-Info-Icons (IP, Steam, Ubisoft, Battle.net) in Session-Karten – Klick/Tap zeigt Popup mit Wert

## v2.4.0 (2026-03-08)
- fix: Save-Button "Connection & Accounts" globales Styling (btn-admin-coins außerhalb admin-coins-form)

## v2.3.9 (2026-03-08)
- feat: Profilseite umgebaut – neue "Verbindung & Accounts"-Card (LAN-IP, Steam, Ubisoft Connect, Battle.net)
- feat: Session-Player-Chips zeigen Icons bei vorhandenen Account-Daten + Hover/Tap-Tooltip
- feat: App-Version im Admin-Panel angezeigt (subtil, aus package.json)
- fix: package.json in Docker Runtime-Stage kopiert (server.js require fix)
- ci: Docker-Tags und GitHub-Tags synchronisiert (nur semver, kein raw-Tag mehr)
- ci: Release-Script (`npm run release`) für automatisches Version-Bump + Tag + Push
- docs: Docker Hub Badge + GitHub-Link im README
- ci: README wird automatisch zu Docker Hub gepusht (continue-on-error)

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
- feat: Herausforderung annehmen startet sofort Duell-Session

## v2.2 (2026-03-07)
- feat: Raum-Button in Spieleliste + LAN-IP-Verwaltung im Profil

## v2.1 (2026-03-07)
- feat: Admin-Panel via Zahnrad-Button im Header

## v2.0 (2026-03-07)
- feat: Penalty in Activities als erledigt markieren
- fix: Browser-Benachrichtigungen respektieren Profil-Einstellung
