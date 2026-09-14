// EINE zentrale Wertungslogik. Alle Punktwerte kommen aus den Regeln
// (Backend: /api/scoring-rules, im Tool unter "Einstellungen" editierbar),
// nichts ist hier fest verdrahtet. Neue Regel ergaenzen = in den Defaults
// einen Wert aufnehmen und hier eine Zeile in playerPoints() dazu.
//
// Standard entspricht dem kicker-Managerspiel Interactive:
//   Note 1,0 = 10 Punkte, je halbe Note schlechter 2 Punkte weniger
//   Startelf +4, Einwechslung +2
//   Tor: TW 6 / ABW 5 / MF 4 / STU 3, Vorlage +2
//   TW ohne Gegentor +2, Gelb-Rot -3, Rot -6
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  var FALLBACK_RULES = {
    gradePoints: {
      "1.0": 10, "1.5": 8, "2.0": 6, "2.5": 4, "3.0": 2, "3.5": 0,
      "4.0": -2, "4.5": -4, "5.0": -6, "5.5": -8, "6.0": -10,
    },
    starter: 4,
    substitute: 2,
    goalByPosition: { G: 6, D: 5, M: 4, F: 3 },
    assist: 2,
    cleanSheetGoalkeeper: 2,
    playerOfTheMatch: 3,
    yellowRedCard: -3,
    redCard: -6,
    ownGoal: 0,
  };

  var GRADE_STEPS = ["1.0", "1.5", "2.0", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0", "5.5", "6.0"];

  // Positionen stammen von kicker (siehe backend/import_kicker_positionen.py),
  // ESPN dient nur als Rueckfall - die Torpunkte haengen davon ab.
  var POSITION_LABEL = { G: "Torwart", D: "Abwehr", M: "Mittelfeld", F: "Sturm" };

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function gradeKey(grade) {
    return Number(grade).toFixed(1);
  }

  function pointsForGrade(grade, rules) {
    if (grade === null || grade === undefined || grade === "") return 0;
    var table = (rules && rules.gradePoints) || FALLBACK_RULES.gradePoints;
    var direct = table[gradeKey(grade)];
    if (direct !== undefined) return num(direct, 0);
    // Zwischenwert (z.B. 2,3): linear aus der offiziellen Formel ableiten,
    // 1,0 = 10 Punkte, pro ganze Note 4 Punkte weniger.
    return Math.round((10 - (Number(grade) - 1) * 4) * 10) / 10;
  }

  /** Manuell korrigierter Wert schlaegt den ESPN-Wert. */
  function effective(manualValue, espnValue) {
    return manualValue === null || manualValue === undefined ? (espnValue || 0) : manualValue;
  }

  /**
   * Punkte fuer EINEN aufgestellten Spieler.
   *
   * @param player   Kaderdaten {espn_player_id, name, position}
   * @param match    Spieldaten aus espn.js (oder null, wenn nicht im Kader/kein Spiel)
   * @param manual   manuelle Eingaben {grade, goals, assists, player_of_match}
   *                 - goals/assists null bedeutet "ESPN-Wert gilt"
   * @param rules    Wertungsregeln
   * @returns {points, parts: [{label, points, manual}], played}
   */
  function playerPoints(player, match, manual, rules) {
    rules = rules || FALLBACK_RULES;
    manual = manual || {};
    var parts = [];
    var total = 0;

    function add(label, points, isManual) {
      if (!points) return;
      parts.push({ label: label, points: points, manual: Boolean(isManual) });
      total += points;
    }

    if (!match || !match.played) {
      // Nicht eingesetzt: keine Punkte. Eine trotzdem eingetragene Note wird
      // bewusst ignoriert - ohne Einsatz gibt es im kicker keine Note.
      return { points: 0, parts: parts, played: false };
    }

    add(match.starter ? "Startelf" : "Einwechslung",
        match.starter ? num(rules.starter, 0) : num(rules.substitute, 0));

    var grade = manual.grade;
    if (grade !== null && grade !== undefined && grade !== "") {
      add("Note " + gradeKey(grade).replace(".", ","), pointsForGrade(grade, rules));
    }

    var goals = effective(manual.goals, match.goals);
    if (goals) {
      var byPos = (rules.goalByPosition || FALLBACK_RULES.goalByPosition);
      var perGoal = num(byPos[player && player.position], num(byPos.M, 0));
      add(goals + "× Tor", perGoal * goals, manual.goals !== null && manual.goals !== undefined);
    }

    var assists = effective(manual.assists, match.assists);
    if (assists) {
      add(assists + "× Vorlage", num(rules.assist, 0) * assists,
          manual.assists !== null && manual.assists !== undefined);
    }

    if (manual.player_of_match) {
      add("Spieler des Spiels", num(rules.playerOfTheMatch, 0), true);
    }

    if (match.ownGoals) {
      add(match.ownGoals + "× Eigentor", num(rules.ownGoal, 0) * match.ownGoals);
    }
    // Gelb-Rot und glatt Rot kosten unterschiedlich viel. Welche es war,
    // steht NICHT in der Spielerstatistik - "redCards" zaehlt beides
    // zusammen. Die Art kommt deshalb aus der Ereignisliste (siehe
    // espn.js). Fehlt sie (aelterer Zwischenspeicher), gilt wie bisher die
    // glatte Rote.
    if (match.platzverweis === "gelbrot") {
      add("Gelb-Rote Karte", num(rules.yellowRedCard, 0));
    } else if (match.redCards) {
      add("Rote Karte", num(rules.redCard, 0) * match.redCards);
    }
    if (player && player.position === "G" && !match.goalsConceded && match.starter) {
      add("Zu Null", num(rules.cleanSheetGoalkeeper, 0));
    }

    return { points: total, parts: parts, played: true };
  }

  /**
   * Wertung fuer alle Konkurrenten eines Spieltags.
   *
   * @param competitors [{competitorId, competitorName, lineup, squadById}]
   * @param matchByPlayerId Map<playerId, matchData>
   * @param manualByPlayerId Map<playerId, {grade, goals, assists, player_of_match}>
   * @param rules Wertungsregeln
   */
  function computeMatchdayScores(competitors, matchByPlayerId, manualByPlayerId, rules) {
    var table = competitors.map(function (entry) {
      var slots = [];
      var total = 0;
      var lineupPlayers = (entry.lineup && entry.lineup.players) || [];

      lineupPlayers.forEach(function (lp) {
        var player = entry.squadById ? entry.squadById[lp.espn_player_id] : null;
        var match = matchByPlayerId.get(lp.espn_player_id) || null;
        var manual = manualByPlayerId.get(lp.espn_player_id) || null;
        var result = playerPoints(player, match, manual, rules);
        total += result.points;

        slots.push({
          slot: lp.slot,
          playerId: lp.espn_player_id,
          playerName: (player && player.name) || (match && match.playerName) || lp.espn_player_id,
          position: player && player.position,
          teamId: (player && player.espn_team_id) || (match && match.teamId) || null,
          teamName: (player && player.team_name) || (match && match.teamName) || "",
          match: match,
          manual: manual,
          grade: manual ? manual.grade : null,
          // "-" (bewusst keine Note): grade bleibt null, aber die Note gilt
          // trotzdem als eingetragen - anders als "noch gar nichts erfasst".
          noGrade: Boolean(manual && manual.no_grade),
          points: result.points,
          parts: result.parts,
          played: result.played,
        });
      });

      return {
        competitorId: entry.competitorId,
        competitorName: entry.competitorName,
        formation: entry.lineup && entry.lineup.formation,
        hasLineup: Boolean(entry.lineup),
        total: total,
        slots: slots,
      };
    });

    table.sort(function (a, b) {
      return b.total - a.total;
    });
    return table;
  }

  KT.scoring = {
    FALLBACK_RULES: FALLBACK_RULES,
    GRADE_STEPS: GRADE_STEPS,
    POSITION_LABEL: POSITION_LABEL,
    pointsForGrade: pointsForGrade,
    playerPoints: playerPoints,
    computeMatchdayScores: computeMatchdayScores,
  };
})(window.KT);
