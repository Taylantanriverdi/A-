# Offline Agent - sunucuyu durdurur (Ollama acik kalir)
. (Join-Path $PSScriptRoot 'ortak.ps1')

if (Stop-Sunucu) { Yaz 'Offline Agent durduruldu.' Green }
else { Yaz 'Calisan bir Offline Agent bulunamadi.' Yellow }
