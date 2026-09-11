// Dünner Client für unser eigenes FastAPI-Backend. Speichert/lädt NUR
// Konkurrenten, Kader und Aufstellungen - alles Live-Bezogene läuft über
// espn.js direkt gegen ESPN.
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  var SCHREIB_METHODEN = { POST: true, PUT: true, PATCH: true, DELETE: true };

  function request(path, options) {
    options = options || {};
    var method = options.method || "GET";
    var init = {
      method: method,
      headers: { "Content-Type": "application/json" },
    };
    // Nur bei aendernden Anfragen: Lesen ist ohne Passwort erlaubt, damit man
    // die Seite auch ohne Eingabe ansehen kann.
    if (SCHREIB_METHODEN[method]) {
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

    return fetch(basis + path, init).then(function (res) {
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
    saveGrades: function (matchday, grades) {
      return request("/api/grades/" + matchday, {
        method: "PUT",
        body: JSON.stringify({ grades: grades }),
      });
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
