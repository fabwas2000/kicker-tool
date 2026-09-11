(function (KT) {
  "use strict";

  KT.router.registerRoute("/live", KT.views.live);
  KT.router.registerRoute("/grades", KT.views.grades);
  KT.router.registerRoute("/squad", KT.views.squad);
  KT.router.registerRoute("/settings", KT.views.settings);

  // Der eine Knopf oben rechts macht beides - je nachdem, ob gerade jemand
  // angemeldet ist. Zwei getrennte Knoepfe waeren nur unnoetiger Platzbedarf,
  // weil immer genau einer sinnvoll ist.
  var authKnopf = document.getElementById("auth-knopf");
  if (authKnopf) {
    authKnopf.addEventListener("click", function () {
      if (KT.auth.istOffen()) KT.auth.abmelden();
      else KT.auth.dialogOeffnen();
    });
  }

  // Nach dem An- oder Abmelden Menue UND Inhalt nachziehen: Die gerade
  // sichtbare Seite kann Knoepfe enthalten, die es nun (nicht mehr) geben
  // darf - etwa "Aufstellung bearbeiten".
  KT.auth.beiAenderung(function () {
    KT.auth.oberflaecheAktualisieren();
    KT.router.refresh();
  });

  KT.auth.init();
  KT.router.start();
})(window.KT);
