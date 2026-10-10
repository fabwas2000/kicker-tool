"""Offizielle Spieltagsdaten aus dem kicker-Managerspiel Interactive.

Das Managerspiel auf kicker.de ist eine eingebettete App von kicker-libero.de
und holt seine Daten als JSON von dort. Anders als kicker.de selbst sitzt
diese Schnittstelle NICHT hinter dem Bot-Schutz (DataDome) und braucht fuer
Spieltagsdaten kein Login - ein schlichter Abruf genuegt.

Gebraucht werden zwei Adressen:
  * /api/gameloop/v1/state/round/{runde}.json
        je Spiel und Spieler: Status, Note, Tore, Vorlagen und die
        Einzelpunkte, so wie kicker sie wertet
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
"""

import json
import time
import urllib.error
import urllib.request
from datetime import date

BASIS = "https://www.kicker-libero.de"
POSITION = {"GOALKEEPER": "G", "DEFENDER": "D", "MIDFIELDER": "M", "FORWARD": "F"}

# Stammdaten je Saison: (abgerufen_um, {spieler_id: spieler}, {verein_id: name},
# {spiel_id: spiel})
_cache: dict[str, tuple[float, dict, dict, dict]] = {}
CACHE_SEKUNDEN = 6 * 60 * 60


class KickerFehler(Exception):
    pass


def saison_jahr(heute: date | None = None) -> int:
    """Die Saison 2026/27 heisst bei kicker se-k00012026 - ab Juli gilt das neue Jahr."""
    heute = heute or date.today()
    return heute.year if heute.month >= 7 else heute.year - 1


def _json(pfad: str) -> dict:
    anfrage = urllib.request.Request(
        BASIS + pfad, headers={"User-Agent": "kicker-tool", "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(anfrage, timeout=20) as antwort:
            return json.load(antwort)
    except urllib.error.HTTPError as err:
        raise KickerFehler(f"kicker antwortet mit {err.code} auf {pfad}") from err
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


def _karte(punkte: int | None) -> str | None:
    if not punkte or punkte >= 0:
        return None
    return "rot" if punkte <= -6 else "gelbrot"


def spieltag(matchday: int) -> dict:
    jahr = saison_jahr()
    saison = f"se-k0001{jahr}"
    runde = f"rn-k0001{jahr}{matchday:04d}"
    spieler_db, vereine, spielplan = _stammdaten(saison)
    try:
        stand = _json(f"/api/gameloop/v1/state/round/{runde}.json")
    except KickerFehler:
        # Runde gibt es (noch) nicht - "nichts da" statt eines Fehlers.
        return {"matchday": matchday, "phase": None, "matches": []}

    spiele = []
    for spiel in stand.get("matches", []):
        eintraege = []
        for p in spiel.get("players", []):
            b = p.get("pointsBreakDown") or {}
            info = spieler_db.get(p["id"], {})
            starter = p.get("status") == "STARTER"
            joker = (b.get("pointsJoker") or 0) > 0
            note = b.get("grade")
            eintraege.append(
                {
                    "name": info.get("displayLongName") or p["id"],
                    "first_name": info.get("firstName") or "",
                    "last_name": info.get("lastName") or info.get("displayName") or "",
                    "team": vereine.get(info.get("teamId"), ""),
                    "team_id": info.get("teamId") or "",
                    "position": POSITION.get(info.get("position")),
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
