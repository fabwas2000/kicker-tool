window.KT = window.KT || {};
window.KT.views = window.KT.views || {};

(function (KT) {
  "use strict";

  KT.views.grades = function (container) {
    var escapeHtml = KT.ui.escapeHtml;

    container.innerHTML = [
      '<section class="max-w-3xl mx-auto">',
      '  <div class="flex flex-wrap items-end justify-between gap-3 mb-4 pb-3 border-b-2 border-ink">',
      "    <div>",
      '      <h1 class="font-display text-3xl font-bold uppercase tracking-tight leading-none">Noten</h1>',
      '      <p class="text-mute text-sm mt-1" id="g-status">Lade Spielplan…</p>',
      "    </div>",
      '    <div class="flex items-end gap-2">',
      "      <div>",
      '        <label class="kt-eyebrow block mb-1">Spieltag</label>',
      '        <select id="g-md" class="kt-input font-semibold py-[0.42rem]"></select>',
      "      </div>",
      "    </div>",
      "  </div>",
      '  <div id="g-body"><p class="text-mute">Lade…</p></div>',
      "</section>",
    ].join("\n");

    var mdSelect = container.querySelector("#g-md");
    var statusEl = container.querySelector("#g-status");
    var bodyEl = container.querySelector("#g-body");

    var bundle = null;
    var openKey = null; // "<eventId>:<teamId>"
    var openPlayersById = {}; // Spieler der gerade geoeffneten Mannschaft

    // Sentinel, den parseGrade() fuer ein bewusst eingetragenes "-"
    // zurueckgibt - unterscheidet sich von null (Feld einfach leer/unberuehrt).
    var NO_GRADE = "no_grade";

    function gradeInputHtml(playerId, grade, noGrade) {
      var value = noGrade
        ? "-"
        : grade === null || grade === undefined
        ? ""
        : Number(grade).toFixed(1).replace(".", ",");
      return [
        '<input type="text" inputmode="decimal" data-grade-for="' + playerId + '"',
        '  value="' + value + '" placeholder="–" maxlength="3"',
        '  title="Note 1,0-6,0, oder „-“: gespielt, aber keine Note bekommen"',
        '  class="kt-input w-14 text-center px-1 py-1 text-sm font-semibold ' +
          (noGrade ? "is-nograde" : "") + '" />',
      ].join(" ");
    }

    /** Manuelle Eingaben zu einem Spieler (oder leere Vorgabe). */
    function manualFor(playerId) {
      return bundle.manualByPlayerId.get(playerId) || {
        grade: null, no_grade: false, goals: null, assists: null, player_of_match: false,
      };
    }

    /**
     * ESPN nennt im Spielbericht feine Positionen ("CD-L", "CF-R"). Fuer die
     * Torpunkte braucht es die grobe Einteilung. Fuer Kaderspieler gilt die
     * kicker-Position aus der Datenbank, sonst diese Naeherung.
     */
    function coarsePosition(abbr) {
      var a = String(abbr || "").toUpperCase();
      if (a === "G" || a.indexOf("GK") === 0) return "G";
      if (/^(CD|RB|LB|RWB|LWB|D)/.test(a)) return "D";
      if (/^(CF|ST|F|LW|RW)/.test(a)) return "F";
      return "M";
    }

    function playerForScoring(p) {
      var squadPlayer = bundle.squadPlayerById && bundle.squadPlayerById[p.playerId];
      if (squadPlayer) return squadPlayer;
      // Ausserhalb der eigenen Kader: kicker fragen. ESPN gibt Eingewechselten
      // im Spielbericht nur "SUB", damit waere jeder Joker ein Mittelfeldspieler.
      var vonKicker = KT.positions.forName(p.playerName);
      return {
        position: vonKicker || coarsePosition(p.positionAbbr),
        name: p.playerName,
      };
    }

    /** Gesamtpunkte des Spielers - auch ohne Note (Einsatz zaehlt ja schon). */
    function totalPointsFor(p, manual) {
      return KT.scoring.playerPoints(playerForScoring(p), p, manual, bundle.rules).points;
    }

    function pointsClass(points) {
      if (points > 0) return "text-pos";
      if (points < 0) return "text-kicker";
      return "text-mute";
    }

    function countInputHtml(playerId, kind, manualValue, espnValue, icon, title) {
      var value = manualValue === null || manualValue === undefined ? espnValue || 0 : manualValue;
      var corrected = manualValue !== null && manualValue !== undefined && manualValue !== (espnValue || 0);
      return [
        '<span class="inline-flex items-center gap-0.5" title="' + title + '">',
        '  <span class="text-xs">' + icon + "</span>",
        '  <input type="number" min="0" max="20" data-count-for="' + playerId + '" data-kind="' + kind + '"',
        '    data-espn="' + (espnValue || 0) + '" value="' + value + '"',
        '    class="kt-input w-11 text-center px-1 py-0.5 text-xs ' +
          (corrected ? "is-override" : "") + '" />',
        "</span>",
      ].join(" ");
    }

    function playerRow(p, isRelevant) {
      var manual = manualFor(p.playerId);
      var grade = manual.grade === undefined ? null : manual.grade;
      // Immer die Gesamtpunkte zeigen, nicht nur die aus der Note - ab
      // Anpfiff bzw. Einwechslung stehen ja schon Einsatzpunkte zu Buche.
      var points = totalPointsFor(p, manual);
      var status = [];
      if (p.redCards) status.push("🟥");
      if (p.subbedIn) status.push('<span class="text-pos" title="eingewechselt">↑</span>');
      if (p.subbedOut) status.push('<span class="text-mute" title="ausgewechselt">↓</span>');

      return [
        '<li class="px-3 py-2 text-sm ' +
          (isRelevant ? "bg-kicker-soft" : "bg-panel") + ' border-b border-line last:border-0">',
        // Zeile 1: Spieler, Note, Notenpunkte
        '  <div class="flex items-center gap-2">',
        isRelevant
          ? '    <span class="text-kicker" title="steht in einer Aufstellung">★</span>'
          : '    <span class="w-3"></span>',
        "    " + KT.images.avatarHtml(p.playerId, p.playerName, "w-7 h-7"),
        '    <span class="w-9 text-[10px] font-semibold uppercase tracking-wide text-mute">' +
          escapeHtml(p.starter ? "Start" : "Ein") + "</span>",
        '    <span class="flex-1 font-medium text-ink truncate">' + escapeHtml(p.playerName) + "</span>",
        '    <span class="text-xs">' + status.join(" ") + "</span>",
        "    " + gradeInputHtml(p.playerId, grade, manual.no_grade),
        '    <span class="w-9 text-right text-sm font-bold tabular-nums ' + pointsClass(points) +
          '" data-points-for="' + p.playerId + '">' + points + "</span>",
        "  </div>",
        // Zeile 2: Korrekturen
        '  <div class="flex items-center gap-3 mt-1 pl-9 text-mute">',
        "    " + countInputHtml(p.playerId, "goals", manual.goals, p.goals, "⚽",
          "Tore – ESPN zählt " + (p.goals || 0)),
        "    " + countInputHtml(p.playerId, "assists", manual.assists, p.assists, "🅰️",
          "Vorlagen – ESPN zählt " + (p.assists || 0)),
        '    <label class="inline-flex items-center gap-1 text-xs cursor-pointer select-none">',
        '      <input type="checkbox" data-potm-for="' + p.playerId + '"' +
          (manual.player_of_match ? " checked" : "") + ' class="accent-kicker" />',
        '      <span>★ Spieler des Spiels</span>',
        "    </label>",
        "  </div>",
        "</li>",
      ].join("\n");
    }

    function teamPanel(detail, teamId) {
      var players = Object.keys(detail.players)
        .map(function (id) {
          return detail.players[id];
        })
        .filter(function (p) {
          return p.teamId === teamId && p.played;
        });

      openPlayersById = {};
      players.forEach(function (p) {
        openPlayersById[p.playerId] = p;
      });

      // Relevante (aufgestellte) Spieler nach oben, Rest darunter.
      var relevant = players.filter(function (p) {
        return bundle.relevantPlayerIds.has(p.playerId);
      });
      var others = players.filter(function (p) {
        return !bundle.relevantPlayerIds.has(p.playerId);
      });
      // Position vor Name - fuer die Position gilt kicker (aus dem Kader),
      // sonst die Naeherung aus der ESPN-Spielposition.
      function nachPosition(a, b) {
        return KT.ui.comparePlayers(
          { position: playerForScoring(a).position, name: a.playerName },
          { position: playerForScoring(b).position, name: b.playerName }
        );
      }
      relevant.sort(nachPosition);
      others.sort(nachPosition);

      if (players.length === 0) {
        return '<div class="px-4 py-3 text-sm text-mute">Für dieses Spiel liegen noch keine ' +
          "Einsatzdaten vor.</div>";
      }

      return [
        '<ul class="border-t border-line">',
        relevant.map(function (p) {
          return playerRow(p, true);
        }).join(""),
        relevant.length && others.length
          ? '<li class="kt-eyebrow px-3 py-1 bg-wash border-y border-line">übrige Spieler</li>'
          : "",
        others.map(function (p) {
          return playerRow(p, false);
        }).join(""),
        "</ul>",
        '<div class="px-3 py-2 bg-wash border-t border-line flex flex-wrap items-center gap-2">',
        '  <button data-save-team="' + teamId + '" data-save-event="' + detail.eventId + '"',
        '    class="kt-btn kt-btn-primary">',
        "    Noten speichern",
        "  </button>",
        '  <span class="text-xs text-mute">Note 1,0 bis 6,0 · „-“ = gespielt, aber keine Note · leer lassen löscht die Note</span>',
        "</div>",
      ].join("\n");
    }

    function matchCard(detail) {
      var home = detail.competitors[0] || {};
      var away = detail.competitors[1] || {};
      var isPre = detail.state === "pre";
      var score = isPre ? "noch nicht gespielt" : (home.score || "0") + " : " + (away.score || "0");

      function teamButton(team, heim) {
        var key = detail.eventId + ":" + team.teamId;
        var isOpen = openKey === key;
        var count = Object.keys(detail.players).filter(function (id) {
          return detail.players[id].teamId === team.teamId && detail.players[id].played;
        }).length;
        var relevantCount = Object.keys(detail.players).filter(function (id) {
          var p = detail.players[id];
          return p.teamId === team.teamId && p.played && bundle.relevantPlayerIds.has(id);
        }).length;
        // Wie viele der eingesetzten Spieler haben schon eine Note ODER
        // bewusst "-" bekommen - beides zählt als "eingetragen".
        function hatNote(id) {
          var m = bundle.manualByPlayerId.get(id);
          return Boolean(m && ((m.grade !== null && m.grade !== undefined) || m.no_grade));
        }
        var gradedCount = Object.keys(detail.players).filter(function (id) {
          var p = detail.players[id];
          return p.teamId === team.teamId && p.played && hatNote(id);
        }).length;
        // Dieselbe Zählung, aber nur für Spieler, die bei einem Konkurrenten
        // aufgestellt sind - das ist es, worauf es eigentlich ankommt.
        var relevantGradedCount = Object.keys(detail.players).filter(function (id) {
          var p = detail.players[id];
          return p.teamId === team.teamId && p.played && bundle.relevantPlayerIds.has(id) && hatNote(id);
        }).length;

        function badgeFarbe(erledigt, gesamt) {
          if (gesamt === 0) return "";
          if (erledigt >= gesamt) return "bg-pos-soft text-pos";
          if (erledigt === 0) return "bg-wash text-mute";
          return "bg-warn-soft text-warn";
        }

        // Eine Zeile statt drei: Wappen, Name und Badges nebeneinander. Die
        // Bruch-Badges tragen Zaehler UND Nenner ("6/16") - die vorherige
        // separate "15 eingesetzt · 3 ★"-Zeile war damit doppelte Information
        // und ist ersatzlos weggefallen, nicht nur verschoben.
        //
        // Die Heimseite ist gespiegelt, damit die Zeile um den Spielstand
        // herum symmetrisch liegt: Zahlen aussen, Wappen und Name innen.
        //   [Noten] ... [Name] [Wappen] | 4:1 | [Wappen] [Name] ... [Noten]
        // Die freie Flaeche dazwischen macht die automatische Aussenkante des
        // Badge-Blocks (mr-auto/ml-auto), nicht ein fester Abstand - so
        // bleiben Wappen und Spielstand beieinander, egal wie lang der
        // Vereinsname ist.
        var wappen = KT.pitch.crestHtml(team.logo, "w-5 h-5");
        var namensfeld =
          '<span class="font-semibold text-ink text-sm truncate min-w-0">' +
          escapeHtml(KT.vereine.name(team.teamId, team.teamName) || "?") + "</span>";
        var noten = isPre
          ? ""
          : '<span class="flex items-center gap-1 shrink-0 ' + (heim ? "mr-auto" : "ml-auto") + '">' +
            '<span class="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 whitespace-nowrap ' +
            badgeFarbe(gradedCount, count) + '" title="' + count + ' eingesetzt, ' + gradedCount + ' benotet">' +
            gradedCount + "/" + count + "</span>" +
            (relevantCount
              ? '<span class="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 whitespace-nowrap ' +
                badgeFarbe(relevantGradedCount, relevantCount) +
                '" title="Von den bei einem Konkurrenten aufgestellten Spielern benotet">' +
                relevantGradedCount + "/" + relevantCount + " ★</span>"
              : "") +
            "</span>";

        return [
          '<button data-open="' + key + '" ' + (isPre ? "disabled" : "") +
            ' class="kt-focus flex-1 min-w-0 flex items-center gap-1.5 px-2 py-2 transition ' +
            // Der Balken markiert die geoeffnete Mannschaft - auf beiden
            // Seiten zum Spielstand hin, sonst steht er mal innen, mal aussen.
            (heim ? "text-right justify-end border-r-[3px] " : "text-left justify-start border-l-[3px] ") +
            (isOpen ? "border-kicker bg-kicker-soft" : "border-transparent kt-hover") +
            ' disabled:opacity-40 disabled:hover:bg-transparent">',
          "  " + (heim ? noten + namensfeld + wappen : wappen + namensfeld + noten),
          "</button>",
        ].join("\n");
      }

      var openPanel = "";
      if (openKey && openKey.indexOf(detail.eventId + ":") === 0) {
        openPanel = teamPanel(detail, openKey.split(":")[1]);
      }

      return [
        '<div class="kt-row bg-panel">',
        '  <div class="flex items-center gap-2 px-1 py-1.5">',
        teamButton(home, true),
        '    <span class="font-display text-lg font-bold text-ink whitespace-nowrap px-1 tabular-nums">' + escapeHtml(score) + "</span>",
        teamButton(away, false),
        "  </div>",
        openPanel,
        "</div>",
      ].join("\n");
    }

    function render() {
      var status = bundle.matchdayInfo ? KT.matchdays.statusOf(bundle.matchdayInfo) : "";
      var withGrades = 0;
      var corrections = 0;
      bundle.manualByPlayerId.forEach(function (m) {
        // "-" (bewusst keine Note) zählt genauso als eingetragen wie eine
        // echte Zahl - nur ein leeres Feld ist "noch offen".
        if ((m.grade !== null && m.grade !== undefined) || m.no_grade) withGrades++;
        if (m.goals !== null || m.assists !== null || m.player_of_match) corrections++;
      });

      // Von den tatsächlich bei einem Konkurrenten aufgestellten Spielern:
      // wie viele haben schon eine Note? Das ist die eigentlich relevante
      // Zahl, nicht "44 Noten insgesamt" (die zählt auch nie aufgestellte mit).
      //
      // Gezählt werden nur die, die auch WIRKLICH gespielt haben - ein
      // aufgestellter Spieler, der gar nicht im Kader seines Vereins stand
      // oder nur auf der Bank saß, kann ohnehin nie eine Note bekommen und
      // dürfte die Quote sonst künstlich unter 100% halten. Dieselbe
      // Einschränkung nutzen auch die Badges je Mannschaft weiter unten.
      var relevantTotal = 0;
      var relevantGraded = 0;
      bundle.relevantPlayerIds.forEach(function (id) {
        var match = bundle.matchByPlayerId.get(id);
        if (!match || !match.played) return;
        relevantTotal++;
        var m = bundle.manualByPlayerId.get(id);
        if (m && ((m.grade !== null && m.grade !== undefined) || m.no_grade)) relevantGraded++;
      });

      statusEl.textContent =
        "Spieltag " + bundle.matchday + " · " + status + " · " + withGrades + " Noten" +
        (corrections ? " · " + corrections + " Korrekturen" : "") +
        (relevantTotal ? " · " + relevantGraded + "/" + relevantTotal + " aufgestellte Spieler benotet" : "");

      if (bundle.backendError) {
        bodyEl.innerHTML = '<p class="text-kicker">' + escapeHtml(bundle.backendError) + "</p>";
        return;
      }

      bodyEl.innerHTML = [
        '<p class="text-mute text-sm mb-3">Mannschaft anklicken, um die eingesetzten Spieler zu ',
        'öffnen. <span class="text-kicker">★</span> = steht bei einem Konkurrenten in der Aufstellung.</p>',
        '<div class="kt-panel">',
        bundle.details.map(matchCard).join(""),
        "</div>",
      ].join("\n");
    }

    /**
     * "" -> null (Feld unberührt, noch nichts eingetragen)
     * "-"/"–"/"—" -> NO_GRADE (bewusst: gespielt, aber keine Note bekommen)
     * "1,0".."6,0" -> Zahl
     * alles andere -> undefined (ungültig)
     */
    function parseGrade(raw) {
      var text = String(raw || "").trim();
      if (text === "") return null;
      if (text === "-" || text === "–" || text === "—") return NO_GRADE;
      var value = Number(text.replace(",", "."));
      if (!isFinite(value) || value < 1 || value > 6) return undefined; // ungueltig
      return value;
    }

    bodyEl.addEventListener("click", function (e) {
      var openTarget = e.target.closest("[data-open]");
      if (openTarget) {
        var key = openTarget.dataset.open;
        openKey = openKey === key ? null : key;
        render();
        return;
      }

      var saveBtn = e.target.closest("[data-save-team]");
      if (saveBtn) {
        var inputs = bodyEl.querySelectorAll("[data-grade-for]");
        var payload = [];
        var invalid = 0;

        Array.prototype.forEach.call(inputs, function (input) {
          var playerId = input.dataset.gradeFor;
          // formValues() liefert genau das, was auch die Punktevorschau
          // rechnet - Tor-/Vorlagenzahl nur, wenn sie von ESPN abweicht.
          var values = formValues(playerId);
          if (values.grade === undefined) {
            invalid++;
            input.classList.add("is-invalid");
            return;
          }
          input.classList.remove("is-invalid");
          payload.push({
            espn_player_id: playerId,
            grade: values.grade,
            no_grade: values.noGrade,
            goals: values.goals,
            assists: values.assists,
            player_of_match: values.player_of_match,
          });
        });

        if (invalid) {
          KT.ui.showError(invalid + " Note(n) ungültig - erlaubt ist 1,0 bis 6,0.");
          return;
        }

        KT.api
          .saveGrades(bundle.matchday, payload)
          .then(function (saved) {
            bundle.manualByPlayerId = new Map();
            saved.forEach(function (g) {
              bundle.manualByPlayerId.set(g.espn_player_id, g);
            });
            KT.ui.showInfo("Eingaben gespeichert.");
            render();
          })
          .catch(function (err) {
            KT.ui.showError("Konnte nicht speichern: " + KT.ui.backendErrorText(err));
          });
      }
    });

    // Punktevorschau live beim Tippen
    /** Liest den aktuellen Formularstand eines Spielers aus. */
    function formValues(playerId) {
      function count(kind) {
        var field = bodyEl.querySelector(
          '[data-count-for="' + playerId + '"][data-kind="' + kind + '"]'
        );
        if (!field) return null;
        var value = field.value.trim();
        if (value === "") return null;
        var n = Number(value);
        if (!isFinite(n) || n < 0) return null;
        return n === (Number(field.dataset.espn) || 0) ? null : n;
      }
      var gradeField = bodyEl.querySelector('[data-grade-for="' + playerId + '"]');
      var potm = bodyEl.querySelector('[data-potm-for="' + playerId + '"]');
      var parsed = gradeField ? parseGrade(gradeField.value) : null;
      return {
        // undefined bleibt undefined (ungültig), NO_GRADE wird zu null+noGrade,
        // alles andere ist entweder null (unberührt) oder eine Zahl.
        grade: parsed === NO_GRADE ? null : parsed,
        noGrade: parsed === NO_GRADE,
        goals: count("goals"),
        assists: count("assists"),
        player_of_match: Boolean(potm && potm.checked),
      };
    }

    /** Punkteanzeige einer Zeile neu berechnen, ohne alles neu zu zeichnen. */
    function refreshPoints(playerId) {
      var out = bodyEl.querySelector('[data-points-for="' + playerId + '"]');
      var player = openPlayersById[playerId];
      if (!out || !player) return;

      var values = formValues(playerId);
      var gradeField = bodyEl.querySelector('[data-grade-for="' + playerId + '"]');
      if (values.grade === undefined) {
        // ungueltige Note - Punkte lassen sich nicht sinnvoll berechnen
        out.textContent = "?";
        out.className = "w-9 text-right text-sm font-bold tabular-nums text-kicker";
        if (gradeField) gradeField.classList.add("is-invalid");
        return;
      }
      if (gradeField) {
        gradeField.classList.remove("is-invalid");
        gradeField.classList.toggle("is-nograde", values.noGrade);
      }

      var points = totalPointsFor(player, values);
      out.textContent = points;
      out.className = "w-9 text-right text-sm font-bold tabular-nums " + pointsClass(points);

      // Abweichende Tor-/Vorlagenzahl hervorheben
      ["goals", "assists"].forEach(function (kind) {
        var field = bodyEl.querySelector(
          '[data-count-for="' + playerId + '"][data-kind="' + kind + '"]'
        );
        if (!field) return;
        var abweichend = values[kind] !== null;
        field.classList.toggle("is-override", abweichend);
      });
    }

    function onFormChange(e) {
      var el = e.target.closest("[data-grade-for], [data-count-for], [data-potm-for]");
      if (!el) return;
      refreshPoints(el.dataset.gradeFor || el.dataset.countFor || el.dataset.potmFor);
    }

    bodyEl.addEventListener("input", onFormChange);
    bodyEl.addEventListener("change", onFormChange);

    function load(matchday) {
      bodyEl.innerHTML = '<p class="text-mute">Lade Spieltag ' + matchday + "…</p>";
      openKey = null;
      return Promise.all([KT.images.load(), KT.positions.load()])
        .then(function () {
          return KT.matchdayData.load(matchday);
        })
        .then(function (b) {
          bundle = b;
          render();
        })
        .catch(function (err) {
          bodyEl.innerHTML = '<p class="text-kicker">Konnte Spieltag nicht laden: ' +
            escapeHtml(err.message || String(err)) + "</p>";
        });
    }

    mdSelect.addEventListener("change", function () {
      load(Number(mdSelect.value));
    });

    return KT.matchdays
      .getIndex()
      .then(function (index) {
        mdSelect.innerHTML = index
          .map(function (md) {
            return '<option value="' + md.number + '">Spieltag ' + md.number + "</option>";
          })
          .join("");
        var stored = KT.config.getStoredMatchday();
        var start = stored && stored <= index.length ? stored : KT.matchdays.currentMatchday(index);
        mdSelect.value = String(start);
        return load(start);
      })
      .catch(function (err) {
        statusEl.textContent = "Spielplan nicht ladbar";
        bodyEl.innerHTML = '<p class="text-kicker">' + escapeHtml(err.message || String(err)) + "</p>";
      });
  };
})(window.KT);
