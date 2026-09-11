@echo off
REM Startet das Backend lokal. Legt beim ersten Mal automatisch die
REM virtuelle Umgebung an und installiert die Abhaengigkeiten.
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

echo.
echo Backend laeuft gleich auf http://127.0.0.1:8000
echo Zum Beenden dieses Fenster schliessen oder Strg+C druecken.
echo.
".venv\Scripts\python.exe" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
pause
