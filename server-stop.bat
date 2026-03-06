@echo off
echo ==========================================
echo   LAN Coins - Stoppe Server...
echo ==========================================
echo.
taskkill /F /IM node.exe 2>nul
if %errorlevel%==0 (
    echo Node-Server wurde beendet.
) else (
    echo Kein Node-Server gefunden.
)
echo.
pause
