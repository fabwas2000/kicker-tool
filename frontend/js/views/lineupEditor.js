window.KT = window.KT || {};

/**
 * Bearbeitungsmodus fuer die Aufstellung eines Konkurrenten - direkt in der
 * ausgeklappten Zeile der Punkte-Ansicht, kein eigenes Fenster. Die Ansicht
 * bleibt dieselbe (Spielfeld links, uebriger Kader rechts); Kacheln und
 * Zeilen zeichnet die Punkte-Ansicht selbst (opts.chipHtml/opts.zeileHtml),
 * damit beide Zustaende genau gleich aussehen. Der Editor kuemmert sich nur
 * um Verschieben, Formation und Speichern.
 */
(function (KT) {
  "use strict";

  // Gemeinsames Geruest: die Punkte-Ansicht baut ihre Lesefassung aus
  // denselben Klassen, damit sich beim Umschalten nichts verschiebt.
  var LAYOUT = {
    grid: "grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start",
    pitch: "pitch pitch-compact relative w-full max-w-lg mx-auto aspect-[3/4] overflow-hidden",
    // Dunkle "Bank" mit denselben Kacheln wie auf dem Feld (styles.css).
    list: "kader-bank grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-x-1 gap-y-2 p-2 " +
      "items-start max-h-[70vh] overflow-y-auto",
    hinweis: "col-span-full text-white/60 text-sm text-center py-3",
  };

  function kopfzeileHtml(anzahl) {
    return '<h3 class="kt-eyebrow mb-2">Übriger Kader <span class="normal-case tracking-normal">(' +
      anzahl + "/11 aufgestellt)</span></h3>";
  }

  KT.lineupEditor = {
    LAYOUT: LAYOUT,
    kopfzeileHtml: kopfzeileHtml,

    /**
     * Baut den Bearbeitungsmodus auf. Haengt sich NICHT selbst ein: der
     * Aufrufer setzt controller.el an die richtige Stelle (und beim Live-
     * Nachladen wieder neu ein, statt den Editor zu verlieren).
     *
     * @param opts.competitorId
     * @param opts.matchday
     * @param opts.squad       Kaderspieler [{espn_player_id, name, position, ...}]
     * @param opts.formation   aktuelle Formation (oder null)
     * @param opts.players     aktuelle Aufstellung [{slot, espn_player_id}]
     * @param opts.chipHtml    function(player, slot) -> HTML der Spielfeld-Kachel
     * @param opts.zeileHtml   function(player, ausgewaehlt) -> Kachel des uebrigen Kaders
     *                         (mit data-source="bench" data-player="..." draggable)
     * @param opts.onSaved     function(lineup) - nach erfolgreichem Speichern
     * @param opts.onCancel    function() - Bearbeitung ohne Speichern beendet
     * @returns {el, refresh, destroy}
     */
    mount: function (opts) {
      var competitorId = opts.competitorId;
      var matchday = opts.matchday;
      var squad = opts.squad || [];
      var formation = opts.formation && KT.formations[opts.formation] ? opts.formation : KT.formationNames[0];
      var placements = new Map(
        (opts.players || []).map(function (p) {
          return [p.slot, p.espn_player_id];
        })
      );
      var selectedBenchId = null;
      var alleAufstellungen = [];
      var vorlage = null;
      var speichert = false;

      var el = document.createElement("div");
      el.setAttribute("data-lineup-editor", competitorId);
      el.innerHTML = [
        '<div class="' + LAYOUT.grid + '">',
        '  <div data-le-pitch class="' + LAYOUT.pitch + '"></div>',
        "  <div>",
        '    <div data-le-kopf></div>',
        '    <div data-le-bench class="' + LAYOUT.list + '"></div>',
        "  </div>",
        "</div>",
        '<div class="flex flex-wrap justify-center items-end gap-2 mt-3">',
        "  <div>",
        '    <label class="kt-eyebrow block mb-1">Formation</label>',
        '    <select data-le-formation class="kt-input font-semibold py-[0.42rem]">',
        KT.formationNames
          .map(function (f) {
            return '      <option value="' + f + '">' + f + "</option>";
          })
          .join("\n"),
        "    </select>",
        "  </div>",
        '  <button data-le-copy class="kt-btn kt-btn-secondary hidden"></button>',
        '  <button data-le-cancel class="kt-btn kt-btn-secondary">Abbrechen</button>',
        '  <button data-le-save class="kt-btn kt-btn-primary">Aufstellung speichern</button>',
        "</div>",
        '<p class="text-xs text-mute text-center mt-2">Spieler aus dem Kader aufs Feld ziehen – oder antippen und dann die Position antippen.</p>',
      ].join("\n");

      var formationSelect = el.querySelector("[data-le-formation]");
      var pitchEl = el.querySelector("[data-le-pitch]");
      var benchEl = el.querySelector("[data-le-bench]");
      var kopfEl = el.querySelector("[data-le-kopf]");
      var saveBtn = el.querySelector("[data-le-save]");
      var copyBtn = el.querySelector("[data-le-copy]");
      var cancelBtn = el.querySelector("[data-le-cancel]");
      formationSelect.value = formation;

      function playerById(id) {
        return squad.find(function (p) {
          return p.espn_player_id === id;
        });
      }

      function placedIds() {
        return new Set(placements.values());
      }

      function placePlayer(slot, playerId) {
        Array.from(placements.entries()).forEach(function (entry) {
          if (entry[1] === playerId) placements.delete(entry[0]);
        });
        placements.set(slot, playerId);
        renderAll();
      }

      function removeFromSlot(slot) {
        placements.delete(slot);
        renderAll();
      }

      function renderPitch() {
        KT.pitch.renderInto(pitchEl, formation, function (s) {
          var playerId = placements.get(s.slot);
          var player = playerId ? playerById(playerId) : null;
          if (!player) {
            return (
              '<div class="empty-slot pitch-slot-empty bg-white/5 border border-dashed border-white/25 ' +
              'flex items-center justify-center text-[9px] text-white/50 font-semibold uppercase">' +
              s.label +
              "</div>"
            );
          }
          return (
            '<div draggable="true" data-source="slot" data-chip-slot="' + s.slot + '" data-player="' +
            player.espn_player_id + '" class="w-full cursor-grab">' +
            opts.chipHtml(player, s.slot) +
            "</div>"
          );
        });
      }

      function renderBench() {
        var placed = placedIds();
        kopfEl.innerHTML = kopfzeileHtml(placed.size);

        if (squad.length === 0) {
          benchEl.innerHTML =
            '<p class="' + LAYOUT.hinweis + '">Dieser Konkurrent hat noch keinen Kader. Erst unter „Kader“ anlegen.</p>';
          return;
        }
        var bench = squad.filter(function (p) {
          return !placed.has(p.espn_player_id);
        });
        if (bench.length === 0) {
          benchEl.innerHTML = '<p class="' + LAYOUT.hinweis + '">Alle Kaderspieler sind aufgestellt.</p>';
          return;
        }
        benchEl.innerHTML = bench
          .sort(KT.ui.comparePlayers)
          .map(function (p) {
            return opts.zeileHtml(p, selectedBenchId === p.espn_player_id);
          })
          .join("");
      }

      function renderAll() {
        renderPitch();
        renderBench();
      }

      function findeVorlage(md) {
        var frueher = alleAufstellungen.filter(function (l) {
          return l.matchday < md;
        });
        if (!frueher.length) return null;
        return frueher.reduce(function (a, b) {
          return b.matchday > a.matchday ? b : a;
        });
      }

      function renderCopyButton() {
        var hatEigene = alleAufstellungen.some(function (l) {
          return l.matchday === matchday;
        });
        vorlage = hatEigene ? null : findeVorlage(matchday);
        if (!vorlage) {
          copyBtn.classList.add("hidden");
          return;
        }
        copyBtn.textContent = "Von Spieltag " + vorlage.matchday + " übernehmen";
        copyBtn.classList.remove("hidden");
      }

      copyBtn.addEventListener("click", function () {
        if (!vorlage) return;
        var imKader = new Set(
          squad.map(function (p) {
            return p.espn_player_id;
          })
        );

        formation = vorlage.formation;
        formationSelect.value = formation;
        placements = new Map();
        var fehlend = 0;
        vorlage.players.forEach(function (p) {
          if (imKader.has(p.espn_player_id)) placements.set(p.slot, p.espn_player_id);
          else fehlend++;
        });
        selectedBenchId = null;
        renderAll();

        KT.ui.showInfo(
          "Aufstellung von Spieltag " + vorlage.matchday + " übernommen" +
            (fehlend ? " – " + fehlend + " Spieler fehlen im Kader" : "") +
            ". Noch nicht gespeichert."
        );
      });

      benchEl.addEventListener("click", function (e) {
        var li = e.target.closest("[data-source='bench']");
        if (!li) return;
        var id = li.dataset.player;
        selectedBenchId = selectedBenchId === id ? null : id;
        renderBench();
      });

      pitchEl.addEventListener("click", function (e) {
        var removeBtn = e.target.closest("[data-remove-slot]");
        if (removeBtn) {
          removeFromSlot(removeBtn.dataset.removeSlot);
          return;
        }
        var slotEl = e.target.closest("[data-slot]");
        if (!slotEl) return;
        if (selectedBenchId) {
          placePlayer(slotEl.dataset.slot, selectedBenchId);
          selectedBenchId = null;
        }
      });

      function autoScroll(e) {
        var rand = 40;
        if (e.clientY < rand) window.scrollBy(0, -14);
        else if (e.clientY > window.innerHeight - rand) window.scrollBy(0, 14);
      }
      document.addEventListener("dragover", autoScroll);

      el.addEventListener("dragstart", function (e) {
        var chip = e.target.closest("[data-player]");
        if (!chip) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(
          "text/plain",
          JSON.stringify({
            playerId: chip.dataset.player,
            source: chip.dataset.source,
            slot: chip.dataset.chipSlot,
          })
        );
      });

      pitchEl.addEventListener("dragover", function (e) {
        if (e.target.closest("[data-slot]")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      });

      function dropDaten(e) {
        try {
          return JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
        } catch (err) {
          return {};
        }
      }

      pitchEl.addEventListener("drop", function (e) {
        var slotEl = e.target.closest("[data-slot]");
        if (!slotEl) return;
        e.preventDefault();
        var data = dropDaten(e);
        if (!data.playerId) return;
        placePlayer(slotEl.dataset.slot, data.playerId);
        selectedBenchId = null;
      });

      benchEl.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      });

      benchEl.addEventListener("drop", function (e) {
        e.preventDefault();
        var data = dropDaten(e);
        if (data.source === "slot" && data.slot) removeFromSlot(data.slot);
      });

      function inFormationUebernehmen(alteFormation, neueFormation) {
        var proLinie = { G: [], D: [], M: [], F: [] };
        (KT.formations[alteFormation] || []).forEach(function (s) {
          var playerId = placements.get(s.slot);
          if (playerId) proLinie[KT.formationLine(s.slot)].push(playerId);
        });

        var neuePlatzierung = new Map();
        (KT.formations[neueFormation] || []).forEach(function (s) {
          var linie = KT.formationLine(s.slot);
          if (proLinie[linie].length) neuePlatzierung.set(s.slot, proLinie[linie].shift());
        });

        var uebrig = 0;
        Object.keys(proLinie).forEach(function (linie) {
          uebrig += proLinie[linie].length;
        });

        placements = neuePlatzierung;
        return uebrig;
      }

      formationSelect.addEventListener("change", function () {
        var alteFormation = formation;
        formation = formationSelect.value;
        var zurueck = inFormationUebernehmen(alteFormation, formation);
        selectedBenchId = null;
        renderAll();
        if (zurueck) {
          KT.ui.showInfo(
            (zurueck === 1 ? "1 Spieler" : zurueck + " Spieler") +
              " zurück in den Kader – in " + formation + " ist dort weniger Platz."
          );
        }
      });

      cancelBtn.addEventListener("click", function () {
        if (typeof opts.onCancel === "function") opts.onCancel();
      });

      saveBtn.addEventListener("click", function () {
        if (speichert) return;
        var players = Array.from(placements.entries()).map(function (entry) {
          return { slot: entry[0], espn_player_id: entry[1] };
        });
        if (players.length === 0) {
          KT.ui.showError("Bitte mindestens einen Spieler aufstellen.");
          return;
        }
        speichert = true;
        saveBtn.disabled = true;
        KT.api
          .saveLineup(competitorId, matchday, formation, players)
          .then(function (gespeichert) {
            if (players.length < 11) {
              KT.ui.showInfo(
                "Aufstellung für Spieltag " + matchday + " gespeichert (" + players.length +
                  "/11 – unvollständig, wird trotzdem gewertet)."
              );
            } else {
              KT.ui.showInfo("Aufstellung für Spieltag " + matchday + " gespeichert.");
            }
            if (typeof opts.onSaved === "function") opts.onSaved(gespeichert);
          })
          .catch(function (err) {
            KT.ui.showError("Konnte Aufstellung nicht speichern: " + KT.ui.backendErrorText(err));
          })
          .then(function () {
            speichert = false;
            saveBtn.disabled = false;
          });
      });

      renderAll();

      // Nur fuer "Von Spieltag X uebernehmen" - die Ansicht steht schon.
      KT.api
        .listLineups(competitorId)
        .then(function (liste) {
          alleAufstellungen = liste || [];
          renderCopyButton();
        })
        .catch(function () {});

      return {
        el: el,
        /** Kacheln/Zeilen neu zeichnen, z. B. nach einem Live-Update. */
        refresh: renderAll,
        destroy: function () {
          document.removeEventListener("dragover", autoScroll);
          el.remove();
        },
      };
    },
  };
})(window.KT);
