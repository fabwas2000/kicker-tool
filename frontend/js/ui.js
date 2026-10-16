window.KT = window.KT || {};

(function (KT) {
  "use strict";

  var toastTimer = null;

  function escapeHtml(value) {
    return String(value)
      .split("&").join("&amp;")
      .split("<").join("&lt;")
      .split(">").join("&gt;")
      .split('"').join("&quot;")
      .split("'").join("&#39;");
  }

  function showToast(message, variant, timeoutMs) {
    var toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.variant = variant;
    toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.add("hidden");
    }, timeoutMs);
  }

  // Reihenfolge der Positionen in allen Listen: Tor, Abwehr, Mittelfeld, Sturm
  var POSITION_RANK = { G: 0, D: 1, M: 2, F: 3 };

  // Namenszusaetze gehoeren zum Nachnamen: "Said El Mala" wird unter E
  // einsortiert, nicht unter M.
  var NAMENSZUSATZ = /^(van|von|de|del|della|der|den|di|da|das|dos|du|el|al|le|la|ten|ter|bin|ibn|mc|mac|st)$/i;

  function lastName(name) {
    var teile = String(name || "").trim().split(/\s+/);
    if (teile.length < 2) return teile[0] || "";
    for (var i = 1; i < teile.length - 1; i++) {
      if (NAMENSZUSATZ.test(teile[i])) return teile.slice(i).join(" ");
    }
    return teile[teile.length - 1];
  }

  function positionRank(position) {
    var rang = POSITION_RANK[position];
    return rang === undefined ? 4 : rang;
  }

  /**
   * Sortierung fuer jede Spielerliste: erst nach Position (TW, ABW, MF, STU),
   * innerhalb der Position alphabetisch nach Nachname.
   * Erwartet Objekte mit {position, name} - fuer abweichende Feldnamen die
   * Werte vorher passend abbilden.
   */
  function comparePlayers(a, b) {
    var d = positionRank(a.position) - positionRank(b.position);
    if (d !== 0) return d;
    var n = lastName(a.name).localeCompare(lastName(b.name), "de");
    if (n !== 0) return n;
    return String(a.name || "").localeCompare(String(b.name || ""), "de");
  }

  // ---------------------------------------------------------------
  // Hinweis "Server wacht auf" (ausgeloest von api.js)
  // ---------------------------------------------------------------
  // Bewusst grosszuegig: Render braucht meist 30-60 Sekunden. Laeuft der
  // Countdown zu lang, ist die Seite einfach frueher da - das ist angenehmer
  // als ein Countdown, der bei null steht und trotzdem noch nichts passiert.
  var AUFWACHEN_DAUER_MS = 90 * 1000;
  var aufwachTakt = null;

  function aufwachZeichnen(seit) {
    var rest = Math.ceil((seit + AUFWACHEN_DAUER_MS - Date.now()) / 1000);
    var anteil = Math.min(1, (Date.now() - seit) / AUFWACHEN_DAUER_MS);
    document.getElementById("aufwach-rest").textContent =
      rest > 0 ? "noch ca. " + rest + " s" : "gleich geschafft …";
    document.getElementById("aufwach-balken").style.width = Math.round(anteil * 100) + "%";
  }

  var aufwachHinweis = {
    /** @param seit Zeitpunkt (ms) der ersten haengenden Anfrage */
    zeigen: function (seit) {
      var el = document.getElementById("aufwach-hinweis");
      if (!el) return;
      clearInterval(aufwachTakt);
      aufwachZeichnen(seit);
      el.hidden = false;
      aufwachTakt = setInterval(function () {
        aufwachZeichnen(seit);
      }, 1000);
    },
    verbergen: function () {
      clearInterval(aufwachTakt);
      var el = document.getElementById("aufwach-hinweis");
      if (el) el.hidden = true;
    },
  };

  KT.ui = {
    escapeHtml: escapeHtml,
    aufwachHinweis: aufwachHinweis,
    lastName: lastName,
    positionRank: positionRank,
    comparePlayers: comparePlayers,

    showError: function (message) {
      console.error(message);
      showToast(message, "error", 7000);
    },

    showInfo: function (message) {
      showToast(message, "info", 3000);
    },

    /**
     * "Failed to fetch" ist für den Nutzer nichtssagend - typischerweise
     * bedeutet es hier: Backend läuft nicht oder falsche URL eingetragen.
     */
    backendErrorText: function (err) {
      var msg = err && err.message ? err.message : String(err);
      if (msg.indexOf("Failed to fetch") > -1 || msg.indexOf("NetworkError") > -1) {
        return (
          "Backend nicht erreichbar (" +
          KT.config.getBackendUrl() +
          "). Läuft uvicorn? Adresse ggf. unter 'Einstellungen' anpassen."
        );
      }
      return msg;
    },
  };
})(window.KT);
