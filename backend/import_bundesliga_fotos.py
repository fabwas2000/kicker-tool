"""Spielerfotos von bundesliga.com holen und in die Datenbank legen.

Die offiziellen DFL-Fotos sind freigestellt (transparenter Hintergrund) und
hochaufloesend - auf dem dunklen Spielfeld sichtbar ruhiger als Fotos mit
hellem Studiohintergrund.

Warum das hier viel einfacher ist als bei kicker (import_kicker_fotos.py):
bundesliga.com liefert die KOMPLETTE Spielerliste samt Bild-Adressen in EINER
Seite, eingebettet als JSON. Kein Browser noetig, keine Drosselung, keine 500
Einzelabrufe - ein Aufruf, dann nur noch die Bilder laden.

Bildvarianten am selben Pfad:
  ...-body.png     freigestelltes Ganzkoerper-Portrait (780x960) - bevorzugt
  ...-circle.png   runder Gesichtsausschnitt - Rueckfall, wenn body fehlt
Ueber "?fit=Breite,Hoehe" liefert der Bilddienst die Datei direkt verkleinert.

Aufruf aus dem backend-Ordner:

    .venv\\Scripts\\python.exe import_bundesliga_fotos.py --dry-run
    .venv\\Scripts\\python.exe import_bundesliga_fotos.py
    .venv\\Scripts\\python.exe import_bundesliga_fotos.py --nur-luecken

Braucht Pillow (pip install pillow) fuer den Kopfausschnitt.

WICHTIG: Vorher fotos_sichern.py laufen lassen - das Skript ueberschreibt
vorhandene Fotos (ausser mit --nur-luecken).
"""

import io
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone

from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.models import PlayerImage
from app.positions import normalize
from import_kicker_fotos import espn_spieler

# Windows-Konsolen arbeiten standardmaessig mit einer Zeichentabelle, die
# Namen wie "Ivanovic" mit Sonderzeichen nicht darstellen kann - ohne diese
# Zeile bricht das Skript beim blossen Ausgeben eines Namens ab.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SPIELER_SEITE = "https://www.bundesliga.com/de/bundesliga/spieler"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"
)

# Zielgroesse: 300px Breite reicht fuer die groesste Darstellung im Tool
# (Detailansicht 84px, auf einem 3fach aufloesenden Handy also 252px).
BREITE, HOEHE = 300, 375
MAX_BYTES = 400 * 1024

# Vielfaches der SCHULTERBREITE, das als Ausschnitthoehe uebernommen wird.
# 1.35 ergibt Kopf plus Schultern und oberen Brustbereich.
#
# Warum die Schulterbreite als Massstab und nicht die Kopfhoehe: Die Kopfhoehe
# laesst sich nur ueber einen Breitensprung im Umriss bestimmen ("hier fangen
# die Schultern an"). Bei langen Haaren ist der Kopf aber schon so breit wie
# die Schultern - der Sprung faellt dann erst bei den verschraenkten Armen auf
# und der Ausschnitt wird viel zu hoch (Fall Wimmer). Die groesste Breite des
# Umrisses ist dagegen immer die Schulter-/Armspanne und damit robust.
SCHULTER_FAKTOR = 1.35

# Notloesung, falls sich am Bild kein Umriss erkennen laesst: fester Anteil
# der Bildhoehe wie zuvor.
KOPF_ANTEIL = 0.62

# Vereinshintergrund: Vereinsfarbe mit dem Punktemuster, genau die Flaeche,
# die bundesliga.com hinter die freigestellten Spielerfotos legt. Es ist ein
# echtes Bild je Verein (rund 7700x2160), kein nachgebauter Farbverlauf.
HINTERGRUND_URL = "https://assets.bundesliga.com/web/background/club/dot-stripe/%s.png"

# Aus welchem Bereich des grossen Hintergrunds der Ausschnitt genommen wird.
# Das Punktemuster sitzt bei etwa 70 Prozent der Breite; die 900 Pixel Hoehe
# (statt der vollen 2160) sind bewusst: Wuerde man die ganze Hoehe auf die
# 375px-Kachel verkleinern, schrumpften die Punkte zu Rauschen zusammen.
HINTERGRUND_MITTE = 0.70
HINTERGRUND_HOEHE = 900

# Die Vereins-Kennung steht in jeder Bildadresse: .../dfl-obj-XXX-dfl-clu-YYY-...
CLUB_RE = re.compile(r"(dfl-clu-[0-9a-z]+)", re.IGNORECASE)

