# EdingSim_Testi.ps1 - lib/EdingSim.cs (demo modu için sahte Eding API) testi.
#  1) Sahte sınıfın genel üyeleri, KazimaBaslat.ps1 içindeki gerçek [Eding] sınıfıyla aynı mı (yansıma ile)
#  2) Durum makinesi, MDI, hareket, takım, iş mili, iş yürütme, duraklat/devam/iptal, acil stop
#  3) Panelin durum yorumlayan fonksiyonları (Eding-Durum, Mesgul, Hatali, Rc-Tamam) simülasyonla
# Çalıştırma: pwsh -NoProfile -File tests/EdingSim_Testi.ps1 [-Kaynak <PrimerMill klasörü|KazimaBaslat.ps1>] [-Sim <EdingSim.cs>]
# PS 5.1 uyumlu. Çıkış kodu = başarısız sayısı.
param([string]$Kaynak = '', [string]$Sim = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_Ortak.ps1')
if (-not $Kaynak) { $Kaynak = Varsayilan-Kaynak }
if (-not $Sim) {
    $Sim = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, '..', 'lib', 'EdingSim.cs'))
    if (-not (Test-Path -LiteralPath $Sim)) {
        # teslim yapısı: <kök>/PrimerMill/lib/EdingSim.cs
        $alt = [System.IO.Path]::Combine($Kaynak, 'lib', 'EdingSim.cs'); if (Test-Path -LiteralPath $alt) { $Sim = $alt }
    }
}
Write-Host "Kaynak: $Kaynak"
Write-Host "Sim   : $Sim"

if (-not ('Eding' -as [type])) { Add-Type -Path $Sim }
$E = [Eding]
Dogru ($E.GetField('Demo') -ne $null -and [Eding]::Demo) 'Eding.Demo alanı var ve true'

# ------------------------------------------------------------------ 1) üye eşliği
Bolum 'Gerçek [Eding] sınıfıyla üye eşliği'
$gercekCs = $null
foreach ($d in (Kaynak-Dosyalari $Kaynak)) {
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($d, [ref]$null, [ref]$null)
    $s = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $n.Value -match 'public static class Eding\b' -and $n.Value -match 'DllImport\("cncapi' }, $true)
    foreach ($x in $s) { $gercekCs = $x.Value; break }
    if ($gercekCs) { break }
}
# teslim yapısı: gerçek sınıf lib/EdingApi.cs içinde (Add-Type -Path)
if (-not $gercekCs -and (Test-Path -LiteralPath $Kaynak -PathType Container)) {
    foreach ($cs in @(Get-ChildItem -LiteralPath $Kaynak -Filter '*.cs' -Recurse -File)) {
        $m = [System.IO.File]::ReadAllText($cs.FullName)
        if ($m -match 'public static class Eding\b' -and $m -match 'DllImport\("cncapi') { $gercekCs = $m; Bilgi "gerçek sınıf: $($cs.Name)"; break }
    }
}
if (-not $gercekCs) { Kaldi 'gerçek [Eding] Add-Type kaynağı bulunamadı' }
else {
    # Ad çakışmasın diye bir isim alanına sarılıp derlenir (DLL çağrılmaz, yalnız imzalar okunur)
    $using = ([regex]::Matches($gercekCs, '(?m)^\s*using [^;]+;') | ForEach-Object { $_.Value.Trim() }) -join "`n"
    $govde = [regex]::Replace($gercekCs, '(?m)^\s*using [^;]+;', '')
    if (-not ('PmGercek.Eding' -as [type])) { Add-Type -TypeDefinition ($using + "`nnamespace PmGercek {`n" + $govde + "`n}") }
    $imza = {
        param([type]$t)
        $l = @()
        $bf = [System.Reflection.BindingFlags]'Public,Static,DeclaredOnly'
        foreach ($m in $t.GetMethods($bf)) {
            $ps = ($m.GetParameters() | ForEach-Object { $_.ParameterType.Name }) -join ','
            $l += "M $($m.ReturnType.Name -replace '^Cart$','Cart') $($m.Name)($ps)"
        }
        foreach ($f in $t.GetFields($bf)) { $l += "F $($f.FieldType.Name) $($f.Name)" }
        return $l
    }
    $g = & $imza ([type]'PmGercek.Eding'); $sm = & $imza ([type]'Eding')
    $eksik = @($g | Where-Object { $sm -notcontains $_ })
    Dogru ($eksik.Count -eq 0) "gerçek sınıfın $($g.Count) genel üyesinin hepsi simülasyonda aynı imzayla var" ("eksik: " + ($eksik -join '; '))
    $fazla = @($sm | Where-Object { $g -notcontains $_ })
    Bilgi ("simülasyona özel üyeler: " + ($fazla -join '; '))
    $cg = ([type]'PmGercek.Cart').GetFields() | ForEach-Object { $_.Name }; $cs = ([type]'Cart').GetFields() | ForEach-Object { $_.Name }
    Esit (($cg) -join ',') (($cs) -join ',') 'Cart alanları aynı (X,Y,Z,A,B,C)'
    Dogru ([type]'Cart').IsValueType 'Cart bir struct'
}

