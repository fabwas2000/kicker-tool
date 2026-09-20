"""Positionen (Tor/Abwehr/Mittelfeld/Sturm) von kicker.de uebernehmen.

Warum ein eigenes Skript und kein Aufruf aus dem Frontend?
  * kicker.de blockt Anfragen ohne echten Browser-Fingerprint mit HTTP 403 -
    curl und Python-requests kommen nicht durch, ein echter Chrome schon.
  * kicker.de sendet keine CORS-Header, ein fetch() aus dem Browser waere
    ohnehin blockiert.
Deshalb: lokal einmal laufen lassen, Ergebnis landet in der Datenbank.

Aufruf aus dem backend-Ordner:

    .venv\\Scripts\\python.exe import_kicker_positionen.py --dry-run
    .venv\\Scripts\\python.exe import_kicker_positionen.py

Die Zuordnung ESPN-Spieler -> kicker-Position laeuft ueber den normalisierten
Namen (ohne Akzente, Kleinschreibung). Was nicht eindeutig passt, wird
gemeldet und bleibt unveraendert - im Tool laesst sich die Position dann
unter "Kader" von Hand setzen.
"""

import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from datetime import date

from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.models import KickerPosition, SquadPlayer

# Windows-Konsolen arbeiten standardmaessig mit einer Zeichentabelle, die
# Namen wie "Ivanovic" mit Sonderzeichen nicht darstellen kann - ohne diese
# Zeile bricht das Skript beim blossen Ausgeben eines Namens ab.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)
POSITION_BY_HEADLINE = {"Tor": "G", "Abwehr": "D", "Mittelfeld": "M", "Sturm": "F"}
POSITION_LABEL = {"G": "Tor", "D": "Abwehr", "M": "Mittelfeld", "F": "Sturm"}

HEADLINE_RE = re.compile(
    r'<h2 class="kick__section-headline[^"]*">\s*(Tor|Abwehr|Mittelfeld|Sturm)\s*</h2>'
)
PLAYER_RE = re.compile(
    r'<a href="/([^"/]+)/spieler/[^"]*"><strong>([^<]*)</strong>\s*<span>([^<]*)</span></a>'
)
CLUB_RE = re.compile(r'href="/([a-z0-9-]+)/kader/')


def find_browser() -> str:
    for path in CHROME_CANDIDATES:
        if os.path.isfile(path):
            return path
    raise SystemExit(
        "Kein Chrome/Edge gefunden. Bitte Pfad in CHROME_CANDIDATES ergaenzen."
    )


def fetch(browser: str, url: str, profile_dir: str, budget_ms: int = 20000) -> str:
    """Seite mit echtem Browser rendern - kicker blockt alles andere.

    Das Zeitbudget muss grosszuegig sein: bei 12 s kamen einzelne Kaderseiten
    unfertig zurueck (leerer Rumpf ohne Spielertabelle).
    """
    result = subprocess.run(
        [
            browser,
            "--headless=new",
            "--disable-gpu",
            "--virtual-time-budget=" + str(budget_ms),
            "--user-agent=" + USER_AGENT,
            "--user-data-dir=" + profile_dir,
            "--dump-dom",
            url,
        ],
        capture_output=True,
        timeout=150,
    )
    return result.stdout.decode("utf-8", errors="replace")


def season_slug(today: date | None = None) -> str:
    today = today or date.today()
    start = today.year if today.month >= 7 else today.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def normalize(name: str) -> str:
    text = unicodedata.normalize("NFKD", name)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z]+", " ", text.lower()).strip()


def parse_squad(html: str) -> list[tuple[str, str, str]]:
    """[(position, "Vorname Nachname", kicker-slug)]"""
    heads = [(m.start(), m.group(1)) for m in HEADLINE_RE.finditer(html)]
    players = []
    for i, (start, headline) in enumerate(heads):
        end = heads[i + 1][0] if i + 1 < len(heads) else len(html)
        for m in PLAYER_RE.finditer(html, start, end):
            slug, last, first = m.group(1), m.group(2).strip(), m.group(3).strip()
            players.append((POSITION_BY_HEADLINE[headline], f"{first} {last}".strip(), slug))
    return players


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    Base.metadata.create_all(bind=engine)
    browser = find_browser()
    season = season_slug()

    print(f"Browser: {browser}")
    print(f"Saison : {season}\n")

    with tempfile.TemporaryDirectory() as profile_dir:
        clubs = sorted(
            set(CLUB_RE.findall(fetch(browser, "https://www.kicker.de/bundesliga/vereine", profile_dir)))
        )
        if not clubs:
            print("Keine Vereine gefunden - hat kicker.de die Seitenstruktur geaendert?")
            return 1
        print(f"{len(clubs)} Vereine gefunden.\n")

        all_players: list[tuple[str, str, str, str]] = []  # pos, name, slug, club
        leer = []
        for i, club in enumerate(clubs, 1):
            url = f"https://www.kicker.de/{club}/kader/bundesliga/{season}"
            squad = parse_squad(fetch(browser, url, profile_dir))
            if not squad:
                # Einzelne Seiten kommen gelegentlich unfertig zurueck.
                squad = parse_squad(fetch(browser, url, profile_dir, budget_ms=30000))
            if not squad:
                leer.append(club)
            print(f"  [{i:>2}/{len(clubs)}] {club:<28} {len(squad):>2} Spieler")
            for pos, name, slug in squad:
                all_players.append((pos, name, slug, club))

    if leer:
        print("\n  ! Ohne Spieler geblieben: " + ", ".join(leer))
        print("    (Skript nochmal laufen lassen; kicker liefert gelegentlich unfertige Seiten.)")

    if not all_players:
        print("\nKeine Spieler geparst - Seitenstruktur pruefen.")
        return 1

    print(f"\nInsgesamt {len(all_players)} Spieler von kicker.\n")

    db = SessionLocal()
    try:
        if not dry_run:
            db.query(KickerPosition).delete()
            for pos, name, slug, club in all_players:
                db.add(
                    KickerPosition(
                        name_key=normalize(name),
                        name=name,
                        position=pos,
                        kicker_slug=slug,
                        club_slug=club,
                    )
                )
            db.commit()

        # Bestehende Kaderspieler aktualisieren
        by_full = {}
        by_last = {}
        for pos, name, slug, club in all_players:
            by_full.setdefault(normalize(name), []).append(pos)
            by_last.setdefault(normalize(name.split()[-1]), []).append(pos)

        changed = same = unmatched = 0
        for player in db.scalars(select(SquadPlayer)).all():
            key = normalize(player.name)
            hits = by_full.get(key)
            how = "Name"
            if not hits:
                hits = by_last.get(normalize(player.name.split()[-1]))
                how = "Nachname"
            if not hits or len(set(hits)) != 1:
                print(f"  ?  {player.name:<30} keine eindeutige kicker-Position")
                unmatched += 1
                continue

            new_pos = hits[0]
            if new_pos == player.position:
                same += 1
            else:
                print(
                    f"  ~  {player.name:<30} {POSITION_LABEL.get(player.position, player.position)}"
                    f" -> {POSITION_LABEL[new_pos]}   (ueber {how})"
                )
                changed += 1
                if not dry_run:
                    player.position = new_pos
        if not dry_run:
            db.commit()

        verb = "wuerden geaendert" if dry_run else "geaendert"
        print(f"\n{changed} Position(en) {verb}, {same} unveraendert, {unmatched} ohne Treffer.")
        if dry_run:
            print("(Probelauf - es wurde nichts gespeichert.)")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