# Die Spielerdaten stehen als JSON im Seitenquelltext: je Spieler die
# DFL-Kennung, der volle Name und die Adresse des runden Bildes.
SPIELER_RE = re.compile(
    r'"id":"(DFL-OBJ-[0-9A-Z]+)","lastUpdate":null,"name":\{[^}]*?"full":"([^"]+)"[^}]*?\}'
    r'.*?"FACE_CIRCLE":"([^"]+)"'
)


def hole(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def spielerliste() -> list[tuple[str, str, str]]:
    """[(dfl_id, name, bild_url)] - alles aus einer einzigen Seite."""
    html = hole(SPIELER_SEITE).decode("utf-8", errors="replace")
    treffer = SPIELER_RE.findall(html)
    return [(d, n, u.replace("\\u002F", "/")) for d, n, u in treffer]


def bild_urls(circle_url: str) -> list[str]:
    """Bevorzugt das freigestellte Portrait, sonst den runden Ausschnitt.

    Das Portrait wird in voller Aufloesung geholt, weil daraus gleich noch
    der Kopfausschnitt geschnitten wird - dafuer braucht es die Pixel.
    """
    body = circle_url.replace("-circle.png", "-body.png")
    return [body, circle_url + f"?fit={BREITE},{BREITE}"]


_hintergrund_cache: dict = {}


def vereins_hintergrund(club_id: str):
    """Kachelgrosse Flaeche in den Vereinsfarben, oder None.

    Wird je Verein genau einmal geladen (18 Bilder fuer die ganze Liga) und
    gleich auf Kachelformat zugeschnitten gemerkt.
    """
    from PIL import Image

    if not club_id:
        return None
    schluessel = club_id.lower()
    if schluessel in _hintergrund_cache:
        return _hintergrund_cache[schluessel]

    flaeche = None
    try:
        gross = Image.open(io.BytesIO(hole(HINTERGRUND_URL % club_id.upper()))).convert("RGB")
        bw, bh = gross.size
        nh = min(HINTERGRUND_HOEHE, bh)
        nw = min(bw, int(nh * BREITE / HOEHE))
        x0 = max(0, min(bw - nw, int(bw * HINTERGRUND_MITTE) - nw // 2))
        y0 = max(0, (bh - nh) // 2)
        flaeche = (
            gross.crop((x0, y0, x0 + nw, y0 + nh))
            .resize((BREITE, HOEHE), Image.LANCZOS)
            .convert("RGBA")
        )
    except Exception as err:
        print(f"    (Hintergrund {club_id} nicht ladbar: {err})")

    _hintergrund_cache[schluessel] = flaeche
    return flaeche


def _umriss(im) -> list[tuple[int, int, int, int]]:
    """Je abgetasteter Zeile: (y, linker Rand, rechter Rand, Breite).

    Sampling in 4er-/3er-Schritten reicht und haelt es schnell.
    """
    alpha = im.split()[3]
    breite, hoehe = im.size
    px = alpha.load()

    zeilen = []
    for y in range(0, hoehe, 4):
        xs = [x for x in range(0, breite, 3) if px[x, y] > 40]
        if xs:
            zeilen.append((y, min(xs), max(xs), max(xs) - min(xs)))
    return zeilen


def auf_kopf_zuschneiden(roh: bytes, hintergrund=None) -> bytes:
    """Aus dem Ganzkoerperbild Kopf und Oberkoerper schneiden.

    Ohne Zuschnitt waere das Gesicht auf einer 54px breiten Kachel nur ein
    paar Pixel gross - das Ganzkoerperbild verschenkt den halben Platz an
    Beine und Luft.

    Der Ausschnitt richtet sich nach dem ERKANNTEN UMRISS, nicht nach einem
    festen Anteil der Bilddatei. Die DFL-Fotos zeigen die Spieler naemlich in
    unterschiedlicher Groesse: die Schulterlinie liegt je nach Foto zwischen
    33 und 40 Prozent der Bildhoehe. Ein starrer Anteil ergaebe deshalb mal
    Kopf-und-Brust, mal Kopf-und-halben-Bauch.
    """
    from PIL import Image

    im = Image.open(io.BytesIO(roh))
    # Ueber RGBA gehen: im Palettenmodus rechnet das Verkleinern die
    # Transparenz sonst unsauber um.
    im = im.convert("RGBA")
    breite, hoehe = im.size

    zeilen = _umriss(im)
    if zeilen:
        oben = zeilen[0][0]
        spanne = max(b for _y, _l, _r, b in zeilen)
        neu_hoehe = min(hoehe - oben, int(spanne * SCHULTER_FAKTOR))
        # Waagerecht am KOPF ausrichten, nicht am ganzen Koerper: verschraenkte
        # Arme verschieben die Koerpermitte, der Kopf sitzt dann aussermittig.
        kopf = [(l, r) for _y, l, r, b in zeilen[: max(1, len(zeilen) // 6)] if b > 0]
        mitte = sum(l + r for l, r in kopf) // (2 * len(kopf)) if kopf else breite // 2
    else:
        # Kein Umriss erkennbar (z.B. Bild ohne Transparenz) - dann der alte,
        # starre Anteil als Notloesung.
        oben, mitte = 0, breite // 2
        neu_hoehe = int(hoehe * KOPF_ANTEIL)

    neu_hoehe = max(neu_hoehe, 50)
    neu_breite = min(breite, int(neu_hoehe * BREITE / HOEHE))
    links = max(0, min(breite - neu_breite, mitte - neu_breite // 2))

    ausschnitt = im.crop((links, oben, links + neu_breite, oben + neu_hoehe))
    ausschnitt = ausschnitt.resize((BREITE, HOEHE), Image.LANCZOS)

    if hintergrund is not None:
        # Die Vereinsflaeche kommt HINTER den Spieler - deshalb eine Kopie
        # des Hintergrunds nehmen und den Spieler daraufsetzen, nicht
        # umgekehrt. Ohne copy() wuerde die gecachte Flaeche ueberschrieben
        # und jeder weitere Spieler desselben Vereins landete auf dem
        # vorherigen Spieler.
        flaeche = hintergrund.copy()
        flaeche.alpha_composite(ausschnitt)
        ausschnitt = flaeche

    return _als_png(ausschnitt)


def auf_flaeche_setzen(roh: bytes, hintergrund) -> bytes:
    """Runden Gesichtsausschnitt auf die Vereinsflaeche setzen.

    Der Rueckfall fuer die Spieler ohne Ganzkoerperbild. Ohne das saehen diese
    rund 20 Fotos als einzige anders aus als der Rest.
    """
    from PIL import Image

    kopf = Image.open(io.BytesIO(roh)).convert("RGBA")
    # Mittig einpassen, ohne zu verzerren; oben buendig, damit das Gesicht
    # wie bei den anderen Kacheln im oberen Bildteil sitzt.
    breite = BREITE
    hoehe = max(1, round(kopf.height * BREITE / kopf.width))
    kopf = kopf.resize((breite, hoehe), Image.LANCZOS)

    flaeche = hintergrund.copy()
    flaeche.alpha_composite(kopf.crop((0, 0, breite, min(hoehe, HOEHE))))
    return _als_png(flaeche)


def _als_png(bild) -> bytes:
    """Auf eine Farbpalette zurueck und als PNG ausgeben.

    Spart rund 80 Prozent Speicher (138 -> 29 KB je Bild) bei gleicher
    sichtbarer Qualitaet - die DFL liefert die Originale ohnehin als
    Palettenbilder. Eine etwaige Transparenz bleibt erhalten.
    """
    from PIL import Image

    bild = bild.quantize(colors=255, method=Image.Quantize.FASTOCTREE)
    puffer = io.BytesIO()
    bild.save(puffer, "PNG", optimize=True)
    return puffer.getvalue()


def lade_bild(urls: list[str], hintergrund=None) -> tuple[bytes | None, str]:
    for url in urls:
        try:
            daten = hole(url, timeout=45)
        except Exception:
            continue
        if not daten:
            continue
        if "-body" in url:
            try:
                daten = auf_kopf_zuschneiden(daten, hintergrund)
            except Exception as err:
                # Lieber das ungeschnittene Bild als gar keines.
                print(f"    (Zuschnitt fehlgeschlagen: {err})")
        elif hintergrund is not None:
            try:
                daten = auf_flaeche_setzen(daten, hintergrund)
            except Exception as err:
                print(f"    (Hintergrund nicht gesetzt: {err})")
        if len(daten) <= MAX_BYTES:
            return daten, ("freigestellt" if "-body" in url else "rund")
    return None, ""


def zuordnung_zu_espn(spieler: list[tuple[str, str, str]], espn: list[dict]) -> tuple[dict, list]:
    """Ordnet die bundesliga-Namen den ESPN-IDs zu, an denen unsere Fotos
    haengen. bundesliga.com fuehrt volle Taufnamen ("Dayotchanculle Oswald
    Upamecano"), ESPN den Rufnamen - deshalb mehrere Stufen."""

    def teile(norm_name: str) -> set:
        return {t for t in norm_name.split() if t}

    zuordnung: dict[str, tuple[str, str]] = {}
    ohne: list[str] = []
    for _dfl, name, url in spieler:
        norm = normalize(name)
        treffer = [e for e in espn if e["norm"] == norm]
        if len(treffer) != 1:
            treffer = [e for e in espn if norm and (norm in e["norm"] or e["norm"] in norm)]
        if len(treffer) != 1:
            meine = teile(norm)
            treffer = [
                e for e in espn
                if meine and (meine <= teile(e["norm"]) or teile(e["norm"]) <= meine)
            ]
        if len(treffer) != 1:
            # Nachname muss stimmen UND mindestens ein weiterer Namensteil -
            # faengt die vollen Taufnamen, ohne blind auf Nachnamen zu raten.
            meine = teile(norm)
            worte = norm.split()
            nachname = worte[-1] if worte else ""
            treffer = [
                e for e in espn
                if nachname and nachname in teile(e["norm"])
                and (teile(e["norm"]) & meine) - {nachname}
            ]
        if len(treffer) == 1:
            zuordnung[treffer[0]["id"]] = (name, url)
        else:
            ohne.append(name)
    return zuordnung, ohne


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    nur_luecken = "--nur-luecken" in sys.argv
    Base.metadata.create_all(bind=engine)

    print(f"Modus: {'Probelauf' if dry_run else ('nur Luecken' if nur_luecken else 'alle ueberschreiben')}\n")

    print("Hole Spielerliste von bundesliga.com ...")
    spieler = spielerliste()
    print(f"  {len(spieler)} Spieler mit Bildadresse\n")
    if not spieler:
        print("Keine Spieler gefunden - hat bundesliga.com die Seite geaendert?")
        return 1

    print("Hole ESPN-Spielerliste (fuer die IDs) ...")
    espn = espn_spieler()
    print(f"  {len(espn)} ESPN-Spieler\n")

    zuordnung, ohne = zuordnung_zu_espn(spieler, espn)
    print(f"Eindeutig zugeordnet: {len(zuordnung)} von {len(spieler)}")
    print(f"Ohne Zuordnung (bleiben beim bisherigen Foto): {len(ohne)}\n")

    db = SessionLocal()
    try:
        vorhanden = {b.espn_player_id for b in db.scalars(select(PlayerImage)).all()}
    finally:
        db.close()

    ziele = dict(zuordnung)
    if nur_luecken:
        vorher = len(ziele)
        ziele = {k: v for k, v in ziele.items() if k not in vorhanden}
        print(f"Nur Luecken: {vorher} -> {len(ziele)} zu holen\n")

    if dry_run:
        print("Probelauf - es wird nichts geladen und nichts gespeichert.")
        if ohne[:10]:
            print("\nBeispiele ohne Zuordnung:")
            for n in ohne[:10]:
                print(f"  {n}")
        return 0

    geladen = freigestellt = 0
    fehler: list[str] = []
    db = SessionLocal()
    try:
        for nr, (espn_id, (name, circle)) in enumerate(ziele.items(), 1):
            treffer = CLUB_RE.search(circle)
            hintergrund = vereins_hintergrund(treffer.group(1)) if treffer else None
            daten, art = lade_bild(bild_urls(circle), hintergrund)
            if daten is None:
                fehler.append(name)
            else:
                bild = db.get(PlayerImage, espn_id)
                if bild is None:
                    bild = PlayerImage(espn_player_id=espn_id)
                    db.add(bild)
                bild.content_type = "image/png"
                bild.data = daten
                bild.updated_at = datetime.now(timezone.utc)
                geladen += 1
                if art == "freigestellt":
                    freigestellt += 1
            if nr % 50 == 0:
                db.commit()
                print(f"  {nr:>4}/{len(ziele)}  geladen: {geladen}  Fehler: {len(fehler)}")
        db.commit()
    finally:
        db.close()

    print(f"\nFertig: {geladen} Fotos uebernommen "
          f"({freigestellt} freigestellt, {geladen - freigestellt} runder Ausschnitt), "
          f"{len(fehler)} fehlgeschlagen.")
    if fehler:
        print("\nOhne Foto geblieben:")
        for n in fehler[:20]:
            print(f"  {n}")

    db = SessionLocal()
    try:
        alle = db.scalars(select(PlayerImage)).all()
        groesse = sum(len(b.data) for b in alle)
        print(f"\nFotos in der Datenbank jetzt: {len(alle)} ({groesse / 1048576:.1f} MB)")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