# ------------------------------------------------------------------ yardımcılar
[Eding]::SimHizCarpani = 5.0      # simüle zaman 5 kat hızlı
[Eding]::SimSifirla()
function Durum { return [Eding]::StateText([Eding]::CncGetState()) }
function Bekle([scriptblock]$kosul, [double]$sn = 5) {
    $son = (Get-Date).AddSeconds($sn)
    while ((Get-Date) -lt $son) { if (& $kosul) { return $true }; Start-Sleep -Milliseconds 15 }
    return (& $kosul)
}
function Hazir-Bekle { return (Bekle { (Durum) -eq 'READY' } 8) }
function Mdi([string]$l) { return [Eding]::CncRunSingleLine($l) }

# ------------------------------------------------------------------ 2) bağlantı, durum metinleri
Bolum 'Bağlantı ve durum metinleri'
Esit 'POWERUP' (Durum) 'bağlanmadan önce POWERUP'
Esit 2 (Mdi 'G0 X1') 'bağlanmadan MDI -> NOT CONNECTED (2)'
Esit 0 ([Eding]::CncConnectServer('')) 'CncConnectServer -> 0'
Esit 7 ([Eding]::CncConnectServer('')) 'ikinci bağlantı -> 7 (zaten bağlı; panel Rc-Tamam kabul eder)'
Esit 'READY' (Durum) 'bağlanınca READY'
Esit 0 ([Eding]::CncGetAllAxesHomed()) 'açılışta home alınmamış'
Esit 0 ([Eding]::CncGetEMStopActive()) 'acil stop yok'
Esit 0 ([Eding]::CncGetCurrentToolNumber()) 'takım T0'
Dogru ([Eding]::SetDllDirectory('C:\yok')) 'SetDllDirectory true'
$metinler = @(0..10 | ForEach-Object { [Eding]::StateText($_) })
foreach ($m in @('IDLE', 'READY', 'RUNNING', 'RUN-SUB', 'PAUSE', 'SEARCHING', 'AXISJOG', 'IPJOG', 'ABORTED', 'POWERUP', 'INT-ERR')) { Dogru ($metinler -contains $m) "durum metni '$m' tanımlı" }
Esit 'CNC_RC_OK' ([Eding]::RCText(0)) 'RCText(0)'
Esit 'CNC_RC_BUSY' ([Eding]::RCText(3)) 'RCText(3)'
Dogru ([Eding]::CncGetStateText(2) -ne [IntPtr]::Zero) 'CncGetStateText IntPtr döner'
Esit ([Eding]::CncGetStateText(2)) ([Eding]::CncGetStateText(2)) 'aynı metin için aynı (önbellekli) işaretçi'
Dogru ([Eding]::SimDurum() -like 'DEMO durum=READY*') 'SimDurum tanı metni'

