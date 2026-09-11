// Anmeldung. Entscheidet, ob die Seite nur angesehen oder auch geaendert
// werden darf.
//
// Wie das technisch funktioniert: Es gibt keine Sitzung auf dem Server. Das
// Backend prueft bei jedem schreibenden Zugriff einfach das mitgeschickte
// Passwort. "Angemeldet" heisst hier also nur: Das Passwort liegt im Browser
// dieses Geraets und wird ab jetzt mitgeschickt. Genau deshalb reicht zum
// Abmelden auch das Loeschen dieses einen Wertes.
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  // Ob das Backend ueberhaupt ein Passwort verlangt. Lokal ohne APP_PASSWORD
  // ist alles offen - dann waere eine Anmeldemaske nur im Weg.
  var passwortNoetig = true;
  var hoerer = [];

  function melden() {
    hoerer.forEach(function (fn) {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    });
  }

  /** Darf der Benutzer gerade etwas aendern? */
  function istOffen() {
    return !passwortNoetig || Boolean(KT.config.getPasswort());
  }

  /**
   * Passwort pruefen und bei Erfolg merken.
   *
   * Das Passwort wird VOR der Pruefung gespeichert, weil KT.api es aus der
   * Ablage liest, um es mitzuschicken. Scheitert die Pruefung, wird der
   * vorherige Wert wiederhergestellt - sonst haette ein Tippfehler den
   * Benutzer abgemeldet.
   */
  function anmelden(passwort) {
    var vorher = KT.config.getPasswort();
    KT.config.setPasswort(passwort);
    return KT.api
      .checkPasswort()
      .then(function () {
        melden();
      })
      .catch(function (err) {
        KT.config.setPasswort(vorher);
        throw err;
      });
  }

  function abmelden() {
    KT.config.setPasswort("");
    melden();
    // Auf einer geschuetzten Seite stehenbleiben ergaebe keinen Sinn.
    if (GESCHUETZT[location.hash.replace(/^#/, "")]) location.hash = "#/live";
  }

  // Seiten, die ohne Anmeldung nichts anzuzeigen haetten.
  var GESCHUETZT = { "/grades": true, "/squad": true, "/settings": true };

  // ---------------------------------------------------------------
  // Anmeldefenster
  // ---------------------------------------------------------------

  function dialogSchliessen() {
    var el = document.getElementById("anmelde-dialog");
    if (el) el.remove();
    document.removeEventListener("keydown", aufEscape);
  }

  function aufEscape(e) {
    if (e.key === "Escape") dialogSchliessen();
  }

  function dialogOeffnen() {
    dialogSchliessen();
    var overlay = document.createElement("div");
    overlay.id = "anmelde-dialog";
    overlay.className =
      "fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4";
    overlay.innerHTML = [
      '<div class="bg-panel border border-line w-full sm:max-w-sm shadow-[0_6px_24px_rgba(0,0,0,0.6)]">',
      '  <form id="anmelde-form" class="p-5 space-y-4">',
      '    <div>',
      '      <h2 class="font-display text-xl font-bold uppercase tracking-tight leading-none">Anmelden</h2>',
      '      <p class="text-mute text-sm mt-1.5">Zum Eintragen von Noten, Aufstellungen und Kadern.',
      "        Ansehen geht auch ohne.</p>",
      "    </div>",
      '    <div>',
      '      <label class="kt-eyebrow block mb-1" for="anmelde-feld">Passwort</label>',
      // autocomplete: so bietet der Browser an, das Passwort zu merken -
      // sonst muesste man es auf dem Handy jedes Mal tippen.
      '      <input id="anmelde-feld" type="password" autocomplete="current-password"',
      '        class="kt-input w-full" />',
      "    </div>",
      '    <p id="anmelde-fehler" class="text-sm text-kicker font-semibold" hidden></p>',
      '    <div class="flex gap-2 justify-end">',
      '      <button type="button" id="anmelde-abbrechen" class="kt-btn kt-btn-secondary">Abbrechen</button>',
      '      <button type="submit" id="anmelde-senden" class="kt-btn kt-btn-primary">Anmelden</button>',
      "    </div>",
      "  </form>",
      "</div>",
    ].join("\n");

    // Klick auf die dunkle Flaeche schliesst - aber nur dort, nicht im
    // Fenster selbst (e.target waere sonst auch ein Kindelement).
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) dialogSchliessen();
    });
    document.addEventListener("keydown", aufEscape);

    var feld = overlay.querySelector("#anmelde-feld");
    var fehler = overlay.querySelector("#anmelde-fehler");
    var knopf = overlay.querySelector("#anmelde-senden");

    overlay.querySelector("#anmelde-abbrechen").addEventListener("click", dialogSchliessen);
    overlay.querySelector("#anmelde-form").addEventListener("submit", function (e) {
      e.preventDefault();
      fehler.hidden = true;
      knopf.disabled = true;
      knopf.textContent = "Prüfe…";
      anmelden(feld.value)
        .then(function () {
          dialogSchliessen();
          KT.ui.showInfo("Angemeldet. Änderungen sind jetzt möglich.");
        })
        .catch(function (err) {
          fehler.textContent = KT.ui.backendErrorText(err);
          fehler.hidden = false;
          knopf.disabled = false;
          knopf.textContent = "Anmelden";
          feld.select();
        });
    });

    document.body.appendChild(overlay);
    feld.focus();
  }

  // ---------------------------------------------------------------
  // Oberflaeche nachfuehren
  // ---------------------------------------------------------------

  function oberflaecheAktualisieren() {
    var offen = istOffen();

    // Geschuetzte Menuepunkte aus- bzw. einblenden.
    var punkte = document.querySelectorAll("[data-geschuetzt]");
    Array.prototype.forEach.call(punkte, function (el) {
      el.hidden = !offen;
    });

    var knopf = document.getElementById("auth-knopf");
    if (knopf) {
      // Verlangt das Backend gar kein Passwort, waere ein Anmeldeknopf
      // sinnlos - dann ganz ausblenden.
      knopf.hidden = !passwortNoetig;
      knopf.textContent = offen ? "Abmelden" : "Anmelden";
    }
  }

  /**
   * Beim Start: klaeren, ob ein Passwort noetig ist, und ein gemerktes
   * Passwort gegen das Backend pruefen.
   *
   * Bewusst NICHT blockierend: Bei Render schlaeft das Backend nach einer
   * Pause ein und braucht bis zu einer Minute zum Aufwachen. Solange darf
   * die Seite nicht leer bleiben. Ein gemerktes Passwort gilt deshalb erst
   * einmal als gueltig; stellt sich das Gegenteil heraus, wird abgemeldet.
   */
  function init() {
    oberflaecheAktualisieren();

    KT.api
      .getAuthStatus()
      .then(function (status) {
        passwortNoetig = Boolean(status && status.passwort_noetig);
        oberflaecheAktualisieren();
        if (!passwortNoetig || !KT.config.getPasswort()) return;

        return KT.api.checkPasswort().catch(function (err) {
          // Nur bei echtem "Passwort falsch" abmelden. Ein Netzfehler oder
          // ein schlafendes Backend darf niemanden hinauswerfen.
          if (!/passwort/i.test(err.message || "")) return;
          KT.config.setPasswort("");
          oberflaecheAktualisieren();
          melden();
          KT.ui.showError("Das gespeicherte Passwort stimmt nicht mehr. Bitte neu anmelden.");
        });
      })
      .catch(function () {
        /* Backend nicht erreichbar - die Ansichten melden das bereits. */
      });
  }

  KT.auth = {
    init: init,
    istOffen: istOffen,
    istGeschuetzt: function (pfad) {
      return Boolean(GESCHUETZT[pfad]);
    },
    anmelden: anmelden,
    abmelden: abmelden,
    dialogOeffnen: dialogOeffnen,
    oberflaecheAktualisieren: oberflaecheAktualisieren,
    beiAenderung: function (fn) {
      hoerer.push(fn);
    },
  };
})(window.KT);
