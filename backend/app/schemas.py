from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CompetitorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class CompetitorUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class CompetitorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_at: datetime
    # Wie viele der 22 Kaderplätze belegt sind - spart dem Frontend einen
    # eigenen Abruf je Konkurrent für die Übersicht.
    squad_size: int = 0


class SquadPlayerIn(BaseModel):
    espn_player_id: str
    espn_team_id: str
    name: str
    team_name: str
    position: str


class SquadPlayerOut(SquadPlayerIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class SquadReplace(BaseModel):
    players: list[SquadPlayerIn] = Field(max_length=22)


class LineupPlayerIn(BaseModel):
    slot: str
    espn_player_id: str


class LineupPlayerOut(LineupPlayerIn):
    model_config = ConfigDict(from_attributes=True)


class LineupUpsert(BaseModel):
    formation: str
    players: list[LineupPlayerIn] = Field(max_length=11)


class LineupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    matchday: int
    formation: str
    players: list[LineupPlayerOut]


class CompetitorLineupOut(BaseModel):
    competitor_id: int
    competitor_name: str
    lineup: LineupOut | None


class GradeIn(BaseModel):
    espn_player_id: str
    # null löscht die Note wieder
    grade: float | None = Field(default=None, ge=1.0, le=6.0)
    # true = Spieler hat gespielt, aber bewusst "-" statt einer Note bekommen.
    # Zählt als "eingetragen"; schließt sich mit `grade` gegenseitig aus.
    no_grade: bool = False
    # null = ESPN-Wert gilt; eine Zahl überschreibt ihn (kicker zählt anders)
    goals: int | None = Field(default=None, ge=0, le=20)
    assists: int | None = Field(default=None, ge=0, le=20)
    player_of_match: bool = False


class GradeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    espn_player_id: str
    grade: float | None
    no_grade: bool
    goals: int | None
    assists: int | None
    player_of_match: bool


class GradesUpsert(BaseModel):
    grades: list[GradeIn]


class PositionUpdate(BaseModel):
    position: str


class PlayerImageIn(BaseModel):
    # "data:image/png;base64,...." - so liefert der Browser das im Canvas
    # verkleinerte Bild.
    data_url: str


class AuthStatus(BaseModel):
    # Ob dieses Backend fuer Aenderungen ein Passwort verlangt. Lokal zuhause
    # ist das aus, in der oeffentlich erreichbaren Fassung an.
    passwort_noetig: bool