# ------------------------------------------------------------------ değişkenler
Bolum 'Değişkenler (cnc.ini [VARIABLES])'
$ini = @{ 4000 = -46.9; 4001 = -26.0; 4002 = 32.265; 4003 = -1.0; 4004 = -14.0; 4005 = 0.2; 4006 = 1.0; 5163 = 3.8; 5213 = -247.5345; 5221 = -53.1425; 5222 = -53.456; 5223 = 208.8975; 5224 = 20.209; 5225 = -2.3508 }
foreach ($k in ($ini.Keys | Sort-Object)) { Yakin $ini[$k] ([Eding]::CncGetVariable($k)) 1e-9 "#$k = $($ini[$k])" }
Esit 0.0 ([Eding]::CncGetVariable(4100)) '#4100 başta 0'
Esit 0.0 ([Eding]::CncGetVariable(4038)) '#4038 (makro sürümü) başta 0'
Esit 0 (Mdi '#4100 = 1.5') 'MDI #4100 = 1.5'
Yakin 1.5 ([Eding]::CncGetVariable(4100)) 1e-12 '#4100 okundu'
Esit 0 (Mdi '#4101=[#4100 * 2 - 0.25]') 'MDI ifade [#4100 * 2 - 0.25]'
Yakin 2.75 ([Eding]::CncGetVariable(4101)) 1e-12 '#4101 = 2.75'
Esit 8 (Mdi '#4101 = abc') 'bozuk atama -> SYNTAX (8)'
Esit 0 (Mdi 'gosub pm_surum') 'gosub pm_surum'
Esit 'RUN-SUB' (Durum) 'alt program sırasında RUN-SUB'
Dogru (Hazir-Bekle) 'alt program bitince READY'
Esit 5.0 ([Eding]::CncGetVariable(4038)) 'pm_surum -> #4038 = 5'
Esit 0 (Mdi 'G10 L2 P1 X-50 Z200') 'G10 L2 P1 (G54 yaz)'
Yakin -50 ([Eding]::CncGetVariable(5221)) 1e-12 'G10 -> #5221'
Yakin 200 ([Eding]::CncGetVariable(5223)) 1e-12 'G10 -> #5223'
Yakin -53.456 ([Eding]::CncGetVariable(5222)) 1e-12 'G10 yazılmayan eksen değişmez'
Esit 'READY' (Durum) 'G10 hareket değil (READY)'
[void](Mdi 'G10 L2 P1 X-53.1425 Z208.8975')

# ------------------------------------------------------------------ hareket
Bolum 'Hareket (G0/G1/G53/G90/G91)'
Esit 0 (Mdi 'G90 G0 X10 Y5 Z20') 'G90 G0 X10 Y5 Z20'
Esit 'RUNNING' (Durum) 'hareket sırasında RUNNING'
Esit 3 (Mdi 'G0 X0') 'hareket sürerken ikinci hareket -> BUSY (3)'
Esit 0 (Mdi '#4102 = 7') 'hareket sürerken atama kabul (anlık)'
Dogru (Hazir-Bekle) 'hareket bitince READY'
$w = [Eding]::WorkPos(); $m = [Eding]::MachinePos()
Yakin 10 $w.X 1e-9 'iş X = 10'; Yakin 5 $w.Y 1e-9 'iş Y = 5'; Yakin 20 $w.Z 1e-9 'iş Z = 20'
Yakin (10 + -53.1425) $m.X 1e-9 'makine X = iş X + G54 X'
Yakin (20 + 208.8975 + -247.5345) $m.Z 1e-9 'makine Z = iş Z + G54 Z + #5213'
Yakin 10 ([Eding]::CncGetVariable(5001)) 1e-9 '#5001 = iş X'
Esit 0 (Mdi 'G91 G1 X1.5 F600') 'G91 G1 X1.5'
Dogru (Hazir-Bekle) 'G91 bitti'
Yakin 11.5 ([Eding]::WorkPos().X) 1e-9 'G91 artımlı: X 11.5'
Esit 0 (Mdi 'G90') 'G90'
Esit 0 (Mdi 'G53 G0 Z[#5163]') 'G53 G0 Z[#5163]'
Dogru (Hazir-Bekle) 'G53 bitti'
Yakin 3.8 ([Eding]::MachinePos().Z) 1e-9 'G53 makine Z = #5163'
Esit 0 (Mdi 'G0 A15 B-15') 'G0 A15 B-15'
Dogru (Hazir-Bekle) 'A/B bitti'
Yakin 15 ([Eding]::WorkPos().A) 1e-9 'iş A = 15'
Esit 0 (Mdi 'G0 X[#5221 - 72.25] (yorum) ; yorum') 'yorumlu ve ifadeli satır'
Dogru (Hazir-Bekle) 'bitti'
Yakin (-53.1425 - 72.25) ([Eding]::WorkPos().X) 1e-9 'X[#5221 - 72.25]'
Esit 0 (Mdi 'G38.2 Z-5 F120') 'G38.2 prob'
Dogru (Hazir-Bekle) 'prob bitti'
Yakin -5 ([Eding]::CncGetVariable(5063)) 1e-9 'G38.2 -> #5063 temas Z'
Esit 1.0 ([Eding]::CncGetVariable(5067)) 'G38.2 -> #5067 = 1'

