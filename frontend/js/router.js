window.KT = window.KT || {};

(function (KT) {
  "use strict";

  var routes = new Map();
  var activeCleanup = null;

  function currentPath() {
    var hash = window.location.hash.replace(/^#/, "");
    return hash || "/live";
  }

  function renderCurrentRoute() {
    var path = currentPath();
    var render = routes.get(path) || routes.get("/live");

    if (typeof activeCleanup === "function") {
      activeCleanup();
      activeCleanup = null;
    }

    var links = document.querySelectorAll("[data-nav-link]");
    Array.prototype.forEach.call(links, function (link) {
      link.classList.toggle("nav-active", link.getAttribute("href") === "#" + path);
    });

    var container = document.getElementById("app");
    container.innerHTML = "";

    // Geschuetzte Seiten ohne Anmeldung gar nicht erst aufbauen. Bewusst
    // eine Erklaerung statt einer stillen Umleitung: Wer ein Lesezeichen auf
    // "#/grades" hat, soll erfahren warum nichts passiert, statt wortlos auf
    // der Punktetabelle zu landen.
    if (KT.auth.istGeschuetzt(path) && !KT.auth.istOffen()) {
      container.innerHTML = [
        '<div class="kt-panel max-w-md mx-auto p-6 text-center">',
        '  <h1 class="font-display text-2xl font-bold uppercase tracking-tight">Anmeldung nötig</h1>',
        '  <p class="text-mute text-sm mt-2 mb-5">Diese Seite ist zum Ändern da.',
        "    Die Punktetabelle und die Aufstellungen kannst du ohne Anmeldung ansehen.</p>",
        '  <button type="button" id="hier-anmelden" class="kt-btn kt-btn-primary">Anmelden</button>',
        "</div>",
      ].join("\n");
      container.querySelector("#hier-anmelden").addEventListener("click", KT.auth.dialogOeffnen);
      return;
    }

    // Ein Fehler in einer View darf nicht die ganze App lahmlegen - sonst
    // sieht der Nutzer nur eine leere Seite ohne jeden Hinweis.
    Promise.resolve()
      .then(function () {
        return render(container);
      })
      .then(function (cleanup) {
        activeCleanup = typeof cleanup === "function" ? cleanup : null;
      })
      .catch(function (err) {
        console.error(err);
        container.innerHTML =
          '<p class="text-kicker">Fehler beim Anzeigen dieser Seite: ' +
          KT.ui.escapeHtml(err && err.message ? err.message : String(err)) +
          "</p>";
      });
  }

  KT.router = {
    registerRoute: function (path, render) {
      routes.set(path, render);
    },
    start: function () {
      window.addEventListener("hashchange", renderCurrentRoute);
      renderCurrentRoute();
    },
    /** Aktuelle Seite neu aufbauen - z.B. nach dem An- oder Abmelden. */
    refresh: renderCurrentRoute,
  };
})(window.KT);
