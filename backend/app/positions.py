"""Positionszuordnung: kicker schlaegt ESPN.

Die Torpunkte sind positionsabhaengig (TW 6 / ABW 5 / MF 4 / STU 3), und die
beiden Quellen sind sich nicht immer einig - Michael Olise ist bei ESPN
Mittelfeld, bei kicker Sturm. Gefuellt wird die Tabelle durch
`import_kicker_positionen.py`.
"""

import re
import unicodedata

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models

VALID_POSITIONS = {"G", "D", "M", "F"}


def normalize(name: str) -> str:
    text = unicodedata.normalize("NFKD", name or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z]+", " ", text.lower()).strip()


def lookup(db: Session, name: str) -> str | None:
    """kicker-Position zu einem Spielernamen, oder None wenn unbekannt bzw.
    nicht eindeutig (zwei gleichnamige Spieler mit anderer Position)."""
    key = normalize(name)
    if not key:
        return None

    positions = set(
        db.scalars(
            select(models.KickerPosition.position).where(models.KickerPosition.name_key == key)
        ).all()
    )
    if len(positions) == 1:
        return positions.pop()
    if positions:
        return None  # mehrdeutig

    # Zweiter Versuch ueber den Nachnamen
    last = key.split()[-1] if key.split() else ""
    if not last:
        return None
    positions = set(
        db.scalars(
            select(models.KickerPosition.position).where(
                models.KickerPosition.name_key.like("% " + last)
            )
        ).all()
    )
    return positions.pop() if len(positions) == 1 else None