# ------------------------------------------------------------------ home, takım, iş mili, çıkışlar
Bolum 'Home, takım, iş mili, çıkışlar'
Esit 0 (Mdi 'gosub home_all') 'gosub home_all'
Esit 'RUN-SUB' (Durum) 'home sırasında RUN-SUB'
Dogru (Hazir-Bekle) 'home bitti'
Esit 1 ([Eding]::CncGetAllAxesHomed()) 'home alındı'
Yakin 0 ([Eding]::MachinePos().X) 1e-9 'home -> makine X 0'
Esit 0 (Mdi 'M6 T3') 'M6 T3'
Esit 'RUN-SUB' (Durum) 'takım değişiminde RUN-SUB'
Esit 0 ([Eding]::CncGetCurrentToolNumber()) 'değişim bitmeden takım hâlâ T0'
Dogru (Hazir-Bekle) 'takım değişimi bitti'
Esit 3 ([Eding]::CncGetCurrentToolNumber()) 'takım T3'
Esit 3.0 ([Eding]::CncGetVariable(5008)) '#5008 = 3'
Esit 0 (Mdi 'M3 S18000') 'M3 S18000'
Dogru (Bekle { [Eding]::CncGetActualSpeed() -ge 17999 } 3) 'iş mili 18000 devire çıktı'
Esit 0 (Mdi 'M5') 'M5'
Dogru (Bekle { [Eding]::CncGetActualSpeed() -eq 0 } 1.0) 'M5 sonrası ~1 sn içinde 0 devir'
Esit 0 (Mdi 'M54 P4') 'M54 P4'
Esit 1 ([Eding]::CncGetOutput(4)) 'çıkış 4 açık'
Esit 0 (Mdi 'M55 P4') 'M55 P4'
Esit 0 ([Eding]::CncGetOutput(4)) 'çıkış 4 kapalı'
Esit 0 ([Eding]::CncSetOutput(9, 1)) 'CncSetOutput(9,1)'
Esit 1 ([Eding]::CncGetOutput(9)) 'CncGetOutput(9)'
[Eding]::SimGiris(16, 1); Esit 1 ([Eding]::CncGetInput(16)) 'SimGiris -> CncGetInput'
Esit 0 ([Eding]::CncGetInput(17)) 'tanımsız giriş 0'
Esit 0 (Mdi 'msg "merhaba"') 'msg kabul'
Esit 0 (Mdi 'G4 P0.5') 'G4 P0.5'
Esit 'RUNNING' (Durum) 'bekleme sırasında RUNNING'
Dogru (Hazir-Bekle) 'bekleme bitti'

# ------------------------------------------------------------------ acil kilit (panel tarafı)
Bolum 'AcilKilit'
[Eding]::AcilKilit = $true
Esit -1 (Mdi 'G0 X0') 'AcilKilit: CncRunSingleLine -> -1'
Esit -1 ([Eding]::CncRunOrResumeJob()) 'AcilKilit: CncRunOrResumeJob -> -1'
Esit 0 ([Eding]::CncRunSingleLineZorla('M5')) 'AcilKilit: CncRunSingleLineZorla çalışır'
[Eding]::AcilKilit = $false

