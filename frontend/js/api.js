// Dünner Client für unser eigenes FastAPI-Backend. Speichert/lädt NUR
// Konkurrenten, Kader und Aufstellungen - alles Live-Bezogene läuft über
// espn.js direkt gegen ESPN.
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  var SCHREIB_METHODEN = { POST: true, PUT: true, PATCH: true, DELETE: true };

  // ---------------------------------------------------------------
  // Aufwachen erkennen
  // ---------------------------------------------------------------
  // Render legt den kostenlosen Dienst nach 15 Minuten ohne Anfrage schlafen;
  // die erste Anfrage danach haengt, bis er wieder hochgefahren ist (meist
  // 30-60 Sekunden). Ohne Hinweis sieht das aus wie eine kaputte Seite.
  //
  // Erkannt wird das ohne Rueckfrage beim Server: hat dieses Geraet laenger
  // als SCHLAF_NACH_MS keine Antwort mehr bekommen und dauert die naechste
  // Anfrage laenger als HINWEIS_NACH_MS, wacht er sehr wahrscheinlich gerade
  // auf. Andere langsame Anfragen (etwa der kicker-Import) loesen den Hinweis
  // nicht aus, weil kurz vorher schon eine Antwort kam.
  var SCHLAF_NACH_MS = 14 * 60 * 1000;
  var HINWEIS_NACH_MS = 2000;
  var letzteAntwort = 0;
  var aufwachenSeit = 0;
  var hinweisTimer = null;

  // Freigabe fuer den automatischen Import, siehe autoAufstellungen.js.
  var autoToken = null;

  function aufwachenBeginnt() {
    if (aufwachenSeit) return;
    aufwachenSeit = Date.now();
    var seit = aufwachenSeit;
    hinweisTimer = setTimeout(function () {
      KT.ui.aufwachHinweis.zeigen(seit);
    }, HINWEIS_NACH_MS);
  }

  // Jede Antwort - auch eine Fehlermeldung - heisst: der Server ist wach.
  function serverAntwortet() {
    letzteAntwort = Date.now();
    aufwachenVorbei();
  }

  function aufwachenVorbei() {
    aufwachenSeit = 0;
    clearTimeout(hinweisTimer);
    KT.ui.aufwachHinweis.verbergen();
  }

  function request(path, options) {
    options = options || {};
    var method = options.method || "GET";
    var init = {
      method: method,
      headers: { "Content-Type": "application/json" },
    };
    // Nur bei aendernden Anfragen: Lesen ist ohne Passwort erlaubt, damit man
    // die Seite auch ohne Eingabe ansehen kann. Ausnahme: lesende Endpunkte,
    // die das Backend trotzdem nur Angemeldeten gibt (options.mitPasswort).
    // Waehrend eines automatischen Imports: die Freigabe vom Server, die auch
    // ohne Passwort Kader und Aufstellungen speichern laesst.
    if (autoToken) init.headers["X-Kicker-Auto"] = autoToken;
    if (SCHREIB_METHODEN[method] || options.mitPasswort) {
      var passwort = KT.config.getPasswort();
      if (passwort) init.headers["X-Kicker-Passwort"] = passwort;
    }
    if (options.body) init.body = options.body;

    // Ohne hinterlegte Backend-Adresse ginge die Anfrage an die eigene
    // Seite - GitHub Pages antwortet dann mit seiner 404-Seite und der
    // Nutzer saehe nur "404:". Lieber gleich sagen, was zu tun ist.
    var basis = KT.config.getBackendUrl();
    if (!basis) {
      return Promise.reject(
        new Error(
          "Keine Backend-Adresse hinterlegt. Unter „Einstellungen“ die Adresse " +
            "des Servers eintragen."
        )
      );
    }

    if (!letzteAntwort || Date.now() - letzteAntwort > SCHLAF_NACH_MS) aufwachenBeginnt();

    return fetch(basis + path, init).then(function (res) {
      serverAntwortet();
      if (!res.ok) {
        return res
          .json()
          .catch(function () {
            return null;
          })
          .then(function (body) {
            var detail = (body && body.detail) || res.statusText;
            // 401 heisst hier immer "Passwort fehlt oder stimmt nicht" - der
            // Hinweis auf die Einstellungen ist nuetzlicher als der Code.
            if (res.status === 401) throw new Error(detail);
            throw new Error(res.status + ": " + detail);
          });
      }
      if (res.status === 204) return null;
      return res.json();
    }, function (err) {
      // Gar nicht erreichbar: Die Ansichten melden das selbst, ein
      // weiterlaufender Countdown waere dann irrefuehrend.
      aufwachenVorbei();
      throw err;
    });
  }

  KT.api = {
    listCompetitors: function () {
      return request("/api/competitors");
    },
    createCompetitor: function (name) {
      return request("/api/competitors", {
        method: "POST",
        body: JSON.stringify({ name: name }),
      });
    },
    renameCompetitor: function (id, name) {
      return request("/api/competitors/" + id, {
        method: "PATCH",
        body: JSON.stringify({ name: name }),
      });
    },
    deleteCompetitor: function (id) {
      return request("/api/competitors/" + id, { method: "DELETE" });
    },

    getSquad: function (competitorId) {
      return request("/api/competitors/" + competitorId + "/squad");
    },
    replaceSquad: function (competitorId, players) {
      return request("/api/competitors/" + competitorId + "/squad", {
        method: "PUT",
        body: JSON.stringify({ players: players }),
      });
    },

    listLineups: function (competitorId) {
      return request("/api/competitors/" + competitorId + "/lineups");
    },
    getLineup: function (competitorId, matchday) {
      return request("/api/competitors/" + competitorId + "/lineups/" + matchday);
    },
    saveLineup: function (competitorId, matchday, formation, players) {
      return request("/api/competitors/" + competitorId + "/lineups/" + matchday, {
        method: "PUT",
        body: JSON.stringify({ formation: formation, players: players }),
      });
    },

    getAllLineupsForMatchday: function (matchday) {
      return request("/api/lineups/" + matchday);
    },

    getGrades: function (matchday) {
      return request("/api/grades/" + matchday);
    },
    /** Fingerabdruck je Spieltag, siehe Gesamtwertung in views/live.js. */
    getPunkteStand: function () {
      return request("/api/punkte-stand");
    },
    saveGrades: function (matchday, grades) {
      return request("/api/grades/" + matchday, {
        method: "PUT",
        body: JSON.stringify({ grades: grades }),
      });
    },

    /** Offizielle Noten/Tore/Vorlagen eines Spieltags aus dem kicker-Managerspiel. */
    getKickerSpieltag: function (matchday) {
      return request("/api/kicker/spieltag/" + matchday);
    },
    /** Kader und Startelf aller Mitglieder der hinterlegten kicker-Liga. Nur angemeldet. */
    getKickerAufstellungen: function (matchday) {
      return request("/api/kicker/aufstellungen/" + matchday, { mitPasswort: true });
    },
    /**
     * Fragt, ob zur Anstosszeit `termin` (Date) ein automatischer Import
     * ansteht. Antwort {erlaubt, token} - der Server vermerkt den Lauf dabei
     * gleich, nur die erste Seite nach dem Anstoss bekommt ihn.
     */
    autoFreigabe: function (matchday, termin) {
      return request("/api/kicker/auto-freigabe", {
        method: "POST",
        body: JSON.stringify({ matchday: matchday, termin: termin.toISOString() }),
      });
    },
    /** Freigabe fuer die folgenden Anfragen setzen bzw. mit null wieder entfernen. */
    setAutoToken: function (token) {
      autoToken = token || null;
    },
    saveKickerImportStand: function (matchday) {
      return request("/api/kicker/aufstellungen-stand", {
        method: "PUT",
        body: JSON.stringify({ matchday: matchday }),
      });
    },
    getKickerLiga: function () {
      return request("/api/kicker/liga");
    },
    /** Nimmt den kopierten Link der Liga-Seite (oder die nackte ID). */
    saveKickerLiga: function (link) {
      return request("/api/kicker/liga", { method: "PUT", body: JSON.stringify({ link: link }) });
    },

    listKickerPositions: function () {
      return request("/api/kicker-positions");
    },
    setPlayerPosition: function (playerId, position) {
      return request("/api/squad-players/" + playerId + "/position", {
        method: "PATCH",
        body: JSON.stringify({ position: position }),
      });
    },

    listPlayerImages: function () {
      return request("/api/player-images");
    },
    putPlayerImage: function (playerId, dataUrl) {
      return request("/api/players/" + playerId + "/image", {
        method: "PUT",
        body: JSON.stringify({ data_url: dataUrl }),
      });
    },
    deletePlayerImage: function (playerId) {
      return request("/api/players/" + playerId + "/image", { method: "DELETE" });
    },

    getScoringRules: function () {
      return request("/api/scoring-rules");
    },
    saveScoringRules: function (rules) {
      return request("/api/scoring-rules", { method: "PUT", body: JSON.stringify(rules) });
    },
    resetScoringRules: function () {
      return request("/api/scoring-rules", { method: "DELETE" });
    },

    /** Verlangt dieses Backend ueberhaupt ein Passwort fuer Aenderungen? */
    getAuthStatus: function () {
      return request("/api/auth/status");
    },

    /** Prueft das gespeicherte Passwort (schlaegt mit 401 fehl, wenn falsch). */
    checkPasswort: function () {
      return request("/api/auth/check", { method: "POST" });
    },
  };
})(window.KT);
