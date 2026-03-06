# 🎮 Gameparty

Eine Gamification-App für LAN-Partys. Spieler sammeln Coins durch gemeinsame Gaming-Sessions, kaufen Items im Shop, fordern sich gegenseitig zu Duellen heraus und kämpfen um Controller-Punkte auf der Bestenliste.

## Features

### Coin-System
Spieler verdienen Coins durch das Abschließen von Gaming-Sessions:
- **1 Coin** – Session mit mind. 3 Spielern
- **2 Coins** – Session mit 4+ Spielern
- **3 Coins** – Session mit allen anwesenden Spielern

### Shop
Coins können für Aktionen ausgegeben werden:
| Item | Kosten | Beschreibung |
|---|---|---|
| Controller-Punkt 🎮 | 20 Coins | Dauerhafter Siegpunkt auf der Bestenliste |
| Nächstes Spiel bestimmen | 3 Coins | Du wählst, was als nächstes gespielt wird |
| Skip-Token | 2 Coins | Überspringe ein Spiel, das du nicht willst |
| Zwangsspielen | 5 Coins | Zwinge einen Mitspieler zum Mitspielen |
| Trink-Befehl | 3 Coins | Lass jemanden sofort trinken |

### Duelle
Spieler können sich 1-gegen-1 herausfordern und Coins oder Controller-Punkte als Einsatz setzen.

### Spieleverwaltung
- Große Spielebibliothek mit Genre-Filterung
- Spieler können Interesse an Spielen markieren
- Spiele-Matcher zeigt an, welches Spiel die meisten Interessenten hat
- Admin kann neue Spiele vorschlagen oder bestehende bearbeiten

### Sessions & Proposals
- Spieler können Sessions vorschlagen (sofort oder geplant)
- Admin genehmigt und startet Sessions
- Live-Session-Lobby mit Beitrittsfunktion
- Automatische Coin-Vergabe beim Session-Abschluss

### Bestenliste
Sortierung nach Controller-Punkten, dann nach Coins. Controller-Punkte sind permanente Siegpunkte und nicht ausgebbar.

### Live-Updates
Alle Clients werden via Server-Sent Events (SSE) in Echtzeit aktualisiert – kein manuelles Neuladen nötig.

## Tech Stack

- **Backend:** Node.js, Express, better-sqlite3 (SQLite)
- **Frontend:** Vanilla JS, HTML5, CSS3 – kein Framework
- **Datenbank:** SQLite mit WAL-Modus
- **Realtime:** Server-Sent Events (SSE)

## Installation & Start

```bash
# Abhängigkeiten installieren
npm install

# Server starten
npm start
```

Der Server läuft auf `http://localhost:3000`.

Alle Geräte im gleichen Netzwerk können über `http://<HOST-IP>:3000` mitspielen.

## Projektstruktur

```
gameparty/
├── server.js        # Express-Backend + SQLite-API
├── index.html       # Single-Page App Shell
├── js/
│   ├── app.js       # Gesamte Frontend-Logik
│   └── data.js      # Konfiguration, Spielerliste, Spielebibliothek
├── css/
│   └── style.css    # Styling
├── assets/          # Statische Dateien
└── VERSION          # Aktuelle Versionsnummer
```

## Rollen

| Rolle | Rechte |
|---|---|
| `player` | Coins verdienen, Shop nutzen, Duelle, Interesse markieren |
| `admin` | + Sessions starten/abschließen, Spieler verwalten, Coins anpassen |

Login erfolgt über PIN (konfigurierbar in `js/data.js`).

## Versioning

Jede Änderung wird mit Git-Tag versioniert (`v1.0`, `v1.1`, …).
Alle Versionen sind unter [Releases](https://github.com/gomaaz/Gameparty/releases) einsehbar.
