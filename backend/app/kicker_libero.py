"""Offizielle Daten aus dem kicker-Managerspiel Interactive.

Das Managerspiel auf kicker.de ist eine eingebettete App von kicker-libero.de
und holt seine Daten als JSON von dort. Anders als kicker.de selbst sitzt
diese Schnittstelle NICHT hinter dem Bot-Schutz (DataDome) und braucht fuer
Spieltagsdaten und fremde Aufstellungen kein Login - ein schlichter Abruf
genuegt.

Gebraucht werden diese Adressen:
  * /api/gameloop/v1/state/round/{runde}.json
        je Spiel und Spieler: Status, Note, Tore, Vorlagen und die
        Einzelpunkte, so wie kicker sie wertet
  * /api/ranking/v1/round-ranking/{saison}/{runde}/group/{liga}.json
        Tabelle einer privaten Liga - die einzige offene Quelle fuer ihre
        Mitglieder. Gibt es erst, wenn die Runde fertig gewertet ist (sonst
        404 "Ranking for this round is not final").
  * /api/gameloop/v1/opponent-lineup-informer/{saison}/{runde}/{nutzer}.json
        der 22er-Kader eines Mitspielers fuer eine Runde; 404, solange es fuer
        die Runde nichts gibt
  * /api/sportsdata/v1/client_database/{saison}.json
        Namen, Vereine und Positionen aller Spieler (gut 700 KB, deshalb
        zwischengespeichert)

Eigenheiten der Daten (am abgeschlossenen 4. Spieltag 2026/27 geprueft):
  * Noten sind mit 100 malgenommen: 250 = Note 2,5.
  * Status STARTER = Startelf. Eingewechselte stehen als BENCH, erkennbar an
    pointsJoker > 0. BENCH ohne Jokerpunkte hat nicht gespielt.
  * Note 0 bei einem Eingesetzten = gespielt, aber keine Note bekommen.
  * Ist ein Spiel beendet, aber noch nicht ausgewertet, stehen Note und alle
    Punkte noch auf null - die Noten kommen erst spaeter.
  * Im Kader eines Mitspielers sind die ersten elf die Startelf, in der
    Reihenfolge der Formation (TW, Abwehr, Mittelfeld, Sturm). Die Formation
    heisst "1433" fuer 4-3-3 - die fuehrende 1 ist der Torwart.
"""

import json
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date

BASIS = "https://www.kicker-libero.de"
POSITION = {"GOALKEEPER": "G", "DEFENDER": "D", "MIDFIELDER": "M", "FORWARD": "F"}

# Stammdaten je Saison: (abgerufen_um, {spieler_id: spieler}, {verein_id: name},
# {spiel_id: spiel})
_cache: dict[str, tuple[float, dict, dict, dict]] = {}
CACHE_SEKUNDEN = 6 * 60 * 60


class KickerFehler(Exception):
    def __init__(self, text: str, status: int | None = None):
        super().__init__(text)
        self.status = status


def saison_jahr(heute: date | None = None) -> int:
    """Die Saison 2026/27 heisst bei kicker se-k00012026 - ab Juli gilt das neue Jahr."""
    heute = heute or date.today()
    return heute.year if heute.month >= 7 else heute.year - 1


def _ids(matchday: int) -> tuple[str, str]:
    jahr = saison_jahr()
    return f"se-k0001{jahr}", f"rn-k0001{jahr}{matchday:04d}"


