import base64
import binascii
import hmac
import json
import os
import re

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import models, positions, schemas, scoring_defaults
from .database import Base, engine, get_db

# Reicht dick fuer ein freigestelltes Portrait; verhindert, dass versehentlich
# ein 10-MB-Foto in der Datenbank landet.
MAX_IMAGE_BYTES = 400 * 1024

# ----------------------------------------------------------------------
# Schreibschutz
# ----------------------------------------------------------------------
# Ansehen darf jeder, aendern nur mit Passwort. Das Passwort steht in der
# Umgebungsvariablen APP_PASSWORD.
#
# Ist sie NICHT gesetzt (lokaler Betrieb zuhause), bleibt alles offen wie
# bisher - so aendert sich am Arbeiten auf dem eigenen Rechner nichts.
PASSWORT_HEADER = "X-Kicker-Passwort"
SCHREIB_METHODEN = {"POST", "PUT", "PATCH", "DELETE"}
APP_PASSWORD = os.environ.get("APP_PASSWORD", "").strip()

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Kicker Tool Backend")


@app.middleware("http")
async def schreibschutz(request: Request, call_next):
    """Prueft bei aendernden Anfragen das Passwort.

    Bewusst als Middleware und nicht als Abhaengigkeit an jedem Endpunkt:
    so ist auch ein spaeter hinzugefuegter Schreib-Endpunkt automatisch
    geschuetzt, ohne dass jemand daran denken muss.

    OPTIONS bleibt frei - das ist die CORS-Vorabfrage des Browsers, die noch
    gar keine eigenen Kopfzeilen mitschicken kann.
    """
    if APP_PASSWORD and request.method in SCHREIB_METHODEN:
        mitgeschickt = request.headers.get(PASSWORT_HEADER, "")
        # compare_digest statt "==", damit die Antwortzeit nichts ueber das
        # richtige Passwort verraet.
        if not hmac.compare_digest(mitgeschickt, APP_PASSWORD):
            return JSONResponse(
                status_code=401,
                content={"detail": "Passwort fehlt oder ist falsch. Unter „Einstellungen“ eintragen."},
            )
    return await call_next(request)


cors_origins = os.environ.get("CORS_ORIGINS", "*")
allow_origins = ["*"] if cors_origins == "*" else [o.strip() for o in cors_origins.split(",")]

# NACH dem Schreibschutz hinzugefuegt und dadurch weiter aussen: nur so
# tragen auch die 401-Antworten die CORS-Kopfzeilen, sonst zeigt der Browser
# statt "Passwort falsch" einen nichtssagenden CORS-Fehler.
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/auth/status", response_model=schemas.AuthStatus)
def auth_status() -> schemas.AuthStatus:
    """Sagt dem Frontend, ob dieses Backend ueberhaupt ein Passwort verlangt."""
    return schemas.AuthStatus(passwort_noetig=bool(APP_PASSWORD))


@app.post("/api/auth/check")
def auth_check() -> dict:
    """Zum Testen des Passworts.

    Braucht keinen eigenen Code: POST ist eine Schreibmethode, die Middleware
    oben laesst die Anfrage nur mit richtigem Passwort ueberhaupt durch.
    """
    return {"ok": True}


def get_competitor_or_404(db: Session, competitor_id: int) -> models.Competitor:
    competitor = db.get(models.Competitor, competitor_id)
    if competitor is None:
        raise HTTPException(status_code=404, detail="Konkurrent nicht gefunden")
    return competitor


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Konkurrenten
# ---------------------------------------------------------------------------


def squad_sizes(db: Session, competitor_ids: list[int] | None = None) -> dict[int, int]:
    """Belegte Kaderplätze je Konkurrent - in einer Abfrage statt einer pro Kader."""
    query = select(
        models.SquadPlayer.competitor_id, func.count(models.SquadPlayer.id)
    ).group_by(models.SquadPlayer.competitor_id)
    if competitor_ids is not None:
        query = query.where(models.SquadPlayer.competitor_id.in_(competitor_ids))
    return {row[0]: row[1] for row in db.execute(query).all()}


