// Zuordnung kicker-Spieler -> ESPN-Spieler, ueber den Namen.
//
// Die App fuehrt Spieler unter ihrer ESPN-ID, kicker unter eigenen IDs - eine
// gemeinsame Kennung gibt es nicht. Gebraucht vom Noten- und vom
// Aufstellungs-Import. An den Spieltagen 1-4 2026/27 geprueft: alle 1136
// eingesetzten Spieler richtig zugeordnet, auch die Sonderfaelle (koreanische
// Namen in anderer Reihenfolge, gekuerzte Doppelnamen, andere Umschrift).
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  // Buchstaben, die beim Zerlegen in Grundbuchstabe + Akzent NICHT zerfallen
  // und sonst einfach wegfielen: ESPN schreibt "Højlund", kicker "Höjlund".
  var ERSATZ = { "ø": "o", "æ": "ae", "ß": "ss", "ł": "l", "đ": "d", "ı": "i" };

  function tokens(name) {
    var text = String(name || "").toLowerCase().replace(/[øæßłđı]/g, function (c) {
      return ERSATZ[c];
    });
    return KT.positions.normalize(text).split(" ").filter(Boolean);
  }

  function anzahlIn(gross, klein) {
    return klein.filter(function (t) { return t.length >= 3 && gross.indexOf(t) > -1; }).length;
  }

  /** Unterscheiden sich a und b um hoechstens einen Buchstaben? */
  function fastGleich(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    var i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
  }

  /**
   * Nachnamen mit anderer Umschrift: kicker "Duric", ESPN "Djuric" (Đurić).
   * Ein Buchstabe Unterschied genuegt - aber nur zusammen mit passendem
   * Vornamen, sonst waeren Müller und Möller schnell verwechselt.
   */
  function anzahlAehnlich(gross, nach, vor) {
    if (!anzahlIn(gross, vor)) return 0;
    return nach.filter(function (t) {
      return t.length >= 5 && gross.some(function (g) { return fastGleich(g, t); });
    }).length;
  }

  /**
   * Ordnet kicker-Spieler den ESPN-Spielern zu.
   *
   * @param kickerSpieler [{name, first_name, last_name, team_id}]
   * @param espnSpieler Map<espnId, {playerName, teamId}>
   * @returns Map<kicker-Eintrag, espnId> - nur die Treffer
   *
   * 1. Voller Name eindeutig gleich -> Treffer. Nebenbei lernt das, welcher
   *    kicker-Verein welcher ESPN-Verein ist (Mehrheit der Treffer) - so
   *    braucht es keine eigene Vereinstabelle.
   * 2. Der Rest wird nur noch unter den freien Spielern des passenden
   *    ESPN-Vereins gesucht. ESPN kuerzt Doppelnamen gern ("Amaimouni" statt
   *    "Amaimouni-Echghouyab", "Horst" statt "ter Horst", "Miguel Gutiérrez"
   *    statt "Gutierrez Ortega"), deshalb reicht ein gemeinsamer Teil des
   *    Nachnamens. Gewinnt der Kandidat mit den meisten Treffern im Nach-,
   *    dann im Vornamen - aber nur, wenn er dabei allein vorne liegt.
   */
  function zuordnen(kickerSpieler, espnSpieler) {
    var espn = [];
    var nachName = {};
    espnSpieler.forEach(function (p, id) {
      var t = tokens(p.playerName);
      espn.push({ id: id, teamId: String(p.teamId), tokens: t });
      var key = t.join(" ");
      (nachName[key] = nachName[key] || []).push(id);
    });

    var vergeben = {};
    var treffer = new Map(); // kicker-Eintrag -> ESPN-ID
    var stimmen = {}; // kicker-Verein -> {espnVerein: Anzahl}

    kickerSpieler.forEach(function (k) {
      var schluessel = [tokens(k.first_name + " " + k.last_name).join(" "), tokens(k.name).join(" ")];
      for (var i = 0; i < schluessel.length; i++) {
        var ids = nachName[schluessel[i]] || [];
        if (ids.length === 1 && !vergeben[ids[0]]) {
          treffer.set(k, ids[0]);
          vergeben[ids[0]] = true;
          var espnTeam = String(espnSpieler.get(ids[0]).teamId);
          var s = (stimmen[k.team_id] = stimmen[k.team_id] || {});
          s[espnTeam] = (s[espnTeam] || 0) + 1;
          return;
        }
      }
    });

    var vereinZu = {};
    Object.keys(stimmen).forEach(function (kt) {
      vereinZu[kt] = Object.keys(stimmen[kt]).sort(function (a, b) {
        return stimmen[kt][b] - stimmen[kt][a];
      })[0];
    });

    kickerSpieler.forEach(function (k) {
      if (treffer.has(k) || !vereinZu[k.team_id]) return;
      var nach = tokens(k.last_name);
      var vor = tokens(k.first_name);
      var kandidaten = espn
        .filter(function (e) {
          return e.teamId === vereinZu[k.team_id] && !vergeben[e.id];
        })
        .map(function (e) {
          var n = anzahlIn(e.tokens, nach) || anzahlAehnlich(e.tokens, nach, vor);
          // Nachname zaehlt vor Vorname: 100 statt 1 je Treffer
          return { e: e, nach: n, wert: n * 100 + anzahlIn(e.tokens, vor) };
        })
        .filter(function (c) { return c.nach > 0; })
        .sort(function (a, b) { return b.wert - a.wert; });
      if (kandidaten.length && (kandidaten.length === 1 || kandidaten[0].wert > kandidaten[1].wert)) {
        treffer.set(k, kandidaten[0].e.id);
        vergeben[kandidaten[0].e.id] = true;
      }
    });

    return treffer;
  }

  KT.kickerZuordnung = { zuordnen: zuordnen };
})(window.KT);
