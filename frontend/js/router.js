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
  };
})(window.KT);
