# Kicker Tool

Live-Tool für die kicker-Managerspiel-Liga: verfolgt, welche Konkurrenten
gerade Punkte machen, basierend auf echten Bundesliga-Live-Daten (Tore,
Vorlagen) von der versteckten ESPN-API.

- **Kader & Aufstellungen** (Konkurrenten, 22er-Kader, Startelf pro Spieltag)
  werden im eigenen Backend gespeichert.
- **Live-Daten** (Tore, Vorlagen) kommen **direkt aus dem Browser** von ESPN -
  das Backend ist daran nicht beteiligt. Die Live-Ansicht funktioniert daher
  auch, wenn das Backend gerade schläft (z.B. Render Free Tier).

Siehe [`docs/espn-api.md`](docs/espn-api.md) für die recherchierten
ESPN-JSON-Strukturen, inkl. einer wichtigen CORS-Falle beim `/teams`-Endpoint.

## Architektur

```
frontend/   statische SPA (HTML/CSS/Vanilla-JS, Tailwind über CDN, keine Build-Schritt)
backend/    FastAPI + SQLAlchemy, speichert NUR Konkurrenten/Kader/Aufstellungen
docs/       Recherche-Notizen zur ESPN-API
```

## Lokal starten

### Backend

Unter Windows am schnellsten: **`backend/start.bat` doppelklicken**. Das legt
beim ersten Mal die virtuelle Umgebung an, installiert die Abhängigkeiten und
startet den Server auf `http://127.0.0.1:8000`.

Manuell geht es so:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS/Linux
pip install -r requirements.txt
copy .env.example .env          # Windows; unter macOS/Linux: cp .env.example .env
uvicorn app.main:app --reload
```

Läuft standardmäßig auf `http://127.0.0.1:8000`. Die SQLite-Datei
`kicker_tool.db` wird beim ersten Start automatisch angelegt.

> **Hinweis:** Falls Port 8000 auf deinem Rechner bereits belegt ist, starte
> mit `uvicorn app.main:app --reload --port 8001` und passe die Backend-URL
> im Frontend unter "Einstellungen" entsprechend an.

### Frontend

Am einfachsten: **`frontend/index.html` per Doppelklick öffnen**. Das Frontend
nutzt bewusst klassische `<script>`-Tags statt ES-Modulen, damit das auch per
`file://` funktioniert - inklusive ESPN-Live-Daten und Backend-Zugriff.

Alternativ (z.B. um die GitHub-Pages-Situation lokal nachzustellen) reicht
jeder einfache Webserver:

```bash
cd frontend
python -m http.server 5500
```

Dann `http://127.0.0.1:5500` öffnen. Unter **Einstellungen** die Backend-URL
prüfen (Standard: `http://127.0.0.1:8000`); der Button *Verbindung testen*
sagt dir sofort, ob das Backend erreichbar ist.

> Falls du das Frontend später doch auf ES-Module umstellst: dann geht
> `file://` nicht mehr, weil Browser Modul-Importe von `file://` per CORS
> blockieren. Genau deshalb ist es hier bei klassischen Scripts geblieben.

## Deployment

### Frontend auf GitHub Pages

1. Repo-Einstellungen → Pages → "Deploy from a branch" → Branch `main`,
   Ordner `/frontend`.
2. Nach dem Deploy unter **Einstellungen** in der App die Produktions-
   Backend-URL (siehe unten) eintragen - wird in `localStorage` gemerkt.

### Backend auf Render

1. Neuen "Web Service" aus dem GitHub-Repo anlegen, Root-Verzeichnis `backend`.
2. Build Command: `pip install -r requirements.txt`
3. Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Umgebungsvariable `DATABASE_URL` setzen, sobald von SQLite auf Postgres
   (z.B. Render- oder Neon-Datenbank) umgestiegen wird, z.B.:
   `postgresql+psycopg2://user:pass@host/dbname`. Ohne diese Variable nutzt
   das Backend eine lokale SQLite-Datei - auf Render-Free-Instanzen geht der
   Inhalt bei jedem Neustart/Deploy verloren, für den Hobby-Gebrauch aber ok.
