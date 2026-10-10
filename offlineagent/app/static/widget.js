/* Offline Agent panel düğmesi.
 * Bir sayfaya eklemek için:  <script src="http://127.0.0.1:8765/widget.js" defer></script>
 * Sağ altta bir düğme çıkar; tıklanınca asistan küçük bir pencerede açılır.
 * Asistan bu bilgisayarda çalışan sunucudan gelir; sayfanın kendisi sohbet içeriğini göremez.
 */
(function () {
  if (window.__offlineAgent) return;
  window.__offlineAgent = true;
  var kaynak = document.currentScript && document.currentScript.src;
  var KOK = kaynak ? new URL(kaynak).origin : "http://127.0.0.1:8765";

  var stil = document.createElement("style");
  stil.textContent =
    "#oa-dugme{position:fixed;right:18px;bottom:18px;z-index:2147483646;width:56px;height:56px;border-radius:50%;" +
    "border:0;background:#2f6fed;color:#fff;font:600 15px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer}" +
    "#oa-pencere{position:fixed;right:18px;bottom:86px;z-index:2147483646;width:400px;height:600px;max-width:calc(100vw - 24px);" +
    "max-height:calc(100vh - 110px);border:1px solid #d0d5dd;border-radius:14px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.25);" +
    "background:#fff;display:none}" +
    "#oa-pencere.acik{display:block}#oa-pencere iframe{width:100%;height:100%;border:0}" +
    "@media (max-width:520px){#oa-pencere{right:8px;left:8px;width:auto;bottom:80px}}";
  document.head.appendChild(stil);

  var dugme = document.createElement("button");
  dugme.id = "oa-dugme";
  dugme.type = "button";
  dugme.title = "Offline Agent";
  dugme.textContent = "AI";
  var pencere = document.createElement("div");
  pencere.id = "oa-pencere";

  dugme.onclick = function () {
    if (!pencere.firstChild) {
      var cerceve = document.createElement("iframe");
      cerceve.src = KOK + "/?gomulu=1";
      cerceve.allow = "microphone; clipboard-write";
      cerceve.title = "Offline Agent";
      pencere.appendChild(cerceve);
    }
    var acik = pencere.classList.toggle("acik");
    dugme.textContent = acik ? "✕" : "AI";
  };
  document.body.appendChild(pencere);
  document.body.appendChild(dugme);
})();
