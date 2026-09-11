// Positionen laut kicker, fuer ALLE Bundesliga-Spieler - nicht nur fuer die
// in den eigenen Kadern. Gebraucht wird das in der Noten-Maske: ESPN gibt
// eingewechselten Spielern im Spielbericht nur "SUB" als Position, damit
// liesse sich weder sortieren noch ein Tor richtig bewerten.
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  var CACHE_KEY = "kicker-tool:kicker-positions";
  var CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  var positionen = null; // { normalisierterName: "G"|"D"|"M"|"F" }

  /** Muss zur Normalisierung im Backend passen (app/positions.py). */
  function normalize(name) {
    return String(name || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // Akzente entfernen
      .toLowerCase()
      .replace(/[^a-z]+/g, " ")
      .trim();
  }

  function readCache() {
    try {
      var raw = KT.config.safeGet(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
      return parsed.positionen;
    } catch (err) {
      return null;
    }
  }

  function load(force) {
    if (positionen && !force) return Promise.resolve(positionen);
    if (!force) {
      var cached = readCache();
      if (cached) {
        positionen = cached;
        return Promise.resolve(positionen);
      }
    }
    return KT.api
      .listKickerPositions()
      .then(function (daten) {
        positionen = daten || {};
        KT.config.safeSet(
          CACHE_KEY,
          JSON.stringify({ fetchedAt: Date.now(), positionen: positionen })
        );
        return positionen;
      })
      .catch(function () {
        // Ohne Backend bleibt es bei der ESPN-Naeherung.
        positionen = positionen || {};
        return positionen;
      });
  }

  /** kicker-Position zu einem Spielernamen, oder null wenn unbekannt. */
  function forName(name) {
    if (!positionen) return null;
    return positionen[normalize(name)] || null;
  }

  KT.positions = {
    load: load,
    forName: forName,
    normalize: normalize,
  };
})(window.KT);
