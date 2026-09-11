// Positions-Layouts für die Aufstellungs-Pitch (Prozent-Koordinaten,
// x=0 links, y=0 oben=Tor des Gegners, y=100 unten=eigener Torwart).
//
// Die Auswahl entspricht genau den sieben Formationen, die das kicker-
// Managerspiel Interactive anbietet. 4-2-3-1 gibt es dort NICHT und ist
// deshalb hier auch nicht aufgeführt.
//
// Zwischen zwei Reihen liegen mindestens 17 Prozent der Feldhöhe: darunter
// stossen die hochformatigen Spielerkacheln aneinander.
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  function row(prefix, y, xs, label) {
    return xs.map(function (x, i) {
      return { slot: prefix + (i + 1), x: x, y: y, label: label };
    });
  }

  function build() {
    var f = {};
    f["4-4-2"] = [{ slot: "GK", x: 50, y: 90, label: "TW" }]
      .concat(row("D", 72, [12, 38, 62, 88], "ABW"))
      .concat(row("M", 50, [12, 38, 62, 88], "MF"))
      .concat(row("F", 20, [35, 65], "STU"));

    f["4-3-3"] = [{ slot: "GK", x: 50, y: 90, label: "TW" }]
      .concat(row("D", 72, [12, 38, 62, 88], "ABW"))
      .concat(row("M", 52, [25, 50, 75], "MF"))
      .concat(row("F", 20, [15, 50, 85], "STU"));

    f["3-5-2"] = [{ slot: "GK", x: 50, y: 90, label: "TW" }]
      .concat(row("D", 72, [25, 50, 75], "ABW"))
      .concat(row("M", 50, [11, 30.5, 50, 69.5, 89], "MF"))
      .concat(row("F", 20, [35, 65], "STU"));

    f["3-4-3"] = [{ slot: "GK", x: 50, y: 90, label: "TW" }]
      .concat(row("D", 72, [25, 50, 75], "ABW"))
      .concat(row("M", 50, [12, 38, 62, 88], "MF"))
      .concat(row("F", 20, [15, 50, 85], "STU"));

    f["5-3-2"] = [{ slot: "GK", x: 50, y: 90, label: "TW" }]
      .concat(row("D", 73, [11, 30.5, 50, 69.5, 89], "ABW"))
      .concat(row("M", 50, [25, 50, 75], "MF"))
      .concat(row("F", 20, [35, 65], "STU"));

    f["5-4-1"] = [{ slot: "GK", x: 50, y: 90, label: "TW" }]
      .concat(row("D", 73, [11, 30.5, 50, 69.5, 89], "ABW"))
      .concat(row("M", 50, [12, 38, 62, 88], "MF"))
      .concat(row("F", 18, [50], "STU"));

    f["4-5-1"] = [{ slot: "GK", x: 50, y: 90, label: "TW" }]
      .concat(row("D", 73, [12, 38, 62, 88], "ABW"))
      .concat(row("M", 48, [11, 30.5, 50, 69.5, 89], "MF"))
      .concat(row("F", 18, [50], "STU"));

    return f;
  }

  /**
   * Linie eines Slots: G, D, M oder F - so lassen sich Spieler beim
   * Formationswechsel innerhalb ihrer Linie weiterverwenden. Unbekannte
   * Praefixe landen bewusst im Mittelfeld, damit auch eine aeltere
   * gespeicherte Aufstellung mit fremden Slot-Namen nicht verloren geht.
   */
  function lineOf(slot) {
    if (slot === "GK") return "G";
    var prefix = String(slot).replace(/\d+$/, "");
    if (prefix === "D") return "D";
    if (prefix === "F") return "F";
    return "M";
  }

  KT.formations = build();
  KT.formationNames = Object.keys(KT.formations);
  KT.formationLine = lineOf;
})(window.KT);
