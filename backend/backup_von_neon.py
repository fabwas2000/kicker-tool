"""Holt den aktuellen Stand aus der Cloud-Datenbank in eine lokale Datei.

Seit dem Umzug liegen die echten Daten bei Neon. Diese Datei zieht davon
eine vollstaendige Kopie auf diesen Rechner - als Sicherung, falls bei Neon
etwas passiert oder du versehentlich etwas loeschst.

Die Kopie ist eine ganz normale SQLite-Datei. Man kann sie also im Notfall
einfach als kicker_tool.db verwenden und das Backend lokal damit starten.

Aufruf aus dem backend-Ordner (oder per Doppelklick auf backup.bat):

    .venv\Scripts\python.exe backup_von_neon.py
    .venv\Scripts\python.exe backup_von_neon.py --behalten 20

Die Zugangsdaten stehen in neon.url. Diese Datei enthaelt ein Passwort und
ist bewusst von git ausgenommen.
"""

import os
import sys
from datetime import datetime

# Windows-Konsolen arbeiten standardmaessig mit einer Zeichentabelle, die
# Namen wie "Ivanovic" mit Sonderzeichen nicht darstellen kann - ohne diese
# Zeile bricht das Skript beim blossen Ausgeben eines Namens ab.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HIER = os.path.dirname(os.path.abspath(__file__))
URL_DATEI = os.path.join(HIER, "neon.url")
ORDNER = os.path.join(HIER, "backups")

# Wie viele Sicherungen aufgehoben werden. Aeltere werden geloescht - sonst
# waechst der Ordner mit jedem Aufruf um rund 16 MB.
STANDARD_BEHALTEN = 10


def quelle_lesen() -> str:
    if not os.path.isfile(URL_DATEI):
        raise SystemExit(
            f"Keine Zugangsdaten gefunden ({URL_DATEI}).\n"
            "In diese Datei gehoert die Verbindungsadresse aus der "
            "Neon-Oberflaeche (Connect -> Copy snippet), in einer Zeile."
        )
    with open(URL_DATEI, encoding="utf-8") as f:
        url = f.read().strip()
    if not url:
        raise SystemExit(f"{URL_DATEI} ist leer.")
    # Neon gibt "postgresql://" heraus; SQLAlchemy waehlt dafuer psycopg2,
    # installiert ist aber psycopg 3.
    for praefix in ("postgresql://", "postgres://"):
        if url.startswith(praefix):
            return "postgresql+psycopg://" + url[len(praefix):]
    return url


def aufraeumen(behalten: int) -> None:
    dateien = sorted(
        (f for f in os.listdir(ORDNER) if f.startswith("neon_") and f.endswith(".db")),
        reverse=True,
    )
    for alt in dateien[behalten:]:
        os.remove(os.path.join(ORDNER, alt))
        print(f"  alte Sicherung geloescht: {alt}")


def main() -> int:
    args = sys.argv[1:]
    behalten = STANDARD_BEHALTEN
    if "--behalten" in args:
        behalten = int(args[args.index("--behalten") + 1])

    os.makedirs(ORDNER, exist_ok=True)
    ziel = os.path.join(ORDNER, f"neon_{datetime.now():%Y%m%d_%H%M%S}.db")

    # Der eigentliche Kopiervorgang steckt schon im Umzugsskript - das kann
    # beide Richtungen, weil Quelle und Ziel ueber Umgebungsvariablen kommen.
    # Kein Grund, dieselbe Logik ein zweites Mal zu schreiben.
    os.environ["QUELL_DATABASE_URL"] = quelle_lesen()
    os.environ["ZIEL_DATABASE_URL"] = "sqlite:///" + ziel.replace("\\", "/")

    import migrate_zu_postgres

    print(f"Sichere die Cloud-Datenbank nach {os.path.basename(ziel)} ...\n")
    code = migrate_zu_postgres.main()

    if code != 0:
        print("\nSicherung fehlgeschlagen - die Datei wird verworfen.")
        if os.path.isfile(ziel):
            os.remove(ziel)
        return code

    groesse = os.path.getsize(ziel) / 1048576
    print(f"\nSicherung fertig: backups/{os.path.basename(ziel)} ({groesse:.1f} MB)")
    aufraeumen(behalten)
    return 0


if __name__ == "__main__":
    sys.exit(main())
