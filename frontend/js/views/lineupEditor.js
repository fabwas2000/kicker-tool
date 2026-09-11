window.KT = window.KT || {};

/**
 * Aufstellungs-Editor als Overlay (kein eigener Tab mehr) - wird von der
 * Spieltag-Ansicht aus für einen einzelnen Konkurrenten geöffnet.
 */
(function (KT) {
  "use strict";

  KT.lineupEditor = {
    /**
     * @param opts.competitorId
     * @param opts.competitorName
     * @param opts.matchday
     * @param opts.onSaved  function(lineup) - nach erfolgreichem Speichern
     */
    open: function (opts) {
      var escapeHtml = KT.ui.escapeHtml;
      var competitorId = opts.competitorId;
      var matchday = opts.matchday;

      var squad = [];
      var placements = new Map(); // slot -> espn_player_id
      var selectedBenchId = null;
      var alleAufstellungen = [];
      var vorlage = null;
      var formation = KT.formationNames[0];

      var overlay = document.createElement("div");
      overlay.id = "lineup-editor-overlay";
      overlay.className =
        "fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-0 sm:p-4 overflow-y-auto";
      overlay.innerHTML = [
        '<div class="bg-panel border border-line w-full sm:max-w-4xl shadow-[0_6px_24px_rgba(0,0,0,0.6)] my-0 sm:my-8" data-panel>',
        '  <div class="flex items-center justify-between gap-3 p-4 border-b-2 border-ink">',
        "    <div>",
        '      <h2 class="font-display text-2xl font-bold uppercase tracking-tight leading-none">Aufstellung</h2>',
        '      <p class="text-sm text-mute mt-0.5">' + escapeHtml(opts.competitorName || "") + " · Spieltag " + matchday + "</p>",
        "    </div>",
        '    <button data-close class="text-mute hover:text-kicker text-2xl leading-none px-2">×</button>',
        "  </div>",
        '  <div class="p-4">',
        '    <div class="flex flex-wrap gap-3 mb-4 items-end">',
        "      <div>",
        '        <label class="kt-eyebrow block mb-1">Formation</label>',
        '        <select id="le-formation" class="kt-input font-semibold py-[0.42rem]">',
        KT.formationNames
          .map(function (f) {
            return '          <option value="' + f + '">' + f + "</option>";
          })
          .join("\n"),
        "        </select>",
        "      </div>",
        '      <button id="le-save" class="kt-btn kt-btn-primary">',
        "        Aufstellung speichern",
        "      </button>",
        '      <button id="le-copy" class="kt-btn kt-btn-secondary hidden"></button>',
        "    </div>",
        '    <div class="grid gap-6 md:grid-cols-[2fr_1fr] items-start">',
        '      <div id="le-pitch" class="pitch relative w-full aspect-[3/4] max-h-[60vh] overflow-hidden"></div>',
        "      <div>",
        '        <h3 class="kt-eyebrow mb-2">Bank <span id="le-bench-count" class="normal-case tracking-normal"></span></h3>',
        '        <ul id="le-bench-list" class="kt-panel max-h-[50vh] overflow-y-auto"></ul>',
        "      </div>",
        "    </div>",
        "  </div>",
        "</div>",
      ].join("\n");
      document.body.appendChild(overlay);

      var formationSelect = overlay.querySelector("#le-formation");
      var pitchEl = overlay.querySelector("#le-pitch");
      var benchEl = overlay.querySelector("#le-bench-list");
      var benchCountEl = overlay.querySelector("#le-bench-count");
      var saveBtn = overlay.querySelector("#le-save");
      var copyBtn = overlay.querySelector("#le-copy");
      formation = formationSelect.value;

      function close() {
        document.removeEventListener("dragover", autoScroll);
        document.removeEventListener("keydown", onKeydown);
        overlay.remove();
      }

      function onKeydown(e) {
        if (e.key === "Escape") close();
      }
      document.addEventListener("keydown", onKeydown);

      overlay.addEventListener("click", function (e) {
        if (e.target.closest("[data-close]")) {
          close();
          return;
        }
        // Nur schliessen, wenn wirklich der dunkle Hintergrund getroffen wurde
        // (e.target === overlay). e.target.closest("[data-panel]") war hier
        // unzuverlaessig: der "x"-Knopf zum Entfernen eines Spielers rendert
        // beim Klick sofort neu und haengt sich dabei selbst aus dem Baum
        // aus - closest() findet dann auf dem verwaisten Knoten nichts mehr
        // und der Editor schloss sich faelschlich mit.
        if (e.target === overlay) close();
      });

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
              'flex items-center justify-center text-[10px] text-white/50 font-semibold uppercase">' +
              s.label +
              "</div>"
            );
          }
          // Wie bei kicker: Foto im Hochformat, darunter nur der Nachname.
          return [
            '<div draggable="true" data-source="slot" data-chip-slot="' + s.slot + '" data-player="' + player.espn_player_id + '"',
            '  class="relative flex flex-col items-center w-full cursor-grab">',
            '  <div class="relative">',
            "    " + KT.images.avatarHtml(player.espn_player_id, player.name, "pitch-photo", false),
            '    <button data-remove-slot="' + s.slot + '" title="Von dieser Position nehmen"',
            '      class="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-panel text-kicker text-[10px]',
            '             leading-none ring-1 ring-line hover:bg-kicker hover:text-white">×</button>',
            "  </div>",
            '  <div class="pitch-name mt-1 font-semibold text-ink text-center max-w-full truncate">' +
              escapeHtml(KT.ui.lastName(player.name)) + "</div>",
            "</div>",
          ].join("\n");
        });
      }

      function renderBench() {
        var placed = placedIds();
        var bench = squad.filter(function (p) {
          return !placed.has(p.espn_player_id);
        });
        benchCountEl.textContent = "(" + placed.size + "/11 aufgestellt)";

        if (squad.length === 0) {
          benchEl.innerHTML =
            '<li class="text-mute text-sm px-3 py-3">Dieser Konkurrent hat noch keinen Kader. Erst unter „Kader“ anlegen.</li>';
          return;
        }
        if (bench.length === 0) {
          benchEl.innerHTML = '<li class="text-mute text-sm px-3 py-3">Alle Kaderspieler sind aufgestellt.</li>';
          return;
        }
        benchEl.innerHTML = bench
          .sort(KT.ui.comparePlayers)
          .map(function (p) {
            var selected = selectedBenchId === p.espn_player_id;
            return [
              '<li draggable="true" data-source="bench" data-player="' + p.espn_player_id + '"',
              '  class="player-chip kt-row flex items-center gap-2 px-3 py-2 text-sm cursor-grab ' +
                (selected ? "bg-kicker-soft ring-1 ring-inset ring-kicker" : "bg-panel kt-hover") + '">',
              "  " + KT.images.avatarHtml(p.espn_player_id, p.name, "w-8 h-8"),
              '  <span class="w-6 text-center text-[10px] font-semibold uppercase text-mute">' + escapeHtml(p.position) + "</span>",
              '  <span class="flex-1 font-medium text-ink">' + escapeHtml(p.name) + "</span>",
              '  <span class="text-mute text-xs">' +
                escapeHtml(KT.vereine.name(p.espn_team_id, p.team_name)) + "</span>",
              "</li>",
            ].join("\n");
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

      function renderCopyButton(aktuellerSpieltag, hatEigeneAufstellung) {
        vorlage = hatEigeneAufstellung ? null : findeVorlage(aktuellerSpieltag);
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
        if (e.target.dataset.removeSlot) {
          removeFromSlot(e.target.dataset.removeSlot);
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
        if (e.clientY < rand) overlay.scrollBy(0, -14);
        else if (e.clientY > window.innerHeight - rand) overlay.scrollBy(0, 14);
      }
      document.addEventListener("dragover", autoScroll);

      overlay.addEventListener("dragstart", function (e) {
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

      pitchEl.addEventListener("drop", function (e) {
        var slotEl = e.target.closest("[data-slot]");
        if (!slotEl) return;
        e.preventDefault();
        var data;
        try {
          data = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
        } catch (err) {
          return;
        }
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
        var data;
        try {
          data = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
        } catch (err) {
          return;
        }
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
        var zurueckAufDieBank = inFormationUebernehmen(alteFormation, formation);
        selectedBenchId = null;
        renderAll();
        if (zurueckAufDieBank) {
          KT.ui.showInfo(
            zurueckAufDieBank === 1
              ? "1 Spieler zurück auf die Bank – in " + formation + " ist dort weniger Platz."
              : zurueckAufDieBank + " Spieler zurück auf die Bank – in " + formation +
                " ist dort weniger Platz."
          );
        }
      });

      saveBtn.addEventListener("click", function () {
        var players = Array.from(placements.entries()).map(function (entry) {
          return { slot: entry[0], espn_player_id: entry[1] };
        });
        if (players.length === 0) {
          KT.ui.showError("Bitte mindestens einen Spieler aufstellen.");
          return;
        }
        KT.api
          .saveLineup(competitorId, matchday, formation, players)
          .then(function (gespeichert) {
            alleAufstellungen = alleAufstellungen.filter(function (l) {
              return l.matchday !== matchday;
            });
            alleAufstellungen.push(gespeichert);
            renderCopyButton(matchday, true);

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
          });
      });

      return KT.images
        .load()
        .then(function () {
          return Promise.all([KT.api.getSquad(competitorId), KT.api.listLineups(competitorId)]);
        })
        .then(function (results) {
          squad = results[0];
          alleAufstellungen = results[1] || [];

          var existing = alleAufstellungen.filter(function (l) {
            return l.matchday === matchday;
          })[0];

          if (existing) {
            formation = existing.formation;
            formationSelect.value = formation;
            placements = new Map(
              existing.players.map(function (p) {
                return [p.slot, p.espn_player_id];
              })
            );
          } else {
            formation = formationSelect.value;
            placements = new Map();
          }
          renderCopyButton(matchday, Boolean(existing));
          renderAll();
        })
        .catch(function (err) {
          KT.ui.showError("Konnte Kader/Aufstellung nicht laden: " + KT.ui.backendErrorText(err));
        });
    },
  };
})(window.KT);
