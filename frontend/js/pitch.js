// Gemeinsames Spielfeld-Rendering fuer Aufstellungs- und Spieltagsansicht.
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  /**
   * Baut das innere HTML eines Spielfelds.
   *
   * @param formation Formationsname, z.B. "4-3-3"
   * @param renderSlot function(slotDef) -> HTML fuer den Inhalt einer Position
   */
  function renderInto(el, formation, renderSlot) {
    var slots = KT.formations[formation] || KT.formations["4-4-2"];
    el.innerHTML = slots
      .map(function (s) {
        return [
          '<div data-slot="' + s.slot + '" style="left:' + s.x + "%; top:" + s.y + '%;"',
          '  class="lineup-slot absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">',
          renderSlot(s),
          "</div>",
        ].join("\n");
      })
      .join("");
  }

  /** Kurzform des Namens, damit die Kacheln auf dem Handy nicht platzen. */
  function shortName(name) {
    if (!name) return "";
    var parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return parts[0].charAt(0) + ". " + parts.slice(1).join(" ");
  }

  /**
   * Vereinswappen - kommt direkt von ESPN, kein eigenes Backend-Archiv wie
   * bei Spielerfotos nötig. Ohne URL bleibt die Stelle leer statt zu
   * springen, damit Namen in einer Zeile nicht seitlich wandern.
   */
  function crestHtml(logo, sizeClass) {
    if (!logo) return '<span class="' + sizeClass + ' inline-block shrink-0"></span>';
    return (
      '<img src="' + KT.ui.escapeHtml(logo) + '" alt="" loading="lazy" ' +
      'class="' + sizeClass + ' object-contain shrink-0" onerror="this.style.visibility=\'hidden\'" />'
    );
  }

  /**
   * "Borussia Mönchengladbach" -> "M'gladbach"-artige Kurzform fuer enge
   * Kacheln. Nimmt die gepflegten kicker-Kurzformen (KT.vereine); nur fuer
   * unbekannte Vereine wird der Name noch selbst gekuerzt.
   */
  function shortTeam(name, teamId) {
    if (!name && teamId == null) return "";
    var kurz = KT.vereine.kurz(teamId, name);
    if (kurz !== name) return kurz;
    return String(name)
      .replace(/^(1\.\s*)?(FC|SC|SV|VfB|VfL|TSG|RB|Borussia|Bayer|Eintracht|Hamburg|Werder)\s+/i, "")
      .trim() || String(name);
  }

  KT.pitch = {
    renderInto: renderInto,
    shortName: shortName,
    shortTeam: shortTeam,
    crestHtml: crestHtml,
  };
})(window.KT);
