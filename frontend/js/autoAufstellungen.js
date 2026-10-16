// Aufstellungen automatisch zu den Anstosszeiten aus dem kicker-Managerspiel
// holen - und der eine Weg, ueber den auch der Knopf "Aufstellungen laden"
// importiert, damit nie zwei Importe gleichzeitig laufen.
//
// Wann: kurz nach JEDER Anstosszeit des Spieltags (Freitag 20:30, Samstag
// 15:30, Samstag 18:30 ...). Im Managerspiel Interactive darf jeder bis zum
// Anpfiff eines Spiels noch umstellen, mit jedem Anstoss stehen also weitere
// Spieler fest. Einmal je Spieltag reichte deshalb nicht, staendiges Nachfragen
// waere unnoetig.
//
// Wo: im Browser, weil nur dort die Zuordnung kicker -> ESPN laeuft. Es
// braucht also ein angemeldetes Geraet mit offener Seite. Wer erst spaeter
// oeffnet, holt einen verpassten Lauf sofort nach. Wann zuletzt geladen wurde,
// merkt sich das Backend - ein zweites offenes Geraet laedt dann nicht noch
// einmal.
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  // Kurz nach dem Anstoss, damit kicker die festgestellten Aufstellungen
  // sicher schon ausliefert.
  var VERZUG_MS = 2 * 60 * 1000;
  // setTimeout traegt nicht beliebig weit (und verschlaeft Ruhezustaende);
  // laengere Wartezeiten werden zwischendurch neu berechnet.
  var MAX_WARTEN_MS = 6 * 60 * 60 * 1000;
  // Nach einem Fehlschlag (kicker oder Backend nicht erreichbar) erneut.
  var NEUVERSUCH_MS = 15 * 60 * 1000;

  var gestartet = false;
  var timer = null;
  var laeuft = null;
  var hoerer = [];
  var zustand = {
    stand: null, // {matchday, zeit} vom Backend
    naechster: null, // {matchday, zeit} - naechster geplanter Lauf (zeit inkl. Verzug)
    fehler: null, // Text, wenn der letzte automatische Versuch scheiterte
    laeuft: false,
  };

  function melden(ereignis) {
    hoerer.slice().forEach(function (fn) {
      try {
        fn(ereignis || { art: "zustand" });
      } catch (err) {
        console.error(err);
      }
    });
  }

  /** Alle Anstosszeiten der Saison, aufsteigend: [{matchday, zeit}], zeit inkl. Verzug. */
  function laufzeiten(index) {
    var liste = [];
    index.forEach(function (md) {
      var gesehen = {};
      md.events.forEach(function (e) {
        var t = new Date(e.date).getTime();
        if (!isFinite(t) || gesehen[t]) return;
        gesehen[t] = true;
        liste.push({ matchday: md.number, zeit: t + VERZUG_MS });
      });
    });
    return liste.sort(function (a, b) {
      return a.zeit - b.zeit;
    });
  }

  /**
   * Ist seit dem Lauftermin schon geladen worden? Nur ein Import DESSELBEN
   * Spieltags zaehlt - wer zwischendurch einen alten Spieltag nachgeladen
   * hat, hat den aktuellen damit nicht erledigt.
   */
  function erledigt(termin, stand) {
    if (!stand || !stand.zeit || stand.matchday !== termin.matchday) return false;
    return new Date(stand.zeit).getTime() >= termin.zeit;
  }

  function planen(wann) {
    clearTimeout(timer);
    var warten = Math.max(1000, Math.min(wann - Date.now(), MAX_WARTEN_MS));
    timer = setTimeout(pruefen, warten);
  }

  // Ein Neuversuch darf den naechsten regulaeren Termin nicht verdraengen.
  function neuVersuchen() {
    var wann = Date.now() + NEUVERSUCH_MS;
    if (zustand.naechster) wann = Math.min(wann, zustand.naechster.zeit);
    planen(wann);
  }

  /**
   * Steht ein Lauf an? Wenn ja, sofort importieren; in jedem Fall den
   * naechsten Termin vormerken.
   */
  function pruefen() {
    clearTimeout(timer);
    if (!KT.auth.istOffen()) {
      zustand.naechster = null;
      melden();
      return Promise.resolve();
    }
    if (laeuft) return laeuft;

    return Promise.all([KT.matchdays.getIndex(), KT.api.getKickerImportStand()])
      .then(function (r) {
        var zeiten = laufzeiten(r[0]);
        var jetzt = Date.now();
        zustand.stand = r[1];
        var faellig = null;
        zustand.naechster = null;
        zeiten.forEach(function (t) {
          if (t.zeit <= jetzt) faellig = t;
          else if (!zustand.naechster) zustand.naechster = t;
        });
        if (zustand.naechster) planen(zustand.naechster.zeit);
        melden();

        if (faellig && !erledigt(faellig, zustand.stand)) {
          return importieren(faellig.matchday, { automatisch: true }).catch(function () {
            neuVersuchen();
          });
        }
      })
      .catch(function (err) {
        zustand.fehler = KT.ui.backendErrorText(err);
        melden();
        neuVersuchen();
      });
  }

  /**
   * Aufstellungen eines Spieltags holen und speichern.
   *
   * @param options {automatisch: bool, matchByPlayerId: Map (optional)}
   * @returns Promise<bericht> - siehe kickerAufstellungen.js
   */
  function importieren(matchday, options) {
    options = options || {};
    if (laeuft) return Promise.reject(new Error("Es werden gerade schon Aufstellungen geladen."));

    zustand.laeuft = true;
    melden({ art: "start", matchday: matchday, automatisch: Boolean(options.automatisch) });

    laeuft = KT.matchdays
      .getIndex()
      .then(function (index) {
        // Den Kader nur ab dem laufenden Spieltag ersetzen - siehe kickerAufstellungen.js.
        return KT.kickerAufstellungen.importieren(matchday, {
          kaderErsetzen: matchday >= KT.matchdays.currentMatchday(index),
          matchByPlayerId: options.matchByPlayerId,
        });
      })
      .then(function (bericht) {
        // Klappt das Merken nicht, laedt beim naechsten Pruefen eben jemand
        // noch einmal - kein Grund, den gelungenen Import als Fehler zu melden.
        return KT.api
          .saveKickerImportStand(matchday)
          .then(function (stand) {
            zustand.stand = stand;
          })
          .catch(function () {})
          .then(function () {
            return bericht;
          });
      })
      .then(
        function (bericht) {
          laeuft = null;
          zustand.laeuft = false;
          zustand.fehler = null;
          melden({ art: "fertig", matchday: matchday, automatisch: Boolean(options.automatisch), bericht: bericht });
          return bericht;
        },
        function (err) {
          laeuft = null;
          zustand.laeuft = false;
          if (options.automatisch) zustand.fehler = KT.ui.backendErrorText(err);
          melden({ art: "fehler", matchday: matchday, automatisch: Boolean(options.automatisch), fehler: err });
          throw err;
        }
      );
    return laeuft;
  }

  function start() {
    if (gestartet) return;
    gestartet = true;
    // Ein Handy im Ruhezustand verschlaeft Timer. Beim Zurueckholen der
    // Seite deshalb gleich nachsehen, ob inzwischen ein Lauf faellig war.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) pruefen();
    });
    pruefen();
  }

  KT.autoAufstellungen = {
    start: start,
    pruefen: pruefen,
    importieren: importieren,
    zustand: function () {
      return zustand;
    },
    /** fn(ereignis) bei jedem Wechsel; liefert eine Funktion zum Abmelden. */
    beiAenderung: function (fn) {
      hoerer.push(fn);
      return function () {
        hoerer = hoerer.filter(function (h) {
          return h !== fn;
        });
      };
    },
  };
})(window.KT);
