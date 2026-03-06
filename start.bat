@echo off
echo ==========================================
echo   Gameparty - Starte Server...
echo ==========================================
echo.
echo Oeffne im Browser: http://localhost:3000
echo Andere Spieler im LAN: http://[DEINE-IP]:3000
echo Zum Stoppen: STRG+C druecken
echo.
cd /d "%~dp0"
node server.js
echo.
echo Server wurde beendet oder ein Fehler ist aufgetreten.
pause
