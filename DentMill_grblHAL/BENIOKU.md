# DentMill X5 – EdingCNC → grblHAL dönüşümü

Kaynak: `cnc.ini` (CNC V4.03.54, CPU5B--6D 1.11LU) ve `macro.cnc` (PrimerMill sürümü, 15.528 bayt).

## Klasör

| Dosya | Ne yapar | Eding karşılığı |
|---|---|---|
| `grblHAL_ayarlar.txt` | `$` ayarları, ioSender konsoluna satır satır gönderilir | `cnc.ini` |
| `sd_kart/tc.macro` | Her `M6`'da çalışan takım değişimi (otomatik + manuel) | `change_tool`, `DropTool0-6`, `PickTool0-6`, `manual_change` |
| `sd_kart/P100.macro` | **Kalibrasyon değerleri** (yuva, sensör, mod) | `#4000–#4033`, `#4901–#4902` |
| `sd_kart/P101.macro` | `$H` öncesi güvenli park | `pm_home_guvenli` |
| `sd_kart/P102.macro` | `$H` sonrası çıkış hareketi + `G30` | `home_all` ikinci yarısı |
| `sd_kart/P103.macro` | Sensörle Z sıfırlama | `user_1` |
| `sd_kart/P104.macro` | Pens boş mu kontrolü | `is_empty_tool` |
| `sd_kart/P105.macro` | Takım boyu / aşınma kontrolü | `m100` |
| `sd_kart/P106.macro` | Pensi aç, takımı T0 say | `pm_pens_t0` |
| `sd_kart/P107.macro` | Parçadan uzaklaş | `ClearPos` |
| `sd_kart/P108.macro` | Z güvenli | `z_safe` |
| `sd_kart/P109.macro` | Z+A güvenli, sensör üstü | `azxy_safe` |
| `sd_kart/P110.macro` | Program başında pens boş olmalı | `check_empty_tool` |
| `sd_kart/P111.macro` | Parça merkezi bulma | `user_6` |
| `sd_kart/P112.macro` / `P113.macro` | Pens aç / kapat | `user_4` / `user_5` |
| `sd_kart/P114.macro` | Hava basıncı bekle | `check_pressure` |
| `sd_kart/P115.macro` | Takım no → yuva Y (yardımcı) | — |
| `donusturucu/eding2grblhal.py` | DentMill `.nc` dosyalarını çevirir | — |
| `donusturucu/cevir.bat` | Sürükle-bırak ile çevirme (Windows) | — |

`sd_kart/` içindekiler SD kartın **kök dizinine** (veya littlefs varsa `/littlefs/`) kopyalanır. Çağırma: `G65 P105` gibi.

## Kurulum sırası

1. Firmware'i grblHAL olarak, **5 eksen**, *SD kart* ve *expressions / flow control* açık şekilde derleyin.
2. `grblHAL_ayarlar.txt` satırlarını gönderin. Ardından aşağıdaki **"ölçerek belirlenecek"** ayarları düzeltin.
3. `sd_kart/` içeriğini SD karta kopyalayın.
4. `P100.macro` içindeki değerleri **yeniden ölçerek** doldurun (aşağıya bakın).
5. Test sırasını uygulayın.

## Ayarların kaynağı

| Ayar | Değer | `cnc.ini` kaynağı |
|---|---|---|
| `$100–$104` | 1000, 1000, 1000, 1388.8889, 277.7378 | `resolution` |
| `$110–$114` | 3600 mm/dk (°/dk) | `maxVelocity = 60` mm/s × 60 |
| `$120–$124` | 800 mm/s² | `maxAcceleration` |
| `$130–$133` | 129, 105, 69, 46 | `negativeLimit` (home tarafındaki küçük paylar bilerek dışarıda bırakıldı, güvenli taraf) |
| `$134` | 0 | B ±3600° sürekli döner. 0 değeri B'yi soft limitten çıkarır |
| `$22` | 15 | home açık + tek eksen home + açılışta home zorunlu (`mandatoryHoming=1`) + home noktası = 0 (`homePosition=0`) |
| `$23` | 24 | A ve B negatif yöne home (`homeVelocity` negatif), XYZ pozitif yöne |
| `$24` / `$25` | 90 / 600 mm/dk | `homeVelocitySlow` 1.5 mm/s; `homeVelocity` A/B için 10 °/s (en yavaşı alındı) |
| `$44–$48` | 4, 1, 2, 8, 16 | `home_all` sırası Z → X → Y → A → B |
| `$30` / `$31` / `$33` | 42000 / 100 / 5000 | `spindleNmax`, `spindleNmin`, `pwmFrequency` |
| `$16` | 4 | `invertPwm1Out = 1` → PWM ters (**ölçün**) |
| `$4` | 31 | `invertAmpEnableOut = 1` (**ölçün**) |
| `$1` | 255 | Motorlar sürekli enerjili (döner eksenler konumunu korusun) |
| `$21` | 0 | `endOfStrokeInputSenseLevel = 0` → ayrı limit switch yok |
| `$341` | 0 | `tc.macro` kullanılır |