5. `CORS_ORIGINS` optional auf die GitHub-Pages-URL einschränken (Standard: `*`).
6. **`APP_PASSWORD` setzen** - sonst darf jeder, der die Adresse kennt, Daten
   ändern. Siehe nächster Abschnitt.

## Passwortschutz

Ansehen ist frei, **Ändern** braucht ein Passwort. Das gilt für alle
schreibenden Anfragen (Noten, Aufstellungen, Kader, Bilder, Punkte-Regeln).

- Backend: Umgebungsvariable **`APP_PASSWORD`** setzen.
  **Ist sie nicht gesetzt, ist alles offen** - genau so läuft es lokal
  zuhause weiter, ohne dass sich am Arbeiten etwas ändert.
- Frontend: das Passwort einmal je Gerät unter **Einstellungen → Passwort**
  eintragen. Es liegt danach im `localStorage` dieses Geräts und wird bei
  jeder ändernden Anfrage als Kopfzeile `X-Kicker-Passwort` mitgeschickt.
- `GET /api/auth/status` sagt, ob ein Backend überhaupt ein Passwort
  verlangt; `POST /api/auth/check` prüft das eingetragene.

Umgesetzt ist das als Middleware in `backend/app/main.py`, nicht als
Abhängigkeit an jedem einzelnen Endpunkt: so ist auch ein später ergänzter
Schreib-Endpunkt automatisch geschützt, ohne dass jemand daran denken muss.
Die Middleware wird **vor** der CORS-Middleware registriert und liegt dadurch
weiter innen - nur so tragen auch die 401-Antworten die CORS-Kopfzeilen, sonst
zeigt der Browser statt „Passwort falsch" einen nichtssagenden CORS-Fehler.

Das ist ein gemeinsames Passwort für alle, die ändern dürfen - keine
Benutzerverwaltung. Für ein Tool im Freundeskreis reicht das; wer es
weitergibt, kann alles ändern.

Render-Free-Instanzen schlafen nach Inaktivität ein und brauchen beim ersten
Aufruf ein paar Sekunden zum Aufwachen - deshalb laufen alle Live-Daten
bewusst NICHT über das Backend, sondern direkt im Browser gegen ESPN.

## Bildschirme

