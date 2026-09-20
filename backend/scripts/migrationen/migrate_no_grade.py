"""Fuegt die Spalte `no_grade` zu player_grades hinzu.

Bedeutung: der Spieler hat gespielt, aber es wurde bewusst "-" statt einer
Note eingetragen (kicker vergibt z.B. unter 25 Einsatzminuten oft keine
Note). Das zaehlt als "eingetragen", im Gegensatz zu einem leeren Feld
(noch nicht bearbeitet).

Reines ALTER TABLE ADD COLUMN - SQLite kann das ohne Tabellen-Neubau, ein
Backup wird trotzdem vorher angelegt. Gefahrlos mehrfach ausfuehrbar.

    .venv\\Scripts\\python.exe migrate_no_grade.py
"""

import os
import shutil
import sqlite3
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kicker_tool.db")


def main() -> int:
    if not os.path.isfile(DB_PATH):
        print(f"Keine Datenbank unter {DB_PATH} - nichts zu tun.")
        return 0

    db = sqlite3.connect(DB_PATH)
    cols = {row[1] for row in db.execute("pragma table_info(player_grades)")}
    if "no_grade" in cols:
        print("Spalte no_grade existiert bereits - nichts zu tun.")
        return 0

    before = db.execute("select count(*) from player_grades").fetchone()[0]
    print(f"Vorher: {before} Zeilen in player_grades")

    backup = DB_PATH.replace(".db", f"_vor_no_grade_{datetime.now():%Y%m%d_%H%M%S}.db")
    shutil.copy2(DB_PATH, backup)
    print(f"Sicherung: {os.path.basename(backup)}")

    db.execute("ALTER TABLE player_grades ADD COLUMN no_grade BOOLEAN NOT NULL DEFAULT 0")
    db.commit()

    after = db.execute("select count(*) from player_grades").fetchone()[0]
    print(f"Nachher: {after} Zeilen in player_grades")
    if after != before:
        print("!! Zeilenzahl weicht ab - bitte die Sicherung zurueckspielen.")
        return 1

    cols_after = [row[1] for row in db.execute("pragma table_info(player_grades)")]
    print("Neues Schema:", ", ".join(cols_after))
    print("Migration erfolgreich.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
