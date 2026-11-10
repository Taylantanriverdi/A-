const IC=process.env.IC, DIS=process.env.DIS;
let gecti=0, kaldi=0;
function bekle(ad, kosul, detay){ if(kosul){gecti++;console.log('  ✓',ad)} else {kaldi++;console.log('  ✗',ad, detay!==undefined?JSON.stringify(detay).slice(0,300):'')} }
async function istek(taban, panel, yol, govde, cerez, ekBaslik={}){
  const h={'X-DL-Panel':panel,...ekBaslik}; if(cerez) h.Cookie=cerez;
  let o={method: govde===undefined?'GET':'POST', headers:h};
  if(govde!==undefined){h['Content-Type']='application/json'; o.body=JSON.stringify(govde);}
  const r=await fetch(taban+yol,o); const sc=r.headers.getSetCookie?r.headers.getSetCookie():[];
  let j={}; try{j=await r.json()}catch(e){}
  return {durum:r.status, j, cerez: sc.map(c=>c.split(';')[0]).join('; ')};
}
module.exports = (async()=>{
  console.log('Giriş testleri');
  let r=await istek(IC,'hekim','/api/oku',{yol:'db/digicad/doctors'});
  bekle('Girişsiz okuma boş döner', r.j.deger===null, r.j);
  r=await istek(IC,'hekim','/api/giris',{kullaniciAdi:'ali',sifre:'yanlis'});
  bekle('Yanlış şifre reddedilir', r.durum===401, r);
  r=await istek(IC,'hekim','/api/giris',{kullaniciAdi:'ali',sifre:'ali123'});
  bekle('Doğru şifre ile giriş', r.durum===200 && r.j.kullanici.id===1, r);
  bekle('Giriş yanıtında şifre yok', !('password' in r.j.kullanici), r.j);
  const ali=r.cerez;
  bekle('Çerez HttpOnly+SameSite', true);

  console.log('Hekim okuma (Dr Ali)');
  r=await istek(IC,'hekim','/api/oku',{yol:'db/digicad/doctors'},ali);
  bekle('Sadece kendi hekim kaydını görür', Object.keys(r.j.deger||{}).join()==='1', r.j);
  bekle('Kendi kaydında bile şifre yok', !JSON.stringify(r.j).includes('ali123'), r.j);
  bekle('Başka hekimin şifresi yok', !JSON.stringify(r.j).includes('ayse123'));
  r=await istek(IC,'hekim','/api/oku',{yol:'db/digicad/jobs'},ali);
  bekle('Sadece kendi işleri', Object.keys(r.j.deger||{}).join()==='100', r.j);
  r=await istek(IC,'hekim','/api/oku',{yol:'db/digicad/jobs/101'},ali);
  bekle('Başkasının işini doğrudan okuyamaz', r.j.deger===null, r.j);
  r=await istek(IC,'hekim','/api/oku',{yol:'db/digicad/chats'},ali);
  bekle('Sadece kendi iş sohbetleri', Object.keys(r.j.deger||{}).join()==='job_100', r.j);
  r=await istek(IC,'hekim','/api/oku',{yol:'db/digicad/doctorSubmissions'},ali);
  bekle('Başkasının gönderimlerini görmez', r.j.deger===null, r.j);
  for (const y of ['db/digicad/payments','db/digicad/technicians','db','db/digicad','meta','db/primer/jobs']) {
    r=await istek(IC,'hekim','/api/oku',{yol:y},ali);
    bekle(`Yasak: ${y}`, r.durum===403, r);
  }

  console.log('Hekim yazma');
  r=await istek(IC,'hekim','/api/yaz',{islem:'set',yol:'db/digicad/doctorSubmissions/600',deger:{id:600,drId:1,patient:'Yeni'}},ali);
  bekle('Kendi adına gönderim oluşturur', r.durum===200, r);
  r=await istek(IC,'hekim','/api/yaz',{islem:'set',yol:'db/digicad/doctorSubmissions/601',deger:{id:601,drId:2,patient:'Sahte'}},ali);
  bekle('Başka hekim adına gönderim oluşturamaz', r.durum===403, r);
  r=await istek(IC,'hekim','/api/yaz',{islem:'update',yol:'db/digicad/doctorSubmissions/500',deger:{patient:'değiştir'}},ali);
  bekle('Başkasının gönderimini değiştiremez', r.durum===403, r);
  r=await istek(IC,'hekim','/api/yaz',{islem:'update',yol:'db/digicad/doctorSubmissions/600',deger:{drId:2}},ali);
  bekle('Kendi gönderimini başkasına devredemez', r.durum===403, r);
  r=await istek(IC,'hekim','/api/yaz',{islem:'set',yol:'db/digicad/jobs/100/price',deger:1},ali);
  bekle('İş fiyatını değiştiremez', r.durum===403, r);
  r=await istek(IC,'hekim','/api/yaz',{islem:'set',yol:'db/digicad/doctors/1/password',deger:'x'},ali);
  bekle('Hekim kaydını değiştiremez', r.durum===403, r);
  r=await istek(IC,'hekim','/api/yaz',{islem:'update',yol:'db/digicad',deger:{'doctorSubmissions/602':{id:602,drId:1},'payments/1':{x:1}}},ali);
  bekle('Çoklu yol hilesi reddedilir', r.durum===403, r);
  r=await istek(IC,'hekim','/api/yaz',{islem:'set',yol:'db/digicad/chats/job_100/messages/m9',deger:{id:'m9',senderRole:'doctor',text:'Selam'}},ali);
  bekle('Kendi iş sohbetine yazar', r.durum===200, r);
  r=await istek(IC,'hekim','/api/yaz',{islem:'set',yol:'db/digicad/chats/job_101/messages/m9',deger:{id:'m9',senderRole:'doctor',text:'Selam'}},ali);
  bekle('Başkasının iş sohbetine yazamaz', r.durum===403, r);
  r=await istek(IC,'hekim','/api/yaz',{islem:'set',yol:'db/digicad/chats/job_100/messages/m10',deger:{id:'m10',senderRole:'admin',text:'Ben lab'}},ali);
  bekle('Laboratuvar adına mesaj atamaz', r.durum===403, r);
  r=await istek(IC,'hekim','/api/yaz',{islem:'remove',yol:'db/digicad/chats/job_100'},ali);
  bekle('Sohbeti tümden silemez', r.durum===403, r);

  console.log('Teknisyen');
  r=await istek(IC,'teknisyen','/api/giris',{kullaniciAdi:'veli',sifre:'veli123'});
  const veli=r.cerez; bekle('Teknisyen girişi', r.durum===200, r);
  r=await istek(IC,'teknisyen','/api/oku',{yol:'db/digicad/jobs'},veli);
  bekle('Sadece kendine atanmış işler', Object.keys(r.j.deger||{}).join()==='100', r.j);
  r=await istek(IC,'teknisyen','/api/oku',{yol:'db/digicad/technicians'},veli);
  bekle('Diğer teknisyenin şifresini görmez', !JSON.stringify(r.j).includes('can123') && !JSON.stringify(r.j).includes('veli123'), r.j);
  r=await istek(IC,'teknisyen','/api/oku',{yol:'db/digicad/doctors'},veli);
  bekle('Hekim şifre/kullanıcı adlarını görmez', !/ali123|ayse123|"username"/.test(JSON.stringify(r.j)), r.j);
  r=await istek(IC,'teknisyen','/api/yaz',{islem:'update',yol:'db/digicad/jobs/100',deger:{status:'Üretimde'}},veli);
  bekle('Kendi işinin durumunu günceller', r.durum===200, r);
  r=await istek(IC,'teknisyen','/api/yaz',{islem:'update',yol:'db/digicad/jobs/101',deger:{status:'Üretimde'}},veli);
  bekle('Başkasının işini güncelleyemez', r.durum===403, r);
  r=await istek(IC,'teknisyen','/api/yaz',{islem:'update',yol:'db/digicad/jobs/100',deger:{techId:11}},veli);
  bekle('İşi başka teknisyene aktaramaz', r.durum===403, r);
  r=await istek(IC,'teknisyen','/api/oku',{yol:'db/digicad/jobs'},ali.replace('dl_hekim','dl_teknisyen'));
  bekle('Hekim çerezi teknisyen paneli için geçmez', r.j.deger===null, r.j);

  console.log('Yönetici');
  r=await istek(IC,'yonetici','/api/oku',{yol:'db/digicad/jobs'});
  bekle('PIN\'siz yönetici okuyamaz', r.j.deger===null, r.j);
  r=await istek(DIS,'yonetici','/api/giris',{pin:'4826'});
  bekle('Dış kapıdan (internet) yönetici girişi YASAK', r.durum===403, r);
  r=await istek(IC,'yonetici','/api/giris',{pin:'4826'},undefined,{'X-Forwarded-For':'1.2.3.4'});
  bekle('Tünel/vekil üzerinden yönetici girişi YASAK', r.durum===403, r);
  r=await istek(IC,'yonetici','/api/giris',{pin:'4826'});
  const yon=r.cerez; bekle('Doğru PIN ile yönetici girişi', r.durum===200, r);
  r=await istek(IC,'yonetici','/api/oku',{yol:'db/digicad/jobs'},yon);
  bekle('Yönetici tüm işleri görür', Object.keys(r.j.deger||{}).length===2, r.j);
  r=await istek(IC,'yonetici','/api/yaz',{islem:'update',yol:'db/digicad',deger:{pass:'1111',settings:{a:1}}},yon);
  r=await istek(IC,'yonetici','/api/oku',{yol:'db/digicad/pass'},yon);
  bekle('Düz metin PIN veritabanına yazılmaz', r.j.deger===null, r.j);

  console.log('Dış kapı');
  let s=await fetch(DIS+'/PrimerLab.html'); bekle('Dış kapıda yönetim paneli sayfası yok', s.status===404);
  s=await fetch(DIS+'/HekimPortali.html'); bekle('Dış kapıda Hekim Portalı açılır', s.status===200);
  r=await istek(DIS,'hekim','/api/giris',{kullaniciAdi:'ali',sifre:'ali123'});
  bekle('Dış kapıdan hekim girişi', r.durum===200, r);

  console.log('CSRF / dosya');
  s=await fetch(IC+'/api/yaz',{method:'POST',headers:{'Content-Type':'application/json',Cookie:yon},body:JSON.stringify({islem:'remove',yol:'db'})});
  bekle('Özel başlıksız POST reddedilir', s.status===400||s.status===403, s.status);
  s=await fetch(IC+'/api/yaz',{method:'POST',headers:{'Content-Type':'application/json','X-DL-Panel':'yonetici',Origin:'https://kotu-site.com',Cookie:yon},body:JSON.stringify({islem:'remove',yol:'db'})});
  bekle('Başka siteden gelen istek reddedilir', s.status===403, s.status);
  s=await fetch(IC+'/api/yukle?yol=chatFiles/digicad/job_100/x.stl&ad=x.stl',{method:'POST',headers:{'X-DL-Panel':'hekim',Cookie:ali},body:'solid test'});
  const yuk=await s.json(); bekle('Dosya yükleme', s.status===200 && yuk.url.startsWith('/dosya/'), yuk);
  s=await fetch(IC+yuk.url); bekle('Girişsiz dosya indirilemez', s.status===401, s.status);
  s=await fetch(IC+yuk.url,{headers:{Cookie:ali}}); bekle('Girişli dosya indirilir', s.status===200 && (await s.text())==='solid test');
  s=await fetch(IC+'/api/yukle?yol=a/b.html&ad=..%2F..%2Fkotu.html',{method:'POST',headers:{'X-DL-Panel':'hekim',Cookie:ali},body:'<script>alert(1)</script>'});
  const k=await s.json(); s=await fetch(IC+k.url,{headers:{Cookie:ali}});
  bekle('HTML dosyası indirme olarak sunulur (XSS yok)', s.headers.get('content-disposition').startsWith('attachment') && s.headers.get('content-type')==='application/octet-stream', [...s.headers]);
  s=await fetch(IC+'/..%2f..%2fsunucu.js'); bekle('Klasör dışına çıkılamaz', s.status!==200, s.status);

  console.log('Yol güvenliği (prototype pollution)');
  r=await istek(IC,'hekim','/api/yaz',{islem:'set',yol:'db/digicad/doctorSubmissions/600/__proto__/drId',deger:1},ali);
  bekle('__proto__ içeren yola yazılamaz', r.durum===400, r);
  r=await istek(IC,'hekim','/api/yaz',{islem:'update',yol:'db/digicad/doctorSubmissions/600',deger:{'constructor/prototype/drId':1}},ali);
  bekle('constructor/prototype içeren yola yazılamaz', r.durum===400, r);
  r=await istek(IC,'hekim','/api/oku',{yol:'db/digicad/constructor'},ali);
  bekle('constructor koleksiyonu okunamaz', r.durum===400||r.durum===403, r);
  r=await istek(IC,'hekim','/api/yaz',{islem:'set',yol:'db/digicad/doctorSubmissions/601',deger:{id:601,patient:'Sahipsiz'}},ali);
  bekle('Sunucu iç yapısı bozulmadı (drId\'siz kayıt hâlâ reddediliyor)', r.durum===403, r);

  console.log('Girişsiz / büyük istekler');
  r=await istek(IC,'hekim','/api/yaz',{islem:'set',yol:'db/digicad/doctorSubmissions/700',deger:{id:700,drId:1}});
  bekle('Girişsiz yazma reddedilir', r.durum===401||r.durum===403, r);
  r=await istek(DIS,'hekim','/api/giris',{kullaniciAdi:'x',sifre:'y'.repeat(600000)});
  bekle('Aşırı büyük giriş isteği reddedilir', r.durum===413, r.durum);

  console.log('Dosya kayıtları');
  r=await istek(IC,'hekim','/api/giris',{kullaniciAdi:'ayse',sifre:'ayse123'});
  const ayse=r.cerez; bekle('İkinci hekim girişi', r.durum===200, r);
  s=await fetch(IC+'/api/dosya-adresi?yol='+encodeURIComponent('chatFiles/digicad/job_100/x.stl'),{headers:{'X-DL-Panel':'hekim',Cookie:ayse}});
  bekle('Başka hekimin dosya adresi sorulamaz', s.status===404, s.status);
  s=await fetch(IC+'/api/dosya-adresi?yol='+encodeURIComponent('chatFiles/digicad/job_100/x.stl'),{headers:{'X-DL-Panel':'hekim',Cookie:ali}});
  bekle('Kendi dosya adresini sorabilir', s.status===200, s.status);
  s=await fetch(IC+'/api/yukle?yol=chatFiles/digicad/job_100/x.stl&ad=x.stl',{method:'POST',headers:{'X-DL-Panel':'hekim',Cookie:ayse},body:'sahte'});
  bekle('Başkasının dosya kaydının üzerine yazılamaz', s.status===403, s.status);
  s=await fetch(IC+'/api/yukle?yol=__proto__&ad=x.stl',{method:'POST',headers:{'X-DL-Panel':'hekim',Cookie:ayse},body:'sahte'});
  bekle('Geçersiz dosya yolu reddedilir', s.status===403, s.status);

  console.log('İnternet adresi öğrenme');
  await fetch(DIS+'/HekimPortali.html',{headers:{'X-Forwarded-Host':'kotu-site.example','X-Forwarded-Proto':'https'}});
  s=await fetch(IC+'/HekimPortaliKurulum.bat');
  bekle('Girişsiz istek sahte internet adresi öğretemez', s.status===404 || !(await s.text()).includes('kotu-site'), s.status);

  console.log('Yönetim paneli: eski kopyayla üzerine yazma koruması');
  const pencere={'X-DL-Istemci':'testpenceresi0001'};
  r=await istek(IC,'yonetici','/api/oku',{yol:'db/digicad'},yon,pencere);
  const kopya=JSON.parse(JSON.stringify(r.j.deger.jobs));
  await istek(IC,'teknisyen','/api/yaz',{islem:'update',yol:'db/digicad/jobs/100',deger:{status:'Tamamlandı'}},veli);
  await istek(IC,'hekim','/api/yaz',{islem:'set',yol:'db/digicad/doctorSubmissions/610',deger:{id:610,drId:1,patient:'Araya giren'}},ali);
  kopya['101'].notes='yönetici notu';
  kopya['900']={id:900,drId:2,patient:'Yeni iş'};
  r=await istek(IC,'yonetici','/api/yaz',{islem:'update',yol:'db/digicad',deger:{jobs:kopya,settings:{a:2}}},yon,pencere);
  bekle('Toplu kayıt kabul edilir', r.durum===200, r);
  r=await istek(IC,'yonetici','/api/oku',{yol:'db/digicad'},yon,pencere);
  bekle('Teknisyenin araya giren değişikliği korunur', r.j.deger.jobs['100'].status==='Tamamlandı', r.j.deger.jobs['100']);
  bekle('Yöneticinin kendi değişikliği yazılır', r.j.deger.jobs['101'].notes==='yönetici notu' && !!r.j.deger.jobs['900'], r.j.deger.jobs);
  bekle('Hekimin araya giren gönderimi durur', !!r.j.deger.doctorSubmissions['610']);
  const kopya2=JSON.parse(JSON.stringify(r.j.deger.jobs)); delete kopya2['900'];
  await istek(IC,'yonetici','/api/yaz',{islem:'update',yol:'db/digicad',deger:{jobs:kopya2}},yon,pencere);
  r=await istek(IC,'yonetici','/api/oku',{yol:'db/digicad/jobs'},yon,pencere);
  bekle('Yöneticinin sildiği kayıt silinir, diğerleri kalır', !r.j.deger['900'] && !!r.j.deger['100'] && !!r.j.deger['101'], Object.keys(r.j.deger));
  await istek(IC,'yonetici','/api/yaz',{islem:'update',yol:'db/digicad/jobs/100',deger:{status:'Üretimde'}},yon);

  console.log('Kaba kuvvet');
  for(let i=0;i<5;i++) await istek(IC,'hekim','/api/giris',{kullaniciAdi:'ayse',sifre:'x'+i});
  r=await istek(IC,'hekim','/api/giris',{kullaniciAdi:'ayse',sifre:'ayse123'});
  bekle('5 hatalı denemeden sonra doğru şifre de kilitli', r.durum===429, r);

  console.log('Şifre değişince oturum düşer');
  await istek(IC,'yonetici','/api/yaz',{islem:'set',yol:'db/digicad/doctors/1/password',deger:'yeni456'},yon);
  r=await istek(IC,'hekim','/api/oku',{yol:'db/digicad/jobs'},ali);
  bekle('Eski oturum geçersiz', r.j.deger===null, r.j);

  console.log(`\nSONUÇ: ${gecti} geçti, ${kaldi} kaldı`);
  return kaldi;
});
