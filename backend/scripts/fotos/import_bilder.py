"""Bilder aus dem Ordner ../Bilder in die Datenbank uebernehmen.

Ordnet Fotos ALLEN Bundesliga-Spielern zu - nicht nur denen, die schon in
einem Kader stehen. Ein Foto haengt an der ESPN-Spieler-ID, nicht am Kader:
nimmt ein Konkurrent den Spieler spaeter auf, ist das Foto schon da.

Zuordnung: Der Dateiname (ohne Endung) wird normalisiert - Akzente entfernt,
Bindestriche/Sonderzeichen zu Leerzeichen, kleingeschrieben, siehe
app.positions.normalize() - und als Teilstring im ebenso normalisierten
Spielernamen gesucht. "El Faouzi.png" findet so "Soufian El-Faouzi",
"Diaz.png" findet "Luis Díaz" (Akzent spielt keine Rolle mehr).

Ist das mehrdeutig (z.B. zwei Brüder mit demselben Nachnamen: "El Mala.png"
passt auf Said UND Malek El Mala), wird bevorzugt, wer schon in einem Kader
steht - steht genau einer der Treffer in einem Kader, wird dieser gewählt.
Bleiben mehrere übrig, wird das Bild übersprungen und gemeldet.

Aufruf aus dem backend-Ordner:

    .venv\\Scripts\\python.exe import_bilder.py --dry-run   # nur anzeigen
    .venv\\Scripts\\python.exe import_bilder.py             # übernehmen

Bilder lassen sich alternativ direkt im Tool unter "Kader" hochladen; dort
werden sie automatisch verkleinert. Dieses Skript legt die Datei so ab, wie
sie im Ordner liegt.
"""

import json
import os
import sys
import urllib.error
import urllib.request

from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.models import PlayerImage, SquadPlayer
from app.positions import normalize

# Windows-Konsolen arbeiten standardmaessig mit einer Zeichentabelle, die
# Namen wie "Ivanovic" mit Sonderzeichen nicht darstellen kann - ohne diese
# Zeile bricht das Skript beim blossen Ausgeben eines Namens ab.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BILDER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Bilder")
CONTENT_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
MAX_BYTES = 400 * 1024
ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1"


def fetch_json(url: str) -> dict:
    # ESPN blockt curl/requests nicht (anders als kicker.de) - ein simpler
    # User-Agent reicht, kein Browser wie fuer import_kicker_positionen.py nötig.
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def fetch_all_bundesliga_players() -> list[dict]:
    """Alle Spieler aller 18 Vereine direkt von ESPN - mit echten ESPN-IDs,
    unabhängig davon, ob jemand sie schon in einen Kader aufgenommen hat."""
    teams_data = fetch_json(f"{ESPN_BASE}/teams")
    teams = teams_data["sports"][0]["leagues"][0]["teams"]

    players = []
    for entry in teams:
        team_id = entry["team"]["id"]
        roster = fetch_json(f"{ESPN_BASE}/teams/{team_id}/roster")
        club_name = roster.get("team", {}).get("displayName", "")
        for athlete in roster.get("athletes", []):
            players.append(
                {
                    "id": athlete["id"],
                    "name": athlete["displayName"],
                    "club": club_name,
                    "norm": normalize(athlete["displayName"]),
                }
            )
    return players


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    Base.metadata.create_all(bind=engine)

    if not os.path.isdir(BILDER_DIR):
        print(f"Ordner nicht gefunden: {BILDER_DIR}")
        return 1

    print("Lade Spielerlisten von ESPN (alle 18 Vereine)...")
    try:
        players = fetch_all_bundesliga_players()
    except (urllib.error.URLError, KeyError, json.JSONDecodeError) as exc:
        print(f"Konnte ESPN nicht erreichen bzw. Antwort nicht lesen: {exc}")
        return 1
    print(f"{len(players)} Bundesliga-Spieler gefunden.\n")

    db = SessionLocal()
    try:
        squad_ids = set(db.scalars(select(SquadPlayer.espn_player_id)).all())

        imported = skipped = 0
        for filename in sorted(os.listdir(BILDER_DIR)):
            stem, ext = os.path.splitext(filename)
            content_type = CONTENT_TYPES.get(ext.lower())
            if content_type is None:
                continue

            key = normalize(stem)
            matches = [p for p in players if key and key in p["norm"]]

            if not matches:
                print(f"  ?  {filename:<28} kein Bundesliga-Spieler passt")
                skipped += 1
                continue

            chosen = matches[0]
            if len(matches) > 1:
                im_kader = [p for p in matches if p["id"] in squad_ids]
                if len(im_kader) == 1:
                    chosen = im_kader[0]
                else:
                    namen = ", ".join(f"{p['name']} ({p['club']})" for p in matches)
                    print(f"  !  {filename:<28} mehrdeutig: {namen}")
                    skipped += 1
                    continue

            path = os.path.join(BILDER_DIR, filename)
            with open(path, "rb") as fh:
                data = fh.read()
            if len(data) > MAX_BYTES:
                print(f"  !  {filename:<28} zu gross ({len(data)//1024} KB, max {MAX_BYTES//1024} KB)")
                skipped += 1
                continue

            print(f"  ok {filename:<28} -> {chosen['name']} ({chosen['club']}, {len(data)//1024} KB)")
            imported += 1
            if dry_run:
                continue

            existing = db.get(PlayerImage, chosen["id"])
            if existing is None:
                db.add(PlayerImage(espn_player_id=chosen["id"], content_type=content_type, data=data))
            else:
                existing.content_type = content_type
                existing.data = data

        if not dry_run:
            db.commit()
        print(f"\n{imported} Bild(er) {'gefunden' if dry_run else 'uebernommen'}, {skipped} uebersprungen.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