# ------------------------------------------------------------------ iş yürütme
Bolum 'İş (job) yürütme'
$tmp = Gecici-Klasor 'edingsim'
$isYol = Join-Path $tmp 'deneme_iş.nc'
$sat = New-Object System.Collections.Generic.List[string]
$sat.Add('%'); $sat.Add('G0 G90 X0 Y0'); $sat.Add('T2 M6'); $sat.Add('S20000 M3')
for ($i = 0; $i -lt 6000; $i++) { $sat.Add(('G1 X{0} Y{1} F2000' -f ($i % 50), [math]::Floor($i / 50))) }
$sat.Add('M5'); $sat.Add('M30'); $sat.Add('%')
[System.IO.File]::WriteAllLines($isYol, $sat)
Esit 5 ([Eding]::CncLoadJobA((Join-Path $tmp 'yok.nc'))) 'olmayan dosya -> FILE (5)'
Esit 0 ([Eding]::CncLoadJobA($isYol)) 'CncLoadJobA'
Esit $sat.Count ([Eding]::SimToplamSatir()) 'satırlar sayıldı'
Esit 0 ([Eding]::CncRunOrResumeJob()) 'CncRunOrResumeJob'
Esit 1 ([Eding]::CncGetRunningStatus()) 'RunningStatus 1'
Esit 3 (Mdi 'G0 X0') 'iş sürerken MDI -> BUSY'
Dogru (Bekle { (Durum) -eq 'RUN-SUB' } 2) 'iş içindeki M6 -> RUN-SUB'
Dogru (Bekle { (Durum) -eq 'RUNNING' -and [Eding]::CncGetCurExecLine() -gt 100 } 5) 'satır ilerliyor (RUNNING)'
Esit 2 ([Eding]::CncGetCurrentToolNumber()) 'iş içindeki T2 M6 uygulandı'
Esit 0 ([Eding]::CncPauseJob()) 'CncPauseJob'
Esit 'PAUSE' (Durum) 'PAUSE'
Esit 1 ([Eding]::CncGetPauseStatus()) 'PauseStatus 1'
$l1 = [Eding]::CncGetCurExecLine(); Start-Sleep -Milliseconds 200; $l2 = [Eding]::CncGetCurExecLine()
Esit $l1 $l2 'duraklatınca satır sabit'
Esit 0 ([Eding]::CncSetFeedOverride(0.5)) 'CncSetFeedOverride(0.5)'
Yakin 0.5 ([Eding]::CncGetActualFeedOverride()) 1e-12 'hız oranı 0.5'
Esit 0 ([Eding]::CncRunOrResumeJob()) 'devam'
Esit 'RUNNING' (Durum) 'yeniden RUNNING'
$t0 = Get-Date; $a0 = [Eding]::CncGetCurExecLine(); Start-Sleep -Milliseconds 400; $a1 = [Eding]::CncGetCurExecLine(); $dt = ((Get-Date) - $t0).TotalSeconds
$hiz = ($a1 - $a0) / $dt / [Eding]::SimHizCarpani
Dogru ($hiz -gt 120 -and $hiz -lt 260) "hız %50'de ~200 satır/sn (ölçülen $([math]::Round($hiz)))"
[void][Eding]::CncSetFeedOverride(1.0)
Esit 0 ([Eding]::CncAbortJob()) 'CncAbortJob'
Esit 'ABORTED' (Durum) 'iptal sonrası ABORTED'
Esit 0 ([Eding]::CncGetRunningStatus()) 'RunningStatus 0'
Dogru (Bekle { [Eding]::CncGetActualSpeed() -eq 0 } 1.0) 'iptal iş milini durdurur (~1 sn içinde 0)'
Dogru (Hazir-Bekle) 'iptal sonrası kısa sürede READY'
[void][Eding]::CncSetFeedOverride(2.0)
Esit 0 ([Eding]::CncRunOrResumeJob()) 'yeniden başlat (baştan)'
Dogru (Bekle { (Durum) -eq 'READY' } 10) 'iş sonuna kadar çalıştı, READY'
Esit ($sat.Count - 1) ([Eding]::CncGetCurExecLine()) 'iş M30 satırında bitti'
Dogru (Bekle { [Eding]::CncGetActualSpeed() -eq 0 } 1.0) 'işteki M5 ile iş mili durdu'
[void][Eding]::CncSetFeedOverride(100)
Yakin 1.0 ([Eding]::CncGetActualFeedOverride()) 1e-12 'yüzde olarak 100 verilince oran 1.0'
# M0 ile duraklama
$isYol2 = Join-Path $tmp 'm0.nc'
[System.IO.File]::WriteAllLines($isYol2, @('G0 X1', 'G0 X2', 'M0', 'G0 X3', 'M30'))
Esit 0 ([Eding]::CncLoadJobA($isYol2)) 'M0 işi yüklendi'
Esit 0 ([Eding]::CncRunOrResumeJob()) 'M0 işi başladı'
Dogru (Bekle { (Durum) -eq 'PAUSE' } 3) 'M0 -> PAUSE'
Esit 3 ([Eding]::CncGetCurExecLine()) 'M0 satırında (3)'
Esit 0 ([Eding]::CncRunOrResumeJob()) 'M0 sonrası devam'
Dogru (Bekle { (Durum) -eq 'READY' } 3) 'M0 işi bitti'
Yakin 3 ([Eding]::WorkPos().X) 1e-9 'iş satırları konumu günceller (X3)'

