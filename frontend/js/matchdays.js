// Spieltags-Index. ESPN kennt fuer die Bundesliga KEINE Spieltagsnummern
// (weder week, round noch matchday - in keinem Endpoint). Der Index wird
// deshalb aus dem Spielplan rekonstruiert: alle Saisonspiele chronologisch
// sortieren und in 9er-Bloecke gruppieren. Das ist zulaessig, weil jede der
// 18 Mannschaften pro Spieltag genau einmal spielt - beim Aufbau wird genau
// das auch geprueft (siehe `clean`).
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  var CACHE_KEY = "kicker-tool:matchday-index";
  var CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  var GAMES_PER_MATCHDAY = 9;

  var memoryCache = null;

  /** Saison-Startjahr: ab Juli zaehlt das laufende Jahr, davor das Vorjahr. */
  function seasonStartYear(now) {
    now = now || new Date();
    return now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  }

  function monthRanges(startYear) {
    var months = [];
    for (var i = 0; i < 12; i++) {
      var month = 7 + i; // Juli bis Juni
      var year = startYear + (month > 12 ? 1 : 0);
      var m = month > 12 ? month - 12 : month;
      var lastDay = new Date(year, m, 0).getDate();
      var mm = m < 10 ? "0" + m : String(m);
      months.push({ from: "" + year + mm + "01", to: "" + year + mm + lastDay });
    }
    return months;
  }

  function buildFromEvents(events) {
    var sorted = events.slice().sort(function (a, b) {
      if (a.date === b.date) return a.id < b.id ? -1 : 1;
      return a.date < b.date ? -1 : 1;
    });

    var matchdays = [];
    for (var i = 0; i + GAMES_PER_MATCHDAY <= sorted.length; i += GAMES_PER_MATCHDAY) {
      var block = sorted.slice(i, i + GAMES_PER_MATCHDAY);
      var teams = {};
      block.forEach(function (e) {
        e.competitors.forEach(function (c) {
          teams[c.teamId] = true;
        });
      });
      matchdays.push({
        number: matchdays.length + 1,
        events: block,
        clean: Object.keys(teams).length === 18,
        from: block[0].date,
        to: block[block.length - 1].date,
      });
    }
    return matchdays;
  }

  function readCache() {
    try {
      var raw = KT.config.safeGet(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
      if (parsed.season !== seasonStartYear()) return null;
      return parsed.matchdays;
    } catch (err) {
      return null;
    }
  }

  /**
   * Liefert [{number, events, from, to, clean}] fuer die laufende Saison.
   * Erster Aufruf kostet 12 Requests (monatsweise, weil das Scoreboard pro
   * Anfrage bei 100 Events deckelt), danach aus dem Cache.
   */
  function getIndex(options) {
    var force = options && options.forceRefresh;
    if (!force) {
      if (memoryCache) return Promise.resolve(memoryCache);
      var cached = readCache();
      if (cached) {
        memoryCache = cached;
        return Promise.resolve(cached);
      }
    }

    var ranges = monthRanges(seasonStartYear());
    return Promise.all(
      ranges.map(function (r) {
        return KT.espn.fetchScoreboard(r.from, r.to).catch(function () {
          return []; // einzelner Monat darf ausfallen, ohne alles zu kippen
        });
      })
    ).then(function (lists) {
      var byId = {};
      lists.forEach(function (list) {
        list.forEach(function (e) {
          byId[e.id] = e;
        });
      });
      var events = Object.keys(byId).map(function (id) {
        return byId[id];
      });

      var matchdays = buildFromEvents(events);
      memoryCache = matchdays;
      KT.config.safeSet(
        CACHE_KEY,
        JSON.stringify({
          fetchedAt: Date.now(),
          season: seasonStartYear(),
          matchdays: matchdays,
        })
      );
      return matchdays;
    });
  }

  function toYYYYMMDD(date) {
    return date.toISOString().slice(0, 10).replace(/-/g, "");
  }

  /**
   * Spielstatus und Zwischenstaende eines Spieltags frisch holen.
   *
   * Wichtig: der Index wird 12 Stunden gecacht, der darin gespeicherte
   * `state` ist also schnell veraltet. Wer die App vormittags oeffnet, haette
   * abends noch "pre" stehen - und weil fuer "pre" gar keine Spieldaten
   * geladen werden, gaebe es waehrend der Spiele keine Punkte. Deshalb wird
   * der Status beim Laden eines Spieltags immer neu abgefragt.
   */
  function withFreshState(md) {
    if (!md || !md.events.length) return Promise.resolve([]);
    var from = new Date(md.from);
    from.setDate(from.getDate() - 1);
    var to = new Date(md.to);
    to.setDate(to.getDate() + 1);

    return KT.espn
      .fetchScoreboard(toYYYYMMDD(from), toYYYYMMDD(to))
      .then(function (fresh) {
        var byId = {};
        fresh.forEach(function (e) {
          byId[e.id] = e;
        });
        return md.events.map(function (e) {
          return byId[e.id] || e;
        });
      })
      .catch(function () {
        return md.events; // ohne Netz lieber die alten Daten als gar keine
      });
  }

  /**
   * Aktueller Spieltag - anhand der Anstosszeiten, nicht anhand des
   * gecachten Status (der kann veraltet sein). Laeuft gerade ein Spieltag,
   * ist das seiner; sonst der zuletzt beendete.
   */
  function currentMatchday(matchdays, now) {
    var jetzt = (now || new Date()).getTime();
    var current = 1;
    for (var i = 0; i < matchdays.length; i++) {
      var md = matchdays[i];
      var start = new Date(md.from).getTime();
      var ende = new Date(md.to).getTime() + 3 * 60 * 60 * 1000; // letztes Spiel + 3h
      if (jetzt >= start && jetzt <= ende) return md.number;
      if (jetzt > ende) current = md.number;
    }
    return current;
  }

  function statusOf(matchday) {
    var states = matchday.events.map(function (e) {
      return e.state;
    });
    if (states.some(function (s) { return s === "in"; })) return "live";
    if (states.every(function (s) { return s === "post"; })) return "beendet";
    if (states.every(function (s) { return s === "pre"; })) return "kommend";
    return "laufend";
  }

  KT.matchdays = {
    getIndex: getIndex,
    withFreshState: withFreshState,
    currentMatchday: currentMatchday,
    statusOf: statusOf,
    seasonStartYear: seasonStartYear,
  };
})(window.KT);
