# ESPN Bundesliga API – Recherche-Notizen

Diese Datei dokumentiert die tatsächlich beobachteten JSON-Strukturen der
versteckten ESPN-API, wie sie am 2026-09-10 per `curl` abgefragt wurden.
Basis für die gesamte Live-Logik im Frontend (`frontend/js/espn.js`).

Es gibt **keinen API-Key**, kein Rate-Limit-Header wurde beobachtet. Alle
Aufrufe erfolgen direkt aus dem Browser (CORS ist offen).

## 1. Teams der Liga

```
GET https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1/teams
```

Struktur (gekürzt):

```
{
  "sports": [{
    "leagues": [{
      "teams": [
        { "team": {
            "id": "598",
            "displayName": "1. FC Union Berlin",
            "abbreviation": "FCU",
            "color": "DA0308",
            "logos": [{ "href": "https://a.espncdn.com/i/teamlogos/soccer/500/598.png" }]
        }},
        ... 18 Teams total
      ]
    }]
  }]
}
```

Pfad zu den Teams: `sports[0].leagues[0].teams[].team`.

**⚠️ CORS-Falle (per curl verifiziert, per echtem Browser-Fetch bestätigt):**
Dieser Endpoint liefert serverseitig 200 OK, aber **keinen**
`Access-Control-Allow-Origin`-Header. Ein `fetch()` aus dem Browser schlägt
deshalb mit "blocked by CORS policy" fehl, obwohl curl/Server-zu-Server
Aufrufe klaglos funktionieren. `/scoreboard`, `/summary` und
`/teams/{id}/roster` senden dagegen alle `Access-Control-Allow-Origin: *`
und funktionieren aus dem Browser einwandfrei.

Da das Frontend laut Architektur-Vorgabe NIE über das Backend proxyen darf,
wird die Liste der 18 Vereine deshalb **nicht** über `/teams` geladen,
sondern aus einem großzügigen `/scoreboard`-Zeitfenster (±60 Tage um heute)
abgeleitet: jeder Verein spielt pro Spieltag einmal, taucht also in den
`competitions[0].competitors[].team`-Objekten der Scoreboard-Events auf.
Siehe `frontend/js/espn.js#fetchTeams`.

## 2. Kader eines Teams (für die Spielerauswahl beim Kaderbau)

```
GET https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1/teams/{teamId}/roster
```

Relevante Felder unter `athletes[]`:

```
{
  "id": "216225",
  "displayName": "Maximilian Mittelstädt",
  "jersey": "7",
  "position": { "abbreviation": "D", "displayName": "Defender" }
}
```

`position.abbreviation` ist eine von `G` (Torwart), `D` (Abwehr), `M` (Mittelfeld),
`F` (Sturm) – nutzbar zum Filtern in der Spielersuche.

**⚠️ Für die Wertung ist ESPN hier NICHT maßgeblich.** Die Torpunkte hängen von
der Position ab, und die beiden Quellen widersprechen sich: Michael Olise ist
bei ESPN `M`, bei kicker Stürmer; Alessio Castro-Montes ist bei ESPN `M`, bei
kicker Abwehr. Maßgeblich ist kicker – siehe
`backend/import_kicker_positionen.py`. ESPNs Wert dient nur als Rückfall für
Spieler, die kicker nicht listet.

kicker.de selbst ist weder per curl noch aus dem Browser nutzbar: Anfragen ohne
echten Browser-Fingerprint werden mit **HTTP 403** beantwortet (curl scheitert
auch mit gesetztem Browser-User-Agent, ein headless Chrome kommt durch), und
CORS-Header sendet kicker.de ebenfalls keine. Deshalb läuft der Abgleich als
lokales Skript über einen headless Chrome und nicht im Frontend.

## 2b. Spieltagsnummern gibt es bei ESPN NICHT

Für die Bundesliga liefert ESPN **keine** Spieltagsnummer - überprüft am
2026-09-10 in allen erreichbaren Endpoints:

| Versuch | Ergebnis |
| --- | --- |
| `scoreboard?week=3` | HTTP 200, aber `events: []` |
| `sports.core.api.espn.com/.../seasons/2026/types/1/weeks` | `count: 0` |
| `sports.core.api.espn.com/.../events/{id}` | kein `week`/`round`/`matchday` |
| `teams/{id}/schedule` | kein `week`/`round`/`matchday` |
| `scoreboard` → `leagues[].calendar` | leeres Array |