# ------------------------------------------------------------------ acil stop ve hata
Bolum 'Acil stop ve hata'
[void](Mdi 'M3 S10000')
[Eding]::SimAcilStop($true)
Esit 1 ([Eding]::CncGetEMStopActive()) 'acil stop basılı -> 1'
Esit 'ABORTED' (Durum) 'acil stopta ABORTED'
Esit 9 (Mdi 'G0 X0') 'acil stopta hareket -> EMSTOP (9)'
Esit 9 ([Eding]::CncReset()) 'buton basılıyken reset temizleyemez'
[Eding]::SimAcilStop($false)
Esit 'ABORTED' (Durum) 'buton bırakılınca reset gerekir'
Esit 0 ([Eding]::CncReset()) 'CncReset'
Esit 'READY' (Durum) 'reset sonrası READY'
Esit 1 ([Eding]::CncGetAllAxesHomed()) 'acil stop home bilgisini silmez'
[Eding]::SimHata()
Esit 'INT-ERR' (Durum) 'SimHata -> INT-ERR'
Esit 0 ([Eding]::CncReset()) 'reset'
Esit 'READY' (Durum) 'INT-ERR temizlendi'

# ------------------------------------------------------------------ 3) panelin durum fonksiyonları
Bolum 'Panel durum fonksiyonları simülasyonla'
try {
    [void](. Kaynak-Fonksiyonlari -Kaynak $Kaynak -Adlar 'Eding-Durum', 'Mesgul', 'Hatali', 'Rc-Tamam', 'Durakli-Mi', 'Calisiyor-Mu')
    Esit 'READY' (Eding-Durum) 'Eding-Durum READY'
    Dogru (-not (Calisiyor-Mu)) 'READY: Calisiyor-Mu false'
    [void](Mdi 'G0 X5')
    Dogru (Calisiyor-Mu) 'RUNNING: Calisiyor-Mu true'
    [void](Hazir-Bekle)
    [void](Mdi 'gosub user_1')
    Dogru (Mesgul (Eding-Durum)) 'RUN-SUB: Mesgul'
    [void](Hazir-Bekle)
    [Eding]::SimHata(); Dogru (Hatali (Eding-Durum)) 'INT-ERR: Hatali'; [void][Eding]::CncReset()
    Dogru (Rc-Tamam ([Eding]::CncConnectServer(''))) 'Rc-Tamam(yeniden bağlan)'
    [void][Eding]::CncLoadJobA($isYol); [void][Eding]::CncRunOrResumeJob(); [void][Eding]::CncPauseJob()
    Dogru (Durakli-Mi) 'Durakli-Mi'
    [void][Eding]::CncAbortJob(); [void](Hazir-Bekle)
} catch { Kaldi 'panel fonksiyonları yüklenemedi' $_.Exception.Message }

Esit 0 ([Eding]::CncDisConnectServer()) 'CncDisConnectServer'
Esit 'POWERUP' (Durum) 'bağlantı kesilince POWERUP'
try { Remove-Item -LiteralPath $tmp -Recurse -Force } catch { }
Ozet 'EdingSim'
