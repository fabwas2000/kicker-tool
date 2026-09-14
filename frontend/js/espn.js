// Direkter Client für die versteckte ESPN-API. Läuft ausschließlich im
// Browser, NIE über unser Backend (siehe docs/espn-api.md für die
// recherchierten JSON-Strukturen).
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  var PLAYERS_CACHE_KEY = "kicker-tool:espn-players-cache";
  var PLAYERS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h - Kader ändern sich selten

  function getJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) {
        throw new Error("ESPN-Anfrage fehlgeschlagen (" + res.status + "): " + url);
      }
      return res.json();
    });
  }

  function toYYYYMMDD(date) {
    return date.toISOString().slice(0, 10).replace(/-/g, "");
  }

  /**
   * Der naheliegende `/teams`-Endpoint liefert KEINEN
   * `Access-Control-Allow-Origin`-Header und ist daher aus dem Browser nicht
   * nutzbar, obwohl er serverseitig funktioniert. Stattdessen werden die 18
   * Vereine aus einem großzügigen Scoreboard-Zeitfenster abgeleitet (dieser
   * Endpoint hat CORS korrekt gesetzt) - jede Mannschaft spielt pro Spieltag
   * einmal, ein Fenster von ±60 Tagen deckt also zuverlässig alle 18 ab.
   */
  function fetchTeams() {
    var now = new Date();
    var from = new Date(now);
    from.setDate(from.getDate() - 60);
    var to = new Date(now);
    to.setDate(to.getDate() + 60);

    var url = KT.config.ESPN_BASE + "/scoreboard?dates=" + toYYYYMMDD(from) + "-" + toYYYYMMDD(to);
    return getJson(url).then(function (data) {
      var events = (data && data.events) || [];
      var teams = new Map();

      events.forEach(function (e) {
        var competition = e.competitions && e.competitions[0];
        var competitors = (competition && competition.competitors) || [];
        competitors.forEach(function (c) {
          var t = c.team;
          if (t && t.id && !teams.has(t.id)) {
            teams.set(t.id, {
              id: t.id,
              name: t.displayName,
              abbreviation: t.abbreviation,
              logo: t.logo || null,
            });
          }
        });
      });

      return Array.from(teams.values()).sort(function (a, b) {
        return a.name.localeCompare(b.name, "de");
      });
    });
  }

  function fetchTeamRoster(teamId) {
    return getJson(KT.config.ESPN_BASE + "/teams/" + teamId + "/roster").then(function (data) {
      var teamName = (data && data.team && data.team.displayName) || "";
      var athletes = (data && data.athletes) || [];
      return athletes.map(function (a) {
        return {
          id: a.id,
          name: a.displayName,
          jersey: a.jersey || "",
          position: (a.position && a.position.abbreviation) || "?",
          teamId: String(teamId),
          teamName: teamName,
        };
      });
    });
  }

  function readPlayersCache() {
    try {
      var raw = KT.config.safeGet(PLAYERS_CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (Date.now() - parsed.fetchedAt > PLAYERS_CACHE_TTL_MS) return null;
      return { teams: parsed.teams, players: parsed.players };
    } catch (err) {
      return null;
    }
  }

  /**
   * Lädt Teams + alle 18 Kader und cached das Ergebnis, damit die
   * Spielersuche beim Kaderbau nicht bei jeder Eingabe 19 Requests auslöst.
   */
  function getAllPlayers(options) {
    var forceRefresh = options && options.forceRefresh;
    if (!forceRefresh) {
      var cached = readPlayersCache();
      if (cached) return Promise.resolve(cached);
    }

    var teamList;
    return fetchTeams()
      .then(function (teams) {
        teamList = teams;
        return Promise.all(
          teams.map(function (t) {
            return fetchTeamRoster(t.id);
          })
        );
      })
      .then(function (rosters) {
        var players = [];
        rosters.forEach(function (r) {
          players = players.concat(r);
        });

        KT.config.safeSet(
          PLAYERS_CACHE_KEY,
          JSON.stringify({ fetchedAt: Date.now(), teams: teamList, players: players })
        );

        return { teams: teamList, players: players };
      });
  }

  /** Standard-Zeitfenster für "der aktuelle Spieltag": gestern bis in 3 Tagen. */
  function defaultMatchdayDateRange(now) {
    now = now || new Date();
    var from = new Date(now);
    from.setDate(from.getDate() - 1);
    var to = new Date(now);
    to.setDate(to.getDate() + 3);
    return { from: toYYYYMMDD(from), to: toYYYYMMDD(to) };
  }

  function fetchScoreboard(dateFrom, dateTo) {
    var url = KT.config.ESPN_BASE + "/scoreboard?dates=" + dateFrom + "-" + dateTo;
    return getJson(url).then(function (data) {
      var events = (data && data.events) || [];
      return events.map(function (e) {
        var comp = e.competitions && e.competitions[0];
        var competitors = ((comp && comp.competitors) || [])
          .map(function (c) {
            return {
              teamId: c.team && c.team.id,
              teamName: c.team && c.team.displayName,
              // Wappen kommen direkt von ESPN (oeffentliche CDN-URL, keine
              // Anmeldung/CORS-Huerde beim reinen <img>-Einbinden) - anders
              // als Spielerfotos braucht das kein eigenes Backend-Archiv.
              logo: c.team && c.team.logo,
              homeAway: c.homeAway,
              score: c.score,
            };
          })
          // Heimmannschaft immer zuerst - ESPN garantiert die Reihenfolge
          // im Array nicht, alle Ansichten verlassen sich aber darauf.
          .sort(function (a, b) {
            if (a.homeAway === b.homeAway) return 0;
            return a.homeAway === "home" ? -1 : 1;
          });
        var statusType = (e.status && e.status.type) || {};
        return {
          id: e.id,
          date: e.date,
          shortName: e.shortName,
          state: statusType.state || "pre", // pre | in | post
          statusDetail: statusType.shortDetail || "",
          completed: Boolean(statusType.completed),
          competitors: competitors,
        };
      });
    });
  }

  /**
   * Holt Tor-/Vorlagen-Ereignisse für ein Spiel. Eigentore werden in v1
   * bewusst NICHT gewertet (siehe docs/espn-api.md, Abschnitt 4.1).
   * Gibt eine flache Liste zurück, je Eintrag genau ein betroffener Spieler
   * (kind: "goal" | "assist").
   */
  function fetchMatchScoringEvents(eventId, matchLabel) {
    return getJson(KT.config.ESPN_BASE + "/summary?event=" + eventId).then(function (data) {
      var keyEvents = (data && data.keyEvents) || [];
      var results = [];

      keyEvents.forEach(function (ev) {
        var type = ev.type || {};
        var isGoal = ev.scoringPlay === true && type.type !== "own-goal";
        if (!isGoal) return;

        var participants = ev.participants || [];
        var minute = (ev.clock && ev.clock.displayValue) || "";
        var scorer = participants[0] && participants[0].athlete;
        var assister = participants[1] && participants[1].athlete;

        if (scorer) {
          results.push({
            kind: "goal",
            playerId: scorer.id,
            playerName: scorer.displayName,
            minute: minute,
            matchLabel: matchLabel,
          });
        }
        if (assister) {
          results.push({
            kind: "assist",
            playerId: assister.id,
            playerName: assister.displayName,
            minute: minute,
            matchLabel: matchLabel,
          });
        }
      });

      return results;
    });
  }

  // ---------------------------------------------------------------------
  // Spieldetails: wer hat gespielt, wer hat getroffen, wer sass draussen
  // ---------------------------------------------------------------------

  // Die Kennung traegt eine Versionsnummer: Beendete Spiele liegen dauerhaft
  // im localStorage, und ein Eintrag, der vor einer Erweiterung geschrieben
  // wurde, kennt neue Felder nicht. Beim Nachruesten der Wappen hat genau das
  // schon einmal zu einer stillen Luecke gefuehrt. Wird das Format erweitert,
  // wird hier hochgezaehlt - dann bauen sich die Eintraege einmal neu auf.
  var DETAIL_CACHE_PREFIX = "kicker-tool:match-detail:v4:";

  function statValue(player, name) {
    var stats = player.stats || [];
    for (var i = 0; i < stats.length; i++) {
      if (stats[i].name === name) return stats[i].value || 0;
    }
    return 0;
  }

  /**
   * Destilliert aus dem (grossen) Summary-Response nur das, was die Wertung
   * braucht. Das Ergebnis ist klein genug, um es pro Spiel in localStorage zu
   * cachen - abgeschlossene Spiele muessen so nie erneut geladen werden.
   */
  /**
   * Die Ereignisse eines Spiels in unserer eigenen, schlanken Form.
   *
   * ESPN liefert unter keyEvents alles: Tore, Karten, Auswechslungen, aber
   * auch Anpfiff und Halbzeit. Hier bleibt nur, was im Ticker etwas zu
   * suchen hat.
   *
   * Die Art wird NICHT auf feste Kennungen abgebildet, sondern als
   * Zeichenkette uebernommen ("goal---header", "yellow-red-card", ...). ESPN
   * hat viele Spielarten davon, und eine feste Liste waere bei der naechsten
   * unbekannten Variante still unvollstaendig. Ausgewertet wird spaeter ueber
   * Teilzeichenketten.
   */
  function ereignisseAusSummary(data) {
    var IGNORIEREN = /^(kickoff|halftime|start-2nd-half|end-regular-time|end-of-game|penalty-shootout)/;

    return (data.keyEvents || [])
      .filter(function (ev) {
        var art = (ev.type && ev.type.type) || "";
        return art && !IGNORIEREN.test(art);
      })
      .map(function (ev) {
        var beteiligte = (ev.participants || [])
          .map(function (t) {
            return t && t.athlete ? { id: t.athlete.id, name: t.athlete.displayName } : null;
          })
          .filter(Boolean);
        return {
          // Stabile Kennung von ESPN. Damit laesst sich ein Ereignis ueber
          // mehrere Abrufe hinweg wiedererkennen - noetig, um ein spaeter
          // aberkanntes Tor zu bemerken.
          id: ev.id || null,
          art: (ev.type && ev.type.type) || "",
          minute: (ev.clock && ev.clock.displayValue) || "",
          // Sekunden seit Anpfiff DIESES Spiels.
          sekunde: (ev.clock && ev.clock.value) || 0,
          // Echte Uhrzeit. Die Spielminute taugt nicht zum Sortieren ueber
          // mehrere Partien hinweg: Ein Tor in der 90. Minute der
          // Freitagspartie faellt lange VOR einem Tor in der 10. Minute am
          // Sonntag.
          zeit: ev.wallclock || null,
          teamId: (ev.team && ev.team.id) || null,
          tor: ev.scoringPlay === true,
          beteiligte: beteiligte,
          text: ev.text || ev.shortText || "",
        };
      });
  }

  function distillSummary(data, event) {
    var players = {};
    var goalMinutes = {};
    // Art des Platzverweises je Spieler: "gelbrot" oder "rot".
    //
    // Die Spielerstatistik fuehrt nur "redCards" und zaehlt beides zusammen -
    // eine Gelb-Rote ist dort von einer glatten Roten nicht zu unterscheiden.
    // Nur die Ereignisliste nennt die Art, und die beiden kosten
    // unterschiedlich viele Punkte.
    var platzverweise = {};
    (data.keyEvents || []).forEach(function (ev) {
      var art = (ev.type && ev.type.type) || "";
      if (!/red-card/.test(art)) return;
      var athlete = (ev.participants || [])[0] && ev.participants[0].athlete;
      if (!athlete) return;
      platzverweise[athlete.id] = /yellow-red|second-yellow/.test(art) ? "gelbrot" : "rot";
    });

    (data.keyEvents || []).forEach(function (ev) {
      var type = ev.type || {};
      if (ev.scoringPlay !== true || type.type === "own-goal") return;
      var participants = ev.participants || [];
      var minute = (ev.clock && ev.clock.displayValue) || "";
      [0, 1].forEach(function (idx) {
        var athlete = participants[idx] && participants[idx].athlete;
        if (!athlete) return;
        if (!goalMinutes[athlete.id]) goalMinutes[athlete.id] = [];
        goalMinutes[athlete.id].push({ kind: idx === 0 ? "goal" : "assist", minute: minute });
      });
    });

    (data.rosters || []).forEach(function (teamRoster) {
      var team = teamRoster.team || {};
      var opponent = (event.competitors || []).filter(function (c) {
        return c.teamId !== team.id;
      })[0];

      (teamRoster.roster || []).forEach(function (p) {
        var athlete = p.athlete || {};
        var starter = Boolean(p.starter);
        var subbedIn = Boolean(p.subbedIn);
        players[athlete.id] = {
          playerId: athlete.id,
          playerName: athlete.displayName,
          teamId: team.id,
          teamName: team.displayName,
          opponentName: opponent ? opponent.teamName : "",
          // Status des Spiels ("pre"/"in"/"post") direkt am Spieler, damit
          // die Live-Ansicht ohne Zusatzlookup weiss, ob "aktiv im Spiel"
          // ueberhaupt eine sinnvolle Aussage ist.
          matchState: event.state,
          played: starter || subbedIn,
          starter: starter,
          subbedIn: subbedIn,
          subbedOut: Boolean(p.subbedOut),
          goals: statValue(p, "totalGoals"),
          assists: statValue(p, "goalAssists"),
          ownGoals: statValue(p, "ownGoals"),
          yellowCards: statValue(p, "yellowCards"),
          redCards: statValue(p, "redCards"),
          goalsConceded: statValue(p, "goalsConceded"),
          saves: statValue(p, "saves"),
          positionAbbr: (p.position && p.position.abbreviation) || "",
          events: goalMinutes[athlete.id] || [],
          platzverweis: platzverweise[athlete.id] || null,
        };
      });
    });

    return {
      eventId: event.id,
      shortName: event.shortName,
      state: event.state,
      statusDetail: event.statusDetail,
      competitors: event.competitors,
      players: players,
      ereignisse: ereignisseAusSummary(data),
    };
  }

  function readDetailCache(eventId) {
    try {
      var raw = KT.config.safeGet(DETAIL_CACHE_PREFIX + eventId);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  /**
   * Spieldetails fuer EIN Spiel. Beendete Spiele kommen aus dem Cache,
   * laufende werden immer frisch geholt. Noch nicht angepfiffene Spiele
   * brauchen gar keinen Request.
   */
  function fetchMatchDetail(event) {
    if (event.state === "pre") {
      return Promise.resolve({
        eventId: event.id,
        shortName: event.shortName,
        state: event.state,
        statusDetail: event.statusDetail,
        competitors: event.competitors,
        players: {},
      });
    }

    if (event.state === "post") {
      var cached = readDetailCache(event.id);
      if (cached) {
        // Die Mannschaftsangaben NICHT aus dem Cache nehmen, sondern aus dem
        // gerade geladenen Spielplan. Beendete Spiele liegen dauerhaft im
        // localStorage; ein Cache, der vor einer Erweiterung geschrieben
        // wurde, kennt neu hinzugekommene Felder nicht - genau so fehlten
        // nach dem Nachruesten der Wappen in der Notenansicht saemtliche
        // Vereinswappen. Teuer und cachewuerdig sind die Spielerdaten, die
        // Mannschaftskoepfe stehen ohnehin schon im Spielplan.
        cached.competitors = event.competitors || cached.competitors;
        return Promise.resolve(cached);
      }
    }

    return getJson(KT.config.ESPN_BASE + "/summary?event=" + event.id).then(function (data) {
      var detail = distillSummary(data, event);
      if (event.state === "post") {
        KT.config.safeSet(DETAIL_CACHE_PREFIX + event.id, JSON.stringify(detail));
      }
      return detail;
    });
  }

  /** Spieldetails fuer einen kompletten Spieltag (9 Partien). */
  function fetchMatchdayDetails(events) {
    return Promise.all(events.map(fetchMatchDetail));
  }

  KT.espn = {
    fetchTeams: fetchTeams,
    fetchTeamRoster: fetchTeamRoster,
    getAllPlayers: getAllPlayers,
    defaultMatchdayDateRange: defaultMatchdayDateRange,
    fetchScoreboard: fetchScoreboard,
    fetchMatchScoringEvents: fetchMatchScoringEvents,
    fetchMatchDetail: fetchMatchDetail,
    fetchMatchdayDetails: fetchMatchdayDetails,
  };
})(window.KT);
