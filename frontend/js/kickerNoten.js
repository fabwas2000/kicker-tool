// Noten, Tore und Vorlagen aus dem kicker-Managerspiel uebernehmen.
//
// Das Backend liefert die offiziellen Werte je Spiel (/api/kicker/spieltag),
// zugeordnet werden sie HIER, weil nur das Frontend die ESPN-Spieldaten hat -
// und gespeichert wird ueber denselben Weg wie die Handeingabe. Damit gilt
// fuer kicker-Werte dieselbe Regel wie fuer Korrekturen von Hand: Tore und
// Vorlagen werden nur gespeichert, wo sie von ESPN abweichen, sonst bleibt
// null ("ESPN-Wert gilt").
//
// Uebernommen werden nur Spiele, die kicker schon bewertet hat. Ein beendetes,
// aber noch nicht ausgewertetes Spiel hat bei kicker ueberall null - das
// wuerde sonst vorhandene Handeingaben mit "nichts" ueberschreiben.
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  var STATUS_TEXT = {
    SCHEDULED: "noch nicht gespielt",
    PRELIMINARY_LINEUP: "noch nicht gespielt",
    FINAL_LINEUP: "noch nicht gespielt",
    LIVE: "läuft",
    HALTED: "unterbrochen",
    FINISHED: "beendet, Noten fehlen noch",
  };

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
   * Ordnet die eingesetzten kicker-Spieler den ESPN-Spielern zu.
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
  function zuordnen(kickerSpieler, matchByPlayerId) {
    var espn = [];
    var nachName = {};
    matchByPlayerId.forEach(function (p, id) {
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
          var espnTeam = String(matchByPlayerId.get(ids[0]).teamId);
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

  function autoKarte(p) {
    return p.platzverweis || (p.redCards ? "rot" : null);
  }

  /**
   * @param kicker Antwort von /api/kicker/spieltag
   * @param bundle Spieltagsbuendel aus matchdayData.js
   * @returns {eintraege: [GradeIn], bericht}
   */
  function aufbereiten(kicker, bundle) {
    var bewertet = kicker.matches.filter(function (m) { return m.graded; });
    var eingesetzt = [];
    bewertet.forEach(function (m) {
      m.players.forEach(function (k) {
        if (k.played) eingesetzt.push(k);
      });
    });

    var treffer = zuordnen(eingesetzt, bundle.matchByPlayerId);
    var eintraege = [];
    var abweichungen = [];
    var zuordnung = [];

    eingesetzt.forEach(function (k) {
      var id = treffer.get(k);
      if (!id) return;
      var p = bundle.matchByPlayerId.get(id);

      function zahl(kickerWert, espnWert, art) {
        var k0 = kickerWert || 0;
        var e0 = espnWert || 0;
        if (k0 === e0) return null;
        abweichungen.push(k.name + ": " + art + " ESPN " + e0 + " → kicker " + k0);
        return k0;
      }

      var auto = autoKarte(p);
      var karte = null;
      if ((k.card || null) !== auto) {
        karte = k.card || "keine";
        abweichungen.push(k.name + ": Platzverweis ESPN " + (auto || "keiner") + " → kicker " +
          (k.card || "keiner"));
      }

      eintraege.push({
        espn_player_id: id,
        grade: k.no_grade ? null : k.grade,
        no_grade: Boolean(k.no_grade),
        goals: zahl(k.goals, p.goals, "Tore"),
        assists: zahl(k.assists, p.assists, "Vorlagen"),
        player_of_match: Boolean(k.player_of_match),
        red_card_override: karte,
      });
      zuordnung.push({ kicker: k, espnId: id });
    });

    var offen = eingesetzt.filter(function (k) { return !treffer.has(k); });

    return {
      eintraege: eintraege,
      bericht: {
        matchday: kicker.matchday,
        spiele: kicker.matches.map(function (m) {
          return {
            paarung: m.home + " – " + m.guest,
            ergebnis: m.state === "FINISHED" || m.state === "LIVE" || m.graded
              ? m.home_score + ":" + m.guest_score : "",
            bewertet: m.graded,
            text: m.graded ? "Noten da" : STATUS_TEXT[m.state] || m.state,
          };
        }),
        bewerteteSpiele: bewertet.length,
        uebernommen: eintraege.length,
        abweichungen: abweichungen,
        offen: offen.map(function (k) { return k.name + " (" + k.team + ")"; }),
        zuordnung: zuordnung,
        punkteAbweichungen: [],
      },
    };
  }

  /**
   * Nach dem Speichern: Rechnet das Tool fuer jeden aufgestellten Spieler
   * dieselben Punkte wie kicker? Unterschiede zeigen, wo noch etwas nicht
   * stimmt - typischerweise eine abweichende Position (Torpunkte haengen
   * davon ab) oder eine Wertungsregel.
   *
   * @param punkteFuer function(espnId) -> Punkte laut Tool
   */
  function punktePruefen(bericht, bundle, punkteFuer) {
    var geprueft = 0;
    bericht.punkteAbweichungen = [];
    bericht.zuordnung.forEach(function (z) {
      if (!bundle.relevantPlayerIds.has(z.espnId)) return;
      geprueft++;
      var tool = punkteFuer(z.espnId);
      if (tool !== z.kicker.points) {
        bericht.punkteAbweichungen.push(
          z.kicker.name + ": Tool " + tool + ", kicker " + z.kicker.points
        );
      }
    });
    bericht.punkteGeprueft = geprueft;
    return bericht;
  }

  KT.kickerNoten = {
    aufbereiten: aufbereiten,
    punktePruefen: punktePruefen,
  };
})(window.KT);
