# LAN Coins - Agent Memory

## Projekt: LAN Coins Web App
- Pfad: `/mnt/d/onedrive_new/OneDrive - Daniel Lortie Media/privat/LAN/lan-coins-app/`
- Vanilla HTML/CSS/JS, kein Build-Step, kein Framework
- Dark Mode Gaming-Theme, ADHS-freundliches Design
- LocalStorage fuer Persistenz (Coins, Sessions, History, Tokens)
- Google Sheet ID: `1qfNC_9TwRZvlKayf2Gxw2WzhHCcKcrvfSwxlqIAq6VY` als Datenquelle fuer Spieleliste

## Teilnehmer
Martin, Daniel, Kevin, Peter, Julian, Lars, Wolf (5-7 Personen)

## Coin-System
- 1 Coin: Session (3+ Spieler), 2 Coins: 4+ Spieler, 3 Coins: ALLE anwesend
- 1 Bonus-Coin: Neues Genre ausprobiert
- Shop: 3C Spiel bestimmen, 5C Zwangsspielen, 2C Skip-Token

## Dateistruktur
- `index.html` - Single Page mit 5 Views (Dashboard, Matcher, Profil, Session, Shop)
- `css/style.css` - Dark Theme mit CSS Variables
- `js/data.js` - CONFIG, SHOP_ITEMS, FALLBACK_GAMES (aus Google Sheet exportiert)
- `js/app.js` - Gesamte Logik (IIFE, kein globaler State-Leak)

## Architektur-Entscheidungen
- CSV-Export von Google Sheets als Live-Datenquelle (kein API-Key noetig)
- Fallback auf eingebaute JSON-Daten wenn Sheet nicht erreichbar
- Trust-System statt Login (Freundes-LAN)
- Admin-Bereich in Session-View integriert (kein separater Login)
- Genre-Tracking fuer Bonus-Coins ueber LocalStorage
