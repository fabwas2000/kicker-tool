window.KT = window.KT || {};
window.KT.views = window.KT.views || {};

(function (KT) {
  "use strict";

  var MAX_SQUAD_SIZE = 22;
  var POSITIONS = [
    { value: "", label: "Alle" },
    { value: "G", label: "Torwart" },
    { value: "D", label: "Abwehr" },
    { value: "M", label: "Mittelfeld" },
    { value: "F", label: "Sturm" },
  ];

  KT.views.squad = function (container) {
    var escapeHtml = KT.ui.escapeHtml;

    container.innerHTML = [
      '<section class="max-w-5xl mx-auto">',
      '  <div class="mb-4 pb-3 border-b-2 border-ink">',
      '    <h1 class="font-display text-3xl font-bold uppercase tracking-tight leading-none">Kader</h1>',
      '    <p class="text-mute text-sm mt-1">22er-Kader je Konkurrent aus echten Bundesliga-Spielern.</p>',
      "  </div>",
      '  <form id="add-competitor-form" class="flex gap-2 mb-4">',
      '    <input id="add-competitor-name" type="text" placeholder="Name des Konkurrenten"',
      '      class="kt-input flex-1" />',
      '    <button type="submit" class="kt-btn kt-btn-primary">',
      "      Spieler hinzufügen",
      "    </button>",
      "  </form>",
      '  <div id="competitor-list" class="mb-6">',
      '    <p class="text-mute text-sm">Lade Konkurrenten…</p>',
      "  </div>",
      '  <div id="squad-editor" class="hidden grid gap-6 md:grid-cols-2">',
      "    <div>",
      '      <button id="back-to-list" class="kt-eyebrow hover:text-kicker mb-3">‹ Alle Konkurrenten</button>',
      '      <h2 class="font-display text-xl font-bold uppercase tracking-tight mb-2"><span id="editor-name"></span> <span id="squad-count" class="text-mute font-normal normal-case"></span></h2>',
      '      <ul id="squad-list" class="kt-panel mb-4 min-h-[100px]"></ul>',
      '      <button id="save-squad" class="kt-btn kt-btn-primary">',
      "        Kader speichern",
      "      </button>",
      "    </div>",
      "    <div>",
      '      <h2 class="kt-eyebrow mb-2">Spieler suchen</h2>',
      '      <div class="flex flex-col gap-2 mb-3">',
      '        <input id="search-text" type="text" placeholder="Spielername…" class="kt-input" />',
      '        <div class="flex gap-2">',
      '          <select id="filter-team" class="kt-input flex-1">',
      '            <option value="">Vereine werden geladen…</option>',
      "          </select>",
      '          <select id="filter-position" class="kt-input">',
      POSITIONS.map(function (p) {
        return '            <option value="' + p.value + '">' + p.label + "</option>";
      }).join("\n"),
      "          </select>",
      "        </div>",
      "      </div>",
      '      <ul id="search-results" class="kt-panel max-h-[420px] overflow-y-auto"></ul>',
      "    </div>",
      "  </div>",
      "</section>",
    ].join("\n");

    var addForm = container.querySelector("#add-competitor-form");
    var addNameInput = container.querySelector("#add-competitor-name");
    var listEl = container.querySelector("#competitor-list");
    var editorNameEl = container.querySelector("#editor-name");
    var backBtn = container.querySelector("#back-to-list");
    var editor = container.querySelector("#squad-editor");
    var squadListEl = container.querySelector("#squad-list");
    var squadCountEl = container.querySelector("#squad-count");
    var searchTextEl = container.querySelector("#search-text");
    var filterTeamEl = container.querySelector("#filter-team");
    var filterPositionEl = container.querySelector("#filter-position");
    var resultsEl = container.querySelector("#search-results");
    var saveBtn = container.querySelector("#save-squad");

    var squad = new Map(); // espn_player_id -> player
    var allPlayers = [];
    var playersLoaded = false;
    var competitors = [];
    var selectedId = null;

    function renderCompetitorList() {
      if (competitors.length === 0) {
        listEl.innerHTML =
          '<p class="text-mute text-sm">Noch keine Konkurrenten – oben mit „Spieler hinzufügen“ anlegen.</p>';
        return;
      }
      listEl.innerHTML = competitors
        .map(function (c) {
          var voll = c.squad_size >= MAX_SQUAD_SIZE;
          var farbe = voll
            ? "bg-pos-soft text-pos"
            : c.squad_size === 0
            ? "bg-wash text-mute"
            : "bg-warn-soft text-warn";
          return [
            '<div class="kt-row flex items-center bg-panel">',
            '  <button data-competitor="' + c.id + '"',
            '    class="kt-focus flex-1 flex items-center gap-3 px-3 py-2.5 text-left kt-hover transition-colors">',
            '    <span class="flex-1 font-semibold text-ink truncate" data-name>' + escapeHtml(c.name) + "</span>",
            '    <span class="text-[10px] font-semibold uppercase tracking-wide tabular-nums px-1.5 py-0.5 ' + farbe + '">' +
              c.squad_size + "/" + MAX_SQUAD_SIZE + " Kader</span>",
            '    <span class="text-mute">›</span>',
            "  </button>",
            // Textzeichen statt Emoji - die bunten Emoji-Symbole fielen aus
            // dem ansonsten zweifarbigen Bild heraus.
            '  <button data-rename="' + c.id + '" title="Umbenennen"' +
              ' class="text-[11px] font-semibold uppercase tracking-wide text-mute hover:text-kicker px-2 py-2">Umbenennen</button>',
            '  <button data-delete="' + c.id + '" title="Löschen"' +
              ' class="text-mute hover:text-kicker px-2 py-2 text-sm leading-none">✕</button>',
            "</div>",
          ].join("\n");
        })
        .join("");
      listEl.classList.add("kt-panel");
    }

    /** Kaderzahl in der Übersicht nachziehen, ohne alles neu zu laden. */
    function updateCount(competitorId, size) {
      competitors.forEach(function (c) {
        if (String(c.id) === String(competitorId)) c.squad_size = size;
      });
    }

    function showList() {
      selectedId = null;
      editor.classList.add("hidden");
      listEl.classList.remove("hidden");
      renderCompetitorList();
    }

    function renderSquad() {
      squadCountEl.textContent = "(" + squad.size + "/" + MAX_SQUAD_SIZE + ")";
      if (squad.size === 0) {
        squadListEl.innerHTML = '<li class="text-mute text-sm px-3 py-3">Noch keine Spieler im Kader.</li>';
        return;
      }
      squadListEl.innerHTML = Array.from(squad.values())
        .sort(KT.ui.comparePlayers)
        .map(function (p) {
          var hasImage = KT.images.has(p.espn_player_id);
          return [
            '<li class="kt-row flex items-center gap-2 bg-panel px-3 py-2 text-sm">',
            "  " + KT.images.avatarHtml(p.espn_player_id, p.name, "w-9 h-9"),
            '  <select data-position-for="' + p.espn_player_id + '" title="Position laut kicker – bestimmt die Punkte pro Tor"',
            '    class="kt-input text-xs font-semibold px-1 py-0.5 bg-wash">',
            ["G", "D", "M", "F"]
              .map(function (code) {
                return '<option value="' + code + '"' + (p.position === code ? " selected" : "") + ">" +
                  KT.scoring.POSITION_LABEL[code].slice(0, 3) + "</option>";
              })
              .join(""),
            "  </select>",
            '  <span class="flex-1 font-medium text-ink truncate">' + escapeHtml(p.name) + "</span>",
            '  <span class="text-mute text-xs hidden sm:inline">' +
              escapeHtml(KT.vereine.name(p.espn_team_id, p.team_name)) + "</span>",
            // Bild-Knöpfe bleiben dicht beieinander, das Entfernen aus dem
            // Kader steht mit Abstand rechts - sonst stünden zwei gleich
            // aussehende "✕" nebeneinander und man träfe das falsche.
            '  <span class="inline-flex items-center">',
            '    <button data-image-for="' + p.espn_player_id + '" title="Bild wählen"',
            '      class="text-[10px] font-semibold uppercase tracking-wide px-2 py-1 ' +
              (hasImage
                ? "text-mute hover:text-kicker underline decoration-line underline-offset-2"
                : "border border-kicker text-kicker hover:bg-kicker-soft") +
              '">' + (hasImage ? "Bild ändern" : "+ Bild") + "</button>",
            hasImage
              ? '    <button data-image-del="' + p.espn_player_id + '" title="Bild entfernen"' +
                ' class="text-mute hover:text-kicker px-1 text-[11px]">✕</button>'
              : "",
            "  </span>",
            '  <button data-remove="' + p.espn_player_id + '" title="Aus Kader entfernen"' +
              ' class="text-mute hover:text-kicker pl-3 pr-1 text-base leading-none">✕</button>',
            "</li>",
          ].join("\n");
        })
        .join("");
    }

    // Verstecktes Dateifeld, das fuer alle Spieler wiederverwendet wird
    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";
    container.appendChild(fileInput);
    var pendingPlayerId = null;

    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      var playerId = pendingPlayerId;
      fileInput.value = "";
      pendingPlayerId = null;
      if (!file || !playerId) return;

      KT.ui.showInfo("Bild wird hochgeladen…");
      KT.images
        .upload(playerId, file)
        .then(function () {
          KT.ui.showInfo("Bild gespeichert.");
          renderSquad();
        })
        .catch(function (err) {
          KT.ui.showError("Bild konnte nicht gespeichert werden: " + KT.ui.backendErrorText(err));
        });
    });

    function renderResults() {
      if (!playersLoaded) {
        resultsEl.innerHTML = '<li class="text-mute text-sm px-3 py-3">Lade Spielerlisten von ESPN…</li>';
        return;
      }

      var text = searchTextEl.value.trim().toLowerCase();
      var teamFilter = filterTeamEl.value;
      var positionFilter = filterPositionEl.value;

      var filtered = allPlayers
        .filter(function (p) {
          return text ? p.name.toLowerCase().indexOf(text) > -1 : true;
        })
        .filter(function (p) {
          return teamFilter ? p.teamId === teamFilter : true;
        })
        .filter(function (p) {
          return positionFilter ? p.position === positionFilter : true;
        })
        // Erst sortieren, dann kappen - sonst haengt die Auswahl der 60
        // angezeigten Spieler von ESPNs Reihenfolge ab.
        .sort(KT.ui.comparePlayers)
        .slice(0, 60);

      if (filtered.length === 0) {
        resultsEl.innerHTML = '<li class="text-mute text-sm px-3 py-3">Keine Spieler gefunden.</li>';
        return;
      }

      resultsEl.innerHTML = filtered
        .map(function (p) {
          var inSquad = squad.has(p.id);
          var full = squad.size >= MAX_SQUAD_SIZE;
          var disabled = inSquad || full;
          var btnClass = inSquad
            ? "border-line text-mute"
            : "border-kicker text-kicker hover:bg-kicker-soft";
          return [
            '<li class="kt-row flex items-center gap-2 bg-panel px-3 py-2 text-sm">',
            '  <span class="w-8 text-center text-[10px] font-semibold uppercase text-mute">' + escapeHtml(p.position) + "</span>",
            '  <span class="flex-1 font-medium text-ink">' + escapeHtml(p.name) + "</span>",
            '  <span class="text-mute text-xs">' + escapeHtml(KT.vereine.name(p.teamId, p.teamName)) + "</span>",
            '  <button data-add="' + p.id + '" ' + (disabled ? "disabled" : "") +
              ' class="px-2 py-1 border text-[10px] font-semibold uppercase tracking-wide ' + btnClass +
              ' disabled:opacity-50">' + (inSquad ? "Im Kader" : "+ hinzufügen") + "</button>",
            "</li>",
          ].join("\n");
        })
        .join("");
    }

    [searchTextEl, filterPositionEl, filterTeamEl].forEach(function (el) {
      el.addEventListener("input", renderResults);
      el.addEventListener("change", renderResults);
    });

    resultsEl.addEventListener("click", function (e) {
      var id = e.target.dataset.add;
      if (!id) return;
      if (squad.size >= MAX_SQUAD_SIZE) {
        KT.ui.showError("Der Kader ist mit 22 Spielern voll.");
        return;
      }
      var player = allPlayers.find(function (p) {
        return p.id === id;
      });
      if (!player) return;
      squad.set(player.id, {
        espn_player_id: player.id,
        espn_team_id: player.teamId,
        name: player.name,
        team_name: player.teamName,
        position: player.position,
      });
      renderSquad();
      renderResults();
    });

    // Position von Hand korrigieren - noetig fuer Spieler, die kicker gar
    // nicht listet (z.B. Nachwuchs), oder bei abweichender Einschaetzung.
    squadListEl.addEventListener("change", function (e) {
      var select = e.target.closest("[data-position-for]");
      if (!select) return;
      var playerId = select.dataset.positionFor;
      var position = select.value;
      KT.api
        .setPlayerPosition(playerId, position)
        .then(function () {
          var entry = squad.get(playerId);
          if (entry) entry.position = position;
          KT.ui.showInfo("Position gespeichert: " + KT.scoring.POSITION_LABEL[position]);
        })
        .catch(function (err) {
          KT.ui.showError("Position konnte nicht gespeichert werden: " + KT.ui.backendErrorText(err));
        });
    });

    squadListEl.addEventListener("click", function (e) {
      var imageFor = e.target.closest("[data-image-for]");
      if (imageFor) {
        pendingPlayerId = imageFor.dataset.imageFor;
        fileInput.click();
        return;
      }

      var imageDel = e.target.closest("[data-image-del]");
      if (imageDel) {
        var delId = imageDel.dataset.imageDel;
        if (!confirm("Bild dieses Spielers entfernen?")) return;
        KT.images
          .remove(delId)
          .then(function () {
            KT.ui.showInfo("Bild entfernt.");
            renderSquad();
          })
          .catch(function (err) {
            KT.ui.showError("Bild konnte nicht entfernt werden: " + KT.ui.backendErrorText(err));
          });
        return;
      }

      var id = e.target.dataset.remove;
      if (!id) return;
      squad.delete(id);
      renderSquad();
      renderResults();
    });

    saveBtn.addEventListener("click", function () {
      if (!selectedId) {
        KT.ui.showError("Bitte zuerst einen Konkurrenten wählen.");
        return;
      }
      KT.api
        .replaceSquad(selectedId, Array.from(squad.values()))
        .then(function (gespeichert) {
          updateCount(selectedId, gespeichert.length);
          KT.ui.showInfo("Kader gespeichert (" + gespeichert.length + "/" + MAX_SQUAD_SIZE + ").");
        })
        .catch(function (err) {
          KT.ui.showError("Konnte Kader nicht speichern: " + KT.ui.backendErrorText(err));
        });
    });

    function openCompetitor(competitorId) {
      var competitor = competitors.filter(function (c) {
        return String(c.id) === String(competitorId);
      })[0];
      selectedId = competitorId;
      editorNameEl.textContent = competitor ? competitor.name : "Kader";
      listEl.classList.add("hidden");
      editor.classList.remove("hidden");
      squad = new Map();
      renderSquad();
      renderResults();

      // Kader und Bilderliste parallel - erst danach zeichnen, sonst fehlen
      // beim ersten Rendern die Fotos.
      Promise.all([KT.api.getSquad(competitorId), KT.images.load()])
        .then(function (results) {
          squad = new Map(
            results[0].map(function (p) {
              return [p.espn_player_id, p];
            })
          );
          updateCount(competitorId, results[0].length);
          renderSquad();
          renderResults();
        })
        .catch(function (err) {
          KT.ui.showError("Konnte Kader nicht laden: " + KT.ui.backendErrorText(err));
        });
    }

    function refreshCompetitors() {
      return KT.api
        .listCompetitors()
        .then(function (geladen) {
          competitors = geladen;
          renderCompetitorList();
        })
        .catch(function (err) {
          listEl.innerHTML =
            '<p class="text-kicker text-sm">' + escapeHtml(KT.ui.backendErrorText(err)) + "</p>";
        });
    }

    addForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = addNameInput.value.trim();
      if (!name) return;
      KT.api
        .createCompetitor(name)
        .then(function () {
          addNameInput.value = "";
          KT.ui.showInfo('"' + name + '" wurde angelegt.');
          return refreshCompetitors();
        })
        .catch(function (err) {
          KT.ui.showError("Konnte Konkurrent nicht anlegen: " + KT.ui.backendErrorText(err));
        });
    });

    listEl.addEventListener("click", function (e) {
      var renameId = e.target.dataset.rename;
      var deleteId = e.target.dataset.delete;

      if (renameId || deleteId) {
        var row = e.target.closest("div");
        var currentName = row ? row.querySelector("[data-name]").textContent : "";

        if (renameId) {
          var newName = prompt("Neuer Name:", currentName);
          if (!newName || newName.trim() === "" || newName === currentName) return;
          KT.api
            .renameCompetitor(renameId, newName.trim())
            .then(refreshCompetitors)
            .catch(function (err) {
              KT.ui.showError("Konnte nicht umbenennen: " + KT.ui.backendErrorText(err));
            });
        }

        if (deleteId) {
          if (!confirm('"' + currentName + '" inkl. Kader und Aufstellungen wirklich löschen?')) return;
          KT.api
            .deleteCompetitor(deleteId)
            .then(refreshCompetitors)
            .catch(function (err) {
              KT.ui.showError("Konnte nicht löschen: " + KT.ui.backendErrorText(err));
            });
        }
        return;
      }

      var btn = e.target.closest("[data-competitor]");
      if (btn) openCompetitor(btn.dataset.competitor);
    });

    backBtn.addEventListener("click", showList);

    // ESPN-Spielerlisten parallel zum Backend laden - unabhängig voneinander,
    // damit ein schlafendes Backend die Spielersuche nicht blockiert.
    KT.espn
      .getAllPlayers()
      .then(function (data) {
        allPlayers = data.players;
        playersLoaded = true;
        filterTeamEl.innerHTML =
          '<option value="">Alle Vereine</option>' +
          // Nach dem Umbenennen neu sortieren - ESPN liefert nach den
          // englischen Namen sortiert ("FC Cologne" bei F statt bei K).
          data.teams
            .map(function (t) {
              return { id: t.id, name: KT.vereine.name(t.id, t.name) };
            })
            .sort(function (a, b) {
              return a.name.localeCompare(b.name, "de");
            })
            .map(function (t) {
              return '<option value="' + t.id + '">' + escapeHtml(t.name) + "</option>";
            })
            .join("");
        renderResults();
      })
      .catch(function (err) {
        resultsEl.innerHTML =
          '<li class="text-kicker text-sm px-3 py-3">Konnte ESPN-Spielerdaten nicht laden: ' +
          escapeHtml(err.message) +
          "</li>";
      });

    return refreshCompetitors();
  };
})(window.KT);