Der Spieltags-Index wird deshalb aus dem Spielplan **rekonstruiert**
(`frontend/js/matchdays.js`):

1. Saison monatsweise über `scoreboard?dates=YYYYMM01-YYYYMMxx` abfragen.
   **Wichtig:** Das Scoreboard deckelt bei **100 Events pro Anfrage** - ein
   Zeitraum über mehrere Monate liefert stillschweigend zu wenig Spiele.
   Monatsweise (12 Requests) kommen alle 306 Saisonspiele zusammen.
2. Alle Spiele chronologisch sortieren und in Blöcke zu 9 gruppieren.
3. Gegenprobe: In jedem Block müssen genau 18 verschiedene Mannschaften
   stehen, weil jedes Team pro Spieltag genau einmal spielt.

Für die Saison 2026/27 verifiziert: 306 Spiele → **34 saubere Blöcke**, kein
einziger unsauber. Das Ergebnis wird 12 Stunden in `localStorage` gecacht.

## 3. Scoreboard (Spieltag / laufende Spiele)

```
GET https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1/scoreboard
GET https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1/scoreboard?dates=YYYYMMDD-YYYYMMDD
```

Ohne `dates`-Parameter liefert ESPN nur ein sehr enges "aktueller Tag"-Fenster
(oft nur 1 Spiel). Für einen kompletten Spieltag (Fr–Mo) muss ein Datumsbereich
übergeben werden, z.B. `dates=20260904-20260907`.

Struktur (gekürzt):

```
{
  "events": [
    {
      "id": "401884808",
      "date": "2026-09-04T18:30Z",
      "shortName": "KOE @ VFB",
      "status": { "type": { "name": "STATUS_SCHEDULED|STATUS_IN_PROGRESS|STATUS_FULL_TIME", "state": "pre|in|post", "completed": bool } },
      "competitions": [{
        "competitors": [
          { "id": "134", "homeAway": "home", "score": "4", "team": { "id": "134", "displayName": "VfB Stuttgart" } },
          { "id": "122", "homeAway": "away", "score": "1", "team": { "id": "122", "displayName": "FC Cologne" } }
        ],
        "details": [ /* Tor-/Karten-Ereignisse, siehe unten – OHNE Vorlagen */ ]
      }]
    }
  ]
}
```

`competitions[0].details[]` enthält Tore/Karten, aber je Tor **nur den
Torschützen** (`athletesInvolved: [ { id, displayName, position } ]`), keine
Vorlage. Für Vorlagen wird pro Spiel der Summary-Endpoint gebraucht (siehe 4).
`details[].ownGoal` markiert Eigentore explizit (`true`/`false`).

Der Scoreboard-Call wird genutzt, um pro Live-Poll die **Liste der Event-IDs**
des beobachteten Spieltags zu bekommen (per Datumsbereich), plus grobem
Spielstatus (läuft / beendet).

## 4. Match-Summary (Tore + Vorlagen + reale Aufstellungen)

```
GET https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1/summary?event={eventId}
```

Das ist der wichtigste Endpoint für die Live-Wertung. Relevante Top-Level-Keys:
`keyEvents`, `rosters`.

### 4.1 `keyEvents[]` – Spielereignisse in chronologischer Reihenfolge

```
{
  "type": { "type": "goal" /* oder z.B. "goal---volley", "own-goal", "substitution", "yellow-card", "kickoff" ... */ },
  "scoringPlay": true,
  "team": { "id": "134", "displayName": "VfB Stuttgart" },
  "clock": { "displayValue": "39'" },
  "text": "Goal! Stuttgart 1, FC Cologne 0. Bilal El Khannouss ... Assisted by Josha Vagnoman.",
  "participants": [
    { "athlete": { "id": "336595", "displayName": "Bilal El Khannouss" } },
    { "athlete": { "id": "266839", "displayName": "Josha Vagnoman" } }
  ]
}
```

Beobachtete Regeln (durch Abgleich mit dem `text`-Feld verifiziert):

- **Tor** (`scoringPlay: true`, `type.type` beginnt mit `goal`, z.B. auch
  `goal---volley`, `goal---header`, `goal---free-kick`): `participants[0]` ist
  immer der Torschütze, `participants[1]` (falls vorhanden) ist der
  Vorlagengeber.
