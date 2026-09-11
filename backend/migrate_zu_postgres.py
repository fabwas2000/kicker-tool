"""Alle Daten aus der lokalen SQLite-Datei in eine Postgres-Datenbank kopieren.

Fuer den Umzug in die Cloud (z.B. Neon). Laeuft ueber die SQLAlchemy-Modelle,
nicht ueber SQL-Dumps - dadurch ist es unabhaengig von den Unterschieden
zwischen SQLite und Postgres (Datentypen, Anfuehrungszeichen, AUTOINCREMENT).

Aufruf aus dem backend-Ordner (Windows, Eingabeaufforderung):

    set ZIEL_DATABASE_URL=postgresql+psycopg://benutzer:passwort@host/dbname
    .venv\\Scripts\\python.exe migrate_zu_postgres.py --dry-run
    .venv\\Scripts\\python.exe migrate_zu_postgres.py

Die Quelle ist standardmaessig kicker_tool.db im selben Ordner; mit
QUELL_DATABASE_URL laesst sich eine andere angeben.

Sicherheitsnetz: Das Skript bricht ab, wenn im Ziel schon Daten stehen -
ausser mit --ueberschreiben. So laesst es sich gefahrlos zweimal starten.
"""

import os
import sys

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.models import (
    Base,
    Competitor,
    KickerPosition,
    Lineup,
    LineupPlayer,
    PlayerGrade,
    PlayerImage,
    Setting,
    SquadPlayer,
)

HIER = os.path.dirname(os.path.abspath(__file__))
QUELLE = os.environ.get("QUELL_DATABASE_URL", f"sqlite:///{os.path.join(HIER, 'kicker_tool.db')}")

# Reihenfolge ist wichtig: Tabellen, auf die andere verweisen, zuerst.
REIHENFOLGE = [
    Competitor,
    SquadPlayer,
    Lineup,
    LineupPlayer,
    PlayerGrade,
    PlayerImage,
    KickerPosition,
    Setting,
]


