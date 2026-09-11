@echo off
REM Holt den aktuellen Stand aus der Cloud-Datenbank auf diesen Rechner.
REM Einfach doppelklicken. Die Sicherungen landen in backend\backups\.
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Die virtuelle Umgebung fehlt. Bitte einmal start.bat ausfuehren.
    pause
    exit /b 1
)

".venv\Scripts\python.exe" backup_von_neon.py %*
echo.
pause