- **Eigentor**: `type.type === "own-goal"` (`type.text === "Own Goal"`).
  Zählt in v1 NICHT als Tor für einen Spieler (siehe `frontend/js/scoring.js`).
  Die zuverlässigste Erkennung eines "zählenden" Tor-Events ist deshalb
  `scoringPlay === true && type.type !== "own-goal"` statt eines Textvergleichs
  auf `"goal"`, da Varianten wie `goal---volley`/`goal---header`/`goal---free-kick`
  sonst durchs Raster fallen würden.
- **Auswechslung** (`type.type === "substitution"`): `participants[0]` ist der
  eingewechselte Spieler, `participants[1]` der ausgewechselte Spieler.

### 4.2 `rosters[]` – reale Aufstellungen inkl. Ein-/Auswechslungen

```
{
  "homeAway": "home",
  "team": { "id": "134", "displayName": "VfB Stuttgart" },
  "formation": "3-4-2-1",
  "roster": [
    {
      "athlete": { "id": "201123", "displayName": "Fabian Bredlow" },
      "starter": true,
      "subbedIn": false,
      "subbedOut": false,
      "position": { "abbreviation": "G", "displayName": "Goalkeeper" },
      "stats": [
        { "name": "totalGoals", "value": 0.0 },
        { "name": "goalAssists", "value": 0.0 },
        ...
      ]
    }
  ]
}
```

`roster[].stats` enthält bereits aggregierte Werte pro Spieler für dieses eine
Spiel. Verfügbar sind: `appearances`, `totalGoals`, `goalAssists`, `ownGoals`,
`yellowCards`, `redCards`, `subIns`, `goalsConceded`, `saves`, `shotsFaced`,
`shotsOnTarget`, `totalShots`, `foulsCommitted`, `foulsSuffered`, `offsides`.
Eine **Minutenangabe gibt es nicht** - nur `appearances` (1/0). Wer wie lange
gespielt hat, ließe sich nur über die Minuten der `substitution`-keyEvents
herleiten.

Einsatzstatus (genutzt für Wertung und Noten-Maske):

| Fall | Erkennung |
| --- | --- |
| Startelf | `starter: true` |
| eingewechselt | `subbedIn: true` |
| auf der Bank geblieben | im `roster`, aber weder `starter` noch `subbedIn` |
| gar nicht im Spieltagskader | **fehlt komplett im `roster`** (ESPN listet nur ~20 Spieler) |

Beispiel VfB Stuttgart, Spiel 401884808: Kader 20, Startelf 11,
eingewechselt 5, nicht eingesetzt 4.

Fürs Ereignis-Protokoll ("wer hat wann was gemacht") wird zusätzlich
`keyEvents` ausgewertet, weil dort Minute und Text stehen.

## Debugging-Hinweis: headless Chrome wird von ESPN anders behandelt

Beim Testen dieser App mit `--headless=new` (Standard-User-Agent enthält
"HeadlessChrome") lieferte ESPN teils **keine** CORS-Header aus und der
Request schlug im Browser mit "blocked by CORS policy" fehl - obwohl curl
und ein normaler Chrome-Desktop-Browser (bzw. `--headless=new` mit
untergeschobenem Desktop-User-Agent) dieselbe URL klaglos mit korrekten
CORS-Headern beantworten. Vermutlich Bot-Mitigation auf ESPNs Edge/CDN, die
auf den Automations-User-Agent anspringt. Für echte Nutzer:innen in einem
normalen Browser ist das nicht relevant - nur beim automatisierten Testen
mit headless Browsern beachten.

## Zusammenfassung für die Live-Ansicht

1. Scoreboard mit Datumsbereich des aktuellen Spieltags abfragen → Liste der
   `eventId`s.
2. Für jede `eventId` den Summary-Endpoint abfragen → `keyEvents` auswerten.
3. Jedes Tor-Event einem ESPN-Spieler (`athlete.id`) zuordnen, ebenso die
   Vorlage (falls vorhanden).
4. Für jeden Konkurrenten wird geprüft, ob der torschützende / vorlagen­gebende
   Spieler in dessen gespeicherter Startaufstellung für den gewählten
   Spieltag steht. Falls ja: Punkte laut `frontend/js/scoring.js` gutschreiben.
5. Alle 30 Sekunden wiederholen (Polling), Tabelle neu rendern.
