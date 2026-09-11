from datetime import datetime, timezone

from sqlalchemy import ForeignKey, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Competitor(Base):
    __tablename__ = "competitors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)

    squad_players: Mapped[list["SquadPlayer"]] = relationship(
        back_populates="competitor", cascade="all, delete-orphan"
    )
    lineups: Mapped[list["Lineup"]] = relationship(
        back_populates="competitor", cascade="all, delete-orphan"
    )


class SquadPlayer(Base):
    """One player in a competitor's 22-man squad. Player data is a snapshot
    copied from the ESPN roster at selection time, so the squad view never
    needs to re-fetch ESPN just to render itself."""

    __tablename__ = "squad_players"
    __table_args__ = (UniqueConstraint("competitor_id", "espn_player_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    competitor_id: Mapped[int] = mapped_column(ForeignKey("competitors.id"))
    espn_player_id: Mapped[str] = mapped_column(String(32))
    espn_team_id: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(120))
    team_name: Mapped[str] = mapped_column(String(120))
    position: Mapped[str] = mapped_column(String(8))

    competitor: Mapped["Competitor"] = relationship(back_populates="squad_players")


class Lineup(Base):
    """A competitor's starting formation + XI for one matchday."""

    __tablename__ = "lineups"
    __table_args__ = (UniqueConstraint("competitor_id", "matchday"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    competitor_id: Mapped[int] = mapped_column(ForeignKey("competitors.id"))
    matchday: Mapped[int] = mapped_column()
    formation: Mapped[str] = mapped_column(String(16))
    updated_at: Mapped[datetime] = mapped_column(default=_utcnow, onupdate=_utcnow)

    competitor: Mapped["Competitor"] = relationship(back_populates="lineups")
    players: Mapped[list["LineupPlayer"]] = relationship(
        back_populates="lineup", cascade="all, delete-orphan"
    )


class LineupPlayer(Base):
    """One starting-XI slot assignment. `slot` is an opaque label defined by
    the frontend's formation template (e.g. "GK", "D1", "M3", "F1")."""

    __tablename__ = "lineup_players"
    __table_args__ = (UniqueConstraint("lineup_id", "slot"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    lineup_id: Mapped[int] = mapped_column(ForeignKey("lineups.id"))
    slot: Mapped[str] = mapped_column(String(16))
    espn_player_id: Mapped[str] = mapped_column(String(32))

    lineup: Mapped["Lineup"] = relationship(back_populates="players")


class PlayerGrade(Base):
    """Alle manuellen Eingaben zu einem Spieler an einem Spieltag - Note,
    Korrekturen an Toren/Vorlagen und "Spieler des Spiels". Gilt global, also
    fuer jeden Konkurrenten, der den Spieler aufgestellt hat.

    goals/assists sind Korrekturwerte: NULL bedeutet "ESPN-Wert gilt".
    Gebraucht wird das, weil kicker anders zaehlt als ESPN (kicker gibt z.B.
    Vorlagen, die ESPN nicht kennt).
    """

    __tablename__ = "player_grades"
    __table_args__ = (UniqueConstraint("matchday", "espn_player_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    matchday: Mapped[int] = mapped_column(index=True)
    espn_player_id: Mapped[str] = mapped_column(String(32))
    grade: Mapped[float | None] = mapped_column(nullable=True)
    # Spieler hat gespielt, aber bewusst "-" statt einer Note bekommen (z.B.
    # unter 25 Einsatzminuten - kicker vergibt dann oft keine Note). Zaehlt
    # als "eingetragen", anders als ein schlicht leeres Feld.
    no_grade: Mapped[bool] = mapped_column(default=False)
    goals: Mapped[int | None] = mapped_column(nullable=True)
    assists: Mapped[int | None] = mapped_column(nullable=True)
    player_of_match: Mapped[bool] = mapped_column(default=False)


class PlayerImage(Base):
    """Spielerfoto, global je ESPN-Spieler (nicht je Konkurrent). Wird als
    Rohbild gespeichert und ueber einen eigenen Endpoint mit Cache-Header
    ausgeliefert - so laedt das Handy jedes Bild nur einmal."""

    __tablename__ = "player_images"

    espn_player_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    content_type: Mapped[str] = mapped_column(String(64), default="image/png")
    data: Mapped[bytes] = mapped_column(LargeBinary)
    updated_at: Mapped[datetime] = mapped_column(default=_utcnow, onupdate=_utcnow)


class KickerPosition(Base):
    """Positionszuordnung laut kicker.de. ESPN und kicker sind sich nicht
    immer einig (Olise ist bei ESPN Mittelfeld, bei kicker Sturm) - und weil
    die Torpunkte positionsabhaengig sind, gilt kicker als Quelle.
    Befuellt durch import_kicker_positionen.py."""

    __tablename__ = "kicker_positions"

    # Eigener Schluessel statt name_key: Namen sind ligaweit nicht eindeutig
    # (zwei Spieler koennen gleich heissen). Mehrdeutige Treffer werden beim
    # Zuordnen erkannt und uebersprungen.
    id: Mapped[int] = mapped_column(primary_key=True)
    name_key: Mapped[str] = mapped_column(String(120), index=True)
    name: Mapped[str] = mapped_column(String(120))
    position: Mapped[str] = mapped_column(String(8))
    kicker_slug: Mapped[str] = mapped_column(String(120), default="")
    club_slug: Mapped[str] = mapped_column(String(120), default="")


class Setting(Base):
    """Key/value store for app settings (currently only the scoring rules),
    kept server-side so phone and desktop always agree."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
