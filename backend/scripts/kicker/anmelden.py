"""Einmalig bei kicker anmelden, damit die Import-Skripte eingeloggt lesen.

Oeffnet ein sichtbares Chrome-Fenster mit dem eigenen kicker-Tool-Profil
(siehe browser.py). Dort ganz normal bei kicker einloggen und das Fenster
danach schliessen - das Login bleibt im Profil gespeichert. Erneut noetig
erst, wenn kicker einen wieder abmeldet.

    python anmelden.py
"""

import os
import subprocess

from browser import PROFIL, browser_finden

os.makedirs(PROFIL, exist_ok=True)
print("Chrome oeffnet sich. Bitte bei kicker anmelden und das Fenster danach schliessen.")
subprocess.run(
    [browser_finden(), "--user-data-dir=" + PROFIL, "--no-first-run", "https://www.kicker.de/"]
)
print("Fertig. Das Login ist gespeichert unter:", PROFIL)
