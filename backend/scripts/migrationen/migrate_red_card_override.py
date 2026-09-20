"""Fuegt die Spalte `red_card_override` zu player_grades hinzu.

Bedeutung: manuelle Korrektur des Platzverweises eines Spielers. NULL
laesst den automatisch erkannten Wert gelten; "keine"/"gelbrot"/"rot"
ueberschreiben ihn.

Hintergrund: ESPNs eigene Typangabe fuer eine zweite Gelbe ist nicht
verlaesslich - bei Kleindienst (Borussia Moenchengladbach @ SC Freiburg,
Spieltag 3) stand die Karte als gewoehnliche "red-card" da, obwohl er
zuvor schon Gelb hatte. Die automatische Erkennung zaehlt das seitdem
selbst mit, aber es braucht trotzdem eine Moeglichkeit, von Hand
nachzukorrigieren - genau wie bei Toren und Vorlagen.

Reines ALTER TABLE ADD COLUMN, dialektunabhaengig ueber SQLAlchemy:
funktioniert sowohl gegen die lokale SQLite-Datei als auch gegen die
Cloud-Datenbank (Neon/Postgres). Gefahrlos mehrfach ausfuehrbar.

Aufruf aus dem backend-Ordner:

    .venv\\Scripts\\python.exe migrate_red_card_override.py

Ohne DATABASE_URL laeuft es gegen die lokale kicker_tool.db. Fuer die
Cloud-Datenbank vorher setzen (Eingabeaufforderung):

    set /p DATABASE_URL=<neon.url
    .venv\\Scripts\\python.exe migrate_red_card_override.py
"""

import os
import shutil
import sys
from datetime import datetime

from sqlalchemy import create_engine, inspect, text

# Windows-Konsolen arbeiten standardmaessig mit einer Zeichentabelle, die
# Sonderzeichen nicht darstellen kann.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HIER = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HIER, "kicker_tool.db")
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

# Denselben Treiberzwang wie in app/database.py anwenden: Neon gibt die
# Adresse als "postgresql://" heraus, SQLAlchemy waehlt dafuer psycopg2 -
# installiert ist psycopg 3.
for praefix in ("postgresql://", "postgres://"):
    if DATABASE_URL.startswith(praefix):
        DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len(praefix):]
        break

if not DATABASE_URL:
    DATABASE_URL = f"sqlite:///{DB_PATH}"


def main() -> int:
    ist_sqlite = DATABASE_URL.startswith("sqlite")
    # Bei einer expliziten SQLite-Adresse deren eigene Datei sichern, nicht
    # blind die lokale kicker_tool.db - beide muessen nicht dieselbe sein.
    sqlite_datei = DATABASE_URL.replace("sqlite:///", "") if ist_sqlite else DB_PATH
    sichtbar = DATABASE_URL
    if "@" in sichtbar:
        vorn, hinten = sichtbar.split("//", 1)
        zugang, rest = hinten.split("@", 1)
        sichtbar = vorn + "//" + zugang.split(":", 1)[0] + ":***@" + rest
    print(f"Datenbank: {sichtbar}")

    if ist_sqlite and not os.path.isfile(sqlite_datei):
        print(f"Keine Datenbank unter {sqlite_datei} gefunden - nichts zu tun.")
        return 0

    engine = create_engine(DATABASE_URL)
    inspector = inspect(engine)

    if "player_grades" not in inspector.get_table_names():
        print("Tabelle player_grades existiert noch nicht - wird beim Serverstart angelegt.")
        return 0

    spalten = {c["name"] for c in inspector.get_columns("player_grades")}
    if "red_card_override" in spalten:
        print("Spalte red_card_override existiert bereits - nichts zu tun.")
        return 0

    if ist_sqlite:
        backup = sqlite_datei.replace(".db", f"_vor_red_card_override_{datetime.now():%Y%m%d_%H%M%S}.db")
        shutil.copy2(sqlite_datei, backup)
        print(f"Sicherung: {os.path.basename(backup)}")

    with engine.begin() as conn:
        vorher = conn.execute(text("SELECT COUNT(*) FROM player_grades")).scalar()
        print(f"Vorher: {vorher} Zeilen in player_grades")
        conn.execute(text("ALTER TABLE player_grades ADD COLUMN red_card_override VARCHAR(16)"))
        nachher = conn.execute(text("SELECT COUNT(*) FROM player_grades")).scalar()

    print(f"Nachher: {nachher} Zeilen in player_grades")
    if nachher != vorher:
        print("!! Zeilenzahl weicht ab - bitte pruefen.")
        return 1

    print("Migration erfolgreich.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