| Seite | Zweck |
| --- | --- |
| **Spieltag** | Spieltag 1–34 wählen. Zuerst nur die Rangliste der Konkurrenten mit Punktzahl; ein Klick auf eine Zeile klappt die Startelf auf dem Spielfeld auf (Formation wie gespeichert, mit Foto, Punkten, Toren, Vorlagen und Note je Spieler). Von dort öffnet der Knopf **„Aufstellung bearbeiten"** direkt den Editor für diesen Konkurrenten und Spieltag (siehe unten) – auch wenn noch gar keine Aufstellung existiert. **Ein Klick auf einen Spieler zeigt, wofür er seine Punkte bekommen hat** – Zeile für Zeile bis zur Summe. Vergangene Spieltage zeigen echte Ergebnisse, kommende alle Spieler auf 0 mit ihrem jeweiligen Gegner. **Läuft ein Spiel gerade**, zeigt die (auch eingeklappte) Kopfzeile jedes betroffenen Konkurrenten auf einen Blick, wie viele seiner Spieler **gerade aktiv auf dem Platz stehen** bzw. **noch auf der Bank sitzen**; auf dem Spielfeld selbst steht das je Spieler genauso (inkl. „ausgewechselt"). Die Punkte selbst laufen die ganze Zeit mit – Tore, Startelf/Einwechslung usw. fließen ein, sobald ESPN sie meldet, nicht erst nach Abpfiff. Ab 15 Minuten vor dem ersten Anstoß bis nach dem letzten Abpfiff aktualisiert sich die Seite alle 30 Sekunden von selbst – aufgeklappte Zeilen bleiben dabei offen. |
| **Noten** | Nach Abpfiff die kicker-Noten eintragen: Spieltag wählen, Mannschaft anklicken, alle eingesetzten Spieler erscheinen mit Eingabefeld. Jede Mannschaft zeigt zwei Zähler: wie viele Noten insgesamt schon eingetragen sind, und – wichtiger – wie viele **der bei einem Konkurrenten aufgestellten (★) Spieler** schon eine Note haben (z.B. „6/6 ★ benotet"). Dieselbe Zahl für den ganzen Spieltag steht oben in der Kopfzeile. Spieler, die bei einem Konkurrenten in der Aufstellung stehen, sind mit ★ markiert und stehen oben. Je Spieler lassen sich außerdem **Tore und Vorlagen korrigieren** (wenn kicker anders zählt als ESPN) und **„Spieler des Spiels"** ankreuzen. |
| **Kader** | 22er-Kader je Konkurrent aus echten Bundesliga-Spielern zusammenstellen. Über der Liste legt der Knopf **„Spieler hinzufügen"** einen neuen Konkurrenten an; jede Zeile hat zusätzlich „Umbenennen" und ✕ (löschen inkl. Kader/Aufstellungen). |
| **Einstellungen** | Backend-URL und die komplette Punkte-Tabelle. |

Einen eigenen Tab für Konkurrenten oder Aufstellungen gibt es bewusst nicht -
Konkurrenten anlegen/umbenennen/löschen passiert direkt auf der Kader-Seite,
und die Aufstellung eines Konkurrenten bearbeitet man direkt von der
Spieltag-Seite aus über „Aufstellung bearbeiten" (öffnet als Overlay).

## Gestaltung

Die Optik ist an kicker.de angelehnt, in der **dunklen Variante**. Die Werte
sind nicht geschätzt, sondern aus kickers eigenem Dark-Stylesheet
(`main-dark.min.css`) abgeleitet:

| Rolle | Wert | Verwendung |
| --- | --- | --- |
| Akzent (Schrift) | `#ff5c4d` | Punktespalte, aktiver Reiter, „live", Fehler |
| Akzent (Knopf) | `#c00` | gefüllte Knöpfe mit weißer Schrift |
| Kopfleiste | `#2a0606` | oberer Balken |
| Text | `#f3f3f3` / `#d4d4d5` / `#b4b4b4` | Haupttext bis Nebentext |
| Linien | `#3a3a3a` / `#7a7a7a` | Haarlinien / Rahmen von Eingabefeldern |
| Flächen | `#1a1a1a` / `#242424` / `#2e2e2e` | Seitenhintergrund, Panel, Hover |
| Positiv | `#4dbc3b` | Pluspunkte, „vollständig" |

**Warum zwei Rottöne?** kickers Marken-Rot `#c00` erreicht als Schrift auf
dunklem Grund nur 2,4:1 und wäre unlesbar. Ein Rot, das als Schrift hell genug
ist (`#ff5c4d`, 4,7:1), ist umgekehrt zu hell, um weiße Schrift darauf zu
tragen. Deshalb: helles Rot für Schrift, Marken-Rot für gefüllte Flächen.
kicker macht das in seinem Dark-Stylesheet genauso.

Grundregeln, die bei Änderungen erhalten bleiben sollten:

- **Eine Akzentfarbe.** Rot ist der einzige Farbakzent. Grün nur für „positiv",
  Gelb nur für „unvollständig/abweichend" - beides Statusfarben, keine
  Gestaltungsmittel.
- **Kaum Rundungen** (2-3px) und **keine Schatten** außer bei echten Overlays.
  Getrennt wird mit Haarlinien, nicht mit Kästen. Deshalb sind auch die großen
  Tailwind-Stufen (`rounded-xl` usw.) in der Konfiguration auf 3px gesetzt:
  ein übersehenes `rounded-lg` fällt so nicht aus dem System.
- **Schmale Grotesk**: Barlow Semi Condensed für Fließtext, Barlow Condensed
  für Überschriften. Die Originale von kicker (Ringside, Knockout) sind
  lizenzpflichtig, Barlow ist die nächste frei verfügbare Entsprechung.
- **Zahlen immer mit fester Ziffernbreite** (`tabular-nums`, global gesetzt) -
  sonst springen die Spalten bei jedem Live-Update.
- Kleine **Großbuchstaben-Beschriftungen** (`.kt-eyebrow`) über Tabellen und
  Abschnitten statt großer Zwischenüberschriften.

Die Bausteine `.kt-panel`, `.kt-row`, `.kt-input`, `.kt-btn`, `.kt-eyebrow`
stehen in `frontend/css/styles.css`, die Farb- und Schrift-Kürzel
(`text-kicker`, `border-line`, `bg-wash`, `font-display` …) in der
Tailwind-Konfiguration oben in `frontend/index.html`.

Die Zustände der Noteneingabe (`is-invalid`, `is-nograde`, `is-override`)
sind bewusst eigene CSS-Klassen statt Tailwind-Klassen: sie werden zur
Laufzeit per JavaScript umgeschaltet und müssen sicher gegen die
Grundgestaltung von `.kt-input` gewinnen, unabhängig von der Reihenfolge der
Stylesheets.

### Spieler auf dem Spielfeld

Aufgebaut wie kickers Mannschaftsaufstellung im Spielbericht:

- **Foto im Hochformat** (`.pitch-photo`), nicht rund - zeigt bei gleicher
  Kachelbreite deutlich mehr vom Gesicht und passt zu den Portraitfotos.
- **Punktzahl oben rechts** über der Fotoecke, wo bei kicker die Note steht.
  Farbe nach unserer Bedeutung: grün positiv, rot negativ, grau ohne Einsatz.
- **Ereignis-Symbole oben links** (Tor, Vorlage, Karte, Ein-/Auswechslung).
- **Nur der Nachname** darunter, darunter klein der Status (Note, „live",
  „auf der Bank"). Auf dem dunklen Rasen brauchen die Zeilen keine eigene
  helle Fläche mehr.

Die Fotogröße richtet sich per **Container-Query** (`cqw`) nach der
tatsächlichen Breite des Spielfelds, nicht nach der Bildschirmbreite: im
großen Editor werden die Fotos automatisch größer als im kompakten
Spieltag-Ausklapper, ohne dass je Ansicht eigene Werte gepflegt werden.

Ein Klick auf einen Spieler öffnet die **Punkte-Aufschlüsselung**: großes
Portraitfoto, Name, Vereinswappen, darunter Zeile für Zeile jede Punktequelle
und die Summe. Die Summe ist dort genauso eingefärbt wie die Zahl auf dem
Spielfeld (grün positiv, rot negativ, grau ohne Einsatz) - vorher war sie
immer rot, was bei einem starken Spieler wie eine Warnung aussah.

Die Reihenabstände in `frontend/js/formations.js` sind so gewählt, dass
zwischen zwei Reihen **mindestens 17 %** der Feldhöhe liegen. Darunter stoßen
die höheren Hochformat-Kacheln aneinander - das war der Grund, warum Torwart
und Abwehr früher überlappten.

## Aufstellen

**Aufruf:** Auf der Spieltag-Seite einen Konkurrenten aufklappen und
„Aufstellung bearbeiten" anklicken - öffnet den Editor als Overlay für genau
diesen Konkurrenten und den oben gewählten Spieltag. Das funktioniert auch,
wenn noch gar keine Aufstellung existiert. Ein Klick auf das „×" oder daneben
schließt den Editor wieder.

**Unvollständige Aufstellungen** lassen sich speichern und werden auch
gewertet - z.B. wenn noch nicht klar ist, wer verletzt oder gesperrt fehlt.
Nur ganz leer (0 Spieler) lässt sich nicht speichern. Nicht besetzte
Positionen bleiben auf dem Spielfeld leer und tragen keine Punkte bei; alle
anderen Ansichten (Spieltag, Noten) werten die vorhandenen Spieler normal.

**Formationen:** zur Auswahl stehen genau die sieben, die das kicker-
Managerspiel Interactive anbietet - 4-4-2, 4-3-3, 3-5-2, 3-4-3, 5-3-2, 5-4-1,
4-5-1. 4-2-3-1 gibt es dort nicht und deshalb auch hier nicht.

**Formationswechsel** behält die Elf so weit wie möglich: jeder Spieler bleibt
in seiner Linie (Tor / Abwehr / Mittelfeld / Sturm), und nur wenn eine Linie
schrumpft, wandern die überzähligen zurück auf die Bank. Von 4-3-3 auf 4-4-2
geht also genau ein Stürmer zurück, während das Mittelfeld seine drei behält
und einen Platz frei lässt. Wie viele Spieler die Bank sehen, steht kurz als
Hinweis am unteren Rand.

**Neuer Spieltag:** Ist für den gewählten Spieltag noch nichts gespeichert,
erscheint neben *Aufstellung speichern* der Knopf *Von Spieltag N übernehmen* –
N ist der letzte Spieltag, für den dieser Konkurrent eine Aufstellung hat.
Übernommen wird Formation samt Startelf; Spieler, die inzwischen nicht mehr im
Kader stehen, bleiben weg und werden gemeldet. Gespeichert wird erst mit dem
Speichern-Knopf.

**Sortierung:** In allen Spielerlisten (Kader, Spielersuche, Bank, Noten-Maske)
stehen die Spieler nach Position – Tor, Abwehr, Mittelfeld, Sturm – und
innerhalb der Position alphabetisch nach Nachname. Namenszusätze zählen zum
Nachnamen, „Said El Mala“ steht also unter E.

## Wertungslogik

Standard entspricht dem offiziellen **kicker-Managerspiel Interactive**
(recherchiert am 2026-09-10, Quellen in `backend/app/scoring_defaults.py`).
Note und Leistung werden **addiert**:

| Kriterium | Punkte |
| --- | --- |
| kicker-Note | 1,0 = +10, je halbe Note schlechter 2 weniger, bis 6,0 = −10 |
| Startelf / Einwechslung | +4 / +2 |
| Tor | Torwart 6, Abwehr 5, Mittelfeld 4, Sturm 3 |
| Vorlage | +2 |
| Torwart ohne Gegentor | +2 |
| Spieler des Spiels | +3 |
| Gelb-Rote Karte / Rote Karte | −3 / −6 |

Die Punkte stehen **immer** da, nicht erst nach dem Eintragen der Note: ab
Anpfiff hat ein Startelfspieler seine +4, ab Einwechslung der Joker seine +2,
dazu Tore und Vorlagen, sobald ESPN sie meldet. Die Note kommt später obendrauf.

Das gilt auch **während ein Spiel noch läuft**: die Seite fragt ESPN alle 30
Sekunden neu ab, und jedes Tor, jede Einwechslung wirkt sich sofort auf die
Punkte aus – es gibt keinen separaten "Live-Modus" mit eigener Rechenlogik,
dieselbe zentrale Funktion (`frontend/js/scoring.js`) läuft während des
Spiels wie danach.

Ein Spieler, der **nicht eingesetzt** wurde, bekommt 0 Punkte – auch wenn
versehentlich eine Note eingetragen ist.

### Note leer lassen vs. „-" eintragen

Ein **leeres** Notenfeld heißt „noch nicht bearbeitet" – der Spieler taucht
in den Zählern (Statuszeile, „X/Y Noten"-Badge je Mannschaft) als offen auf.

Ein bewusst eingetragenes **„-"** heißt „hat gespielt, aber keine Note
bekommen" (kicker vergibt z.B. unter 25 Einsatzminuten oft keine Note). Das
zählt als **erledigt**: Der Zähler steigt, auf dem Spieltag-Screen steht
„Note –" statt der Warnung „Note fehlt". Punktemäßig macht es keinen
Unterschied zu einem leeren Feld (keine Notenpunkte, Einsatz- und
Torpunkte zählen trotzdem) – der Unterschied ist rein organisatorisch, damit
du siehst, was schon abgehakt ist.

### Wenn kicker anders zählt als ESPN

Tore und Vorlagen kommen normalerweise von ESPN, aber die beiden Quellen sind
sich nicht immer einig – kicker gibt zum Beispiel Vorlagen, die ESPN nicht
kennt. Unter **Noten** lässt sich die Zahl je Spieler überschreiben; ein
geändertes Feld wird gelb hinterlegt, und in der Aufschlüsselung steht
„manuell" hinter dem Posten.

Gespeichert wird nur die **Abweichung**: steht im Feld derselbe Wert wie bei
ESPN, merkt sich das Tool nichts – so wirken spätere ESPN-Korrekturen weiter.
Feld leeren setzt wieder auf den ESPN-Wert zurück.

Alle Werte sind unter **Einstellungen** editierbar und liegen im Backend
(gelten also auf Handy und Rechner gleichermaßen). Der Button
*Auf kicker-Standard zurücksetzen* stellt die Tabelle oben wieder her.
Die Rechenlogik selbst steckt zentral in
[`frontend/js/scoring.js`](frontend/js/scoring.js).

## Spielerpositionen: kicker ist die Quelle

Die Punkte pro Tor hängen von der Position ab (TW 6 / ABW 5 / MF 4 / STU 3),
und ESPN und kicker sind sich nicht immer einig – **Michael Olise ist bei ESPN
Mittelfeldspieler, bei kicker Stürmer**. Maßgeblich ist kicker.

```bash
cd backend
.venv\Scripts\python.exe import_kicker_positionen.py --dry-run   # nur anzeigen
.venv\Scripts\python.exe import_kicker_positionen.py             # übernehmen
```

Das Skript liest die Kaderseiten aller 18 Vereine von kicker.de, legt die
Positionen in der Datenbank ab und korrigiert die Kaderspieler. Danach
bekommen auch neu hinzugefügte Spieler automatisch die kicker-Position.

> **Warum ein Skript und kein Aufruf aus dem Tool?** kicker.de beantwortet
> Anfragen ohne echten Browser-Fingerprint mit HTTP 403 – curl und
> Python-`requests` kommen nicht durch, ein echter Chrome schon. Deshalb
> steuert das Skript einen headless Chrome. Zusätzlich sendet kicker.de keine
> CORS-Header, ein `fetch()` aus dem Browser wäre ohnehin blockiert.

Spieler, die kicker gar nicht führt (z.B. Nachwuchsspieler), meldet das Skript.
Deren Position lässt sich unter **Kader** über das Auswahlfeld neben dem Namen
von Hand setzen – das überschreibt beide Quellen.

Die eingelesenen Positionen gelten nicht nur für die eigenen Kader: die
Noten-Maske nutzt sie für **alle** Bundesliga-Spieler. Nötig ist das, weil ESPN
im Spielbericht für eingewechselte Spieler nur „SUB“ als Position angibt – ohne
kicker-Daten wäre jeder Joker ein Mittelfeldspieler, mit falscher Sortierung
und falschen Punkten pro Tor.

Nach einem Wechsel des Spielsystems oder zur neuen Saison einfach erneut laufen
lassen.

## Spielerbilder

Jeder Spieler kann ein Foto bekommen. Es hängt am Spieler (nicht am
Konkurrenten) und erscheint auf dem Spielfeld, in der Kaderliste, auf der
Bank und in der Noten-Maske. Ohne Foto zeigt das Tool die Initialen.

**Einzeln zuweisen:** unter *Kader* beim jeweiligen Spieler auf *+ Bild*
klicken. Das Bild wird im Browser automatisch auf 200 px Breite verkleinert
(Transparenz bleibt erhalten) und im Backend gespeichert.

**Alle Fotos automatisch von kicker.de holen** (empfohlener Weg, keine
eigenen Dateien nötig):

```bash
cd backend
.venv\Scripts\python.exe fotos_sichern.py                  # ERST sichern!
.venv\Scripts\python.exe import_kicker_fotos.py --dry-run  # nur prüfen
.venv\Scripts\python.exe import_kicker_fotos.py            # holen
.venv\Scripts\python.exe import_kicker_fotos.py --nur-luecken  # nur fehlende
```

kicker hat auf **jeder** Spielerseite ein echtes Studiofoto, alle im selben
Stil – auch bei Ersatztorhütern und Nachwuchsspielern. (ESPN hat für die
Bundesliga praktisch keine: 0–2 pro Verein, selbst Kane und Neuer fehlen.)

Das Skript klappert die 18 Kaderseiten ab, sammelt die Spieler-Kürzel, holt
je Spieler dessen Seite und lädt das Foto in 300 px Breite (~74 KB). Die
Spielerseiten brauchen einen echten Browser (kicker blockt alles andere mit
HTTP 403), die Bilder selbst liegen auf einem offenen CDN. Es läuft mit 5
Browsern parallel und merkt sich den Fortschritt in
`kicker_fotos_fortschritt.json` – nach einem Abbruch macht es dort weiter.

**Vorher immer `fotos_sichern.py`**: das schreibt alle vorhandenen Fotos als
Einzeldateien nach `backend/fotos_gesichert/`, benannt nach der
ESPN-Spieler-ID. Ist ein kicker-Foto schlechter als das bisherige, holt man
es gezielt zurück:

```bash
.venv\Scripts\python.exe fotos_zurueck.py --liste        # was ist gesichert?
.venv\Scripts\python.exe fotos_zurueck.py 190161 142200  # einzelne zurück
.venv\Scripts\python.exe fotos_zurueck.py --alle         # alle zurück
```

**Stapelweise aus dem Ordner `Bilder/`:** Dateien nach dem **Nachnamen** des
Spielers benennen (`Olise.png`, `El Mala.png`) und einmal laufen lassen:

```bash
cd backend
.venv\Scripts\python.exe import_bilder.py --dry-run   # nur anzeigen
.venv\Scripts\python.exe import_bilder.py             # übernehmen
```

Das Skript lädt dafür einmal die kompletten Kader aller 18 Bundesliga-Vereine
direkt von ESPN (~500 Spieler) und ordnet **unabhängig vom eigenen Kader**
zu – ein Foto hängt an der ESPN-Spieler-ID, nicht daran, ob ihn schon ein
Konkurrent aufgestellt hat. Nimmt später jemand den Spieler in seinen Kader
auf, ist das Foto also schon da, ohne das Skript erneut laufen zu lassen.

Der Dateiname wird dafür normalisiert (Akzente entfernt, Bindestriche zu
Leerzeichen) – `El Faouzi.png` findet so `Soufian El-Faouzi`, `Diaz.png`
findet `Luis Díaz`. Bleiben nach der Normalisierung mehrere Spieler mit
passendem Namen übrig (z.B. zwei Brüder), gewinnt derjenige, der schon in
einem Kader steht; sind mehrere oder keiner davon im Kader, wird das Bild
übersprungen und gemeldet – mit allen passenden Namen, damit sich das von
Hand unter *Kader* nachholen lässt.

Unterstützt `.png`, `.jpg`, `.webp` bis 400 KB.

Ausgeliefert werden die Bilder über einen eigenen Endpoint mit
`Cache-Control: max-age=86400` – das Handy lädt jedes Foto also nur einmal.

## Datenbank-Migrationen

Neue Tabellen legt das Backend beim Start selbst an. Wenn sich eine
**bestehende** Tabelle ändert, liegt dafür ein Skript bereit, das vorher eine
Sicherung anlegt und hinterher die Zeilenzahl gegenprüft:

```bash
cd backend
.venv\Scripts\python.exe migrate_manuelle_eingaben.py
```

Dieses Skript hat `player_grades` um Tor-/Vorlagen-Korrekturen und „Spieler des
Spiels" erweitert und die Note optional gemacht. Es ist gefahrlos mehrfach
ausführbar – ist alles vorhanden, passiert nichts.

## Datensicherung

Die gesamte Eingabe (Konkurrenten, Kader, Aufstellungen, Noten, Regeln) liegt
in `backend/kicker_tool.db`. Diese Datei einfach kopieren, um ein Backup zu
haben – `*.db` ist per `.gitignore` vom Repo ausgeschlossen.

## Bedienung Aufstellung

Spieler lassen sich per Drag & Drop von der Bank auf eine Position ziehen.
Alternativ (v.a. am Handy): Bankspieler antippen (wird hervorgehoben), dann
die Zielposition antippen. Eine bereits besetzte Position antippen/hierher
ziehen schickt den bisherigen Spieler zurück auf die Bank.
