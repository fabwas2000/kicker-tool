"""Spielerfotos von kicker.de holen und in die Datenbank legen.

Warum kicker und nicht ESPN? ESPN hat fuer die Bundesliga praktisch keine
Spielerfotos (Stichprobe: 0-2 pro Verein, selbst Kane/Kimmich/Neuer fehlen).
kicker hat dagegen auf JEDER Spielerseite ein echtes Studiofoto - alle im
selben Stil, auch bei Ersatztorwart und Nachwuchsspieler.

Ablauf:
  1. Vereinsliste von kicker.de/bundesliga/vereine
  2. je Verein die Kaderseite -> Spieler-Kuerzel ("sven-ulreich") + Name
  3. je Spieler seine Seite -> URL des Fotos
  4. Foto herunterladen und unter der ESPN-Spieler-ID ablegen

Zwei Eigenheiten von kicker.de, die den Aufbau bestimmen:
  * Die SEITEN blocken alles ohne echten Browser-Fingerprint (HTTP 403) -
    deshalb wie import_kicker_positionen.py ueber einen Headless-Chrome.
  * Die BILDER liegen auf einem offenen CDN und lassen sich ganz normal
    herunterladen, dafuer braucht es keinen Browser.

Die Zuordnung kicker-Name -> ESPN-ID laeuft ueber den normalisierten Namen
(ohne Akzente, kleingeschrieben, siehe app.positions.normalize) - dieselbe
Logik wie in import_bilder.py.

Aufruf aus dem backend-Ordner:

    .venv\\Scripts\\python.exe import_kicker_fotos.py --dry-run   # nur pruefen
    .venv\\Scripts\\python.exe import_kicker_fotos.py             # uebernehmen
    .venv\\Scripts\\python.exe import_kicker_fotos.py --nur-luecken

Der Lauf merkt sich seinen Fortschritt in kicker_fotos_fortschritt.json und
macht nach einem Abbruch dort weiter, statt von vorn anzufangen.

WICHTIG: Vorher fotos_sichern.py laufen lassen - dieses Skript ueberschreibt
vorhandene Fotos (ausser mit --nur-luecken).
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone

from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.models import PlayerImage
from app.positions import normalize

# Windows-Konsolen arbeiten standardmaessig mit einer Zeichentabelle, die
# Namen wie "Ivanovic" mit Sonderzeichen nicht darstellen kann - ohne diese
# Zeile bricht das Skript beim blossen Ausgeben eines Namens ab.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HIER = os.path.dirname(os.path.abspath(__file__))
FORTSCHRITT_DATEI = os.path.join(HIER, "kicker_fotos_fortschritt.json")

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)
ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1"

CLUB_RE = re.compile(r'href="/([a-z0-9-]+)/kader/')
PLAYER_RE = re.compile(
    r'<a href="/([^"/]+)/spieler/[^"]*"><strong>([^<]*)</strong>\s*<span>([^<]*)</span></a>'
)
# Das Portraitfoto auf der Spielerseite. "spieler/xl" grenzt es gegen
# Trainerfotos, Wappen und Nationalflaggen ab.
FOTO_RE = re.compile(r'<img[^>]*?src="(https://derivates\.kicker\.de/[^"]*?spieler/xl/[^"]*)"')

# Breite, in der das Foto abgelegt wird. kicker liefert ueber den
# Bild-Dienst jede gewuenschte Groesse; 300px reichen fuer die groesste
# Darstellung (64px) auch auf einem hochaufloesenden Display.
FOTO_BREITE = 300
MAX_BYTES = 400 * 1024

# Bewusst niedrig: bei 5 gleichzeitigen Browsern liefert kicker rund die
# Haelfte der Seiten nur als Rumpf zurueck (offenbar eine Drosselung unter
# Last) - einzeln abgerufen funktionieren dieselben Seiten einwandfrei.
PARALLEL = 2


def find_browser() -> str:
    for path in CHROME_CANDIDATES:
        if os.path.isfile(path):
            return path
    raise SystemExit("Kein Chrome/Edge gefunden. Bitte Pfad in CHROME_CANDIDATES ergaenzen.")


def fetch(browser: str, url: str, profile_dir: str, budget_ms: int = 15000) -> str:
    """Seite mit echtem Browser rendern - kicker blockt alles andere."""
    try:
        result = subprocess.run(
            [
                browser,
                "--headless=new",
                "--disable-gpu",
                "--virtual-time-budget=" + str(budget_ms),
                "--user-agent=" + USER_AGENT,
                "--user-data-dir=" + profile_dir,
                "--dump-dom",
                url,
            ],
            capture_output=True,
            timeout=120,
        )
        return result.stdout.decode("utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        return ""


def season_slug(today: date | None = None) -> str:
    today = today or date.today()
    start = today.year if today.month >= 7 else today.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def espn_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def espn_spieler() -> list[dict]:
    """Alle Bundesliga-Spieler mit ESPN-ID - das Ziel der Zuordnung."""
    teams = espn_json(f"{ESPN_BASE}/teams")["sports"][0]["leagues"][0]["teams"]
    spieler = []
    for eintrag in teams:
        team_id = eintrag["team"]["id"]
        roster = espn_json(f"{ESPN_BASE}/teams/{team_id}/roster")
        verein = roster.get("team", {}).get("displayName", "")
        for a in roster.get("athletes", []):
            spieler.append(
                {
                    "id": a["id"],
                    "name": a["displayName"],
                    "verein": verein,
                    "norm": normalize(a["displayName"]),
                }
            )
    return spieler


def foto_url_in_groesse(url: str, breite: int) -> str:
    """kicker liefert Bilder ueber einen Groessen-Dienst; die gewuenschte
    Breite steckt als "w_150%2Ch_176" in der URL und laesst sich austauschen.

    Das Trennzeichen wird uebernommen, wie es in der URL stand (kodiert als
    %2C oder als echtes Komma) - nicht mischen, auch wenn der Server beides
    akzeptiert.
    """
    def ersetze(m: re.Match) -> str:
        trenner = m.group(1)
        return f"w_{breite}{trenner}h_{int(breite * 1.17)}"

    return re.sub(r"w_\d+(%2C|,)h_\d+", ersetze, url)


def lade_foto(url: str) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            daten = resp.read(MAX_BYTES + 1)
    except Exception:
        return None
    if not daten or len(daten) > MAX_BYTES:
        return None
    return daten


def lade_fortschritt() -> dict:
    if os.path.isfile(FORTSCHRITT_DATEI):
        try:
            with open(FORTSCHRITT_DATEI, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def speichere_fortschritt(daten: dict) -> None:
    with open(FORTSCHRITT_DATEI, "w", encoding="utf-8") as f:
        json.dump(daten, f, ensure_ascii=False)


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    nur_luecken = "--nur-luecken" in sys.argv
    Base.metadata.create_all(bind=engine)
    browser = find_browser()
    saison = season_slug()

    print(f"Browser : {browser}")
    print(f"Saison  : {saison}")
    print(f"Modus   : {'Probelauf' if dry_run else ('nur Luecken' if nur_luecken else 'alle ueberschreiben')}\n")

    print("Lade ESPN-Spielerliste (fuer die IDs)...")
    espn = espn_spieler()
    print(f"  {len(espn)} ESPN-Spieler\n")

    vorhandene_ids = set()
    db = SessionLocal()
    try:
        vorhandene_ids = {b.espn_player_id for b in db.scalars(select(PlayerImage)).all()}
    finally:
        db.close()
    print(f"Bereits Fotos in der Datenbank: {len(vorhandene_ids)}\n")

    fortschritt = lade_fortschritt()
    if fortschritt:
        print(f"Fortschritt gefunden: {len(fortschritt)} Spielerseiten schon besucht.\n")

    with tempfile.TemporaryDirectory() as basis_profil:
        # --- Schritt 1: Vereine + Kader ---
        print("Hole Vereinsliste...")
        # kicker liefert gelegentlich eine unfertige Seite zurueck - dann
        # einfach nochmal, mit mehr Zeit.
        vereine = []
        for versuch, budget in enumerate([20000, 30000, 45000], 1):
            vereine = sorted(set(CLUB_RE.findall(
                fetch(browser, "https://www.kicker.de/bundesliga/vereine", basis_profil, budget_ms=budget)
            )))
            if vereine:
                break
            print(f"  Versuch {versuch} kam leer zurueck, nochmal...")
        if not vereine:
            print("Keine Vereine gefunden - hat kicker.de die Seitenstruktur geaendert?")
            return 1
        print(f"  {len(vereine)} Vereine\n")

        kicker_spieler: list[dict] = []
        for i, verein in enumerate(vereine, 1):
            url = f"https://www.kicker.de/{verein}/kader/bundesliga/{saison}"
            html = fetch(browser, url, basis_profil, budget_ms=20000)
            treffer = list(PLAYER_RE.finditer(html))
            if not treffer:
                html = fetch(browser, url, basis_profil, budget_ms=30000)
                treffer = list(PLAYER_RE.finditer(html))
            for m in treffer:
                nachname, vorname = m.group(2).strip(), m.group(3).strip()
                kicker_spieler.append(
                    {
                        "slug": m.group(1),
                        "name": f"{vorname} {nachname}".strip(),
                        "verein": verein,
                    }
                )
            print(f"  [{i:>2}/{len(vereine)}] {verein:<28} {len(treffer):>2} Spieler")

        # Doppelte (Leihspieler in zwei Kadern) nur einmal behandeln
        einmalig = {s["slug"]: s for s in kicker_spieler}
        print(f"\n{len(einmalig)} Spieler bei kicker gefunden.\n")

        # --- Schritt 2: Zuordnung zu ESPN-IDs (vor dem Laden, spart Arbeit) ---
        def teile(norm_name: str) -> set:
            return {t for t in norm_name.split() if t}

        zugeordnet = []
        ohne_espn = []
        for s in einmalig.values():
            norm = normalize(s["name"])
            treffer = [e for e in espn if e["norm"] == norm]
            if len(treffer) != 1:
                # Zweiter Versuch: Teilstring (kicker kuerzt manche Namen)
                treffer = [e for e in espn if norm and (norm in e["norm"] or e["norm"] in norm)]
            if len(treffer) != 1:
                # Dritter Versuch ueber die Namensbestandteile, unabhaengig von
                # deren Reihenfolge. Faengt zwei haeufige Faelle:
                #   * andere Reihenfolge ("Woo-Yeong Jeong" / "Jeong Woo-Yeong")
                #   * zusaetzlicher Zweitname ("Ransford-Yeboah Koenigsdoerffer")
                meine = teile(norm)
                treffer = [
                    e for e in espn
                    if meine and (meine <= teile(e["norm"]) or teile(e["norm"]) <= meine)
                ]
            if len(treffer) == 1:
                s["espn_id"] = treffer[0]["id"]
                zugeordnet.append(s)
            else:
                ohne_espn.append((s["name"], len(treffer)))

        print(f"Davon eindeutig einer ESPN-ID zugeordnet: {len(zugeordnet)}")
        print(f"Ohne eindeutige Zuordnung (werden uebersprungen): {len(ohne_espn)}\n")

        if nur_luecken:
            vorher = len(zugeordnet)
            zugeordnet = [s for s in zugeordnet if s["espn_id"] not in vorhandene_ids]
            print(f"Nur Luecken: {vorher} -> {len(zugeordnet)} zu holen\n")

        # Nur ERFOLGE ueberspringen. Fehlschlaege kommen beim naechsten Lauf
        # wieder dran - sie lagen bisher fast immer an kickers Drosselung,
        # nicht daran, dass es das Foto nicht gibt.
        offen = [s for s in zugeordnet if not fortschritt.get(s["slug"])]
        schon_geschafft = len(zugeordnet) - len(offen)
        print(f"Zu besuchende Spielerseiten: {len(offen)} "
              f"(von {len(zugeordnet)}, {schon_geschafft} bereits erfolgreich)\n")

        if dry_run:
            print("Probelauf - es wird nichts geladen und nichts gespeichert.")
            if ohne_espn[:10]:
                print("\nBeispiele ohne Zuordnung:")
                for name, n in ohne_espn[:10]:
                    print(f"  {name} ({n} Treffer)")
            return 0

        # --- Schritt 3: Spielerseiten parallel abklappern ---
        def hole_einen(s: dict) -> tuple[dict, bytes | None, str]:
            # Kurzform der Adresse: kommt ohne Saison und Verein aus und
            # funktioniert auch bei Spielern, deren Vereinszuordnung sich
            # gerade geaendert hat.
            urls = [
                f"https://www.kicker.de/{s['slug']}/spieler",
                f"https://www.kicker.de/{s['slug']}/spieler/bundesliga/{saison}/{s['verein']}",
            ]
            # Mehrere Anlaeufe mit wachsender Wartezeit: kicker liefert unter
            # Last gelegentlich nur einen Seitenrumpf zurueck. Derselbe Abruf
            # klappt kurz darauf problemlos.
            for versuch, (url, budget) in enumerate(
                [(urls[0], 15000), (urls[1], 20000), (urls[0], 30000)], 1
            ):
                # Jeder Abruf braucht ein eigenes Profilverzeichnis, sonst
                # streiten sich die Chrome-Instanzen um die Sperrdatei.
                with tempfile.TemporaryDirectory() as profil:
                    html = fetch(browser, url, profil, budget_ms=budget)
                m = FOTO_RE.search(html)
                if m:
                    daten = lade_foto(foto_url_in_groesse(m.group(1), FOTO_BREITE))
                    if daten is not None:
                        return s, daten, ""
                    return s, None, "Download fehlgeschlagen"
                time.sleep(1.5 * versuch)
            return s, None, "kein Foto auf der Seite (3 Versuche)"

        geladen = 0
        fehler: list[tuple[str, str]] = []
        db = SessionLocal()
        try:
            with ThreadPoolExecutor(max_workers=PARALLEL) as pool:
                for nr, (s, daten, problem) in enumerate(pool.map(hole_einen, offen), 1):
                    if daten is None:
                        fehler.append((s["name"], problem))
                    else:
                        bild = db.get(PlayerImage, s["espn_id"])
                        if bild is None:
                            bild = PlayerImage(espn_player_id=s["espn_id"])
                            db.add(bild)
                        bild.content_type = "image/png"
                        bild.data = daten
                        bild.updated_at = datetime.now(timezone.utc)
                        geladen += 1
                    fortschritt[s["slug"]] = bool(daten)
                    if nr % 20 == 0:
                        db.commit()
                        speichere_fortschritt(fortschritt)
                        print(f"  {nr:>4}/{len(offen)}  geladen: {geladen}  Fehler: {len(fehler)}")
            db.commit()
            speichere_fortschritt(fortschritt)
        finally:
            db.close()

        print(f"\nFertig: {geladen} Fotos uebernommen, {len(fehler)} fehlgeschlagen.")
        if fehler:
            print("\nOhne Foto geblieben:")
            for name, problem in fehler[:25]:
                print(f"  {name:<30} {problem}")
            if len(fehler) > 25:
                print(f"  ... und {len(fehler) - 25} weitere")

        db = SessionLocal()
        try:
            gesamt = db.scalars(select(PlayerImage)).all()
            groesse = sum(len(b.data) for b in gesamt)
            print(f"\nFotos in der Datenbank jetzt: {len(gesamt)} ({groesse / 1048576:.1f} MB)")
        finally:
            db.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
