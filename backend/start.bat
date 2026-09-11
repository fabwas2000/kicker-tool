@echo off
REM Startet das Backend lokal. Legt beim ersten Mal automatisch die
REM virtuelle Umgebung an und installiert die Abhaengigkeiten.
REM
REM WICHTIG: Seit dem Umzug arbeitet auch dieser lokale Start mit der
REM Cloud-Datenbank bei Neon - derselben, die die Webseite benutzt. Sonst
REM gaebe es zwei Datenbestaende: einen im Netz und einen auf diesem
REM Rechner. Aenderungen hier waeren vom Handy aus unsichtbar und
REM umgekehrt, und irgendwann wuesste niemand mehr, welcher Stand gilt.
REM
REM Eine lokale Kopie zum Anfassen bekommst du ueber backup.bat.
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [1/2] Lege virtuelle Umgebung an...
    py -3 -m venv .venv
    if errorlevel 1 (
        echo Konnte keine virtuelle Umgebung anlegen. Ist Python installiert?
        pause
        exit /b 1
    )
    echo [2/2] Installiere Abhaengigkeiten...
    ".venv\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check -r requirements.txt
)

REM Zugangsdaten aus neon.url lesen (die Datei ist von git ausgenommen).
set "DATABASE_URL="
if exist "neon.url" (
    for /f "usebackq delims=" %%i in ("neon.url") do set "DATABASE_URL=%%i"
)

if defined DATABASE_URL (
    echo Datenbank: Neon ^(Cloud^) - dieselbe wie auf der Webseite.
) else (
    echo.
    echo   ACHTUNG: neon.url fehlt. Es wird die lokale Datei kicker_tool.db
    echo   benutzt. Aenderungen landen dann NICHT in der Cloud und sind von
    echo   anderen Geraeten aus nicht sichtbar.
    echo.
)

echo.
echo Backend laeuft gleich auf http://127.0.0.1:8000
echo Zum Beenden dieses Fenster schliessen oder Strg+C druecken.
echo.
".venv\Scripts\python.exe" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
pause
