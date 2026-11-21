/** BASLA.html içeriği (tek dosya, dış kaynak yok). */
export function startPage(): string {
  return `<!doctype html>
<html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DigiCAD — Demo Başlangıç</title>
<style>
:root{--bg:#f6f7fb;--fg:#1b2030;--card:#fff;--line:#e3e6ef;--pri:#2457d6;--muted:#5c6477;--warn:#7a2e00}
@media (prefers-color-scheme:dark){:root{--bg:#12151c;--fg:#e8ebf3;--card:#1b2030;--line:#2c3347;--muted:#a3abc0;--pri:#6c93ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif}
main{max-width:820px;margin:0 auto;padding:28px 16px 60px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px}
.tag{display:inline-block;background:#ffd34d;color:#4a1b00;font-weight:700;padding:2px 10px;border-radius:6px;font-size:13px;letter-spacing:.5px}
.muted{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:6px}
.card h3{margin:0;font-size:17px}.card p{margin:0;color:var(--muted);font-size:14px;flex:1}
.card a{align-self:flex-start;margin-top:8px;background:var(--pri);color:#fff;text-decoration:none;padding:8px 14px;border-radius:8px;font-weight:600}
.box{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--warn);border-radius:8px;padding:12px 16px;margin-top:18px}
ul{padding-left:20px}li{margin:4px 0}
</style></head><body><main>
<span class="tag">DEMO</span>
<h1>DigiCAD Diş Laboratuvarı Yönetim Yazılımı</h1>
<p class="muted">Bu, programın <b>deneme sürümüdür</b>. Gerçek bir sunucuya bağlanmaz; ekrandaki tüm hekim, hasta, iş ve tutarlar <b>uydurmadır</b>. Bilgisayarınızda, internet olmadan çalışır.</p>
<div class="grid">
<div class="card"><h3>Yönetim Paneli</h3><p>Laboratuvar sahibinin ekranı: işler, hekimler, teknisyenler, kasa, giderler, aylık rapor, sohbet.</p><a href="DigiCAD-Demo-Admin.html">Aç</a></div>
<div class="card"><h3>Gelen İşler</h3><p>Hekimlerin gönderdiği işler ve sipariş formları (yönetici ekranı).</p><a href="DigiCAD-Demo-GelenIsler.html">Aç</a></div>
<div class="card"><h3>Hekim Portalı</h3><p>Bir hekimin gözünden: işlerini izler, yeni iş gönderir, laboratuvarla yazışır.</p><a href="DigiCAD-Demo-Hekim.html">Aç</a></div>
<div class="card"><h3>Teknisyen Paneli</h3><p>Bir teknisyenin gözünden: kendisine atanan işlerin durumunu günceller.</p><a href="DigiCAD-Demo-Teknisyen.html">Aç</a></div>
</div>
<h2>Denemek için öneriler</h2>
<ul>
<li><b>Yönetim:</b> soldaki menüde gezin; <i>Sipariş Formu</i>'ndan yeni iş oluşturun; <i>Devam Eden İşler</i>'de bir işin durumunu değiştirin; <i>Kasa / Arşiv</i>'te tahsilat ekleyin; <i>Mesajlar</i>'dan yazın.</li>
<li><b>Hekim:</b> <i>Yeni gönderim</i> ile bir iş gönderin; sonra <b>Gelen İşler</b>'e geçip orada görün.</li>
<li><b>Teknisyen:</b> bir işin durumunu açılır listeden değiştirin; Yönetim'de anında yansır.</li>
</ul>
<div class="box"><b>Bilmeniz gerekenler</b>
<ul>
<li>Sayfalar demo verisini tarayıcınızda ortak tutmaya çalışır; bu yüzden bir sayfada yaptığınız değişiklik diğerinde de görünebilir (tarayıcıya bağlıdır).</li>
<li>Üstteki turuncu şeritteki <b>Verileri sıfırla</b> düğmesi her şeyi ilk haline döndürür. <b>Çıkış</b> düğmesi sayfayı yeniler.</li>
<li>Hiçbir veri internete gönderilmez. Dosya yükleme/indirme taklit edilir (indirilen dosyalar örnek metin dosyasıdır). E-posta ve hesap açma işlemleri sahtedir.</li>
<li>Yazdır düğmeleri tarayıcının yazdırma penceresini açar.</li>
</ul></div>
</main></body></html>
`;
}
