import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./kicker_tool.db")

# Treiber erzwingen. Neon, Render & Co. geben die Adresse als
# "postgresql://..." heraus. SQLAlchemy waehlt dafuer psycopg2 - das ist
# NICHT installiert, hier liegt psycopg (Version 3). Ohne diese Zeile
# stuerzt das Backend beim Start mit "No module named 'psycopg2'" ab,
# je nachdem welche Fassung der Adresse man eingetragen hat.
# "postgres://" ist die aeltere Schreibweise mancher Anbieter.
for praefix in ("postgresql://", "postgres://"):
    if DATABASE_URL.startswith(praefix):
        DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len(praefix):]
        break

ist_sqlite = DATABASE_URL.startswith("sqlite")

if ist_sqlite:
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(
        DATABASE_URL,
        # Neon faehrt die Datenbank nach wenigen Minuten ohne Zugriff herunter
        # und trennt dabei bestehende Verbindungen. SQLAlchemy merkt das nicht
        # von allein und reicht eine tote Verbindung heraus - der erste
        # Zugriff nach einer Pause scheiterte dann mit einem Serverfehler.
        # pool_pre_ping prueft jede Verbindung vor Gebrauch und baut sie bei
        # Bedarf neu auf.
        pool_pre_ping=True,
        # Zusaetzlich: Verbindungen, die aelter als fuenf Minuten sind, gar
        # nicht erst wiederverwenden. Das ist ungefaehr das Fenster, nach dem
        # Neon abschaltet.
        pool_recycle=300,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