def spaltenwerte(zeile) -> dict:
    """Alle echten Spalten einer Zeile als einfaches dict - ohne die
    Beziehungen, die sonst beim Kopieren Objekte nachladen wuerden."""
    return {
        spalte.name: getattr(zeile, spalte.name)
        for spalte in zeile.__table__.columns
    }


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    ueberschreiben = "--ueberschreiben" in sys.argv

    ziel_url = os.environ.get("ZIEL_DATABASE_URL", "").strip()
    if not ziel_url:
        print("ZIEL_DATABASE_URL ist nicht gesetzt.\n")
        print("Beispiel (Eingabeaufforderung):")
        print("  set ZIEL_DATABASE_URL=postgresql+psycopg://user:pass@host/dbname")
        print("\nDie Adresse steht bei Neon unter „Connection string“.")
        print("Wichtig: 'postgresql://' am Anfang zu 'postgresql+psycopg://' aendern.")
        return 1

    print(f"Quelle: {QUELLE}")
    # Passwort in der Ausgabe unkenntlich machen
    sichtbar = ziel_url
    if "@" in sichtbar and "//" in sichtbar:
        vorn, hinten = sichtbar.split("//", 1)
        if "@" in hinten:
            zugang, rest = hinten.split("@", 1)
            benutzer = zugang.split(":", 1)[0]
            sichtbar = f"{vorn}//{benutzer}:***@{rest}"
    print(f"Ziel  : {sichtbar}\n")

    quell_engine = create_engine(QUELLE, connect_args={"check_same_thread": False}
                                 if QUELLE.startswith("sqlite") else {})
    ziel_engine = create_engine(ziel_url)

    QuellSession = sessionmaker(bind=quell_engine)
    ZielSession = sessionmaker(bind=ziel_engine)

    print("Lege fehlende Tabellen im Ziel an...")
    Base.metadata.create_all(bind=ziel_engine)

    quelle = QuellSession()
    ziel = ZielSession()
    try:
        # --- Bestand pruefen ---
        print("\nBestand:")
        vorhanden_im_ziel = 0
        plan = []
        for modell in REIHENFOLGE:
            n_quelle = quelle.scalar(select(func.count()).select_from(modell))
            n_ziel = ziel.scalar(select(func.count()).select_from(modell))
            vorhanden_im_ziel += n_ziel
            plan.append((modell, n_quelle, n_ziel))
            print(f"  {modell.__tablename__:<18} Quelle {n_quelle:>5}   Ziel {n_ziel:>5}")

        if vorhanden_im_ziel and not ueberschreiben:
            print("\nIm Ziel stehen bereits Daten. Abbruch, damit nichts doppelt landet.")
            print("Mit --ueberschreiben wird das Ziel vorher geleert.")
            return 1

        if dry_run:
            print("\nProbelauf - es wird nichts geschrieben.")
            return 0

        # --- Ziel leeren (nur mit --ueberschreiben) ---
        if vorhanden_im_ziel:
            print("\nLeere Zieltabellen...")
            for modell in reversed(REIHENFOLGE):
                ziel.query(modell).delete()
            ziel.commit()

        # --- Kopieren ---
        print("\nKopiere:")
        for modell, n_quelle, _ in plan:
            if not n_quelle:
                print(f"  {modell.__tablename__:<18} leer, nichts zu tun")
                continue
            zeilen = quelle.scalars(select(modell)).all()
            for zeile in zeilen:
                ziel.add(modell(**spaltenwerte(zeile)))
            ziel.commit()
            print(f"  {modell.__tablename__:<18} {len(zeilen):>5} Zeilen")

        # --- Zaehlerstaende nachziehen ---
        # Postgres fuehrt fuer id-Spalten eine eigene Sequenz. Weil wir die IDs
        # mitkopiert haben, steht die Sequenz noch auf 1 - der naechste neu
        # angelegte Konkurrent bekaeme sonst eine schon vergebene ID.
        if ziel_engine.dialect.name == "postgresql":
            print("\nSetze Postgres-Sequenzen auf den hoechsten vergebenen Wert...")
            from sqlalchemy import text

            for modell in REIHENFOLGE:
                if "id" not in modell.__table__.columns:
                    continue
                spalte = modell.__table__.columns["id"]
                if not spalte.autoincrement:
                    continue
                tabelle = modell.__tablename__
                ziel.execute(
                    text(
                        f"SELECT setval(pg_get_serial_sequence('{tabelle}', 'id'), "
                        f"COALESCE((SELECT MAX(id) FROM {tabelle}), 1))"
                    )
                )
                print(f"  {tabelle}")
            ziel.commit()

        # --- Gegenprobe ---
        print("\nGegenprobe:")
        alles_gleich = True
        for modell in REIHENFOLGE:
            n_quelle = quelle.scalar(select(func.count()).select_from(modell))
            n_ziel = ziel.scalar(select(func.count()).select_from(modell))
            gleich = n_quelle == n_ziel
            alles_gleich = alles_gleich and gleich
            print(f"  {modell.__tablename__:<18} {n_quelle:>5} -> {n_ziel:>5}  {'ok' if gleich else 'ABWEICHUNG'}")

        # Fotos zusaetzlich nach Groesse pruefen - eine reine Zeilenzahl wuerde
        # nicht auffallen lassen, wenn Binaerdaten unterwegs verlorengehen.
        b_quelle = quelle.scalar(select(func.sum(func.length(PlayerImage.data)))) or 0
        b_ziel = ziel.scalar(select(func.sum(func.length(PlayerImage.data)))) or 0
        print(f"\n  Fotos: {b_quelle / 1048576:.1f} MB -> {b_ziel / 1048576:.1f} MB "
              f"{'ok' if b_quelle == b_ziel else 'ABWEICHUNG'}")
        if b_quelle != b_ziel:
            alles_gleich = False

        print("\n" + ("Umzug vollstaendig." if alles_gleich else "ACHTUNG: Abweichungen siehe oben."))
        return 0 if alles_gleich else 1
    finally:
        quelle.close()
        ziel.close()


if __name__ == "__main__":
    sys.exit(main())