def competitor_out(competitor: models.Competitor, size: int) -> schemas.CompetitorOut:
    return schemas.CompetitorOut(
        id=competitor.id,
        name=competitor.name,
        created_at=competitor.created_at,
        squad_size=size,
    )


@app.get("/api/competitors", response_model=list[schemas.CompetitorOut])
def list_competitors(db: Session = Depends(get_db)):
    competitors = db.scalars(select(models.Competitor).order_by(models.Competitor.name)).all()
    sizes = squad_sizes(db)
    return [competitor_out(c, sizes.get(c.id, 0)) for c in competitors]


@app.post("/api/competitors", response_model=schemas.CompetitorOut, status_code=201)
def create_competitor(payload: schemas.CompetitorCreate, db: Session = Depends(get_db)):
    existing = db.scalar(select(models.Competitor).where(models.Competitor.name == payload.name))
    if existing is not None:
        raise HTTPException(status_code=409, detail="Konkurrent existiert bereits")
    competitor = models.Competitor(name=payload.name)
    db.add(competitor)
    db.commit()
    db.refresh(competitor)
    return competitor


@app.patch("/api/competitors/{competitor_id}", response_model=schemas.CompetitorOut)
def rename_competitor(
    competitor_id: int, payload: schemas.CompetitorUpdate, db: Session = Depends(get_db)
):
    competitor = get_competitor_or_404(db, competitor_id)
    competitor.name = payload.name
    db.commit()
    db.refresh(competitor)
    return competitor_out(competitor, squad_sizes(db, [competitor.id]).get(competitor.id, 0))


@app.delete("/api/competitors/{competitor_id}", status_code=204)
def delete_competitor(competitor_id: int, db: Session = Depends(get_db)):
    competitor = get_competitor_or_404(db, competitor_id)
    db.delete(competitor)
    db.commit()


# ---------------------------------------------------------------------------
# Kader (22 Spieler pro Konkurrent)
# ---------------------------------------------------------------------------


@app.get("/api/competitors/{competitor_id}/squad", response_model=list[schemas.SquadPlayerOut])
def get_squad(competitor_id: int, db: Session = Depends(get_db)):
    get_competitor_or_404(db, competitor_id)
    return db.scalars(
        select(models.SquadPlayer).where(models.SquadPlayer.competitor_id == competitor_id)
    ).all()


@app.put("/api/competitors/{competitor_id}/squad", response_model=list[schemas.SquadPlayerOut])
def replace_squad(
    competitor_id: int, payload: schemas.SquadReplace, db: Session = Depends(get_db)
):
    get_competitor_or_404(db, competitor_id)

    player_ids = [p.espn_player_id for p in payload.players]
    if len(player_ids) != len(set(player_ids)):
        raise HTTPException(status_code=400, detail="Spieler doppelt im Kader")

    db.query(models.SquadPlayer).filter(
        models.SquadPlayer.competitor_id == competitor_id
    ).delete()

    squad_players = []
    for p in payload.players:
        values = p.model_dump()
        # kicker ist die Quelle fuer die Position, ESPN nur der Rueckfall.
        kicker_position = positions.lookup(db, values.get("name", ""))
        if kicker_position:
            values["position"] = kicker_position
        squad_players.append(models.SquadPlayer(competitor_id=competitor_id, **values))
    db.add_all(squad_players)
    db.commit()
    return db.scalars(
        select(models.SquadPlayer).where(models.SquadPlayer.competitor_id == competitor_id)
    ).all()


