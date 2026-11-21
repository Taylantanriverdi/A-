# İndirilmiş Ultima Online Classic kurulum dosyasını (UOClassicSetup*.exe) arar.
# Bulursa en yenisinin tam yolunu yazar (çıkış 0), bulamazsa çıkış 1.
$klasorler = New-Object System.Collections.Generic.List[string]
try {
    $dl = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path
    if ($dl) { $klasorler.Add($dl) }
} catch { }
foreach ($k in @("$env:USERPROFILE\Downloads", "$env:USERPROFILE\İndirilenler", "$env:USERPROFILE\Desktop",
                 "$env:USERPROFILE\OneDrive\Desktop", "$env:USERPROFILE\Masaüstü")) { $klasorler.Add($k) }

$dosya = $klasorler | Select-Object -Unique | Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
    ForEach-Object { Get-ChildItem -LiteralPath $_ -File -ErrorAction SilentlyContinue } |
    Where-Object { $_.Name -match '^UO.*Classic.*Setup.*\.exe$|^UOClassicSetup.*\.exe$' } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($dosya) { Write-Output $dosya.FullName; exit 0 }
exit 1