def _json(pfad: str) -> dict:
    anfrage = urllib.request.Request(
        BASIS + pfad, headers={"User-Agent": "kicker-tool", "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(anfrage, timeout=20) as antwort:
            return json.load(antwort)
    except urllib.error.HTTPError as err:
        raise KickerFehler(f"kicker antwortet mit {err.code} auf {pfad}", err.code) from err
    except (urllib.error.URLError, TimeoutError) as err:
        raise KickerFehler(f"kicker nicht erreichbar: {err}") from err


def _stammdaten(saison: str) -> tuple[dict, dict, dict]:
    eintrag = _cache.get(saison)
    if eintrag and time.time() - eintrag[0] < CACHE_SEKUNDEN:
        return eintrag[1:]
    daten = _json(f"/api/sportsdata/v1/client_database/{saison}.json")
    spieler = {p["id"]: p for p in daten.get("players", [])}
    vereine = {t["id"]: t["name"] for t in daten.get("teams", [])}
    spiele = {m["id"]: m for m in daten.get("matches", [])}
    _cache[saison] = (time.time(), spieler, vereine, spiele)
    return spieler, vereine, spiele


def _fehlende_nachladen(ids: set[str], saison: str, spieler_db: dict) -> None:
    """Spieler, die nicht (mehr) in der Spielerdatenbank stehen - etwa nach
    einem Wechsel ins Ausland, waehrend sie noch in einem Kader stecken -
    einzeln nachfragen. Landen im selben Zwischenspeicher."""
    fehlend = [i for i in ids if i not in spieler_db]

    def eines(spieler_id: str) -> None:
        try:
            info = _json(f"/api/sportsdata/v1/player-detail/{saison}/{spieler_id}.json")
            spieler_db[spieler_id] = info | {"_nachgeladen": True}
        except KickerFehler:
            pass

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(eines, fehlend))


def _spieler(spieler_id: str, spieler_db: dict, vereine: dict) -> dict:
    """Name, Verein und Position - die Grundlage fuer die Zuordnung zu ESPN."""
    info = spieler_db.get(spieler_id, {})
    return {
        "name": info.get("displayLongName") or spieler_id,
        "first_name": info.get("firstName") or "",
        "last_name": info.get("lastName") or info.get("displayName") or "",
        "team": vereine.get(info.get("teamId"), ""),
        "team_id": info.get("teamId") or "",
        "position": POSITION.get(info.get("position")),
        # Nicht in kickers aktueller Bundesliga-Liste - meist ein Spieler, der
        # die Liga verlassen hat; ESPN kennt ihn dann auch nicht mehr.
        "departed": bool(info.get("_nachgeladen")),
    }


def _karte(punkte: int | None) -> str | None:
    if not punkte or punkte >= 0:
        return None
    return "rot" if punkte <= -6 else "gelbrot"


def spieltag(matchday: int) -> dict:
    saison, runde = _ids(matchday)
    spieler_db, vereine, spielplan = _stammdaten(saison)
    try:
        stand = _json(f"/api/gameloop/v1/state/round/{runde}.json")
    except KickerFehler:
        # Runde gibt es (noch) nicht - "nichts da" statt eines Fehlers.
        return {"matchday": matchday, "phase": None, "matches": []}

    _fehlende_nachladen(
        {p["id"] for spiel in stand.get("matches", []) for p in spiel.get("players", [])},
        saison,
        spieler_db,
    )
    spiele = []
    for spiel in stand.get("matches", []):
        eintraege = []
        for p in spiel.get("players", []):
            b = p.get("pointsBreakDown") or {}
            starter = p.get("status") == "STARTER"
            joker = (b.get("pointsJoker") or 0) > 0
            note = b.get("grade")
            eintraege.append(
                _spieler(p["id"], spieler_db, vereine)
                | {
                    "played": starter or joker,
                    "starter": starter,
                    # None = noch nicht bewertet, 0 = gespielt ohne Note
                    "grade": None if note in (None, 0) else note / 100,
                    "no_grade": note == 0 and (starter or joker),
                    "goals": b.get("goals"),
                    "assists": b.get("assists"),
                    "player_of_match": (b.get("pointsMvp") or 0) > 0,
                    "card": _karte(b.get("pointsCards")),
                    "points": p.get("points"),
                }
            )
        # "Bewertet" heisst: mindestens ein Startelfspieler hat eine Note
        # (oder bewusst keine). Vorher ist das Spiel fuer den Import tabu.
        bewertet = any(e["starter"] and (e["grade"] is not None or e["no_grade"]) for e in eintraege)
        plan = spielplan.get(spiel.get("id"), {})
        spiele.append(
            {
                "state": spiel.get("state"),
                "home": vereine.get(plan.get("homeTeamId"), ""),
                "guest": vereine.get(plan.get("guestTeamId"), ""),
                "home_score": spiel.get("homeScore"),
                "guest_score": spiel.get("guestScore"),
                "graded": bewertet,
                "players": eintraege,
            }
        )
    return {"matchday": matchday, "phase": stand.get("phase"), "matches": spiele}


# ---------------------------------------------------------------------------
# Aufstellungen der Mitspieler einer privaten Liga
# ---------------------------------------------------------------------------

LIGA_ID = re.compile(r"[0-9a-f]{24}")
# Im Liga-Link steht die Liga-ID direkt hinter der Runde:
#   .../managerspiel/interactive/se-.../group/round/rn-.../<liga>[/user-details/...]
LIGA_IM_LINK = re.compile(r"/group/round/[^/]+/([0-9a-f]{24})")

_mitglieder_cache: dict[str, tuple[float, list[dict]]] = {}


def liga_id_aus(text: str) -> str | None:
    """Liga-ID aus einem kopierten Link (oder schon die nackte ID)."""
    text = (text or "").strip()
    treffer = LIGA_IM_LINK.search(text)
    if treffer:
        return treffer.group(1)
    return text if LIGA_ID.fullmatch(text) else None


def _mitglieder(liga: str, saison: str) -> list[dict]:
    """Mitglieder aus der Tabelle der juengsten fertig gewerteten Runde -
    gesucht ab der laufenden Runde rueckwaerts."""
    eintrag = _mitglieder_cache.get(liga)
    if eintrag and time.time() - eintrag[0] < CACHE_SEKUNDEN:
        return eintrag[1]
    jahr = saison[-4:]
    laufend = _json(f"/api/gameloop/v1/state/current/{saison}.json").get("roundId") or ""
    start = int(laufend[-4:]) if laufend[-4:].isdigit() else 34
    for spieltag_nr in range(start, 0, -1):
        runde = f"rn-k0001{jahr}{spieltag_nr:04d}"
        try:
            tabelle = _json(f"/api/ranking/v1/round-ranking/{saison}/{runde}/group/{liga}.json")
        except KickerFehler as err:
            if err.status == 404:
                continue
            raise
        mitglieder = [{"user_id": e["userId"], "name": e["name"]} for e in tabelle.get("entries", [])]
        if mitglieder:
            _mitglieder_cache[liga] = (time.time(), mitglieder)
            return mitglieder
    raise KickerFehler(
        "Die Mitglieder der Liga sind erst abrufbar, wenn kicker einen Spieltag fertig gewertet hat."
    )


def _formation(formation_id: str | None) -> str | None:
    """"1433" -> "4-3-3"."""
    if not formation_id or len(formation_id) != 4:
        return None
    return "-".join(formation_id[1:])


def aufstellungen(matchday: int, liga: str) -> dict:
    saison, runde = _ids(matchday)
    spieler_db, vereine, _ = _stammdaten(saison)
    mitglieder = _mitglieder(liga, saison)

    def abrufen(mitglied: dict) -> dict | str | None:
        """Roh-Kader des Mitglieds, None wenn es keinen gibt, Text bei Fehler."""
        try:
            daten = _json(
                f"/api/gameloop/v1/opponent-lineup-informer/{saison}/{runde}/{mitglied['user_id']}.json"
            )
        except KickerFehler as err:
            return None if err.status == 404 else str(err)
        kader = daten.get("opponentRoundResult") or {}
        if kader.get("roundId") != runde or not kader.get("players"):
            return None
        return kader

    with ThreadPoolExecutor(max_workers=6) as pool:
        roh = list(pool.map(abrufen, mitglieder))
    _fehlende_nachladen(
        {p["id"] for k in roh if isinstance(k, dict) for p in k["players"]}, saison, spieler_db
    )

    ergebnisse = []
    for mitglied, kader in zip(mitglieder, roh):
        ergebnis = {"user_id": mitglied["user_id"], "name": mitglied["name"], "found": False}
        if isinstance(kader, str):
            ergebnis["error"] = kader
        elif kader:
            ergebnis |= {
                "found": True,
                "phase": kader.get("phase"),
                "formation": _formation(kader.get("formationId")),
                "players": [
                    _spieler(p["id"], spieler_db, vereine) | {"starter": i < 11}
                    for i, p in enumerate(kader["players"])
                ],
            }
        ergebnisse.append(ergebnis)
    return {"matchday": matchday, "members": ergebnisse}