@app.get("/api/kicker-positions")
def list_kicker_positions(db: Session = Depends(get_db)):
    """Positionen aller Bundesliga-Spieler laut kicker, als
    {normalisierter Name: G|D|M|F}. Das Frontend braucht das für Spieler
    ausserhalb der eigenen Kader - ESPN liefert für Eingewechselte nur "SUB"
    statt einer echten Position. Mehrdeutige Namen fallen raus.
    Befüllt durch import_kicker_positionen.py."""
    rows = db.execute(
        select(models.KickerPosition.name_key, models.KickerPosition.position)
    ).all()
    positionen: dict[str, str | None] = {}
    for name_key, position in rows:
        if name_key in positionen and positionen[name_key] != position:
            positionen[name_key] = None  # zwei gleichnamige Spieler, uneindeutig
        else:
            positionen.setdefault(name_key, position)
    return {k: v for k, v in positionen.items() if v}


@app.patch("/api/squad-players/{espn_player_id}/position")
def set_player_position(
    espn_player_id: str, payload: schemas.PositionUpdate, db: Session = Depends(get_db)
):
    """Position von Hand setzen - fuer Spieler, die kicker gar nicht listet
    (z.B. Nachwuchsspieler) oder wenn man anderer Meinung ist. Gilt fuer alle
    Konkurrenten, in deren Kader der Spieler steht."""
    if payload.position not in positions.VALID_POSITIONS:
        raise HTTPException(status_code=400, detail="Position muss G, D, M oder F sein")

    rows = db.scalars(
        select(models.SquadPlayer).where(models.SquadPlayer.espn_player_id == espn_player_id)
    ).all()
    if not rows:
        raise HTTPException(status_code=404, detail="Spieler in keinem Kader")
    for row in rows:
        row.position = payload.position
    db.commit()
    return {"espn_player_id": espn_player_id, "position": payload.position, "updated": len(rows)}


# ---------------------------------------------------------------------------
# Aufstellung pro Spieltag
# ---------------------------------------------------------------------------


def _lineup_to_out(lineup: models.Lineup) -> schemas.LineupOut:
    return schemas.LineupOut(
        matchday=lineup.matchday,
        formation=lineup.formation,
        players=[
            schemas.LineupPlayerOut(slot=p.slot, espn_player_id=p.espn_player_id)
            for p in lineup.players
        ],
    )


@app.get("/api/competitors/{competitor_id}/lineups", response_model=list[schemas.LineupOut])
def list_lineups(competitor_id: int, db: Session = Depends(get_db)):
    """Alle gespeicherten Aufstellungen eines Konkurrenten. Das Frontend
    braucht das, um beim Aufstellen eines neuen Spieltags die letzte
    vorhandene Aufstellung anbieten zu können."""
    get_competitor_or_404(db, competitor_id)
    lineups = db.scalars(
        select(models.Lineup)
        .where(models.Lineup.competitor_id == competitor_id)
        .order_by(models.Lineup.matchday)
    ).all()
    return [_lineup_to_out(lineup) for lineup in lineups]


@app.get("/api/competitors/{competitor_id}/lineups/{matchday}", response_model=schemas.LineupOut | None)
def get_lineup(competitor_id: int, matchday: int, db: Session = Depends(get_db)):
    get_competitor_or_404(db, competitor_id)
    lineup = db.scalar(
        select(models.Lineup).where(
            models.Lineup.competitor_id == competitor_id, models.Lineup.matchday == matchday
        )
    )
    if lineup is None:
        return None
    return _lineup_to_out(lineup)


