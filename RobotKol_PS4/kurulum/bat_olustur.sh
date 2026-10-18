#!/usr/bin/env bash
# ROBOT_KOL_KURULUM_V<n>.bat dosyasini (surum kurulum.ps1 icindeki $SURUM) kurulum.ps1 + proje dosyalarindan (CRLF) uretir.
set -euo pipefail
cd "$(dirname "$0")/.."
SURUM=$(sed -n "s/^\$SURUM = '\(.*\)'.*/\1/p" kurulum/kurulum.ps1 | tr -d '\r')
OUT=ROBOT_KOL_KURULUM_${SURUM}.bat
rm -f ROBOT_KOL_KURULUM*.bat
{
cat <<'HDR'
@echo off
setlocal
chcp 65001 >nul
title ROBOT KOL - Otomatik Kurulum
set "ROBOTKOL_BAT=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:ROBOTKOL_BAT,[Text.Encoding]::UTF8); $a=$s.IndexOf('#'+'#PS_BASLA'); $b=$s.IndexOf('#'+'#PS_BITIS'); try { Invoke-Expression $s.Substring($a,$b-$a) } catch { Write-Host ''; Write-Host ('HATA: '+$_) -ForegroundColor Red; Write-Host 'Bu ekranin goruntusunu gonderin veya dosyaya tekrar cift tiklayin.' -ForegroundColor Yellow }"
echo.
pause
exit /b
##PS_BASLA
HDR
cat kurulum/kurulum.ps1
echo '##PS_BITIS'
for f in RobotKol_PS4.ino README.md SURUMLER.md KONTROL_PANELI.html; do
  case $f in *.ino) dest="RobotKol_PS4/$f" ;; *) dest="$f" ;; esac
  echo "##DOSYA $dest"
  cat "$f"
  echo '##DOSYA_SON'
done
echo '##DOSYA64 ROBOT_KOL_KILAVUZ.pdf'
base64 -w 76 ROBOT_KOL_KILAVUZ.pdf
echo '##DOSYA_SON'
} | sed 's/\r$//; s/$/\r/' > "$OUT"
echo "olusturuldu: $OUT"
