// Laedt alles, was ein Spieltag braucht, und buendelt es zu einem Objekt:
// Spielplan + Spielerdaten (ESPN) sowie Aufstellungen, Noten und
// Wertungsregeln (eigenes Backend).
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  var rulesCache = null;

  function getRules(forceRefresh) {
    if (rulesCache && !forceRefresh) return Promise.resolve(rulesCache);
    return KT.api
      .getScoringRules()
      .then(function (rules) {
        rulesCache = rules;
        return rules;
      })
      .catch(function () {
        // Backend weg: mit den Standardregeln weiterrechnen statt aufzugeben
        return KT.scoring.FALLBACK_RULES;
      });
  }

  function clearRulesCache() {
    rulesCache = null;
  }

  /**
   * @param matchdayNumber 1..34
   * @returns Promise<{matchday, events, details, matchByPlayerId, competitors,
   *                   manualByPlayerId, rules, relevantPlayerIds, backendError}>
   */
  function load(matchdayNumber) {
    var bundle = { matchday: matchdayNumber, backendError: null };

    return KT.matchdays
      .getIndex()
      .then(function (index) {
        var md = index.filter(function (m) {
          return m.number === matchdayNumber;
        })[0];
        bundle.matchdayInfo = md || null;
        // Status/Spielstand immer frisch - der Index ist gecacht.
        return KT.matchdays.withFreshState(md);
      })
      .then(function (events) {
        bundle.events = events;
        if (bundle.matchdayInfo) bundle.matchdayInfo.events = events;

        return Promise.all([
          KT.espn.fetchMatchdayDetails(bundle.events),
          KT.api.getAllLineupsForMatchday(matchdayNumber).catch(function (err) {
            bundle.backendError = KT.ui.backendErrorText(err);
            return [];
          }),
          KT.api.getGrades(matchdayNumber).catch(function () {
            return [];
          }),
          getRules(),
        ]);
      })
      .then(function (results) {
        bundle.details = results[0];
        var rawLineups = results[1];
        var grades = results[2];
        bundle.rules = results[3];

        // Spielerdaten aller 9 Partien in eine Map
        bundle.matchByPlayerId = new Map();
        bundle.details.forEach(function (detail) {
          Object.keys(detail.players).forEach(function (playerId) {
            bundle.matchByPlayerId.set(playerId, detail.players[playerId]);
          });
        });

        // Alle manuellen Eingaben zu einem Spieler: Note, Tor-/Vorlagen-
        // korrekturen und "Spieler des Spiels".
        bundle.manualByPlayerId = new Map();
        grades.forEach(function (g) {
          bundle.manualByPlayerId.set(g.espn_player_id, g);
        });

        // Spieler, die bei mindestens einem Konkurrenten aufgestellt sind
        bundle.relevantPlayerIds = new Set();
        rawLineups.forEach(function (r) {
          ((r.lineup && r.lineup.players) || []).forEach(function (p) {
            bundle.relevantPlayerIds.add(p.espn_player_id);
          });
        });

        // Kader nur fuer Konkurrenten laden, die auch aufgestellt haben -
        // daraus kommen Position und Name fuer die Wertung.
        var withLineup = rawLineups.filter(function (r) {
          return r.lineup;
        });
        return Promise.all(
          withLineup.map(function (r) {
            return KT.api.getSquad(r.competitor_id).catch(function () {
              return [];
            });
          })
        ).then(function (squads) {
          var squadByCompetitor = {};
          // Flache Sicht ueber alle Kader - die Noten-Maske braucht die
          // Position (kicker), um Punkte auch fuer Spieler zu zeigen, die
          // gerade nicht aufgestellt sind.
          bundle.squadPlayerById = {};
          withLineup.forEach(function (r, i) {
            var map = {};
            squads[i].forEach(function (p) {
              map[p.espn_player_id] = p;
              bundle.squadPlayerById[p.espn_player_id] = p;
            });
            squadByCompetitor[r.competitor_id] = map;
          });

          bundle.competitors = rawLineups.map(function (r) {
            return {
              competitorId: r.competitor_id,
              competitorName: r.competitor_name,
              lineup: r.lineup,
              squadById: squadByCompetitor[r.competitor_id] || {},
            };
          });
          return bundle;
        });
      });
  }

  KT.matchdayData = {
    load: load,
    getRules: getRules,
    clearRulesCache: clearRulesCache,
  };
})(window.KT);
