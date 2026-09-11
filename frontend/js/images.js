// Spielerbilder. Die Bilder liegen im Backend und werden ueber einen eigenen
// Endpoint mit Cache-Header ausgeliefert - im <img>-Tag referenziert, damit
// der Browser jedes Foto nur einmal laedt (wichtig fuers Handy).
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  var MAX_WIDTH = 200; // reicht fuer die Kacheln auf dem Spielfeld (2x-Display)
  var known = new Map(); // playerId -> updated_at (dient als Cache-Buster)
  var loaded = false;

  function load(force) {
    if (loaded && !force) return Promise.resolve(known);
    return KT.api
      .listPlayerImages()
      .then(function (list) {
        known = new Map();
        list.forEach(function (entry) {
          known.set(entry.espn_player_id, entry.updated_at);
        });
        loaded = true;
        return known;
      })
      .catch(function () {
        // Ohne Backend gibt es eben keine Bilder - die Ansicht bleibt nutzbar.
        loaded = true;
        return known;
      });
  }

  function has(playerId) {
    return known.has(playerId);
  }

  function urlFor(playerId) {
    if (!known.has(playerId)) return null;
    var stamp = encodeURIComponent(known.get(playerId) || "");
    return KT.config.getBackendUrl() + "/api/players/" + playerId + "/image?v=" + stamp;
  }

  /**
   * Verkleinert die Datei im Canvas auf MAX_WIDTH und gibt eine PNG-Data-URL
   * zurueck. PNG, weil die freigestellten Portraits Transparenz haben.
   */
  function fileToScaledDataUrl(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) {
        reject(new Error("Das ist keine Bilddatei."));
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error("Datei konnte nicht gelesen werden."));
      };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () {
          reject(new Error("Bild konnte nicht geladen werden."));
        };
        img.onload = function () {
          var scale = Math.min(1, MAX_WIDTH / img.width);
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          try {
            resolve(canvas.toDataURL("image/png"));
          } catch (err) {
            reject(new Error("Bild konnte nicht umgewandelt werden."));
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function upload(playerId, file) {
    return fileToScaledDataUrl(file)
      .then(function (dataUrl) {
        return KT.api.putPlayerImage(playerId, dataUrl);
      })
      .then(function () {
        return load(true);
      });
  }

  function remove(playerId) {
    return KT.api.deletePlayerImage(playerId).then(function () {
      return load(true);
    });
  }

  /**
   * <img>-Tag oder Platzhalter mit den Initialen. `onerror` blendet das Bild
   * aus, falls das Backend gerade schlaeft - dann bleibt der Platzhalter.
   *
   * `rund` (Vorgabe: true) steuert die Form: in Listen bleiben die Bilder
   * rund, auf dem Spielfeld stehen sie im Hochformat wie bei kicker. Dort
   * bringen Zuschnitt und Groesse die Klasse selbst mit (.pitch-photo).
   */
  function avatarHtml(playerId, playerName, sizeClass, rund) {
    var url = urlFor(playerId);
    var form = rund === false ? "" : " rounded-full object-cover object-top";
    var initials = String(playerName || "?")
      .split(/\s+/)
      .map(function (part) {
        return part.charAt(0);
      })
      .slice(0, 2)
      .join("")
      .toUpperCase();

    if (!url) {
      return (
        '<div class="' + sizeClass + (rund === false ? "" : " rounded-full") +
        ' bg-panel-alt text-mute ' +
        'flex items-center justify-center text-[9px] font-bold shrink-0">' + KT.ui.escapeHtml(initials) + "</div>"
      );
    }
    return (
      '<img src="' + KT.ui.escapeHtml(url) + '" alt="' + KT.ui.escapeHtml(playerName || "") + '" ' +
      'loading="lazy" class="' + sizeClass + form + ' bg-panel-alt shrink-0" ' +
      "onerror=\"this.style.display='none'\" />"
    );
  }

  KT.images = {
    load: load,
    has: has,
    urlFor: urlFor,
    upload: upload,
    remove: remove,
    avatarHtml: avatarHtml,
    MAX_WIDTH: MAX_WIDTH,
  };
})(window.KT);