@app.put("/api/competitors/{competitor_id}/lineups/{matchday}", response_model=schemas.LineupOut)
def upsert_lineup(
    competitor_id: int, matchday: int, payload: schemas.LineupUpsert, db: Session = Depends(get_db)
):
    get_competitor_or_404(db, competitor_id)

    slots = [p.slot for p in payload.players]
    if len(slots) != len(set(slots)):
        raise HTTPException(status_code=400, detail="Position doppelt belegt")
    player_ids = [p.espn_player_id for p in payload.players]
    if len(player_ids) != len(set(player_ids)):
        raise HTTPException(status_code=400, detail="Spieler doppelt aufgestellt")

    squad_ids = {
        row
        for row in db.scalars(
            select(models.SquadPlayer.espn_player_id).where(
                models.SquadPlayer.competitor_id == competitor_id
            )
        )
    }
    unknown = set(player_ids) - squad_ids
    if unknown:
        raise HTTPException(
            status_code=400, detail=f"Spieler nicht im Kader: {', '.join(sorted(unknown))}"
        )

    lineup = db.scalar(
        select(models.Lineup).where(
            models.Lineup.competitor_id == competitor_id, models.Lineup.matchday == matchday
        )
    )
    if lineup is None:
        lineup = models.Lineup(competitor_id=competitor_id, matchday=matchday, formation=payload.formation)
        db.add(lineup)
    else:
        lineup.formation = payload.formation
        lineup.players.clear()

    db.flush()
    lineup.players = [
        models.LineupPlayer(lineup_id=lineup.id, slot=p.slot, espn_player_id=p.espn_player_id)
        for p in payload.players
    ]
    db.commit()
    db.refresh(lineup)
    return _lineup_to_out(lineup)


# ---------------------------------------------------------------------------
# kicker-Noten (manuell eingetragen, gelten global pro Spieltag)
# ---------------------------------------------------------------------------


@app.get("/api/grades/{matchday}", response_model=list[schemas.GradeOut])
def get_grades(matchday: int, db: Session = Depends(get_db)):
    return db.scalars(
        select(models.PlayerGrade).where(models.PlayerGrade.matchday == matchday)
    ).all()


@app.put("/api/grades/{matchday}", response_model=list[schemas.GradeOut])
def upsert_grades(matchday: int, payload: schemas.GradesUpsert, db: Session = Depends(get_db)):
    """Teil-Update: nur die übergebenen Spieler werden angefasst, alle nicht
    genannten bleiben unverändert. Ist bei einem Spieler nichts mehr gesetzt
    (keine Note, keine Korrektur, kein Spieler des Spiels), wird seine Zeile
    gelöscht statt leer stehen zu lassen."""
    existing = {
        g.espn_player_id: g
        for g in db.scalars(
            select(models.PlayerGrade).where(models.PlayerGrade.matchday == matchday)
        ).all()
    }

    for entry in payload.grades:
        current = existing.get(entry.espn_player_id)
        is_empty = (
            entry.grade is None
            and not entry.no_grade
            and entry.goals is None
            and entry.assists is None
            and not entry.player_of_match
        )

        if is_empty:
            if current is not None:
                db.delete(current)
            continue

        if current is None:
            current = models.PlayerGrade(
                matchday=matchday, espn_player_id=entry.espn_player_id
            )
            db.add(current)
        # no_grade und grade schließen sich aus - no_grade gewinnt, falls
        # aus Versehen beides ankommt.
        current.no_grade = entry.no_grade
        current.grade = None if entry.no_grade else entry.grade
        current.goals = entry.goals
        current.assists = entry.assists
        current.player_of_match = entry.player_of_match

    db.commit()
    return db.scalars(
        select(models.PlayerGrade).where(models.PlayerGrade.matchday == matchday)
    ).all()


# ---------------------------------------------------------------------------
# Spielerbilder
# ---------------------------------------------------------------------------


@app.get("/api/player-images")
def list_player_images(db: Session = Depends(get_db)):
    """Nur die IDs - damit das Frontend weiss, fuer wen es ein <img> setzen
    darf, ohne fuer jeden Spieler einen 404 zu provozieren."""
    rows = db.execute(
        select(models.PlayerImage.espn_player_id, models.PlayerImage.updated_at)
    ).all()
    return [{"espn_player_id": r[0], "updated_at": r[1].isoformat()} for r in rows]