**Ölçerek belirlenecek ayarlar** (Eding'den kopyalanmaz, çünkü arayüz kartı polariteyi değiştirir): `$2` step, `$3` yön, `$4` enable, `$5` home switch'leri, `$6` prob, `$14` kontrol girişleri / E-stop, `$16` spindle, aux giriş ters çevirme (Eding'de tüm AUX girişleri ters: `invertAux*In = 1`).

## I/O eşlemesi

| grblHAL | İşlev | Eding |
|---|---|---|
| `M64/M65 P0` | Pens aç / kapat | `M54/M55 P2` (AUX2 OUT "OpenClamp2") |
| `M64/M65 P1` | Hava üfleme | `M54/M55 P4` (AUX4 OUT "Blowing4") |
| `M66 P0` | Hava basıncı girişi | `M56 P1` (AUX1 IN "ClampAir1") |
| Prob girişi | Takım boyu sensörü | prob girişi + `M56 P61` hasar kontrolü |

Port numaraları NUCLEO pin haritasına (board map) göre kesinleşecek. Değişirse yalnızca bu satırlar düzeltilir.

## Değişken eşlemesi

| Eding | grblHAL | Not |
|---|---|---|
| `#5008` mevcut takım | `#<_current_tool>` / `#5400` | **kalıcı değil**, açılışta 0 |
| `#5011` yeni takım | `#<_selected_tool>` | |
| `#5015` değişim başarılı | — | makro hatasız biterse başarılı sayılır |
| `#5063` prob Z | `#5063` | aynı |
| `#5067` prob tetiklendi | `#5070` (G38.3 ile) | |
| `#5399` M56 sonucu | `#5399` (M66 sonucu, zaman aşımında -1) | |
| `#5161–5166` G28, `#5181–5186` G30 | aynı numaralar | kalıcı, ama **yeniden öğretilmeli** |
| `#5221–5226` G54 | aynı numaralar | kalıcı |
| `#4000–#4999` (kalıcı) | `#4000–#4999` (**kalıcı değil**) | değerler `P100.macro` dosyasında tutulur |
| `#5380` / `#5397` simülasyon | — | kaldırıldı |
| `msg` / `warnmsg` | `(print, …)` | |
| `errmsg` | `(abort, …)` | programı durdurur |
| `m6t[...]` makro içinde | `M61 Q…` veya gerek yok | |
| `dlgmsg` (`user_3`) | — | değerler `P100.macro`'da düzenlenir |
| `TCAGuard`, `ZHC`, `G64 P D` | — | grblHAL'de yok |

## Davranış farkları (bilerek yapıldı)

- **Prob tetiklenmezse iş durur.** Eding'deki `user_1` yalnızca uyarı verip yanlış bir `G92` değeri atıyordu.
- **Prob hasar kontrolü:** grblHAL, prob zaten tetikliyken `G38` komutunu ALARM 4 ile reddeder. `M56 P61` kontrolü bununla karşılanır.
- **G53 ile G38 kullanılmaz.** Ölçüm göreceli yapılır: `G91 G38.3 Z[#4004-#4003]`.
- **Soft limitler daraltıldı.** Eding, home anahtarının ötesine izin veriyordu (X +0.5, Y +1, Z +3.9, A -5.6°). grblHAL'de bu bölge kullanılmaz.

## Yeniden ölçülmesi gerekenler

Home davranışı ve soft limitler değiştiği için **bütün G53 konumları kayabilir**:

- `P100.macro`: yuva X/Y/A/B, alma/yaklaşma Z, sensör X/Y, ölçüm Z'leri, manuel değişim noktası, park noktası
- `G28.1` (güvenli Z: `#5163`, makrolarda her yerde kullanılır), `G30.1`, G54 A/B (`#5224/#5225`)
- Eski değerleri başlangıç tahmini olarak kullanmak için Eding açıkken PrimerMill'den veya `user_3` diyaloğundan not alın. Pakette `#4000`'li değerler **yok**: bu `cnc.ini` 24.10'dan eski bir kopya.

## CAM programları (DentMill) – `donusturucu/`

Beş örnek dosya incelendi (toplam ~2,6 milyon satır). Hepsi aynı yapıda: yalnızca `G0`/`G1` ile X Y Z A B F, yay (G2/G3) yok. Eding'e özgü yalnızca şu satırlar var:

| Eding | grblHAL | Not |
|---|---|---|
| `GOSUB CHECK_EMPTY_TOOL` | `G65 P110` | program başı |
| `GOSUB Z_SAFE` | `G65 P108` | |
| `GOSUB AZXY_SAFE` | `G65 P109` | |
| `M100` | `G65 P105` | takım aşınma kontrolü |
| `M101` | kaldırılır | Eding'de yalnızca mesaj basıyordu |
| `%` | kaldırılır | |
| `M3` | `M3` + `G4 P1` | Eding'de 1 sn spindle rampası vardı (`spindleRampUpTime`), grblHAL beklemez |

**Kullanım** (Windows'ta Python 3 kurulu olmalı): `.nc` dosyalarını `cevir.bat` üzerine sürükleyip bırakın veya:

```
python eding2grblhal.py parca.nc
```

Çıktı aynı klasöre `parca_grblhal.nc` adıyla yazılır. **Güvenlik:** Tanınmayan bir G/M kodu veya `GOSUB` görülürse satır numarasıyla hata verilir ve o dosyanın çıktısı **hiç yazılmaz**. Böylece yarım çevrilmiş bir program makineye gidemez.

**Doğrulama:** Beş örnek dosyanın hepsi hatasız çevrildi. Değiştirilen satırlar dışında kalan her satır orijinalle birebir aynı (md5 karşılaştırması).

Örneklerdeki eksen aralıkları (iş koordinatı): A −14.6…+15.3°, B 0…191.2°, X ±46, Y ±47, Z −14.1…+17.1 mm, F 400–2500, S 22.000–28.000. `M7` (sis soğutma) kullanılıyor, board map'te bir sis/hava çıkışı tanımlanmalı.

## Açık konular

1. **`home_all` içindeki `M81` / `M80`:** Muhtemelen sürücü enable kapat/aç işlemi, ardından B tekrar home yapılıyor. Doğrulanana kadar `P102`'den sonra elle `$HB` gönderin.
2. **`ClearPos` (`P107`):** `#5004` A ekseni konumu varsayıldı (`#5423`). Ayrıca `G54 A-25`, yeni A aralığının (makine 0…46°) dışına düşebilir. Örnek programlarda kullanılmıyor, kullanmadan önce doğrulayın.
3. **Makro içinde `M0` ve iç içe `G65`:** grblHAL belgelerinde kesin bir kural yok. İlk testte kesici takmadan deneyin.
4. **`M66` satır biçimi** (`P0 L0`, `P0 L3 Q300`) LinuxCNC standardına göre yazıldı. Kullandığınız grblHAL sürümünde deneyin.
5. **Açılışta takım bilinmez:** Milde takım varsa `M61 Q<n>` ile bildirin veya `P106` ile pensi boşaltın.

## Test sırası

1. Motor bağlamadan: lojik analizörle step, yön ve enable sinyallerini ölçün. `$2/$3/$4` ayarlarını düzeltin.
2. Girişler: `?` durum raporunda home switch'leri, prob, hava basıncı ve E-stop sinyallerini elle tetikleyip izleyin.
3. Eksenleri tek tek, düşük hızla jog edin. `$100–$104` değerlerini komparatörle doğrulayın (10 mm komut = 10 mm hareket).
4. `$H`, ardından `P102`. `G28.1`/`G30.1` konumlarını öğretin.
5. `M64 P0`/`M65 P0` ve `M64 P1`/`M65 P1` komutlarını ve `P114`'ü havayla deneyin.
6. `P103`'ü önce düşük hızda (`F50`), elinizle sensöre dokunarak test edin.
7. `P100` değerlerini girin. `M6 T1`'i **kesici takmadan**, %10 hız override ile deneyin. Ardından tüm yuvaları ve `T0`'ı deneyin.
8. `#4030 = 1` ile manuel modu deneyin.
9. Son olarak gerçek bir işi, yumuşak bir malzemede çalıştırın.
