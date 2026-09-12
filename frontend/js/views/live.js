window.KT = window.KT || {};
window.KT.views = window.KT.views || {};

(function (KT) {
  "use strict";

  KT.views.live = function (container) {
    var escapeHtml = KT.ui.escapeHtml;
    var pollTimer = null;
    var currentBundle = null;
    var currentScores = [];
    // Ausgeklappte Konkurrenten. Bleibt ueber Neuzeichnen erhalten, damit ein
    // Live-Refresh nicht zuklappt, was man gerade offen hat.
    var expanded = new Set();
    // Aufgeklappte Begegnungen (Ereignis-IDs). Getrennt von "expanded", damit
    // ein offenes Spiel beim Live-Refresh nicht zuklappt und umgekehrt.
    var offeneSpiele = new Set();
    var matchdayIndex = null;

    // Punktestand je Spieler beim letzten Zeichnen - Grundlage dafuer, beim
    // naechsten Mal zu erkennen, WER sich veraendert hat. Schluessel ist
    // Konkurrent+Position, nicht der Spieler: derselbe Spieler kann bei
    // mehreren Konkurrenten aufgestellt sein und soll dann auch mehrfach
    // aufblitzen.
    var letzterStand = new Map();
    // Ergebnis des Vergleichs, gilt nur fuer das unmittelbar folgende
    // Zeichnen: Schluessel -> "plus" oder "minus".
    var frischVeraendert = new Map();
    // Zuletzt gerechnete Gesamtwertung, damit Auf- und Zuklappen einer Zeile
    // nicht alle Spieltage erneut laedt.
    var gesamtStand = null;

    // Wert des Auswahlfelds fuer die Gesamtwertung. Bewusst eine Zeichenkette,
    // die keine Spieltagsnummer sein kann.
    var GESAMT = "gesamt";
    var GESAMT_KEY = "kicker-tool:punktestand-gesamt";

    container.innerHTML = [
      '<section class="max-w-4xl mx-auto">',
      '  <div class="flex flex-wrap items-end justify-between gap-3 mb-4 pb-3 border-b-2 border-ink">',
      "    <div>",
      '      <h1 class="font-display text-3xl font-bold uppercase tracking-tight leading-none">Punkte</h1>',
      '      <p class="text-mute text-sm mt-1" id="md-status">Lade Spielplan…</p>',
      "    </div>",
      '    <div class="flex items-end gap-1.5">',
      '      <button id="md-prev" class="kt-btn kt-btn-secondary px-2.5" title="Voriger Spieltag">‹</button>',
      "      <div>",
      '        <label class="kt-eyebrow block mb-1">Punkte</label>',
      '        <select id="md-select" class="kt-input font-semibold py-[0.42rem]"></select>',
      "      </div>",
      '      <button id="md-next" class="kt-btn kt-btn-secondary px-2.5" title="Nächster Spieltag">›</button>',
      '      <button id="md-refresh" class="kt-btn kt-btn-primary">Aktualisieren</button>',
      "    </div>",
      "  </div>",
      '  <div id="md-body"><p class="text-mute">Lade…</p></div>',
      "</section>",
    ].join("\n");

    var selectEl = container.querySelector("#md-select");
    var statusEl = container.querySelector("#md-status");
    var bodyEl = container.querySelector("#md-body");
    var prevBtn = container.querySelector("#md-prev");
    var nextBtn = container.querySelector("#md-next");
    var refreshBtn = container.querySelector("#md-refresh");

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------

    /**
     * Fixture des Spielers an diesem Spieltag - ueber sein Vereins-Team, denn
     * bei kommenden Spieltagen gibt es noch keine ESPN-Spielerdaten.
     */
    function fixtureForPlayer(entry) {
      var teamId = entry.teamId;
      if (!teamId || !currentBundle) return null;
      var events = currentBundle.events || [];
      for (var i = 0; i < events.length; i++) {
        var cs = events[i].competitors || [];
        for (var j = 0; j < cs.length; j++) {
          if (cs[j].teamId === teamId) {
            var opponent = cs[1 - j] || {};
            return {
              home: j === 0,
              opponentName: opponent.teamName || "?",
              opponentId: opponent.teamId || null,
              event: events[i],
            };
          }
        }
      }
      return null;
    }

    /**
     * Ereignis-Symbole eines Spielers (Tore, Vorlagen, Karten, Wechsel).
     * Gemeinsam genutzt von Spielfeld und Live-Zeile, damit beide dieselbe
     * Sprache sprechen.
     */
    function ereignisBadges(entry) {
      var match = entry.match;
      var manual = entry.manual || {};
      var badges = [];
      // Korrigierte Werte anzeigen, nicht die rohen ESPN-Zahlen.
      var goals = manual.goals === null || manual.goals === undefined
        ? (match && match.goals) || 0 : manual.goals;
      var assists = manual.assists === null || manual.assists === undefined
        ? (match && match.assists) || 0 : manual.assists;

      if (goals) badges.push("⚽" + (goals > 1 ? goals : ""));
      if (assists) badges.push("🅰️" + (assists > 1 ? assists : ""));
      if (manual.player_of_match) badges.push('<span class="text-warn" title="Spieler des Spiels">★</span>');
      if (match && match.redCards) badges.push("🟥");
      // "↑"/"↓" lesen sich als "kam rein"/"ging raus"; Doppelpfeile wirkten
      // auf dem Feld wie ein Strich und waren nicht zu deuten.
      if (match && match.subbedIn) badges.push('<span class="text-pos" title="eingewechselt">↑</span>');
      if (match && match.subbedOut) badges.push('<span class="text-mute" title="ausgewechselt">↓</span>');
      return badges;
    }

    /**
     * Punktefarbe: bei kicker steht die Note oben rechts, hier die Punkte an
     * derselben Stelle - aber mit unserer Bedeutung (gruen gut, rot schlecht).
     */
    function punkteFarbeFuer(entry) {
      if (!entry.played) return "text-mute";
      if (entry.points > 0) return "text-pos";
      if (entry.points < 0) return "text-kicker";
      return "text-ink";
    }

    /**
     * Vergleicht den neuen Punktestand mit dem letzten und merkt sich, wer
     * sich veraendert hat.
     *
     * Beim ERSTEN Zeichnen wird bewusst nichts hervorgehoben: Da ist alles
     * neu, und ein Spielfeld, auf dem elf Spieler gleichzeitig aufblitzen,
     * hiesse gar nichts. Hervorgehoben wird nur eine echte Aenderung
     * gegenueber dem, was man vorher gesehen hat.
     */
    function standVergleichen(scores) {
      frischVeraendert = new Map();
      scores.forEach(function (c) {
        c.slots.forEach(function (slot) {
          var schluessel = c.competitorId + ":" + slot.slot;
          var vorher = letzterStand.get(schluessel);
          if (vorher !== undefined && vorher !== slot.points) {
            frischVeraendert.set(schluessel, slot.points > vorher ? "plus" : "minus");
          }
          letzterStand.set(schluessel, slot.points);
        });
      });
    }

    /** CSS-Klasse fuers kurze Aufblitzen, oder "" wenn unveraendert. */
    function blitzKlasse(competitorId, slot) {
      var richtung = frischVeraendert.get(competitorId + ":" + slot);
      return richtung ? " punkte-blitz punkte-blitz-" + richtung : "";
    }

    function renderPlayerChip(entry, competitorId) {
      var match = entry.match;
      var badges = ereignisBadges(entry);
      var punkteFarbe = punkteFarbeFuer(entry);

      var note = entry.grade !== null && entry.grade !== undefined
        ? Number(entry.grade).toFixed(1).replace(".", ",")
        : null;
      // Waehrend das Spiel laeuft, ist "steht gerade auf dem Platz" die
      // interessantere Auskunft als eine (noch gar nicht vorhandene) Note.
      var liveJetzt = match && match.matchState === "in";

      var fx = fixtureForPlayer(entry);
      // Hat die Partie DIESES Spielers schon begonnen? Nicht am Spieltag
      // insgesamt festmachen: Ein Spieltag laeuft ueber mehrere Tage, die
      // Sonntagspartien sind noch nicht angepfiffen, waehrend die vom Freitag
      // laengst abgepfiffen sind.
      var partieBegonnen = Boolean(fx && fx.event && fx.event.state !== "pre");

      // Die Unterschrift beschreibt den Stand der PUNKTZAHL, nicht das Spiel:
      //   ausstehend  - noch nichts verdient
      //   live        - aendert sich gerade noch
      //   Note 2,5    - steht fest (die Note ist die Eingabe dahinter)
      // "Note fehlt" faellt bewusst aus dieser Reihe: das ist kein Zustand,
      // sondern eine offene Aufgabe, und soll deshalb gelb herausstechen.
      var statusLine;
      if (!fx && !match) {
        // Der Verein dieses Spielers hat an diesem Spieltag gar keine Partie.
        statusLine = '<span class="text-mute">kein Spiel</span>';
      } else if (!partieBegonnen) {
        statusLine = '<span class="text-mute">ausstehend</span>';
      } else if (!match) {
        // Partie laeuft oder ist vorbei, der Spieler steht aber nicht in der
        // Aufstellung - dann war er tatsaechlich nicht nominiert.
        statusLine = '<span class="text-mute">nicht dabei</span>';
      } else if (!match.played) {
        statusLine = '<span class="text-mute">Bank</span>';
      } else if (liveJetzt && match.subbedOut) {
        statusLine = '<span class="text-mute">ausgewechselt</span>';
      } else if (liveJetzt) {
        statusLine = '<span class="text-kicker font-bold uppercase tracking-wide">live</span>';
      } else if (note) {
        statusLine = '<span class="text-mute-dark">Note ' + note + "</span>";
      } else if (entry.noGrade) {
        // Bewusst "-" eingetragen: gespielt, aber keine Note - das ist
        // erledigt, kein offener Punkt mehr wie bei "Note fehlt".
        statusLine = '<span class="text-mute italic">ohne Note</span>';
      } else {
        statusLine = '<span class="text-warn font-semibold">Note fehlt</span>';
      }

      // Aufbau wie bei kicker: Foto im Hochformat, Ereignis-Symbole an der
      // oberen linken Ecke, die Zahl oben rechts, darunter nur der Nachname.
      // Auf dem dunklen Rasen braucht der Name keine eigene Flaeche mehr.
      return [
        '<div class="flex flex-col items-center w-full cursor-pointer" ' +
          'title="' + escapeHtml(entry.playerName) + ' – für die Punkte-Aufschlüsselung antippen">',
        '  <div class="relative' + blitzKlasse(competitorId, entry.slot) + '">',
        "    " + KT.images.avatarHtml(entry.playerId, entry.playerName, "pitch-photo", false),
        badges.length
          ? '    <div class="absolute -top-1 -left-1 leading-none text-[9px] bg-[#0c0c0c]/90 rounded-sm px-0.5 py-px whitespace-nowrap">' +
            badges.join("") + "</div>"
          : "",
        '    <div class="pitch-points absolute -top-1 -right-1 tabular-nums ' + punkteFarbe + '">' +
          entry.points + "</div>",
        "  </div>",
        '  <div class="pitch-name mt-1 font-semibold text-ink text-center max-w-full truncate">' +
          escapeHtml(KT.ui.lastName(entry.playerName)) + "</div>",
        '  <div class="pitch-status max-w-full truncate">' + statusLine + "</div>",
        "</div>",
      ].join("\n");
    }

    /**
     * Spieler dieses Konkurrenten, deren Partie GERADE laeuft - auf dem Platz,
     * ausgewechselt oder auf der Bank. Absteigend nach Punkten, aber die
     * Spielenden immer vor den Ausgewechselten und denen auf der Bank.
     */
    function liveSpieler(c) {
      var rang = function (s) {
        if (!s.played) return 2; // Bank
        return s.match.subbedOut ? 1 : 0; // ausgewechselt / auf dem Platz
      };
      return c.slots
        .filter(function (s) {
          return s.match && s.match.matchState === "in";
        })
        .sort(function (a, b) {
          return rang(a) - rang(b) || b.points - a.points;
        });
    }

    /** Eine Kachel in der Live-Zeile: Foto, Name, Ereignisse, Punktestand. */
    function renderLiveChip(c, entry) {
      var badges = ereignisBadges(entry);
      var aufDemPlatz = entry.played && !entry.match.subbedOut;
      // Die Lage steht nicht mehr als Beschriftung darunter - das war bei elf
      // Kacheln nur eine Wand aus "LIVE". Wer nicht auf dem Platz steht, ist
      // abgedunkelt; das Genaue sagt der Tooltip.
      var lage = !entry.played
        ? "auf der Bank"
        : entry.match.subbedOut
        ? "ausgewechselt"
        : "live im Spiel";

      return [
        '<button data-live-slot="' + c.competitorId + ":" + entry.slot + '"',
          ' title="' + escapeHtml(entry.playerName) + " – " + lage +
          ' – für die Punkte-Aufschlüsselung antippen"',
          ' class="shrink-0 w-[46px] flex flex-col items-center gap-0.5 kt-focus kt-hover rounded-sm ' +
          (aufDemPlatz ? "" : "opacity-60") + '">',
        '  <span class="relative block' + blitzKlasse(c.competitorId, entry.slot) + '">',
        "    " + KT.images.avatarHtml(entry.playerId, entry.playerName,
          "w-[40px] aspect-[4/5] object-cover object-top rounded-sm", false),
        badges.length
          ? '    <span class="absolute -top-1 -left-1 leading-none text-[9px] bg-[#0c0c0c]/90 ' +
            'rounded-sm px-0.5 py-px whitespace-nowrap">' + badges.join("") + "</span>"
          : "",
        // Deckkraft bewusst /90: ein frei gewaehlter Wert wie /92 steht nicht
        // in Tailwinds Stufenleiter und faellt ersatzlos weg - die Zahl haette
        // dann gar keine Flaeche und stuende unlesbar auf dem Trikot.
        // Vollstaendig INNERHALB des Fotos, sonst ragt sie in den Namen.
        '    <span class="absolute bottom-0.5 right-0.5 text-[9px] font-bold tabular-nums leading-none ' +
          'bg-[#0c0c0c]/90 rounded-sm px-1 py-0.5 ' + punkteFarbeFuer(entry) + '">' + entry.points + "</span>",
        "  </span>",
        '  <span class="block w-full text-[9px] font-semibold text-ink text-center truncate leading-tight">' +
          escapeHtml(KT.ui.lastName(entry.playerName)) + "</span>",
        "</button>",
      ].join("\n");
    }

    function renderLiveStrip(c) {
      var spieler = liveSpieler(c);
      // Nichts ausgeben, wenn niemand im Einsatz ist. Eine leere Leiste mit
      // flex-1 hat sonst trotzdem den ganzen freien Platz belegt - die
      // Namensspalte blieb bei ihrer Mindestbreite und schnitt die Zeile
      // "gespielt 8/11 · benotet 3/8" ab.
      if (!spieler.length) return "";
      return [
        // Hoechstens die halbe Zeile: Name und Zaehler darunter sind
        // wichtiger als die fuenfte Spielerkachel. Was nicht passt, laesst
        // sich in der Leiste seitlich schieben.
        '<span class="flex-1 min-w-0 flex gap-1 overflow-x-auto py-0.5">',
        spieler
          .map(function (s) {
            return renderLiveChip(c, s);
          })
          .join(""),
        "</span>",
      ].join("\n");
    }

    function renderCompetitorCard(c, rank, istBeendet) {
      var wrapperId = "pitch-" + c.competitorId;
      var isOpen = expanded.has(c.competitorId);

      // Wie viel von der Punktzahl steht schon fest? Eine hohe Zahl nach drei
      // gespielten Spielern bedeutet etwas ganz anderes als dieselbe Zahl nach
      // elf. Deshalb steht unter dem Namen, wie weit der Spieltag fuer diesen
      // Konkurrenten gediehen ist.
      var aufgestellt = c.slots.length;
      var gespielt = c.slots.filter(function (s) {
        return s.played;
      }).length;
      var benotet = c.slots.filter(function (s) {
        // "-" (bewusst keine Note) zaehlt als eingetragen, nicht als offen.
        return s.played && ((s.grade !== null && s.grade !== undefined) || s.noGrade);
      }).length;

      // Der Nenner bei "benotet" ist bewusst die Zahl der EINGESETZTEN, nicht
      // der aufgestellten Spieler: Wer nicht gespielt hat, kann keine Note
      // bekommen. "3/11" liesse eine Luecke vermuten, die es gar nicht gibt.
      var unterzeile, unterzeileFarbe;
      if (!c.hasLineup) {
        unterzeile = "keine Aufstellung";
        unterzeileFarbe = "text-mute";
      } else if (!gespielt) {
        // Noch niemand im Einsatz - dann ist die Formation die einzige
        // Auskunft, die es ueberhaupt zu geben gibt.
        unterzeile = c.formation || "";
        unterzeileFarbe = "text-mute";
      } else {
        unterzeile =
          "gespielt " + gespielt + "/" + aufgestellt +
          " · benotet " + benotet + "/" + gespielt;
        // Gelb nur nach Abpfiff: Waehrend gespielt wird, sind fehlende Noten
        // normal, es gibt ja noch keine.
        unterzeileFarbe = istBeendet && benotet < gespielt ? "text-warn" : "text-mute";
      }

      // Die Zeile ist ein div mit Knopf-Rolle, kein <button>: die Live-Kacheln
      // darin sind selbst anklickbar, und ein Knopf im Knopf ist ungueltiges
      // HTML. role/tabindex/aria-expanded halten sie trotzdem bedienbar -
      // anspringbar mit Tab, ausloesbar mit Enter und Leertaste.
      var header = [
        '<div data-toggle="' + c.competitorId + '" role="button" tabindex="0"',
          ' aria-expanded="' + (isOpen ? "true" : "false") + '"',
          ' class="w-full flex items-center gap-2 sm:gap-3 px-3 py-2 text-left cursor-pointer ' +
          'kt-hover kt-focus transition-colors">',
        '  <span class="w-5 text-right font-semibold text-mute tabular-nums shrink-0">' + rank + "</span>",
        // Feste Breite, die fuer "gespielt 11/11 · benotet 0/11" reicht.
        // Bewusst NICHT mitwachsend: Mit flex-1 (Basis 0) wurde der Name
        // neben der Live-Leiste auf "Si..." zusammengequetscht, weil die
        // Leiste ihre Inhaltsbreite behielt und kaum Platz uebrig liess.
        '  <span class="w-40 sm:w-52 shrink-0 min-w-0">',
        '    <span class="block font-semibold text-ink truncate leading-tight">' + escapeHtml(c.competitorName) + "</span>",
        '    <span class="block text-[11px] ' + unterzeileFarbe + ' truncate">' +
          escapeHtml(unterzeile) + "</span>",
        "  </span>",
        renderLiveStrip(c),
        // Die Punktespalte ist bei kicker die eine rote Zahl in der Tabelle.
        // Feste Breite, damit Zahl und Pfeil bei Live-Updates nicht wandern.
        '  <span class="font-display text-2xl font-bold tabular-nums leading-none w-14 text-right ' +
          (c.total === 0 ? "text-mute" : "text-kicker") + '">' + c.total + "</span>",
        '  <span class="text-mute text-sm w-3 text-center shrink-0">' + (isOpen ? "▾" : "▸") + "</span>",
        "</div>",
      ].join("\n");

      var body = "";
      if (isOpen) {
        body = [
          '<div class="border-t border-line bg-wash p-3">',
          c.hasLineup
            ? '  <div id="' + wrapperId + '" class="pitch pitch-compact relative w-full max-w-lg mx-auto aspect-[3/4] overflow-hidden"></div>'
            : '  <p class="text-mute text-sm text-center mb-2">Noch keine Aufstellung für diesen Spieltag.</p>',
          // Ohne Anmeldung gar nicht erst anbieten: Der Editor wuerde sich
          // oeffnen lassen, aber jedes Speichern am Passwortschutz des
          // Backends scheitern - erst nach getaner Arbeit.
          KT.auth.istOffen()
            ? '  <div class="flex justify-center mt-3">' +
              '    <button data-edit-lineup="' + c.competitorId + '" class="kt-btn kt-btn-secondary">' +
              "      Aufstellung bearbeiten" +
              "    </button>" +
              "  </div>"
            : "",
          "</div>",
        ].join("\n");
      }

      return [
        '<div class="bg-panel border-b border-line last:border-b-0">',
        header,
        body,
        "</div>",
      ].join("\n");
    }

    /**
     * Torschuetzen und Vorlagengeber einer Partie, nach Mannschaft getrennt.
     *
     * ESPN legt Tor und Vorlage als EIN Ereignis ab, unsere aufbereiteten
     * Daten haengen sie aber an je einen Spieler. Zusammengefuehrt wird
     * deshalb ueber Mannschaft + Minute - beide stammen aus demselben
     * Ereignis und stimmen darum ueberein.
     */
    function torfolge(detail, teamId) {
      if (!detail) return [];
      var nachMinute = {};
      Object.keys(detail.players).forEach(function (id) {
        var p = detail.players[id];
        if (p.teamId !== teamId) return;
        (p.events || []).forEach(function (ev) {
          var schluessel = ev.minute || "?";
          var eintrag = nachMinute[schluessel] ||
            (nachMinute[schluessel] = { minute: ev.minute, tore: [], vorlagen: [] });
          (ev.kind === "goal" ? eintrag.tore : eintrag.vorlagen).push(p.playerName);
        });
      });

      var liste = Object.keys(nachMinute)
        .map(function (k) { return nachMinute[k]; })
        .filter(function (e) { return e.tore.length; })
        .sort(function (a, b) { return minuteAlsZahl(a.minute) - minuteAlsZahl(b.minute); });

      // Eigentore stehen NICHT in den Ereignissen - ESPN zaehlt sie nicht als
      // regulaeres Tor, und unsere Aufbereitung filtert sie bewusst heraus.
      // Ohne sie ginge die Rechnung zum Spielstand aber nicht auf.
      Object.keys(detail.players).forEach(function (id) {
        var p = detail.players[id];
        if (p.teamId === teamId || !p.ownGoals) return;
        for (var n = 0; n < p.ownGoals; n++) {
          liste.push({ minute: "", tore: [p.playerName], vorlagen: [], eigentor: true });
        }
      });
      return liste;
    }

    /** "45+2'" -> 47, damit sich Minuten sortieren lassen. */
    function minuteAlsZahl(minute) {
      var teile = String(minute || "").match(/\d+/g);
      if (!teile) return 999;
      return teile.reduce(function (a, b) { return a + Number(b); }, 0);
    }

    /**
     * Tore einer Mannschaft, untereinander.
     *
     * Ausgerichtet wird nach AUSSEN, nicht zur Mitte: Die Heimmannschaft
     * steht linksbuendig am linken Rand, die Gastmannschaft rechtsbuendig am
     * rechten. Vorher hingen beide Spalten an der Mittellinie, wo lange Namen
     * mit Vorlagengeber ineinanderliefen.
     *
     * Je Tor zwei Zeilen - Torschuetze mit Minute, darunter klein der
     * Vorlagengeber. Als eine Zeile ("Prömel 60' · Vorlage Mittelstädt") war
     * es auf dem Handy zu lang und die Namen gingen ineinander ueber.
     */
    function renderTorliste(detail, teamId, nachRechts) {
      var eintraege = torfolge(detail, teamId);
      if (!eintraege.length) {
        return '<div class="text-xs text-mute ' + (nachRechts ? "text-right" : "") + '">keine Tore</div>';
      }
      return eintraege
        .map(function (e) {
          var namen = escapeHtml(e.tore.map(function (n) { return KT.ui.lastName(n); }).join(", "));
          var kopf = [
            '<span class="text-ink font-semibold truncate">' + namen + "</span>",
            e.eigentor ? '<span class="text-kicker shrink-0">(ET)</span>' : "",
            e.minute
              ? '<span class="text-mute-dark tabular-nums shrink-0">' + escapeHtml(e.minute) + "</span>"
              : "",
          ].join("");

          var vorlage = e.vorlagen.length
            ? '<div class="text-[11px] text-mute truncate leading-tight ' +
              (nachRechts ? 'text-right pr-5' : 'pl-5') + '">' +
              escapeHtml(e.vorlagen.map(function (n) { return KT.ui.lastName(n); }).join(", ")) +
              "</div>"
            : "";

          return [
            '<div class="text-xs py-1 min-w-0">',
            // Der Ball sitzt aussen neben dem Namen, auf beiden Seiten
            // spiegelbildlich - so liest sich jede Zeile von aussen nach innen.
            '  <div class="flex items-baseline gap-1.5 min-w-0 ' +
              (nachRechts ? "flex-row-reverse" : "") + '">',
            '    <span class="shrink-0">⚽</span>',
            "    " + kopf,
            "  </div>",
            vorlage,
            "</div>",
          ].join("");
        })
        .join("");
    }

    // ------------------------------------------------------------------
    // Live-Ticker
    // ------------------------------------------------------------------

    // Ereignis-Schluessel des letzten Durchlaufs. Daraus erkennen wir Tore,
    // die ESPN wieder entfernt hat (Abseits, Videobeweis) - eine eigene
    // Meldung dafuer gibt es naemlich nicht, der Eintrag verschwindet
    // einfach.
    var letzteSchluessel = new Map();
    // Aberkannte Tore aus dieser Sitzung. Muessen aufgehoben werden: In den
    // Daten stehen sie ja gerade nicht mehr.
    var aberkannte = [];

    // Nur die juengsten Ereignisse. Mehr war eine Wand aus Meldungen, in der
    // das Aktuelle nicht mehr auffiel - und genau darum geht es im Ticker.
    var TICKER_MAX = 5;

    /**
     * Welche Sorte Ereignis ist das? Geprueft wird ueber Teilzeichenketten,
     * weil ESPN viele Spielarten kennt ("goal---header", "penalty-goal",
     * "own-goal") und eine feste Liste bei der naechsten stillschweigend
     * unvollstaendig waere.
     */
    function ereignisArt(ev) {
      var a = ev.art || "";
      if (/own-goal/.test(a)) return "eigentor";
      if (ev.tor || /goal/.test(a)) return "tor";
      if (/yellow-red|second-yellow/.test(a)) return "gelbrot";
      if (/red-card/.test(a)) return "rot";
      if (/substitution/.test(a)) return "wechsel";
      return null;
    }

    /**
     * Sortierwert eines Ereignisses: die ECHTE Uhrzeit als Zeitstempel.
     *
     * Nicht die Spielminute. Ein Spieltag laeuft ueber drei Tage - ein Tor in
     * der 90. Minute der Freitagspartie faellt lange vor einem Tor in der 10.
     * Minute am Sonntag. Nach Spielminute sortiert stuende der Ticker kopf.
     *
     * ESPN liefert dafuer "wallclock". Fehlt das (aeltere Daten), wird aus
     * Anpfiff plus Spielzeit geschaetzt - grob, aber immer noch besser als
     * die blosse Spielminute.
     */
    function ereignisZeit(ev, spiel) {
      if (ev.zeit) {
        var t = Date.parse(ev.zeit);
        if (!isNaN(t)) return t;
      }
      var anpfiff = spiel && spiel.date ? Date.parse(spiel.date) : 0;
      if (isNaN(anpfiff)) anpfiff = 0;
      // Nach der 45. Minute die Halbzeitpause mitrechnen, sonst laegen die
      // zweiten Halbzeiten aller Partien zu frueh.
      var pause = (ev.sekunde || 0) > 2700 ? 15 * 60 : 0;
      return anpfiff + ((ev.sekunde || 0) + pause) * 1000;
    }

    /**
     * Wiedererkennungsmerkmal eines Ereignisses ueber mehrere Abrufe hinweg.
     * ESPN vergibt eigene Kennungen - die sind stabiler als alles
     * Zusammengesetzte. Nur falls eine fehlt, wird ersatzweise gebaut.
     */
    function ereignisSchluessel(eventId, ev) {
      if (ev.id) return eventId + "|" + ev.id;
      return [
        eventId,
        ev.art,
        ev.sekunde,
        ev.beteiligte
          .map(function (b) { return b.id; })
          .join("+"),
      ].join("|");
    }

    /**
     * Sammelt die Ereignisse aller Partien fuer den Ticker.
     *
     * Tore kommen aus JEDEM Spiel - der Spielstand interessiert ohnehin.
     * Karten und Auswechslungen nur, wenn ein Spieler beteiligt ist, der bei
     * einem Konkurrenten aufgestellt ist: Sonst waeren es an einem Spieltag
     * ueber hundert Meldungen, von denen fast keine mit der Wertung zu tun
     * hat.
     */
    function tickerSammeln(bundle) {
      var relevant = bundle.relevantPlayerIds || new Set();
      var nameJeEvent = {};
      (bundle.events || []).forEach(function (e) {
        nameJeEvent[e.id] = e;
      });

      // Map statt Set: Verschwindet ein Tor, brauchen wir noch Minute,
      // Verein und Schuetzen - aus den aktuellen Daten sind sie dann weg.
      var jetztSchluessel = new Map();
      var liste = [];

      (bundle.details || []).forEach(function (d) {
        var spiel = nameJeEvent[d.eventId];
        (d.ereignisse || []).forEach(function (ev) {
          var art = ereignisArt(ev);
          if (!art) return;

          var schluessel = ereignisSchluessel(d.eventId, ev);
          if (art === "tor" || art === "eigentor") {
            jetztSchluessel.set(schluessel, {
              spielId: d.eventId,
              minute: ev.minute,
              teamId: ev.teamId,
              beteiligte: ev.beteiligte,
            });
          }

          if (art !== "tor" && art !== "eigentor") {
            var betrifftUns = ev.beteiligte.some(function (b) {
              return relevant.has(String(b.id));
            });
            if (!betrifftUns) return;
          }

          liste.push({
            art: art,
            minute: ev.minute,
            sekunde: ereignisZeit(ev, spiel),
            teamId: ev.teamId,
            spiel: spiel,
            beteiligte: ev.beteiligte,
            schluessel: schluessel,
          });
        });
      });

      // Verschwundene Tore aufspueren - aber nur bei laufenden Partien. Bei
      // beendeten Spielen kaeme eine Abweichung eher von einem neu
      // aufgebauten Zwischenspeicher als von einem aberkannten Tor.
      var laeuftGerade = {};
      (bundle.events || []).forEach(function (e) {
        laeuftGerade[e.id] = e.state === "in";
      });
      if (letzteSchluessel.size) {
        letzteSchluessel.forEach(function (vorher, schluessel) {
          if (jetztSchluessel.has(schluessel)) return;
          if (!laeuftGerade[vorher.spielId]) return;
          if (aberkannte.length >= TICKER_MAX) aberkannte.shift();
          aberkannte.push({
            art: "aberkannt",
            // Die Spielminute des urspruenglichen Tores - dafuer wird der
            // letzte Stand gemerkt, denn in den Daten steht das Tor ja
            // gerade nicht mehr.
            minute: vorher.minute,
            // Als Zeit gilt JETZT, nicht der Zeitpunkt des Tores: Die
            // Aberkennung ist die frische Nachricht und gehoert an den
            // Anfang des Tickers.
            sekunde: Date.now(),
            teamId: vorher.teamId,
            spiel: nameJeEvent[vorher.spielId],
            beteiligte: vorher.beteiligte,
            schluessel: schluessel + "|weg",
          });
        });
      }
      letzteSchluessel = jetztSchluessel;

      return liste
        .concat(aberkannte)
        .sort(function (a, b) { return b.sekunde - a.sekunde; })
        .slice(0, TICKER_MAX);
    }

    var TICKER_SYMBOL = {
      tor: "⚽",
      eigentor: "⚽",
      rot: "🟥",
      gelbrot: "🟨🟥",
      wechsel: "↔",
      aberkannt: "⊘",
    };

    function renderTickerEintrag(e) {
      var verein = e.spiel
        ? (e.spiel.competitors || []).filter(function (c) { return c.teamId === e.teamId; })[0]
        : null;
      var vereinKurz = verein
        ? KT.pitch.shortTeam(verein.teamName || "", verein.teamId)
        : (e.spiel ? KT.pitch.shortTeam(e.spiel.competitors[0].teamName, e.spiel.competitors[0].teamId) : "");

      var haupt, neben;
      if (e.art === "tor" || e.art === "eigentor") {
        haupt = KT.ui.lastName((e.beteiligte[0] || {}).name || "") + (e.art === "eigentor" ? " (ET)" : "");
        // Verein IMMER dazu: Bei einem Tor aus irgendeinem Spiel ist die
        // erste Frage "wer hat getroffen", die zweite "fuer wen".
        neben = e.beteiligte[1]
          ? vereinKurz + " · Vorlage " + KT.ui.lastName(e.beteiligte[1].name)
          : vereinKurz;
      } else if (e.art === "wechsel") {
        haupt = KT.ui.lastName((e.beteiligte[0] || {}).name || "");
        neben = e.beteiligte[1]
          ? vereinKurz + " · für " + KT.ui.lastName(e.beteiligte[1].name)
          : vereinKurz;
      } else if (e.art === "aberkannt") {
        haupt = "Tor aberkannt";
        var schuetze = (e.beteiligte[0] || {}).name;
        neben = schuetze ? vereinKurz + " · " + KT.ui.lastName(schuetze) : vereinKurz;
      } else {
        haupt = KT.ui.lastName((e.beteiligte[0] || {}).name || "");
        neben = vereinKurz;
      }

      var farbe = e.art === "rot" || e.art === "gelbrot" || e.art === "aberkannt"
        ? "text-kicker"
        : "text-ink";

      return [
        '<div class="flex-1 min-w-[150px] px-2 py-1.5 border-l border-line first:border-l-0">',
        '  <div class="flex items-baseline gap-1 min-w-0">',
        '    <span class="shrink-0 text-[11px]">' + TICKER_SYMBOL[e.art] + "</span>",
        e.minute
          ? '    <span class="shrink-0 text-[11px] text-mute-dark tabular-nums">' +
            escapeHtml(e.minute) + "</span>"
          : "",
        '    <span class="truncate text-xs font-semibold ' + farbe + '">' + escapeHtml(haupt) + "</span>",
        "  </div>",
        '  <div class="text-[11px] text-mute truncate leading-tight">' + escapeHtml(neben) + "</div>",
        "</div>",
      ].join("");
    }

    function renderTicker(bundle) {
      var eintraege = tickerSammeln(bundle);
      if (!eintraege.length) return "";
      return [
        '<div class="kt-panel mb-4 overflow-hidden">',
        '  <div class="flex overflow-x-auto divide-line">',
        eintraege.map(renderTickerEintrag).join(""),
        "  </div>",
        "</div>",
      ].join("\n");
    }

    function renderMatchList(events) {
      var details = (currentBundle && currentBundle.details) || [];

      return [
        '<h2 class="kt-eyebrow mt-8 mb-2">Begegnungen</h2>',
        '<div class="kt-panel text-sm">',
        events
          .map(function (e) {
            var home = e.competitors[0] || {};
            var away = e.competitors[1] || {};
            var laeuft = e.state === "in";
            var score = e.state === "pre"
              ? new Date(e.date).toLocaleString("de-DE", {
                  weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                })
              : (home.score || "0") + " : " + (away.score || "0");

            // Vor dem Anpfiff gibt es nichts aufzuklappen.
            var aufklappbar = e.state !== "pre";
            var offen = offeneSpiele.has(e.id);
            var detail = details.filter(function (d) { return d.eventId === e.id; })[0] || null;

            var zeile = [
              "<" + (aufklappbar ? "button" : "div") + ' class="w-full kt-row kt-hover flex items-center ' +
                'justify-between gap-2 px-3 py-2 text-left"' +
                (aufklappbar ? ' data-spiel="' + escapeHtml(e.id) + '" aria-expanded="' + offen + '"' : "") + ">",
              '  <span class="flex-1 min-w-0 flex items-center justify-end gap-1.5 text-right truncate">' +
                // Kurzform: die Zeile ist beidseitig eng, volle Namen wuerden
                // auf dem Handy abgeschnitten - der kicker-Ticker kuerzt auch.
                '<span class="truncate">' +
                escapeHtml(KT.pitch.shortTeam(home.teamName || "?", home.teamId)) + "</span>" +
                KT.pitch.crestHtml(home.logo, "w-4 h-4") + "</span>",
              '  <span class="font-semibold px-1 whitespace-nowrap tabular-nums ' +
                (laeuft ? "text-kicker" : "text-ink") + '">' + escapeHtml(score) + "</span>",
              '  <span class="flex-1 min-w-0 flex items-center gap-1.5 truncate">' +
                KT.pitch.crestHtml(away.logo, "w-4 h-4") +
                '<span class="truncate">' +
                escapeHtml(KT.pitch.shortTeam(away.teamName || "?", away.teamId)) + "</span></span>",
              // Bei noch nicht angepfiffenen Spielen liefert ESPN "TBD" - die
              // Anstosszeit steht schon in der Mitte, das waere nur Rauschen.
              '  <span class="text-xs w-12 text-right ' + (laeuft ? "text-kicker font-semibold" : "text-mute") + '">' +
                escapeHtml(e.state === "pre" ? "" : e.statusDetail || "") + "</span>",
              '  <span class="text-mute text-xs w-3 text-center">' +
                (aufklappbar ? (offen ? "▾" : "▸") : "") + "</span>",
              "</" + (aufklappbar ? "button" : "div") + ">",
            ].join("\n");

            if (!offen) return zeile;

            var inhalt = detail
              ? '<div class="grid grid-cols-2 gap-3 px-3 py-2">' +
                "<div>" + renderTorliste(detail, home.teamId, false) + "</div>" +
                "<div>" + renderTorliste(detail, away.teamId, true) + "</div>" +
                "</div>"
              : '<div class="px-3 py-2 text-mute text-xs">Für dieses Spiel liegen noch keine Daten vor.</div>';

            return zeile + '<div class="border-t border-line/60 bg-wash-soft">' + inhalt + "</div>";
          })
          .join(""),
        "</div>",
      ].join("\n");
    }

    function render(bundle) {
      currentBundle = bundle;
      var status = bundle.matchdayInfo ? KT.matchdays.statusOf(bundle.matchdayInfo) : "unbekannt";
      var played = bundle.events.filter(function (e) {
        return e.state === "post";
      }).length;
      statusEl.textContent =
        "Spieltag " + bundle.matchday + " · " + status + " · " + played + "/" + bundle.events.length +
        " Partien beendet · Stand " + new Date().toLocaleTimeString("de-DE");

      if (bundle.backendError) {
        bodyEl.innerHTML = '<p class="text-kicker mb-4">' + escapeHtml(bundle.backendError) + "</p>" +
          renderMatchList(bundle.events);
        return;
      }

      var scores = KT.scoring.computeMatchdayScores(
        bundle.competitors, bundle.matchByPlayerId, bundle.manualByPlayerId, bundle.rules
      );
      currentScores = scores;
      standVergleichen(scores);

      // Kein erklaerender Satz mehr ueber der Tabelle: dass ein Spieltag noch
      // nicht begonnen hat, steht schon in der Statuszeile unter der
      // Ueberschrift ("Spieltag 3 · kommend"). Nur der leere Zustand bleibt -
      // der sagt, was zu tun ist, statt das Offensichtliche zu erklaeren.
      var intro = scores.length
        ? ""
        : '<p class="text-mute mb-4">Noch keine Konkurrenten angelegt - unter „Kader“ anlegen.</p>';

      bodyEl.innerHTML =
        renderTicker(bundle) +
        intro +
        '<div class="kt-panel">' +
        scores
          .map(function (c, i) {
            return renderCompetitorCard(c, i + 1, status === "beendet");
          })
          .join("") +
        "</div>" +
        renderMatchList(bundle.events);

      // Spielfelder befuellen (erst nachdem die Container im DOM sind)
      scores.forEach(function (c) {
        if (!c.hasLineup) return;
        var el = document.getElementById("pitch-" + c.competitorId);
        if (!el) return;
        var bySlot = {};
        c.slots.forEach(function (s) {
          bySlot[s.slot] = s;
        });
        KT.pitch.renderInto(el, c.formation, function (slotDef) {
          var entry = bySlot[slotDef.slot];
          if (!entry) {
            return '<div class="empty-slot pitch-slot-empty bg-white/5 border border-dashed border-white/25 ' +
              'flex items-center justify-center text-[9px] text-white/50 font-semibold uppercase">' +
              slotDef.label + "</div>";
          }
          return renderPlayerChip(entry, c.competitorId);
        });
      });
    }

    // ------------------------------------------------------------------
    // Laden + Polling
    // ------------------------------------------------------------------

    function load(matchday) {
      bodyEl.innerHTML = '<p class="text-mute">Lade Spieltag ' + matchday + "…</p>";
      gesamtStand = null;
      KT.config.setStoredMatchday(matchday);
      return KT.images
        .load()
        .then(function () {
          return KT.matchdayData.load(matchday);
        })
        .then(function (bundle) {
          render(bundle);
          schedulePolling(bundle);
        })
        .catch(function (err) {
          bodyEl.innerHTML = '<p class="text-kicker">Konnte Spieltag nicht laden: ' +
            escapeHtml(err.message || String(err)) + "</p>";
        });
    }

    /**
     * Nachladen lohnt sich, wenn gerade gespielt wird - aber auch schon kurz
     * vor Anpfiff. Sonst bliebe die Seite tot, wenn man sie vorher geoeffnet
     * hat, und wuerde den Anpfiff nie mitbekommen.
     */
    function shouldPoll(events) {
      var now = Date.now();
      return events.some(function (e) {
        if (e.state === "in") return true;
        if (e.state !== "pre") return false;
        var anpfiff = new Date(e.date).getTime();
        return now >= anpfiff - 15 * 60 * 1000 && now <= anpfiff + 4 * 60 * 60 * 1000;
      });
    }

    function schedulePolling(bundle) {
      clearInterval(pollTimer);
      if (!shouldPoll(bundle.events)) return;
      pollTimer = setInterval(function () {
        KT.matchdayData
          .load(bundle.matchday)
          .then(function (neu) {
            render(neu);
            // Neu bewerten: nach Abpfiff hoert das Nachladen von selbst auf,
            // beim Anpfiff des naechsten Spiels faengt es wieder an.
            schedulePolling(neu);
          })
          .catch(function () {});
      }, KT.config.LIVE_POLL_INTERVAL_MS);
    }

    function selectMatchday(n) {
      selectEl.value = String(n);
      auswahlLaden(String(n));
    }

    // ------------------------------------------------------------------
    // Gesamtwertung ueber alle bereits angepfiffenen Spieltage
    // ------------------------------------------------------------------

    /**
     * Laedt jeden begonnenen Spieltag und addiert die Punkte je Konkurrent.
     *
     * Die einzelnen Spieltage kommen fast alle aus dem Cache - beendete
     * Spiele liegen dauerhaft im localStorage. Trotzdem bewusst NACHEINANDER
     * geladen und nicht per Promise.all: Spieltage ohne Cache loesen je ein
     * Dutzend ESPN-Abrufe aus, und ESPN drosselt unter paralleler Last.
     * Dafuer sieht man beim Warten, wie weit es ist.
     */
    function gesamtLaden() {
      // Welche Spieltage zaehlen mit? NICHT ueber statusOf() bestimmt: der
      // Spieltagsindex wird 12 Stunden gecacht, sein `state` ist also schnell
      // veraltet ("kommend", obwohl laengst angepfiffen). currentMatchday()
      // rechnet stattdessen mit den Anstosszeiten und ist damit belastbar.
      var jetzt = Date.now();
      var bisNummer = KT.matchdays.currentMatchday(matchdayIndex || []);
      var begonnen = (matchdayIndex || []).filter(function (md) {
        return md.number <= bisNummer && new Date(md.from).getTime() <= jetzt;
      });
      if (!begonnen.length) {
        currentBundle = null;
        currentScores = [];
        gesamtStand = null;
        statusEl.textContent = "Gesamt · noch kein Spieltag angepfiffen";
        bodyEl.innerHTML = '<p class="text-mute">Noch kein Spieltag gespielt - es gibt nichts zu addieren.</p>';
        return Promise.resolve();
      }

      var summen = {};
      var kette = Promise.resolve();
      begonnen.forEach(function (md, i) {
        kette = kette.then(function () {
          bodyEl.innerHTML = '<p class="text-mute">Lade Spieltag ' + md.number +
            " … (" + (i + 1) + "/" + begonnen.length + ")</p>";
          return KT.matchdayData.load(md.number).then(function (bundle) {
            if (bundle.backendError) throw new Error(bundle.backendError);
            KT.scoring
              .computeMatchdayScores(
                bundle.competitors, bundle.matchByPlayerId, bundle.manualByPlayerId, bundle.rules
              )
              .forEach(function (c) {
                var s = summen[c.competitorId] || (summen[c.competitorId] = {
                  competitorId: c.competitorId,
                  competitorName: c.competitorName,
                  total: 0,
                  spieltage: [],
                });
                // Der Name kann sich geaendert haben - der zuletzt gesehene
                // (also der vom juengsten Spieltag) gewinnt.
                s.competitorName = c.competitorName;
                s.total += c.total;
                s.spieltage.push({ nummer: md.number, punkte: c.total, hasLineup: c.hasLineup });
              });
          });
        });
      });

      return kette.then(function () {
        var tabelle = Object.keys(summen).map(function (k) {
          return summen[k];
        });
        tabelle.sort(function (a, b) {
          return b.total - a.total;
        });
        renderGesamt(tabelle, begonnen);
      });
    }

    function renderGesamt(tabelle, begonnen) {
      currentBundle = null;
      currentScores = [];
      gesamtStand = { tabelle: tabelle, begonnen: begonnen };
      clearInterval(pollTimer);

      var von = begonnen[0].number;
      var bis = begonnen[begonnen.length - 1].number;
      statusEl.textContent =
        "Gesamt · Spieltag " + (von === bis ? von : von + " bis " + bis) +
        " · " + begonnen.length + (begonnen.length === 1 ? " Spieltag" : " Spieltage") +
        " · Stand " + new Date().toLocaleTimeString("de-DE");

      if (!tabelle.length) {
        bodyEl.innerHTML = '<p class="text-mute">Noch keine Konkurrenten angelegt - unter „Kader“ anlegen.</p>';
        return;
      }

      bodyEl.innerHTML =
        '<div class="kt-panel">' +
        tabelle
          .map(function (c, i) {
            return renderGesamtCard(c, i + 1);
          })
          .join("") +
        "</div>";
    }

    function renderGesamtCard(c, rank) {
      var isOpen = expanded.has(c.competitorId);
      var ohneAufstellung = c.spieltage.filter(function (s) {
        return !s.hasLineup;
      }).length;
      var schnitt = c.spieltage.length ? Math.round(c.total / c.spieltage.length) : 0;

      var header = [
        '<button data-toggle="' + c.competitorId + '"',
          ' class="w-full flex items-center gap-3 px-3 py-2.5 text-left kt-hover kt-focus transition-colors">',
        '  <span class="w-5 text-right font-semibold text-mute tabular-nums">' + rank + "</span>",
        '  <span class="flex-1 min-w-0">',
        '    <span class="block font-semibold text-ink truncate leading-tight">' +
          escapeHtml(c.competitorName) + "</span>",
        '    <span class="block text-[11px] ' + (ohneAufstellung ? "text-warn" : "text-mute") + ' truncate">' +
          escapeHtml("⌀ " + schnitt + " je Spieltag" +
            (ohneAufstellung ? " · " + ohneAufstellung + "× keine Aufstellung" : "")) + "</span>",
        "  </span>",
        '  <span class="font-display text-2xl font-bold tabular-nums leading-none w-14 text-right ' +
          (c.total === 0 ? "text-mute" : "text-kicker") + '">' + c.total + "</span>",
        '  <span class="text-mute text-sm w-3 text-center">' + (isOpen ? "▾" : "▸") + "</span>",
        "</button>",
      ].join("\n");

      if (!isOpen) {
        return '<div class="bg-panel border-b border-line last:border-b-0">' + header + "</div>";
      }

      // Aufgeklappt: woher die Summe kommt. Ein Klick auf eine Zeile springt
      // in genau diesen Spieltag - von dort geht es zur Aufstellung.
      var zeilen = c.spieltage
        .map(function (s) {
          return [
            '<button data-goto-md="' + s.nummer + '"',
              ' class="w-full flex items-center gap-3 px-3 py-1.5 text-left kt-hover kt-focus text-sm">',
            '  <span class="flex-1 text-mute">Spieltag ' + s.nummer +
              (s.hasLineup ? "" : ' <span class="text-warn">· keine Aufstellung</span>') + "</span>",
            '  <span class="font-semibold tabular-nums w-14 text-right ' +
              (s.punkte === 0 ? "text-mute" : "text-ink") + '">' + s.punkte + "</span>",
            '  <span class="w-3"></span>',
            "</button>",
          ].join("\n");
        })
        .join("");

      return [
        '<div class="bg-panel border-b border-line last:border-b-0">',
        header,
        '<div class="border-t border-line bg-wash py-1">' + zeilen + "</div>",
        "</div>",
      ].join("\n");
    }

    /** Faehrt die Ansicht auf den gewaehlten Eintrag - Zahl oder "gesamt". */
    function auswahlLaden(wert) {
      var istGesamt = wert === GESAMT;
      KT.config.safeSet(GESAMT_KEY, istGesamt ? "1" : "");
      // Vor- und Zurueck-Knopf ergeben in der Gesamtansicht keinen Sinn.
      prevBtn.disabled = istGesamt;
      nextBtn.disabled = istGesamt;

      if (!istGesamt) return load(Number(wert));

      clearInterval(pollTimer);
      bodyEl.innerHTML = '<p class="text-mute">Lade Gesamtwertung…</p>';
      return gesamtLaden().catch(function (err) {
        bodyEl.innerHTML = '<p class="text-kicker">Konnte die Gesamtwertung nicht bilden: ' +
          escapeHtml(err.message || String(err)) + "</p>";
      });
    }

    // ------------------------------------------------------------------
    // Punkte-Aufschluesselung eines Spielers
    // ------------------------------------------------------------------

    function findSlotEntry(competitorId, slot) {
      var competitor = currentScores.filter(function (c) {
        return String(c.competitorId) === String(competitorId);
      })[0];
      if (!competitor) return null;
      return competitor.slots.filter(function (s) {
        return s.slot === slot;
      })[0] || null;
    }

    function closeDetail() {
      var overlay = document.getElementById("player-detail");
      if (overlay) overlay.remove();
    }

    /** Wappen des Vereins, bei dem dieser Spieler unter Vertrag steht. */
    function logoForTeam(teamId) {
      if (!teamId || !currentBundle) return null;
      var events = currentBundle.events || [];
      for (var i = 0; i < events.length; i++) {
        var cs = events[i].competitors || [];
        for (var j = 0; j < cs.length; j++) {
          if (cs[j].teamId === teamId) return cs[j].logo || null;
        }
      }
      return null;
    }

    function openDetail(entry, competitorName) {
      closeDetail();
      var match = entry.match;
      var posLabel = KT.scoring.POSITION_LABEL[entry.position] || entry.position || "–";

      var einsatz;
      // Wie auf dem Spielfeld: ohne ESPN-Daten sagt erst der Anpfiff, ob der
      // Spieler wirklich nicht nominiert war oder ob noch nichts feststeht.
      // Hier ist Platz fuer ganze Saetze, deshalb ausfuehrlicher als die
      // Unterschrift auf der Kachel ("ausstehend" / "nicht dabei").
      var detailFx = fixtureForPlayer(entry);
      if (!match) {
        einsatz = !detailFx
          ? "Verein spielt an diesem Spieltag nicht"
          : detailFx.event && detailFx.event.state === "pre"
          ? "Spiel noch nicht angepfiffen"
          : "Nicht im Spieltagskader";
      } else if (match.starter) einsatz = "Startelf" + (match.subbedOut ? " (ausgewechselt)" : "");
      else if (match.subbedIn) einsatz = "Eingewechselt";
      else einsatz = "Auf der Bank geblieben";

      var gegner = match && match.opponentName ? " · gegen " + match.opponentName : "";

      var rows = entry.parts.length
        ? entry.parts
            .map(function (p) {
              return [
                '<div class="flex items-center justify-between gap-3 py-2.5 border-b border-line">',
                '  <span class="text-ink">' + escapeHtml(p.label) +
                  (p.manual
                    ? ' <span class="text-[10px] text-mute uppercase tracking-wide" title="von Hand eingetragen">manuell</span>'
                    : "") + "</span>",
                '  <span class="text-lg font-bold tabular-nums shrink-0 ' +
                  (p.points >= 0 ? "text-pos" : "text-kicker") + '">' +
                  (p.points > 0 ? "+" : "") + p.points + "</span>",
                "</div>",
              ].join("");
            })
            .join("")
        : '<div class="py-4 text-mute">Keine Punkte an diesem Spieltag.</div>';

      var hinweis = "";
      if (match && match.played && (entry.grade === null || entry.grade === undefined) && !entry.noGrade) {
        hinweis =
          '<p class="text-xs text-warn bg-warn-soft border border-warn-line px-3 py-2 mt-4">' +
          "Für diesen Spieler ist noch keine kicker-Note eingetragen – unter „Noten“ nachtragen." +
          "</p>";
      } else if (match && !match.played && entry.grade !== null && entry.grade !== undefined) {
        hinweis =
          '<p class="text-xs text-mute-dark bg-panel-alt px-3 py-2 mt-4">' +
          "Ohne Einsatz zählt die eingetragene Note nicht." +
          "</p>";
      }

      // Gesamtpunkte in derselben Logik wie auf dem Spielfeld einfaerben -
      // gruen fuer positiv, rot fuer negativ. Vorher war die Summe immer rot,
      // was bei einem starken Spieler wie eine Warnung aussah.
      var gesamtFarbe = entry.points > 0
        ? "text-pos"
        : entry.points < 0
        ? "text-kicker"
        : "text-mute";
      var crest = KT.pitch.crestHtml(logoForTeam(entry.teamId), "w-4 h-4");

      var overlay = document.createElement("div");
      overlay.id = "player-detail";
      overlay.className =
        "fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4";
      overlay.innerHTML = [
        '<div class="bg-panel border border-line w-full sm:max-w-md shadow-[0_6px_24px_rgba(0,0,0,0.6)] overflow-hidden" data-panel>',
        // Kopf: grosses Portraitfoto wie auf dem Spielfeld, daneben der Name.
        '  <div class="flex items-start gap-4 p-5 border-b border-line">',
        "    " + KT.images.avatarHtml(entry.playerId, entry.playerName,
          "w-[84px] aspect-[4/5] object-cover object-top rounded-sm", false),
        '    <div class="flex-1 min-w-0 pt-0.5">',
        '      <div class="font-display text-2xl font-bold text-ink leading-tight break-words">' +
          escapeHtml(entry.playerName) + "</div>",
        '      <div class="flex items-center gap-1.5 mt-1.5 text-sm text-mute-dark min-w-0">' +
          crest + '<span class="truncate">' +
          escapeHtml(KT.vereine.name(entry.teamId, entry.teamName)) + "</span></div>",
        '      <div class="kt-eyebrow mt-2">' + escapeHtml(posLabel) + "</div>",
        '      <div class="text-sm text-mute mt-0.5 truncate">' + escapeHtml(competitorName) + "</div>",
        "    </div>",
        '    <button data-close aria-label="Schließen"',
        '      class="text-mute hover:text-kicker text-3xl leading-none px-1 -mt-1 shrink-0">×</button>',
        "  </div>",
        '  <div class="px-5 py-2.5 text-sm text-mute-dark bg-panel-alt border-b border-line">' +
          escapeHtml(einsatz + gegner) + "</div>",
        '  <div class="p-5">',
        rows,
        '    <div class="flex items-center justify-between gap-3 pt-4">',
        '      <span class="kt-eyebrow">Gesamt</span>',
        '      <span class="font-display text-5xl font-bold tabular-nums leading-none ' +
          gesamtFarbe + '">' + entry.points + "</span>",
        "    </div>",
        hinweis,
        "  </div>",
        "</div>",
      ].join("\n");

      overlay.addEventListener("click", function (e) {
        // Klick auf das X schliesst; sonst nur bei Klick auf den Hintergrund
        // selbst (e.target === overlay) - closest("[data-panel]") ist
        // unzuverlaessig, sobald ein Kind-Element sich beim Klick selbst neu
        // rendert und dabei aus dem Baum faellt.
        if (e.target.closest("[data-close]")) {
          closeDetail();
          return;
        }
        if (e.target === overlay) closeDetail();
      });
      document.body.appendChild(overlay);
    }

    function onKeydown(e) {
      if (e.key === "Escape") closeDetail();
    }
    document.addEventListener("keydown", onKeydown);

    bodyEl.addEventListener("click", function (e) {
      // Aus der Gesamtwertung in einen einzelnen Spieltag springen.
      var gotoBtn = e.target.closest("[data-goto-md]");
      if (gotoBtn) {
        selectMatchday(Number(gotoBtn.dataset.gotoMd));
        return;
      }

      // Kachel in der Live-Zeile: dieselbe Aufschluesselung wie ein Klick auf
      // den Spieler im Spielfeld.
      var liveBtn = e.target.closest("[data-live-slot]");
      if (liveBtn) {
        var teile = liveBtn.dataset.liveSlot.split(":");
        var liveEntry = findSlotEntry(teile[0], teile[1]);
        var liveComp = currentScores.filter(function (c) {
          return String(c.competitorId) === String(teile[0]);
        })[0];
        if (liveEntry) openDetail(liveEntry, liveComp ? liveComp.competitorName : "");
        return;
      }

      // Begegnung auf- oder zuklappen.
      var spielBtn = e.target.closest("[data-spiel]");
      if (spielBtn) {
        var eid = spielBtn.dataset.spiel;
        if (offeneSpiele.has(eid)) offeneSpiele.delete(eid);
        else offeneSpiele.add(eid);
        if (currentBundle) render(currentBundle);
        return;
      }

      var editBtn = e.target.closest("[data-edit-lineup]");
      if (editBtn) {
        var editId = editBtn.dataset.editLineup;
        var editCompetitor = currentScores.filter(function (c) {
          return String(c.competitorId) === String(editId);
        })[0];
        KT.lineupEditor.open({
          competitorId: editId,
          competitorName: editCompetitor ? editCompetitor.competitorName : "",
          matchday: currentBundle.matchday,
          onSaved: function () {
            if (currentBundle) load(currentBundle.matchday);
          },
        });
        return;
      }

      var slotEl = e.target.closest("#md-body .pitch > [data-slot]");
      if (slotEl) {
        var pitchEl = slotEl.closest(".pitch");
        var competitorId = pitchEl.id.replace("pitch-", "");
        var entry = findSlotEntry(competitorId, slotEl.dataset.slot);
        var competitor = currentScores.filter(function (c) {
          return String(c.competitorId) === String(competitorId);
        })[0];
        if (entry) openDetail(entry, competitor ? competitor.competitorName : "");
        return;
      }

      var btn = e.target.closest("[data-toggle]");
      if (!btn || btn.disabled) return;
      var id = Number(btn.dataset.toggle);
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      if (currentBundle) render(currentBundle);
      // In der Gesamtwertung gibt es kein Bundle - dort haengt die Tabelle
      // am zuletzt gerechneten Stand und wird direkt neu gezeichnet, statt
      // alle Spieltage nur fuers Auf- und Zuklappen erneut zu laden.
      else if (gesamtStand) renderGesamt(gesamtStand.tabelle, gesamtStand.begonnen);
    });

    // Die Konkurrenten-Zeile ist ein div mit role="button" (weil anklickbare
    // Kacheln darin stehen). Ein echter Knopf reagierte von sich aus auf
    // Enter und Leertaste - das muss hier von Hand nachgezogen werden.
    bodyEl.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      var ziel = e.target.closest('[role="button"][data-toggle]');
      // Nur wenn die Zeile SELBST den Fokus hat: sonst wuerde die Leertaste
      // auf einer Spielerkachel zusaetzlich die Zeile auf- und zuklappen.
      if (!ziel || document.activeElement !== ziel) return;
      e.preventDefault(); // Leertaste wuerde sonst die Seite scrollen
      ziel.click();
    });

    selectEl.addEventListener("change", function () {
      auswahlLaden(selectEl.value);
    });
    prevBtn.addEventListener("click", function () {
      var n = Number(selectEl.value);
      if (n > 1) selectMatchday(n - 1);
    });
    nextBtn.addEventListener("click", function () {
      // -1, weil "Gesamt" als erster Eintrag mit in der Liste steht.
      var n = Number(selectEl.value);
      if (n < selectEl.options.length - 1) selectMatchday(n + 1);
    });
    refreshBtn.addEventListener("click", function () {
      auswahlLaden(selectEl.value);
    });

    var loadPromise = KT.matchdays
      .getIndex()
      .then(function (index) {
        matchdayIndex = index;
        selectEl.innerHTML =
          '<option value="' + GESAMT + '">Gesamt</option>' +
          index
            .map(function (md) {
              return '<option value="' + md.number + '">Spieltag ' + md.number + "</option>";
            })
            .join("");
        // Zuletzt gewaehlte Ansicht wiederherstellen - "Gesamt" wird unter
        // einem eigenen Schluessel gemerkt, weil getStoredMatchday() nur
        // Zahlen kennt (und kennen soll: die Notenansicht braucht dort
        // weiterhin einen einzelnen Spieltag).
        var start;
        if (KT.config.safeGet(GESAMT_KEY) === "1") {
          start = GESAMT;
        } else {
          var stored = KT.config.getStoredMatchday();
          start = String(stored && stored <= index.length ? stored : KT.matchdays.currentMatchday(index));
        }
        selectEl.value = start;
        return auswahlLaden(start);
      })
      .catch(function (err) {
        statusEl.textContent = "Spielplan nicht ladbar";
        bodyEl.innerHTML = '<p class="text-kicker">Konnte den Spielplan nicht von ESPN laden: ' +
          escapeHtml(err.message || String(err)) + "</p>";
      });

    return loadPromise.then(function () {
      return function cleanup() {
        clearInterval(pollTimer);
        document.removeEventListener("keydown", onKeydown);
        closeDetail(); // haengt an document.body, wuerde sonst stehen bleiben
      };
    });
  };
})(window.KT);
