# Kapi.ps1 - mantık tarafındaki arayüz kapısı yardımcıları: Yaz (günlük + mesaj geçmişi), Onay, Ui-Kutu (eski mesaj kutusu
# anlamını Ui-Onay / Ui-Bilgi / Ui-Hata / Ui-Secim kapılarına çevirir), Durum-Yaz, Hatalari-Kaydet, Klasor-Ac.
# Kapının kendisi (Ui-*) kabukta lib/ArayuzKapisi.ps1 ile, testlerde sahte fonksiyonlarla gerçeklenir.
# PowerShell 5.1 (32 bit) uyumlu.

$script:HataSayisi = 0
# ED-10: $Error en fazla 256 kayıt tutar; sayı orada takılınca yeni hatalar hiç loglanmıyordu. Artık her okumadan sonra
# liste boşaltılır (panelde $Error'ı başka okuyan yok). Sık yoklamalar (Get-Process) -ErrorAction Ignore ile $Error'a yazmaz.
function Hatalari-Kaydet {
    $yeni = $global:Error.Count
    if ($yeni -le 0) { return }
    for ($i = $yeni - 1; $i -ge 0; $i--) {
        $h = $global:Error[$i]
        # "işlem bulunamadı" (Get-Process) zararsız; Windows dili ne olursa olsun atla
        if ("$($h.FullyQualifiedErrorId)" -like 'NoProcessFoundForGivenName*' -or "$($h.Exception.Message)" -like '*Cannot find a process*') { continue }
        [Kayit]::Yaz("PROGRAM HATASI: $($h.Exception.Message)  @ $($h.InvocationInfo.PositionMessage)")
    }
    try { $global:Error.Clear() } catch { }
    $script:HataSayisi = 0
}

$script:SonMesajlar = New-Object System.Collections.Generic.List[string]
function Yaz([string]$metin) {
    [Kayit]::Yaz($metin)
    $script:SonMesajlar.Add((Get-Date -Format 'HH:mm:ss') + '  ' + $metin); while ($script:SonMesajlar.Count -gt 40) { $script:SonMesajlar.RemoveAt(0) }
    $kutu.AppendText((Get-Date -Format 'HH:mm:ss') + '   ' + $metin + "`r`n")
    Ui-Olaylar
}

function Onay([string]$metin, [string]$baslik) {
    return ((Ui-Kutu $metin $baslik 'YesNo' 'Question') -eq 'Yes')
}

$script:SonDurum = ''
function Durum-Yaz([string]$metin, [System.Drawing.Color]$renk) {
    if ($metin -ne $script:SonDurum) { [Kayit]::Yaz("DURUM: $metin"); $script:SonDurum = $metin }
    $lblDurum.Text = "●  $metin"
    $lblDurum.ForeColor = $renk
}

# --- PANEL ---
function Klasor-Ac([string]$yol) {
    try { [void][System.IO.Directory]::CreateDirectory($yol); Start-Process explorer.exe $yol } catch { Yaz "Klasör açılamadı: $yol" }
}
