"""Gesicherte Fotos aus backend/fotos_gesichert/ zurueck in die Datenbank.

Gegenstueck zu fotos_sichern.py - fuer den Fall, dass ein kicker-Foto
schlechter ist als das vorherige.

Aufruf aus dem backend-Ordner:

    .venv\\Scripts\\python.exe fotos_zurueck.py --liste          # zeigen, was da ist
    .venv\\Scripts\\python.exe fotos_zurueck.py 190161 142200    # einzelne zurueck
    .venv\\Scripts\\python.exe fotos_zurueck.py --alle           # alle zurueck

Die Spieler-IDs stehen in fotos_gesichert/index.json samt Klarnamen; --liste
zeigt sie lesbar an.
"""

import json
import os
import sys
from datetime import datetime, timezone

from app.database import SessionLocal
from app.models import PlayerImage

# Windows-Konsolen arbeiten standardmaessig mit einer Zeichentabelle, die
# Namen wie "Ivanovic" mit Sonderzeichen nicht darstellen kann - ohne diese
# Zeile bricht das Skript beim blossen Ausgeben eines Namens ab.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

QUELLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fotos_gesichert")


def lade_index() -> dict:
    pfad = os.path.join(QUELLE, "index.json")
    if not os.path.isfile(pfad):
        raise SystemExit(
            f"Keine Sicherung gefunden ({pfad}). Erst fotos_sichern.py laufen lassen."
        )
    with open(pfad, encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    args = [a for a in sys.argv[1:]]
    index = lade_index()

    if not args or "--liste" in args:
        print(f"{len(index)} gesicherte Fotos:\n")
        for pid, info in sorted(index.items(), key=lambda kv: kv[1]["name"]):
            print(f"  {pid:<10} {info['name'] or '(nicht im Kader)':<28} {info['bytes'] / 1024:5.0f} KB")
        print("\nZurueckholen: fotos_zurueck.py <ID> [<ID> ...]   oder   --alle")
        return 0

    ids = list(index.keys()) if "--alle" in args else [a for a in args if not a.startswith("--")]
    unbekannt = [i for i in ids if i not in index]
    if unbekannt:
        print("Nicht in der Sicherung: " + ", ".join(unbekannt))
        return 1

    db = SessionLocal()
    try:
        for pid in ids:
            info = index[pid]
            with open(os.path.join(QUELLE, info["datei"]), "rb") as f:
                daten = f.read()

            bild = db.get(PlayerImage, pid)
            if bild is None:
                bild = PlayerImage(espn_player_id=pid)
                db.add(bild)
            bild.content_type = info["content_type"]
            bild.data = daten
            bild.updated_at = datetime.now(timezone.utc)
            print(f"  zurueckgeholt: {pid} {info['name']}")
        db.commit()
        print(f"\n{len(ids)} Foto(s) wiederhergestellt.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
