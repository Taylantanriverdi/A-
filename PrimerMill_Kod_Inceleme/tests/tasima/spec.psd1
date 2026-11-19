@{
'Cekirdek.ps1' = @{
  Bas = @('# Cekirdek.ps1 - PrimerMill mantık çekirdeği: sayı biçimleme, G-kod üreticileri, kalibrasyon hesapları, ayar dosyaları.',
          '# Eding ve arayüz gerektirmez. Fonksiyonlar düzeltilmiş eski panelden (PrimerMill/KazimaBaslat.ps1) BİREBİR taşındı.',
          '# Bağımlılık: $ScriptKlasor (veri klasörü), $EdingKlasor, $IsKlasor önyüklemede (KazimaBaslat.ps1) tanımlanır.',
          '# PowerShell 5.1 (32 bit) uyumlu.', '')
  Oge = @('F:Sayi','F:Metin-Sayi','','F:Sure','','F:Sade-Sure','',
          'L:2532-2576','','F:Blok-Metin-Temizle','','L:2585-2585','F:Blok-Kazima-NC','','L:2669-2669','F:Blok-Sonraki-No','','F:Blok-Birlesik-Uret','','F:Blok-Kaydet','',
          'L:4974-4987','','F:Kal-Saat','','F:Kal-Duzen','','F:Kal-Nokta','','F:Kal-NC-Uret','',
          'L:5136-5150','',
          'L:5343-5376','','F:OtoKal-NC-Uret','','F:OkRot','','F:OkModel','','F:OkCoz','','F:OtoKal-Hesapla-Ic','','F:OtoKal-Sim-Uret','',
          'L:3042-3047','F:Devam-Oku','F:Devam-Sil','','F:Devam-NC-Uret','',
          'L:3977-3979','F:Tercih-Oku','F:Tercih-Yaz','','F:Yeni-Pin','',
          'L:4202-4205','',
          'L:4246-4256','','L:4276-4279','','L:4383-4384','','L:4433-4433','',
          'L:3942-3945','F:Yuva-Geometrisi-Oku','','F:Makro-AltProgramlari')
}
'Eding.ps1' = @{
  Bas = @('# Eding.ps1 - Eding CNC bağlantısı: durum okuma, bağlanma, bekçi, komut sonucu, hareket bekleme, makro sürümü,',
          '# Eding programını başlatma / gizleme / yeniden başlatma, Windows başlangıç kayıtları.',
          '# Fonksiyonlar düzeltilmiş eski panelden BİREBİR taşındı; değişenler tests/TASIMA_DEGISEN.txt içinde gerekçeli.',
          '# [Eding] sınıfı önyüklemede yüklenir: gerçek (lib/EdingApi.cs, cncapi.dll) ya da demo (lib/EdingSim.cs).',
          '# PowerShell 5.1 (32 bit) uyumlu.', '')
  Oge = @('L:1177-1179','','L:1290-1291','','F:Eding-Exe-Bul','','L:1315-1316','F:Eding-Pencere-Acik','F:Eding-Sunucu-Acik','','F:Eding-Temizle','',
          'L:1795-1795','F:Eding-Kapat-Nazik','','F:Eding-Gizle-Tik','','F:Eding-Baslat','','F:Acilis-Eding-Sifirla','',
          'F:Eding-Durum','F:Durakli-Mi','F:Mesgul','F:Hatali','F:Calisiyor-Mu','F:Is-Suruyor','F:Is-Suruyor-Uyari','','F:Hata-Temizle','',
          'L:1911-1914','F:Baglanti-Bekcisi','','F:Rc-Tamam','','F:Baglan','','F:Komut-Sonucu','','F:Hareket-Bitene-Kadar-Bekle','',
          'L:2236-2242','F:Makro-Surum-Oku','F:Bayrak-Sifirla','F:Makro-Baslangic-Kontrol','F:Makro-Hazir-Mi','',
          'F:Macro-Pens-Yamasi','F:Macro-Yaz','','F:Eding-Goster','F:Eding-Gizle','F:Eding-Yeniden','',
          'L:6364-6364','F:Windows-Baslangic-Ayarla','','F:Eding-Baslangic-Kaldir')
}
'Makine.ps1' = @{
  Bas = @('# Makine.ps1 - iş akışı (dosya seç, kontrol, BAŞLAT/DEVAM/DURAKLAT/DURDUR, kaldığı yerden devam, yeni blok), takım değişimi',
          '# (otomatik / manuel, takım bildirimi, belirsiz takım), HOME, açılış hazırlığı, ACİL STOP, RESET, pens, MDI, temizlik/park,',
          '# jog ve hazır konumlar, iş mili/hava, G54/#4000-#4006 okuma/yazma, yedek alma/yükleme, yuva/sensör kayıtları, ilerleme takibi.',
          '# Fonksiyonlar düzeltilmiş eski panelden taşındı; arayüze yalnız kapı fonksiyonlarıyla (Ui-*, Yaz) ulaşılır.',
          '# Değişen fonksiyonlar ve gerekçeleri: tests/TASIMA_DEGISEN.txt. PowerShell 5.1 (32 bit) uyumlu.', '')
  Oge = @('L:2005-2012','','F:Dosyayi-Kontrol-Et','','F:Hazir-Mi','','F:Btn-DosyaSec','','F:Dosya-Ozeti','',
          'L:2142-2148','','F:Frez-Manuel-Mi','','F:Otomatik-Gecis-Uygun-Mu','F:Frez-Modu-Yaz','','F:Frez-Modu-Sor','','F:Manuel-Macro-Kontrol','','F:Takim-Bildir','',
          'L:2342-2345','F:Takim-Komutu-Mu','F:Takim-Degisimi-Suruyor-Mu','F:Takim-Belirsiz-Isaretle','F:Takim-Belirsiz-Coz','F:Takim-Kapisi','',
          'F:Manuel-Istek','','F:Manuel-Istek-Tahmin','','F:Manuel-Devam','','F:Manuel-Diyalog','','L:2494-2495','F:Manuel-Izle','',
          'L:2776-2779','F:Yeni-Blok','',
          'F:Devam-Kaydet','','F:Devam-Diyalog','','F:Devam-Baslat','','F:Devam-Acilis','','F:Is-Calistir','','F:Bos-Ismili-Hazirla','',
          'L:3248-3249','F:Btn-Baslat','F:Btn-Baslat-Ic','','F:Btn-Duraklat','','F:Btn-Durdur','','F:Btn-FrezBirak','','F:Btn-Home','',
          'L:3440-3442','F:Hiz-Oku','F:Hiz-Ayarla','','L:3469-3472','','F:Geri-Sayim','','F:Acilis-Hazirla','','F:Panel-Sifirla','',
          'F:Acil-Stop','','F:Acil-Stop-Kaldir','','F:Btn-Reset','','L:3655-3655','F:Btn-Pens','','F:Mdi-Gonder','','L:3680-3680','F:Btn-Temizlik','',
          'L:3930-3932','','F:Hazir-Hareket','','F:Satirlar-Gonder','','F:Jog','','F:Konuma-Git','','F:Yuvaya-Git','','F:Yuvaya-Yaklas','','F:Yukari-Kaldir','',
          'F:Takim-Degistir','','F:Takim-Olc','','F:Asinma-Kontrol','','F:Bos-Mu','','F:Ismili-Calistir','','F:Hava-Ufle','','F:Ismili-Durdur-Bekle','','F:Pens-Ac-T0','','F:Tek-Komut','',
          'L:4206-4207','','F:Ayar-Oku','','F:Ayar-Kaydet','','L:4257-4258','','F:Degisken-Yaz','','F:Raf-Metni','','F:Raf-Eksik-Listesi','F:Raf-Kontrol','L:4292-4292','F:Raf-Hazir-Mi','',
          'F:Konumu-Sensor-Yap','','F:Konumu-Yuva-Yap','','F:Z-Alma-Yap','','F:G54-Uretici-Fark','','F:G54-Ureticiye-Don','','F:G92-Sifirla','','F:Ayar-Yedekle','','F:Ayar-Geri-Yukle','',
          'F:Ilerleme-Guncelle','','L:6234-6239')
}
'Kalibrasyon.ps1' = @{
  Bas = @('# Kalibrasyon.ps1 - yuva ayarı sihirbazı (frez alma kalibrasyonu), disk kalibrasyonu, otomatik kalibrasyon (prob testi dahil).',
          '# Fonksiyonlar düzeltilmiş eski panelden taşındı; metin kutusu / etiket yerine durum değişkenleri ($script:...) kullanılır,',
          '# görünüm bunları MakineDurumu ile çizer (lib/Denetleyici.ps1 Durum-Topla). Değişenler: tests/TASIMA_DEGISEN.txt.',
          '# PowerShell 5.1 (32 bit) uyumlu.', '')
  Oge = @('L:4689-4693','','F:Yuva-Kayitli','','F:Yuva-Hedef','','F:Yuva-Liste-Yenile','','F:Yuva-Git','','F:Yuva-Yaklas','','F:Yuva-Al','','F:Yuva-Kaydet','','F:Yuva-Sifirla','','F:Yuva-Varsayilan','','F:Yuva-Test','',
          'F:Kal-Degerleri-Goster','','F:Kal-Test-Hazirla','','F:Kal-Hesapla','','F:Kal-Uygula','','F:Kal-Yerlesim-Yaz','',
          'F:OtoKal-Goster','','L:5658-5659','','F:OtoKal-Prob-Testi','','L:5691-5692','F:OtoKal-Prob-Gecerli-Mi','F:OtoKal-Prob-Aktif-Mi','','F:OtoKal-Hazirla','','F:OtoKal-Oku','','F:OtoKal-Uygula')
}
'Uzak.ps1' = @{
  Bas = @('# Uzak.ps1 - uzaktan erişim: web sunucusunu başlatma, uzaktan komutlar (sec, baslat, duraklat, durdur, blok, blokiptal),',
          '# durum JSON. Komutlar panelin UI iş parçacığında, ana zamanlayıcıdan (Uzak-Tik) çalışır. Fonksiyonlar düzeltilmiş eski',
          '# panelden taşındı; değişenler: tests/TASIMA_DEGISEN.txt. PowerShell 5.1 (32 bit) uyumlu.', '')
  Oge = @('L:2901-2902','F:Uzak-Engel','F:Uzak-Is-Sec','F:Uzak-Komut','F:Uzak-Durum','L:3006-3006','','F:Uzak-Baslat','F:Uzak-Etiket-Guncelle')
}
'Kapi.ps1' = @{
  Bas = @('# Kapi.ps1 - mantık tarafındaki arayüz kapısı yardımcıları: Yaz (günlük + mesaj geçmişi), Onay, Ui-Kutu (eski mesaj kutusu',
          '# anlamını Ui-Onay / Ui-Bilgi / Ui-Hata / Ui-Secim kapılarına çevirir), Durum-Yaz, Hatalari-Kaydet, Klasor-Ac.',
          '# Kapının kendisi (Ui-*) kabukta lib/ArayuzKapisi.ps1 ile, testlerde sahte fonksiyonlarla gerçeklenir.',
          '# PowerShell 5.1 (32 bit) uyumlu.', '')
  Oge = @('L:1161-1161','F:Hatalari-Kaydet','','L:2014-2014','F:Yaz','','F:Onay','','L:6103-6103','F:Durum-Yaz','','F:Klasor-Ac')
}
}
