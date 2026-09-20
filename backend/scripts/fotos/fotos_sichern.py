"""Alle Spielerfotos aus der Datenbank als Dateien wegsichern.

Gedacht als Netz vor dem Import der kicker-Fotos: danach laesst sich jedes
einzelne alte Foto gezielt zurueckholen, ohne die ganze Datenbank
zurueckzurollen.

Die Dateien landen in backend/fotos_gesichert/ und heissen nach der
ESPN-Spieler-ID - das ist der Schluessel, an dem die Fotos in der Datenbank
haengen. Eine beiliegende index.json haelt zusaetzlich die Klarnamen fest,
damit man die Dateien auch von Hand zuordnen kann.

Aufruf aus dem backend-Ordner:

    .venv\\Scripts\\python.exe fotos_sichern.py

Zurueckholen einzelner Fotos: fotos_zurueck.py
"""

import json
import os
import sys

from sqlalchemy import select

from app.database import SessionLocal
from app.models import PlayerImage, SquadPlayer

# Windows-Konsolen arbeiten standardmaessig mit einer Zeichentabelle, die
# Namen wie "Ivanovic" mit Sonderzeichen nicht darstellen kann - ohne diese
# Zeile bricht das Skript beim blossen Ausgeben eines Namens ab.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HIER = os.path.dirname(os.path.abspath(__file__))
ENDUNG = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


def main() -> int:
    # Optional ein eigener Ordnername, damit sich mehrere Staende
    # nebeneinander aufheben lassen (z.B. "fotos_kicker", "fotos_original").
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    ZIEL = os.path.join(HIER, args[0] if args else "fotos_gesichert")
    os.makedirs(ZIEL, exist_ok=True)
    db = SessionLocal()
    try:
        bilder = db.scalars(select(PlayerImage)).all()
        if not bilder:
            print("Keine Fotos in der Datenbank - nichts zu sichern.")
            return 0

        # Namen fuer die Index-Datei, soweit der Spieler in einem Kader steht.
        namen = {
            p.espn_player_id: p.name
            for p in db.scalars(select(SquadPlayer)).all()
        }

        index = {}
        gesamt = 0
        for bild in bilder:
            endung = ENDUNG.get(bild.content_type, ".bin")
            dateiname = f"{bild.espn_player_id}{endung}"
            with open(os.path.join(ZIEL, dateiname), "wb") as f:
                f.write(bild.data)
            gesamt += len(bild.data)
            index[bild.espn_player_id] = {
                "datei": dateiname,
                "name": namen.get(bild.espn_player_id, ""),
                "content_type": bild.content_type,
                "bytes": len(bild.data),
            }

        with open(os.path.join(ZIEL, "index.json"), "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=2)

        print(f"{len(bilder)} Fotos gesichert ({gesamt / 1048576:.1f} MB)")
        print(f"Ordner: {ZIEL}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
