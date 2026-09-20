"""Erweitert die Tabelle player_grades um manuelle Korrekturen.

Neu:
  goals            manuelle Toranzahl (NULL = ESPN-Wert gilt)
  assists          manuelle Vorlagenanzahl (NULL = ESPN-Wert gilt)
  player_of_match  Spieler des Spiels

Ausserdem wird `grade` von NOT NULL auf optional umgestellt - eine Zeile darf
auch ohne Note existieren (z.B. nur eine Vorlagen-Korrektur). SQLite kann
Spalten nicht nachtraeglich nullable machen, deshalb wird die Tabelle
umgebaut. Vorhandene Noten werden dabei uebernommen und geprueft.

Das Skript ist gefahrlos mehrfach ausfuehrbar - ist alles schon vorhanden,
passiert nichts.

    .venv\\Scripts\\python.exe migrate_manuelle_eingaben.py
"""

import os
import shutil
import sqlite3
import sys
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kicker_tool.db")


def columns(db, table):
    return {row[1]: row for row in db.execute(f"pragma table_info({table})")}


def main() -> int:
    if not os.path.isfile(DB_PATH):
        print(f"Keine Datenbank unter {DB_PATH} - nichts zu tun.")
        return 0

    db = sqlite3.connect(DB_PATH)
    cols = columns(db, "player_grades")
    if not cols:
        print("Tabelle player_grades existiert noch nicht - wird beim Serverstart angelegt.")
        return 0

    grade_nullable = cols["grade"][3] == 0
    has_new = {"goals", "assists", "player_of_match"} <= set(cols)
    if grade_nullable and has_new:
        print("Schema ist bereits aktuell - nichts zu tun.")
        return 0

    before = db.execute("select count(*), count(grade) from player_grades").fetchone()
    print(f"Vorher: {before[0]} Zeilen, davon {before[1]} mit Note")

    backup = DB_PATH.replace(".db", f"_vor_migration_{datetime.now():%Y%m%d_%H%M%S}.db")
    shutil.copy2(DB_PATH, backup)
    print(f"Sicherung: {os.path.basename(backup)}")

    db.executescript(
        """
        PRAGMA foreign_keys=off;
        BEGIN;
        CREATE TABLE player_grades_neu (
            id INTEGER NOT NULL PRIMARY KEY,
            matchday INTEGER NOT NULL,
            espn_player_id VARCHAR(32) NOT NULL,
            grade FLOAT,
            goals INTEGER,
            assists INTEGER,
            player_of_match BOOLEAN NOT NULL DEFAULT 0,
            UNIQUE (matchday, espn_player_id)
        );
        INSERT INTO player_grades_neu (id, matchday, espn_player_id, grade)
            SELECT id, matchday, espn_player_id, grade FROM player_grades;
        DROP TABLE player_grades;
        ALTER TABLE player_grades_neu RENAME TO player_grades;
        CREATE INDEX ix_player_grades_matchday ON player_grades (matchday);
        COMMIT;
        PRAGMA foreign_keys=on;
        """
    )

    after = db.execute("select count(*), count(grade) from player_grades").fetchone()
    print(f"Nachher: {after[0]} Zeilen, davon {after[1]} mit Note")

    if after != before:
        print("!! Zeilenzahl weicht ab - bitte die Sicherung zurueckspielen.")
        return 1

    cols = columns(db, "player_grades")
    print("Neues Schema:", ", ".join(cols))
    print("Migration erfolgreich.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
