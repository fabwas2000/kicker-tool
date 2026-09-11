"""Standard-Wertungsregeln nach dem offiziellen kicker-Managerspiel Interactive.

Recherchiert am 2026-09-10, Quellen:
  - https://www.kicker.de/spielregeln-managerspiel-interactive-782799/artikel
  - https://www.spox.com/fussball/news/wie-funktioniert-das-kicker-managerspiel-interactive-...

Diese Werte sind nur der Startwert: das Frontend kann sie unter
"Einstellungen" ändern, gespeichert wird das Ergebnis in der settings-Tabelle.
"""

# Note 1,0 = 10 Punkte, je halbe Note schlechter 2 Punkte weniger.
GRADE_POINTS = {
    "1.0": 10,
    "1.5": 8,
    "2.0": 6,
    "2.5": 4,
    "3.0": 2,
    "3.5": 0,
    "4.0": -2,
    "4.5": -4,
    "5.0": -6,
    "5.5": -8,
    "6.0": -10,
}

DEFAULT_SCORING_RULES = {
    "gradePoints": GRADE_POINTS,
    # Einsatzpunkte
    "starter": 4,
    "substitute": 2,
    # Tore sind positionsabhängig (ESPN-Positionskürzel des Kaderspielers)
    "goalByPosition": {"G": 6, "D": 5, "M": 4, "F": 3},
    "assist": 2,
    "cleanSheetGoalkeeper": 2,
    "playerOfTheMatch": 3,
    "yellowRedCard": -3,
    "redCard": -6,
    "ownGoal": 0,
}

SCORING_RULES_KEY = "scoring_rules"
