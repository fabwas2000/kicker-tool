"""Ein einzelnes Spielerfoto von kicker.de nachtragen.

Fuer die Faelle, die der Massenimport (import_kicker_fotos.py) nicht
zuordnen konnte - meist, weil kicker und ESPN den Namen unterschiedlich
schreiben ("Soufiane" vs "Soufian", "Mueller Wolfe" vs "Moeller Wolfe").
Hier gibt man die Zuordnung von Hand vor.

Aufruf aus dem backend-Ordner:

    .venv\\Scripts\\python.exe foto_nachtragen.py --suche "Fabio Silva"
    .venv\\Scripts\\python.exe foto_nachtragen.py 291629 fabio-silva

Das kicker-Kuerzel steht in der Adresse der Spielerseite:
kicker.de/**fabio-silva**/spieler
"""

import sys
from datetime import datetime, timezone

from sqlalchemy import select

from app.database import SessionLocal
from app.models import PlayerImage, SquadPlayer
from import_kicker_fotos import (
    FOTO_BREITE,
    FOTO_RE,
    fetch,
    find_browser,
    foto_url_in_groesse,
    lade_foto,
    normalize,
)
import tempfile
import time

# Windows-Konsolen arbeiten standardmaessig mit einer Zeichentabelle, die
# Namen wie "Ivanovic" mit Sonderzeichen nicht darstellen kann - ohne diese
# Zeile bricht das Skript beim blossen Ausgeben eines Namens ab.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def suche(begriff: str) -> int:
    """Zeigt Kaderspieler samt ESPN-ID und ob sie schon ein Foto haben."""
    norm = normalize(begriff)
    db = SessionLocal()
    try:
        treffer = [
            p for p in db.scalars(select(SquadPlayer)).all() if norm in normalize(p.name)
        ]
        if not treffer:
            print(f"Kein Kaderspieler passt auf „{begriff}“.")
            return 1
        gesehen = set()
        for p in treffer:
            if p.espn_player_id in gesehen:
                continue
            gesehen.add(p.espn_player_id)
            hat = db.get(PlayerImage, p.espn_player_id) is not None
            print(f"  {p.espn_player_id:<10} {p.name:<30} Foto: {'ja' if hat else 'NEIN'}")
        return 0
    finally:
        db.close()


def nachtragen(espn_id: str, slug: str) -> int:
    browser = find_browser()
    url = f"https://www.kicker.de/{slug}/spieler"
    print(f"Hole {url} ...")

    # kicker drosselt und liefert dann nur einen Seitenrumpf. Mehrere Anlaeufe
    # mit Pause dazwischen - derselbe Abruf klappt kurz darauf.
    m = None
    html = ""
    for versuch in range(1, 5):
        with tempfile.TemporaryDirectory() as profil:
            html = fetch(browser, url, profil, budget_ms=20000)
        m = FOTO_RE.search(html)
        if m:
            break
        if len(html) < 5000:
            print(f"  Versuch {versuch}: nur Rumpf ({len(html)} Zeichen), warte kurz...")
        else:
            print(f"  Versuch {versuch}: Seite da, aber kein Foto gefunden.")
            break
        time.sleep(4 * versuch)

    if not m:
        if len(html) < 5000:
            print("Seite kam wiederholt nur als Rumpf - stimmt das Kuerzel? "
                  "(kicker.de/<kuerzel>/spieler im Browser pruefen)")
        else:
            print("Auf der Seite ist kein Spielerfoto zu finden.")
        return 1

    daten = lade_foto(foto_url_in_groesse(m.group(1), FOTO_BREITE))
    if daten is None:
        print("Foto konnte nicht geladen werden.")
        return 1

    db = SessionLocal()
    try:
        bild = db.get(PlayerImage, espn_id)
        neu = bild is None
        if neu:
            bild = PlayerImage(espn_player_id=espn_id)
            db.add(bild)
        bild.content_type = "image/png"
        bild.data = daten
        bild.updated_at = datetime.now(timezone.utc)
        db.commit()
        print(f"{'Neu angelegt' if neu else 'Ersetzt'}: {espn_id} ({len(daten) / 1024:.0f} KB)")
        return 0
    finally:
        db.close()


def main() -> int:
    args = sys.argv[1:]
    if "--suche" in args:
        i = args.index("--suche")
        if i + 1 >= len(args):
            print("Bitte einen Namen angeben: --suche \"Fabio Silva\"")
            return 1
        return suche(args[i + 1])
    if len(args) != 2:
        print(__doc__)
        return 1
    return nachtragen(args[0], args[1])


if __name__ == "__main__":
    sys.exit(main())