@app.get("/api/players/{espn_player_id}/image")
def get_player_image(espn_player_id: str, db: Session = Depends(get_db)):
    image = db.get(models.PlayerImage, espn_player_id)
    if image is None:
        raise HTTPException(status_code=404, detail="Kein Bild hinterlegt")
    return Response(
        content=image.data,
        media_type=image.content_type,
        headers={
            "Cache-Control": "public, max-age=86400",
            "ETag": f'"{espn_player_id}-{int(image.updated_at.timestamp())}"',
        },
    )


@app.put("/api/players/{espn_player_id}/image")
def put_player_image(
    espn_player_id: str, payload: schemas.PlayerImageIn, db: Session = Depends(get_db)
):
    """Nimmt eine Data-URL entgegen (so liefert der Browser das skalierte
    Bild aus dem Canvas)."""
    match = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", payload.data_url, re.S)
    if not match:
        raise HTTPException(status_code=400, detail="Ungültige Bilddaten")
    content_type = match.group(1)
    try:
        raw = base64.b64decode(match.group(2))
    except (ValueError, binascii.Error):
        raise HTTPException(status_code=400, detail="Bild konnte nicht dekodiert werden")

    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413, detail=f"Bild zu groß (max. {MAX_IMAGE_BYTES // 1024} KB)"
        )

    image = db.get(models.PlayerImage, espn_player_id)
    if image is None:
        db.add(
            models.PlayerImage(
                espn_player_id=espn_player_id, content_type=content_type, data=raw
            )
        )
    else:
        image.content_type = content_type
        image.data = raw
    db.commit()
    return {"espn_player_id": espn_player_id, "bytes": len(raw)}


@app.delete("/api/players/{espn_player_id}/image", status_code=204)
def delete_player_image(espn_player_id: str, db: Session = Depends(get_db)):
    image = db.get(models.PlayerImage, espn_player_id)
    if image is not None:
        db.delete(image)
        db.commit()


# ---------------------------------------------------------------------------
# Wertungsregeln
# ---------------------------------------------------------------------------


@app.get("/api/scoring-rules")
def get_scoring_rules(db: Session = Depends(get_db)):
    row = db.get(models.Setting, scoring_defaults.SCORING_RULES_KEY)
    if row is None:
        return scoring_defaults.DEFAULT_SCORING_RULES
    try:
        return json.loads(row.value)
    except json.JSONDecodeError:
        return scoring_defaults.DEFAULT_SCORING_RULES


@app.put("/api/scoring-rules")
def save_scoring_rules(rules: dict, db: Session = Depends(get_db)):
    row = db.get(models.Setting, scoring_defaults.SCORING_RULES_KEY)
    value = json.dumps(rules)
    if row is None:
        db.add(models.Setting(key=scoring_defaults.SCORING_RULES_KEY, value=value))
    else:
        row.value = value
    db.commit()
    return rules


@app.delete("/api/scoring-rules")
def reset_scoring_rules(db: Session = Depends(get_db)):
    """Setzt auf die recherchierten kicker-Standardwerte zurück."""
    row = db.get(models.Setting, scoring_defaults.SCORING_RULES_KEY)
    if row is not None:
        db.delete(row)
        db.commit()
    return scoring_defaults.DEFAULT_SCORING_RULES


@app.get("/api/lineups/{matchday}", response_model=list[schemas.CompetitorLineupOut])
def get_all_lineups_for_matchday(matchday: int, db: Session = Depends(get_db)):
    """Batch endpoint for the live view: one call instead of one per competitor."""
    competitors = db.scalars(select(models.Competitor).order_by(models.Competitor.name)).all()
    lineups_by_competitor = {
        lineup.competitor_id: lineup
        for lineup in db.scalars(
            select(models.Lineup).where(models.Lineup.matchday == matchday)
        ).all()
    }
    result = []
    for competitor in competitors:
        lineup = lineups_by_competitor.get(competitor.id)
        result.append(
            schemas.CompetitorLineupOut(
                competitor_id=competitor.id,
                competitor_name=competitor.name,
                lineup=_lineup_to_out(lineup) if lineup else None,
            )
        )
    return result
