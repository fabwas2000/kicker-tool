// Globaler Namespace des Tools. Bewusst KEINE ES-Module: nur so lässt sich
// index.html auch per Doppelklick (file://) öffnen - Browser blockieren
// <script type="module"> bei file:// per CORS.
window.KT = window.KT || {};

(function (KT) {
  "use strict";

  var BACKEND_URL_KEY = "kicker-tool:backend-url";
  var MATCHDAY_KEY = "kicker-tool:matchday";
  // Passwort fuer Aenderungen. Liegt bewusst nur hier im Browser des
  // jeweiligen Geraets - einmal eintragen, danach gemerkt.
  var PASSWORT_KEY = "kicker-tool:passwort";
  var DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

  // localStorage kann je nach Browser/Einstellung auch mal werfen (z.B. bei
  // blockierten Cookies) - dann läuft die App eben ohne gemerkte Werte weiter.
  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      /* ignorieren */
    }
  }

  KT.config = {
    ESPN_BASE: "https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1",
    LIVE_POLL_INTERVAL_MS: 30000,
    DEFAULT_BACKEND_URL: DEFAULT_BACKEND_URL,

    getBackendUrl: function () {
      return safeGet(BACKEND_URL_KEY) || DEFAULT_BACKEND_URL;
    },

    setBackendUrl: function (url) {
      safeSet(BACKEND_URL_KEY, url.replace(/\/+$/, ""));
    },

    getPasswort: function () {
      return safeGet(PASSWORT_KEY) || "";
    },

    setPasswort: function (passwort) {
      safeSet(PASSWORT_KEY, passwort || "");
    },

    /**
     * Zuletzt gewaehlter Spieltag - oder null, wenn noch keiner gewaehlt
     * wurde. Bewusst null statt 1: nur so koennen die Ansichten beim ersten
     * Aufruf auf den tatsaechlich aktuellen Spieltag springen.
     */
    getStoredMatchday: function () {
      var raw = safeGet(MATCHDAY_KEY);
      var n = raw ? Number(raw) : NaN;
      return isFinite(n) && n >= 1 ? n : null;
    },

    setStoredMatchday: function (matchday) {
      safeSet(MATCHDAY_KEY, String(matchday));
    },

    safeGet: safeGet,
    safeSet: safeSet,
  };
})(window.KT);
