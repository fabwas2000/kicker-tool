// Vereinsnamen in der kicker-Schreibweise.
//
// Die Spieler- und Spieldaten kommen von ESPN, und ESPN schreibt die Vereine
// englisch und uneinheitlich: "FC Cologne", "Bayern Munich", "Mainz",
// "Hamburg SV". Im Tool sollen die Namen so stehen wie beim kicker.
//
// Das passiert BEWUSST nur hier im Frontend: In der Datenbank bleiben die
// ESPN-Namen stehen, weil sie zusammen mit der ESPN-Vereins-ID der Schluessel
// zu den Spieldaten sind. Wuerde man sie beim Speichern uebersetzen, muesste
// man bei jedem Abgleich mit ESPN wieder zurueckuebersetzen.
//
// Zugeordnet wird ueber die ESPN-Vereins-ID (stabil). Wo nur ein Name zur
// Hand ist, greift die Namensliste darunter. Passt nichts, bleibt der
// urspruengliche Name stehen - ein unbekannter Verein verschwindet also nie.
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  // ESPN-Vereins-ID -> [voller kicker-Name, Kurzform fuer enge Kacheln]
  var NACH_ID = {
    "122": ["1. FC Köln", "Köln"],
    "124": ["Borussia Dortmund", "Dortmund"],
    "125": ["Eintracht Frankfurt", "Frankfurt"],
    "126": ["SC Freiburg", "Freiburg"],
    "127": ["Hamburger SV", "HSV"],
    "131": ["Bayer 04 Leverkusen", "Leverkusen"],
    "132": ["FC Bayern München", "Bayern"],
    "133": ["FC Schalke 04", "Schalke"],
    "134": ["VfB Stuttgart", "Stuttgart"],
    "137": ["SV Werder Bremen", "Bremen"],
    "138": ["VfL Wolfsburg", "Wolfsburg"],
    "268": ["Borussia Mönchengladbach", "M'gladbach"],
    "270": ["FC St. Pauli", "St. Pauli"],
    "598": ["1. FC Union Berlin", "Union Berlin"],
    "2950": ["1. FSV Mainz 05", "Mainz"],
    "3307": ["SC Paderborn 07", "Paderborn"],
    "3841": ["FC Augsburg", "Augsburg"],
    "6418": ["1. FC Heidenheim", "Heidenheim"],
    "7911": ["TSG Hoffenheim", "Hoffenheim"],
    "10388": ["SV 07 Elversberg", "Elversberg"],
    "11420": ["RB Leipzig", "Leipzig"],
  };

  // Rueckfall ueber den ESPN-Namen, fuer die Stellen, an denen keine ID
  // mitgeliefert wird (z.B. der Gegner in einer Spielpaarung).
  var NACH_NAME = {};
  Object.keys(NACH_ID).forEach(function (id) {
    NACH_NAME[schluessel(NACH_ID[id][0])] = NACH_ID[id];
  });
  [
    ["FC Cologne", "122"],
    ["Bayern Munich", "132"],
    ["Bayer Leverkusen", "131"],
    ["Hamburg SV", "127"],
    ["Mainz", "2950"],
    ["St. Pauli", "270"],
    ["Werder Bremen", "137"],
    ["1. FC Heidenheim 1846", "6418"],
    ["Schalke 04", "133"],
    ["SV Elversberg", "10388"],
  ].forEach(function (paar) {
    NACH_NAME[schluessel(paar[0])] = NACH_ID[paar[1]];
  });

  /** Vergleichsform: Gross-/Kleinschreibung und Leerzeichen egal. */
  function schluessel(name) {
    return String(name || "").toLowerCase().replace(/[\s.]+/g, "");
  }

  function eintrag(teamId, name) {
    return (
      (teamId != null && NACH_ID[String(teamId)]) ||
      NACH_NAME[schluessel(name)] ||
      null
    );
  }

  /** Voller Vereinsname, z.B. "1. FC Köln". */
  function name(teamId, espnName) {
    var e = eintrag(teamId, espnName);
    return e ? e[0] : espnName || "";
  }

  /** Kurzform fuer enge Stellen, z.B. "Köln". */
  function kurz(teamId, espnName) {
    var e = eintrag(teamId, espnName);
    return e ? e[1] : espnName || "";
  }

  KT.vereine = { name: name, kurz: kurz };
})(window.KT);
