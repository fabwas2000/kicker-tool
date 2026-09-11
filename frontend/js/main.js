(function (KT) {
  "use strict";

  KT.router.registerRoute("/live", KT.views.live);
  KT.router.registerRoute("/grades", KT.views.grades);
  KT.router.registerRoute("/squad", KT.views.squad);
  KT.router.registerRoute("/settings", KT.views.settings);

  KT.router.start();
})(window.KT);
