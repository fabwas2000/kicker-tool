"""Gemeinsamer Chrome-Zugang fuer alles, was eingeloggt bei kicker liest.

kicker.de sitzt hinter dem Bot-Schutz DataDome: curl und requests bekommen
nur eine Sicherheitsabfrage, Server im Rechenzentrum (GitHub Actions) nach
der ersten Seite ein Captcha. Von einem normalen Heim-PC aus kommt ein echter
Chrome durch - deshalb laufen diese Skripte lokal.

Das Login steckt in einem eigenen Chrome-Profil AUSSERHALB des Repos (das
Repo ist oeffentlich, im Profil liegt das Sitzungs-Cookie):

    %LOCALAPPDATA%\\kicker-tool\\chrome-profil

Angelegt wird es einmalig mit anmelden.py. Danach liest jedes Skript ueber
seite_laden() unsichtbar und eingeloggt mit.

Zum Ausprobieren auch direkt aufrufbar:

    python browser.py https://www.kicker.de/... > seite.html
"""

import os
import re
import subprocess
import sys

PROFIL = os.path.join(
    os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "kicker-tool", "chrome-profil"
)

BROWSER_KANDIDATEN = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def browser_finden() -> str:
    for pfad in BROWSER_KANDIDATEN:
        if os.path.isfile(pfad):
            return pfad
    raise SystemExit("Kein Chrome/Edge gefunden. Bitte Pfad in BROWSER_KANDIDATEN ergaenzen.")


def _user_agent(browser: str) -> str:
    """Kennung wie beim sichtbaren Chrome, mit dem man sich angemeldet hat.

    Unsichtbar meldet sich Chrome sonst als "HeadlessChrome" - das passt
    nicht zum Cookie aus der sichtbaren Anmeldung und faellt DataDome auf.
    Die Versionsnummer steht als Ordnername neben der chrome.exe.
    """
    versionen = [
        name for name in os.listdir(os.path.dirname(browser)) if re.fullmatch(r"\d+(\.\d+){3}", name)
    ]
    haupt = max(versionen, key=lambda v: tuple(map(int, v.split(".")))).split(".")[0] if versionen else "130"
    return (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        f"(KHTML, like Gecko) Chrome/{haupt}.0.0.0 Safari/537.36"
    )


def ist_captcha(html: str) -> bool:
    return "captcha-delivery.com" in html


def seite_laden(url: str, budget_ms: int = 20000) -> str:
    """Seite unsichtbar und eingeloggt rendern, fertiges HTML zurueck.

    Laeuft gerade ein sichtbares Chrome-Fenster mit demselben Profil (etwa
    noch von anmelden.py), haengt sich das an jenes Fenster an und liefert
    nichts - also vorher schliessen.
    """
    if not os.path.isdir(PROFIL):
        raise SystemExit("Noch nicht angemeldet. Bitte zuerst anmelden.py ausfuehren.")
    browser = browser_finden()
    ergebnis = subprocess.run(
        [
            browser,
            "--headless=new",
            "--disable-gpu",
            "--virtual-time-budget=" + str(budget_ms),
            "--user-agent=" + _user_agent(browser),
            "--user-data-dir=" + PROFIL,
            "--dump-dom",
            url,
        ],
        capture_output=True,
        timeout=150,
    )
    return ergebnis.stdout.decode("utf-8", errors="replace")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Aufruf: python browser.py <url>")
    html = seite_laden(sys.argv[1])
    if ist_captcha(html):
        print("kicker zeigt ein Captcha - einmal anmelden.py starten und die Seite dort oeffnen.", file=sys.stderr)
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdout.write(html)
