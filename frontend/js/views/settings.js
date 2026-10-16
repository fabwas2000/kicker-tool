window.KT = window.KT || {};
window.KT.views = window.KT.views || {};

(function (KT) {
  "use strict";

  var SIMPLE_FIELDS = [
    { key: "starter", label: "Startelf" },
    { key: "substitute", label: "Einwechslung" },
    { key: "assist", label: "Vorlage" },
    { key: "cleanSheetGoalkeeper", label: "Torwart ohne Gegentor" },
    { key: "playerOfTheMatch", label: "Spieler des Spiels" },
    { key: "yellowRedCard", label: "Gelb-Rote Karte" },
    { key: "redCard", label: "Rote Karte" },
    { key: "ownGoal", label: "Eigentor" },
  ];

  var POSITION_LABELS = { G: "Torwart", D: "Abwehr", M: "Mittelfeld", F: "Sturm" };

  KT.views.settings = function (container) {
    var escapeHtml = KT.ui.escapeHtml;

    container.innerHTML = [
      '<section class="max-w-2xl mx-auto space-y-10">',
      "  <div>",
      '    <div class="mb-4 pb-3 border-b-2 border-ink">',
      '      <h1 class="font-display text-3xl font-bold uppercase tracking-tight leading-none">Einstellungen</h1>',
      '      <p class="text-mute text-sm mt-1">Adresse des Backends, das Konkurrenten, Kader,',
      "        Aufstellungen und Noten speichert.</p>",
      "    </div>",
      '    <form id="backend-form" class="space-y-3">',
      '      <label class="kt-eyebrow block">Backend-URL</label>',
      '      <input id="backend-url" type="text" placeholder="https://mein-backend.onrender.com"',
      '        class="kt-input w-full"',
      '        value="' + escapeHtml(KT.config.getBackendUrl()) + '" />',
      '      <div class="flex gap-2">',
      '        <button type="submit" class="kt-btn kt-btn-primary">Speichern</button>',
      '        <button type="button" id="test-connection" class="kt-btn kt-btn-secondary">Verbindung testen</button>',
      "      </div>",
      '      <p id="connection-status" class="text-sm"></p>',
      "    </form>",
      "  </div>",

      '  <div id="passwort-section">',
      '    <h2 class="font-display text-xl font-bold uppercase tracking-tight mb-1">Anmeldung</h2>',
      '    <p class="text-mute text-sm">Du bist angemeldet - sonst wäre diese Seite gar nicht',
      "      erreichbar. Abmelden kannst du dich oben rechts.</p>",
      "  </div>",

      '  <div id="kicker-liga-section">',
      '    <h2 class="font-display text-xl font-bold uppercase tracking-tight mb-1">kicker-Liga</h2>',
      '    <p class="text-mute text-sm mb-3">Aus dieser Liga holt das Tool Kader und Startelf der Konkurrenten –',
      "      automatisch kurz nach jeder Anstoßzeit, solange ein angemeldetes Gerät die Seite offen hat,",
      "      oder per „Aufstellungen laden“ auf der Punkte-Seite. Im Managerspiel die Seite der Liga öffnen",
      "      und ihre Adresse hier einfügen.</p>",
      '    <form id="kicker-liga-form" class="space-y-3">',
      '      <input id="kicker-liga" type="text" placeholder="https://www.kicker.de/managerspiel/interactive/…/group/round/…"',
      '        class="kt-input w-full" />',
      '      <button type="submit" class="kt-btn kt-btn-primary">Liga speichern</button>',
      '      <p id="kicker-liga-status" class="text-sm text-mute"></p>',
      "    </form>",
      "  </div>",

      '  <div id="rules-section">',
      '    <h2 class="font-display text-xl font-bold uppercase tracking-tight mb-1">Punkte-Regeln</h2>',
      '    <p class="text-mute text-sm mb-4">Standard = offizielles kicker-Managerspiel Interactive.',
      "      Note und Tore/Vorlagen werden addiert.</p>",
      '    <div id="rules-body"><p class="text-mute text-sm">Lade Regeln…</p></div>',
      "  </div>",
      "</section>",
    ].join("\n");

    // ---------------- Backend-URL ----------------
    var urlInput = container.querySelector("#backend-url");
    var statusEl = container.querySelector("#connection-status");

    container.querySelector("#backend-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var url = urlInput.value.trim();
      if (!url) return;
      KT.config.setBackendUrl(url);
      urlInput.value = KT.config.getBackendUrl();
      KT.matchdayData.clearRulesCache();
      KT.ui.showInfo("Backend-URL gespeichert.");
    });

    container.querySelector("#test-connection").addEventListener("click", function () {
      var url = urlInput.value.trim().replace(/\/+$/, "");
      statusEl.textContent = "Teste…";
      statusEl.className = "text-sm text-mute";
      fetch(url + "/health")
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function () {
          statusEl.textContent = "✓ Backend erreichbar.";
          statusEl.className = "text-sm text-pos font-semibold";
        })
        .catch(function (err) {
          statusEl.textContent = "✗ Nicht erreichbar: " + (err.message || err);
          statusEl.className = "text-sm text-kicker font-semibold";
        });
    });

    // ---------------- kicker-Liga ----------------
    var ligaInput = container.querySelector("#kicker-liga");
    var ligaStatus = container.querySelector("#kicker-liga-status");

    function zeigeLiga(liga) {
      ligaStatus.textContent = liga ? "Hinterlegt: Liga " + liga : "Noch keine Liga hinterlegt.";
    }

    KT.api.getKickerLiga().then(function (r) { zeigeLiga(r.liga); }).catch(function () {});

    container.querySelector("#kicker-liga-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var link = ligaInput.value.trim();
      if (!link) return;
      KT.api
        .saveKickerLiga(link)
        .then(function (r) {
          ligaInput.value = "";
          zeigeLiga(r.liga);
          KT.ui.showInfo("kicker-Liga gespeichert.");
        })
        .catch(function (err) {
          KT.ui.showError("Konnte Liga nicht speichern: " + KT.ui.backendErrorText(err));
        });
    });

    // ---------------- Punkte-Regeln ----------------
    var rulesBody = container.querySelector("#rules-body");

    function numberInput(name, value) {
      return '<input type="number" step="0.5" data-rule="' + name + '" value="' + value +
        '" class="kt-input w-20 text-center px-2 py-1 text-sm" />';
    }

    function renderRules(rules) {
      var gradeRows = KT.scoring.GRADE_STEPS.map(function (step) {
        var value = rules.gradePoints && rules.gradePoints[step] !== undefined
          ? rules.gradePoints[step]
          : KT.scoring.FALLBACK_RULES.gradePoints[step];
        return [
          '<div class="flex items-center gap-2">',
          '  <span class="w-10 text-sm font-semibold text-ink tabular-nums">' + step.replace(".", ",") + "</span>",
          "  " + numberInput("gradePoints." + step, value),
          "</div>",
        ].join("");
      }).join("");

      var goalRows = ["G", "D", "M", "F"].map(function (pos) {
        var value = (rules.goalByPosition && rules.goalByPosition[pos] !== undefined)
          ? rules.goalByPosition[pos]
          : KT.scoring.FALLBACK_RULES.goalByPosition[pos];
        return [
          '<div class="flex items-center gap-2">',
          '  <span class="w-24 text-sm text-mute-dark">' + POSITION_LABELS[pos] + "</span>",
          "  " + numberInput("goalByPosition." + pos, value),
          "</div>",
        ].join("");
      }).join("");

      var simpleRows = SIMPLE_FIELDS.map(function (f) {
        var value = rules[f.key] !== undefined ? rules[f.key] : KT.scoring.FALLBACK_RULES[f.key];
        return [
          '<div class="flex items-center gap-2">',
          '  <span class="w-44 text-sm text-mute-dark">' + f.label + "</span>",
          "  " + numberInput(f.key, value),
          "</div>",
        ].join("");
      }).join("");

      rulesBody.innerHTML = [
        '<div class="grid gap-6 sm:grid-cols-2">',
        "  <div>",
        '    <h3 class="kt-eyebrow mb-2">Punkte je kicker-Note</h3>',
        '    <div class="space-y-1">' + gradeRows + "</div>",
        "  </div>",
        "  <div class=\"space-y-6\">",
        "    <div>",
        '      <h3 class="kt-eyebrow mb-2">Tor nach Position</h3>',
        '      <div class="space-y-1">' + goalRows + "</div>",
        "    </div>",
        "    <div>",
        '      <h3 class="kt-eyebrow mb-2">Sonstiges</h3>',
        '      <div class="space-y-1">' + simpleRows + "</div>",
        "    </div>",
        "  </div>",
        "</div>",
        '<div class="flex gap-2 mt-6">',
        '  <button id="save-rules" class="kt-btn kt-btn-primary">Regeln speichern</button>',
        '  <button id="reset-rules" class="kt-btn kt-btn-secondary">Auf kicker-Standard zurücksetzen</button>',
        "</div>",
      ].join("\n");

      rulesBody.querySelector("#save-rules").addEventListener("click", function () {
        var next = { gradePoints: {}, goalByPosition: {} };
        Array.prototype.forEach.call(rulesBody.querySelectorAll("[data-rule]"), function (input) {
          var path = input.dataset.rule;
          var value = Number(input.value);
          if (!isFinite(value)) value = 0;
          if (path.indexOf("gradePoints.") === 0) {
            next.gradePoints[path.slice("gradePoints.".length)] = value;
          } else if (path.indexOf("goalByPosition.") === 0) {
            next.goalByPosition[path.slice("goalByPosition.".length)] = value;
          } else {
            next[path] = value;
          }
        });
        KT.api
          .saveScoringRules(next)
          .then(function (saved) {
            KT.matchdayData.clearRulesCache();
            KT.ui.showInfo("Punkte-Regeln gespeichert.");
            renderRules(saved);
          })
          .catch(function (err) {
            KT.ui.showError("Konnte Regeln nicht speichern: " + KT.ui.backendErrorText(err));
          });
      });

      rulesBody.querySelector("#reset-rules").addEventListener("click", function () {
        if (!confirm("Alle Punkte-Regeln auf den kicker-Standard zurücksetzen?")) return;
        KT.api
          .resetScoringRules()
          .then(function (defaults) {
            KT.matchdayData.clearRulesCache();
            KT.ui.showInfo("Auf kicker-Standard zurückgesetzt.");
            renderRules(defaults);
          })
          .catch(function (err) {
            KT.ui.showError("Konnte nicht zurücksetzen: " + KT.ui.backendErrorText(err));
          });
      });
    }

    return KT.api
      .getScoringRules()
      .then(renderRules)
      .catch(function (err) {
        rulesBody.innerHTML = '<p class="text-kicker text-sm">' +
          escapeHtml(KT.ui.backendErrorText(err)) + "</p>";
      });
  };
})(window.KT);
