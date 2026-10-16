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
// Wer: die erste Seite, die nach dem Anstoss geoeffnet ist - mit oder ohne
// Anmeldung. Sie fragt den Server um eine Freigabe; der prueft selbst, ob ein
// Lauf ansteht, vermerkt ihn und gibt nur dieser einen Seite einen kurzlebigen
// Schluessel, mit dem sie Kader und Aufstellungen speichern darf. Alle
// anderen Seiten bekommen eine Absage und laden nicht noch einmal.
//
// Im Browser statt auf dem Server, weil nur hier die Zuordnung kicker -> ESPN
// laeuft. Ist niemand auf der Seite, passiert also nichts; der naechste
// Besucher holt den juengsten verpassten Lauf nach.
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  // Kurz nach dem Anstoss, damit kicker die festgestellten Aufstellungen
  // sicher schon ausliefert.
  var VERZUG_MS = 2 * 60 * 1000;
  // setTimeout traegt nicht beliebig weit (und verschlaeft Ruhezustaende);
  // laengere Wartezeiten werden zwischendurch neu berechnet.
  var MAX_WARTEN_MS = 6 * 60 * 60 * 1000;

  var gestartet = false;
  var timer = null;
  var laeuft = null;
  var hoerer = [];
  // Termin, fuer den diese Seite schon gefragt hat - sonst ginge bei jedem
  // Zurueckholen des Tabs eine Anfrage an den Server, die ohnehin abgelehnt wird.
  var gefragtFuer = 0;

  function melden(ereignis) {
    hoerer.slice().forEach(function (fn) {
      try {
        fn(ereignis);
      } catch (err) {
        console.error(err);
      }
    });
  }

  /** Alle Lauftermine der Saison, aufsteigend: [{matchday, zeit}], zeit = Anstoss + Verzug. */
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

  function planen(wann) {
    clearTimeout(timer);
    var warten = Math.max(1000, Math.min(wann - Date.now(), MAX_WARTEN_MS));
    timer = setTimeout(pruefen, warten);
  }

  /**
   * Steht ein Lauf an? Wenn ja, um Freigabe bitten und importieren; in jedem
   * Fall den naechsten Termin vormerken.
   */
  function pruefen() {
    clearTimeout(timer);
    if (laeuft) return laeuft;

    return KT.matchdays
      .getIndex()
      .then(function (index) {
        var jetzt = Date.now();
        var faellig = null;
        var naechster = null;
        laufzeiten(index).forEach(function (t) {
          if (t.zeit <= jetzt) faellig = t;
          else if (!naechster) naechster = t;
        });
        if (naechster) planen(naechster.zeit);
        if (!faellig || faellig.zeit === gefragtFuer) return;

        gefragtFuer = faellig.zeit;
        return KT.api.autoFreigabe(faellig.matchday, new Date(faellig.zeit)).then(function (antwort) {
          if (!antwort || !antwort.erlaubt) return;
          KT.api.setAutoToken(antwort.token);
          return importieren(faellig.matchday, { automatisch: true }).then(
            function () {
              KT.api.setAutoToken(null);
            },
            function () {
              KT.api.setAutoToken(null);
            }
          );
        });
      })
      .catch(function (err) {
        // Server oder ESPN nicht erreichbar: beim naechsten Anlass erneut fragen.
        gefragtFuer = 0;
        console.error(err);
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
    var automatisch = Boolean(options.automatisch);
    if (laeuft) return Promise.reject(new Error("Es werden gerade schon Aufstellungen geladen."));

    melden({ art: "start", matchday: matchday, automatisch: automatisch });

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
        // Den automatischen Lauf hat der Server schon bei der Freigabe
        // vermerkt. Ein Laden von Hand wird hier nachgetragen, damit danach
        // nicht gleich noch ein automatischer Lauf folgt. Klappt das Merken
        // nicht, ist das kein Grund, den gelungenen Import als Fehler zu melden.
        if (automatisch) return bericht;
        return KT.api
          .saveKickerImportStand(matchday)
          .catch(function () {})
          .then(function () {
            return bericht;
          });
      })
      .then(
        function (bericht) {
          laeuft = null;
          melden({ art: "fertig", matchday: matchday, automatisch: automatisch, bericht: bericht });
          return bericht;
        },
        function (err) {
          laeuft = null;
          melden({ art: "fehler", matchday: matchday, automatisch: automatisch, fehler: err });
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
    laeuftGerade: function () {
      return Boolean(laeuft);
    },
    /** fn(ereignis) bei Start, Ende oder Fehler eines Imports; liefert eine Funktion zum Abmelden. */
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
