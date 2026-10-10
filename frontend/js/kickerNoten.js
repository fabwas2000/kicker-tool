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

    var treffer = KT.kickerZuordnung.zuordnen(eingesetzt, bundle.matchByPlayerId);
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
