// Kader und Aufstellungen der Konkurrenten aus dem kicker-Managerspiel holen.
//
// Das Backend liefert je Mitglied der hinterlegten kicker-Liga den 22er-Kader
// fuer den Spieltag (/api/kicker/aufstellungen), die ersten elf sind die
// Startelf. Hier wird zugeordnet und ueber dieselben Endpunkte gespeichert wie
// beim Eintragen von Hand:
//   * Konkurrent  <- Mitglied mit gleichem Namen
//   * ESPN-Spieler <- kicker-Spieler, siehe kickerZuordnung.js
//
// Den Kader ersetzt der Import nur fuer den aktuellen oder einen kommenden
// Spieltag. Bei einem frueheren wuerde er sonst den damaligen Kader
// zuruecksetzen und spaetere Transfers verlieren - dort wird nur die Startelf
// gesetzt, mit den Spielern, die heute noch im Kader stehen.
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  // Nur Gross-/Kleinschreibung und Leerzeichen egal - Ziffern zaehlen mit
  // ("Matti2603"), anders als beim Normalisieren von Spielernamen.
  function schluessel(name) {
    return String(name || "").trim().toLowerCase();
  }

  /** Alle Bundesliga-Spieler, die ESPN kennt: Vereinskader plus Spieltagskader. */
  function espnSpieler(matchByPlayerId) {
    return KT.espn.getAllPlayers().then(function (alle) {
      var map = new Map();
      alle.players.forEach(function (p) {
        map.set(String(p.id), { playerName: p.name, teamId: String(p.teamId), teamName: p.teamName });
      });
      // Junge Spieler fehlen in ESPNs Vereinskadern manchmal, stehen aber im
      // Spielbericht.
      (matchByPlayerId || new Map()).forEach(function (p, id) {
        if (!map.has(String(id))) {
          map.set(String(id), { playerName: p.playerName, teamId: String(p.teamId), teamName: p.teamName });
        }
      });
      return map;
    });
  }

  /**
   * Gleiche Formation und je Reihe dieselben Spieler? Die Reihenfolge
   * innerhalb einer Reihe zaehlt nicht - wer von Hand den Linksverteidiger
   * links einsortiert hat, soll das nicht bei jedem Import verlieren.
   */
  function gleicheAufstellung(alt, formation, spieler) {
    if (!alt || alt.formation !== formation || alt.players.length !== spieler.length) return false;
    function je(players) {
      return players.map(function (p) {
        return KT.formationLine(p.slot) + ":" + p.espn_player_id;
      }).sort().join(",");
    }
    return je(alt.players) === je(spieler);
  }

  function kickerSchluessel(k) {
    return k.team_id + "|" + k.name;
  }

  /** Einen Konkurrenten uebernehmen; liefert seine Zeile fuer den Bericht. */
  function einer(competitor, mitglied, espn, espnIdFuer, matchday, kaderErsetzen) {
    var zeile = { name: competitor.name, gefunden: true, formation: mitglied.formation, offen: [], hinweise: [] };
    var vorlage = KT.formations[mitglied.formation];
    if (!vorlage) {
      zeile.fehler = "Formation " + mitglied.formation + " kennt die App nicht";
      return Promise.resolve(zeile);
    }

    mitglied.players.forEach(function (k) {
      if (espnIdFuer(k)) return;
      zeile.offen.push(k.name + " (" + k.team + ")" + (k.departed ? " – nicht mehr in der Bundesliga" : ""));
    });

    return Promise.all([
      KT.api.getSquad(competitor.id),
      KT.api.getLineup(competitor.id, matchday),
    ]).then(function (r) {
      var alterKader = r[0];
      var alteAufstellung = r[1];
      var imKader = new Set(alterKader.map(function (p) { return p.espn_player_id; }));
      var speichern = Promise.resolve();

      if (kaderErsetzen) {
        var neu = mitglied.players.filter(espnIdFuer).map(function (k) {
          var id = espnIdFuer(k);
          var e = espn.get(id);
          return {
            espn_player_id: id,
            espn_team_id: e.teamId,
            name: e.playerName,
            team_name: e.teamName || "",
            position: k.position || "M",
          };
        });
        var zugaenge = neu.filter(function (p) { return !imKader.has(p.espn_player_id); }).length;
        var gleich = zugaenge === 0 && neu.length === alterKader.length;
        if (!gleich) {
          zeile.kader = zugaenge ? zugaenge + " neu im Kader" : "Kader aktualisiert";
          speichern = KT.api.replaceSquad(competitor.id, neu);
        }
        imKader = new Set(neu.map(function (p) { return p.espn_player_id; }));
      }

      var spieler = [];
      mitglied.players.filter(function (k) { return k.starter; }).forEach(function (k, i) {
        var id = espnIdFuer(k);
        if (!id || !vorlage[i]) return;
        if (!imKader.has(id)) {
          zeile.hinweise.push(k.name + " steht nicht mehr im Kader – Startplatz bleibt leer");
          return;
        }
        spieler.push({ slot: vorlage[i].slot, espn_player_id: id });
      });

      if (gleicheAufstellung(alteAufstellung, mitglied.formation, spieler)) {
        zeile.status = "unverändert";
        return speichern.then(function () { return zeile; });
      }
      zeile.status = alteAufstellung ? "aktualisiert" : "neu";
      return speichern
        .then(function () {
          return KT.api.saveLineup(competitor.id, matchday, mitglied.formation, spieler);
        })
        .then(function () { return zeile; });
    }).catch(function (err) {
      zeile.fehler = KT.ui.backendErrorText(err);
      return zeile;
    });
  }

  /**
   * @param matchday Spieltag
   * @param options {kaderErsetzen: bool, matchByPlayerId: Map (optional)}
   * @returns Promise<bericht>
   */
  function importieren(matchday, options) {
    options = options || {};
    return Promise.all([
      KT.api.getKickerAufstellungen(matchday),
      KT.api.listCompetitors(),
      espnSpieler(options.matchByPlayerId),
    ]).then(function (r) {
      var kicker = r[0];
      var nachName = {};
      r[1].forEach(function (c) { nachName[schluessel(c.name)] = c; });
      var espn = r[2];
      var vergeben = {};

      // Alle Kader auf einmal zuordnen statt je Konkurrent: Die Zuordnung
      // lernt aus eindeutigen Namen, welcher kicker-Verein welcher ESPN-Verein
      // ist - in einem einzelnen 22er-Kader stehen dafuer je Verein oft zu
      // wenige Spieler. Jeder Spieler kommt dabei nur einmal vor, auch wenn
      // ihn mehrere Konkurrenten haben.
      var einmalig = new Map();
      kicker.members.forEach(function (m) {
        (m.players || []).forEach(function (k) {
          if (!einmalig.has(kickerSchluessel(k))) einmalig.set(kickerSchluessel(k), k);
        });
      });
      var treffer = KT.kickerZuordnung.zuordnen(Array.from(einmalig.values()), espn);
      function espnIdFuer(k) {
        return treffer.get(einmalig.get(kickerSchluessel(k)));
      }

      var bericht = {
        matchday: matchday,
        kaderErsetzt: Boolean(options.kaderErsetzen),
        zeilen: [],
        ohneKonkurrent: [],
        ohneKicker: [],
      };

      var arbeit = kicker.members.map(function (m) {
        var competitor = nachName[schluessel(m.name)];
        if (!competitor) {
          bericht.ohneKonkurrent.push(m.name);
          return Promise.resolve(null);
        }
        vergeben[competitor.id] = true;
        if (m.error) return Promise.resolve({ name: competitor.name, gefunden: false, fehler: m.error });
        if (!m.found) return Promise.resolve({ name: competitor.name, gefunden: false });
        return einer(competitor, m, espn, espnIdFuer, matchday, options.kaderErsetzen);
      });

      r[1].forEach(function (c) {
        if (!vergeben[c.id]) bericht.ohneKicker.push(c.name);
      });

      return Promise.all(arbeit).then(function (zeilen) {
        bericht.zeilen = zeilen.filter(Boolean).sort(function (a, b) {
          return a.name.localeCompare(b.name, "de");
        });
        bericht.gefunden = bericht.zeilen.filter(function (z) { return z.gefunden; }).length;
        return bericht;
      });
    });
  }

  KT.kickerAufstellungen = { importieren: importieren };
})(window.KT);
