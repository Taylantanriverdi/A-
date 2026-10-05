@echo off
setlocal EnableExtensions
chcp 65001 >nul
title PRIMER LAB - YENI BILGISAYAR KURULUMU

rem ============================================================
rem  Yonetici izni gerekli (program kurulumu, guvenlik duvari).
rem ============================================================
net session >nul 2>&1
if errorlevel 1 (
    echo Yonetici izni isteniyor...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set "KIT=%~dp0"
set "HEDEF=C:\PrimerLab"
set "KAYNAK=%HEDEF%\Kaynak"
set "UYGULAMA=%HEDEF%\Uygulama"
set "ESKI=%KIT%ESKI_PC_DOSYALARI"
set "URL=http://localhost:5169"
set "DOTNET=%ProgramFiles%\dotnet\dotnet.exe"

echo ============================================================
echo  PRIMER LAB - YENI BILGISAYAR KURULUMU
echo ============================================================
echo  Program klasoru : %HEDEF%
echo  Bu islem 10-20 dakika surebilir. Pencereyi kapatmayin.
echo ============================================================
echo.

if not exist "%KIT%kaynak\PrimerLabV2\PrimerLabV2.csproj" goto KIT_EKSIK
if not exist "%KIT%kaynak\DB\V33_TAM_KURULUM_SEMA.sql" goto KIT_EKSIK
if not exist "%HEDEF%" mkdir "%HEDEF%"
rem Program normal kullanici olarak calisir; is dosyalari ve mail ekleri icin yazabilmeli.
rem (*S-1-5-32-545 = Users grubu; Turkce Windows'ta grup adi farkli oldugu icin SID kullanilir.)
icacls "%HEDEF%" /grant "*S-1-5-32-545:(OI)(CI)M" >nul

rem ------------------------------------------------------------
echo [1/8] Windows paket yoneticisi (winget) kontrol ediliyor...
where winget >nul 2>&1
if errorlevel 1 goto WINGET_YOK
echo       Tamam.

rem ------------------------------------------------------------
echo [2/8] .NET 10 SDK kontrol ediliyor...
set "DOTNET_VAR="
if exist "%DOTNET%" (
    "%DOTNET%" --list-sdks 2>nul | findstr /b "10." >nul && set "DOTNET_VAR=1"
)
if defined DOTNET_VAR (
    echo       Zaten kurulu.
) else (
    echo       Kuruluyor...
    winget install --id Microsoft.DotNet.SDK.10 -e --silent --accept-package-agreements --accept-source-agreements
    "%DOTNET%" --list-sdks 2>nul | findstr /b "10." >nul
    if errorlevel 1 goto DOTNET_HATA
    echo       Kuruldu.
)

rem ------------------------------------------------------------
echo [3/8] Python kontrol ediliyor (eski yedek aktarimi icin)...
set "PYEXE="
if exist "%ProgramFiles%\Python312\python.exe" set "PYEXE=%ProgramFiles%\Python312\python.exe"
if not defined PYEXE (
    echo       Kuruluyor...
    winget install --id Python.Python.3.12 -e --silent --scope machine --accept-package-agreements --accept-source-agreements
    if exist "%ProgramFiles%\Python312\python.exe" set "PYEXE=%ProgramFiles%\Python312\python.exe"
)
if defined PYEXE (
    setx /M PRIMERLAB_PYTHON "%PYEXE%" >nul
    echo       Tamam: %PYEXE%
) else (
    echo       UYARI: Python kurulamadi. Program calisir; yalniz "Eski Yedegi Ice Aktar" calismaz.
)

rem ------------------------------------------------------------
echo [4/8] PostgreSQL veritabani sunucusu kontrol ediliyor...
rem Not: Bu adimda parantezli blok kullanilmaz; blok icindeki %DEGISKEN%'ler
rem blok okunurken acilir ve blok icinde girilen sifre bos kalirdi.
call :PG_BUL
if defined PGBIN goto PG_MEVCUT
echo.
echo       PostgreSQL kurulacak. Veritabani yonetici sifresi belirleyin.
echo       - En az 8 karakter, yalniz harf ve rakam (Turkce karakter ve bosluk yok)
echo       - BU SIFREYI BIR KAGIDA YAZIN. pgAdmin ve yedekler icin gerekir.
call :SIFRE_SOR
echo       PostgreSQL kuruluyor (birkac dakika surebilir)...
winget install --id PostgreSQL.PostgreSQL.17 -e --silent --accept-package-agreements --accept-source-agreements --override "--mode unattended --unattendedmodeui none --superpassword %PGPASS% --serverport 5432 --locale C"
call :PG_BUL
if not defined PGBIN goto PG_HATA
echo       Kuruldu: %PGBIN%
call :PG_SERVIS_BUL
if not defined PGSVC goto PG_ONAR
goto PG_SIFRE_TAMAM
:PG_MEVCUT
echo       Zaten kurulu: %PGBIN%
call :PG_SERVIS_BUL
if not defined PGSVC goto PG_ONAR
echo       Servis: %PGSVC%
echo.
echo       Kurulu PostgreSQL'in "postgres" kullanici sifresini yazin.
call :SIFRE_SOR
goto PG_SIFRE_TAMAM

rem ------------------------------------------------------------
rem PostgreSQL programi var ama Windows servisi yok (yarim kalmis kurulum).
rem Var olan veri klasoru servis olarak kaydedilir; yoksa yenisi olusturulur.
:PG_ONAR
echo.
echo       UYARI: PostgreSQL programi var ama veritabani servisi kurulu degil.
echo       (Onceki bir kurulum yarida kalmis olabilir.) Onariliyor...
if not exist "%PGBIN%\pg_ctl.exe" goto PG_YENIDEN_KUR
if not exist "%PGBIN%\postgres.exe" goto PG_YENIDEN_KUR
if not exist "%PGBIN%\initdb.exe" goto PG_YENIDEN_KUR
set "PGSVC=postgresql-x64-17"
set "PGYENI="
if exist "%PGDATA%\PG_VERSION" goto PG_ONAR_KAYIT
if exist "%HEDEF%\pgdata\PG_VERSION" (
    set "PGDATA=%HEDEF%\pgdata"
    goto PG_ONAR_KAYIT
)
echo       Eski veri klasoru bulunamadi; yeni veritabani alani olusturulacak.
echo       Yeni "postgres" sifresi belirleyin (KAGIDA YAZIN).
call :SIFRE_SOR
set "PGDATA=%HEDEF%\pgdata"
powershell -NoProfile -Command "[IO.File]::WriteAllText($env:TEMP + '\primerlab_pw.txt', $env:PGPASS)"
rem Turkce Windows'ta bolge adi "Turkish_Turkiye.1254" (u harfi ile) PostgreSQL tarafindan
rem kabul edilmiyor (bilinen PostgreSQL hatasi). Bu yuzden bolge adi kullanilmaz:
rem once Turkce siralama icin ICU (tr-TR) denenir, olmazsa genel "C" ayari kullanilir.
if exist "%PGDATA%" if not exist "%PGDATA%\PG_VERSION" rmdir /s /q "%PGDATA%"
"%PGBIN%\initdb.exe" -D "%PGDATA%" -U postgres -E UTF8 --locale=C --lc-messages=C --locale-provider=icu --icu-locale=tr-TR --auth=scram-sha-256 --pwfile="%TEMP%\primerlab_pw.txt"
if not errorlevel 1 goto PG_INITDB_TAMAM
echo       ICU kullanilamadi; genel ayarla tekrar deneniyor...
if exist "%PGDATA%" rmdir /s /q "%PGDATA%"
"%PGBIN%\initdb.exe" -D "%PGDATA%" -U postgres -E UTF8 --locale=C --lc-messages=C --auth=scram-sha-256 --pwfile="%TEMP%\primerlab_pw.txt"
if errorlevel 1 (
    del /q "%TEMP%\primerlab_pw.txt" >nul 2>&1
    goto PG_ONAR_HATA
)
:PG_INITDB_TAMAM
del /q "%TEMP%\primerlab_pw.txt" >nul 2>&1
set "PGYENI=1"
:PG_ONAR_KAYIT
echo       Servis kaydediliyor: %PGSVC%
echo       Veri klasoru: "%PGDATA%"
"%PGBIN%\pg_ctl.exe" register -N "%PGSVC%" -D "%PGDATA%" -S auto
if errorlevel 1 goto PG_ONAR_HATA
net start "%PGSVC%"
if errorlevel 1 goto PG_ONAR_HATA
echo       Servis calisiyor.
if defined PGYENI goto PG_SIFRE_TAMAM
echo.
echo       Bu veritabaninin "postgres" sifresini yazin.
call :SIFRE_SOR
goto PG_SIFRE_TAMAM

:PG_YENIDEN_KUR
echo       PostgreSQL eksik kurulmus; yeniden kurulacak (veri klasoru silinmez).
echo       Yeni "postgres" sifresi belirleyin (KAGIDA YAZIN).
call :SIFRE_SOR
winget install --id PostgreSQL.PostgreSQL.17 -e --force --silent --accept-package-agreements --accept-source-agreements --override "--mode unattended --unattendedmodeui none --superpassword %PGPASS% --serverport 5432 --locale C"
call :PG_BUL
call :PG_SERVIS_BUL
if not defined PGSVC goto PG_HATA

:PG_SIFRE_TAMAM
set "PSQL="%PGBIN%\psql.exe" -h localhost -p 5432 -U postgres -v ON_ERROR_STOP=1 -q -X"
set "PGHATA=%TEMP%\primerlab_pg_hata.txt"

rem PostgreSQL servisi kapaliysa baslat.
call :PG_SERVIS_BUL
if not defined PGSVC goto PG_DENE
sc query "%PGSVC%" | find "RUNNING" >nul
if not errorlevel 1 goto PG_DENE
echo       PostgreSQL servisi baslatiliyor (%PGSVC%)...
net start "%PGSVC%" >nul 2>&1

:PG_DENE
set "PGPASSWORD=%PGPASS%"
echo       Sunucuya baglaniliyor...
set /a DENEME=0
:PG_BEKLE
%PSQL% -d postgres -c "SELECT 1" >nul 2>"%PGHATA%"
if not errorlevel 1 goto PG_HAZIR
rem Sifre hatasi beklemekle duzelmez; hemen kullaniciya sor.
findstr /i /c:"password" /c:"parola" /c:"28P01" "%PGHATA%" >nul
if not errorlevel 1 goto PG_SIFRE_YANLIS
set /a DENEME+=1
if %DENEME% GEQ 30 goto PG_BAGLANTI_HATA
timeout /t 2 /nobreak >nul
goto PG_BEKLE

:PG_SIFRE_YANLIS
echo.
echo       SIFRE KABUL EDILMEDI. Bu bilgisayardaki PostgreSQL daha once
echo       farkli bir sifreyle kurulmus.
echo.
echo         [T] Sifreyi tekrar yaz
echo         [S] Sifreyi hatirlamiyorum - yeni sifre belirle (veriler silinmez)
echo         [C] Cikis
choice /c TSC /n /m "      Seciminiz (T/S/C): "
if errorlevel 3 goto SON_HATA
if errorlevel 2 goto PG_SIFIRLA
call :SIFRE_SOR
goto PG_DENE

rem ------------------------------------------------------------
rem postgres sifresini sifirlama: pg_hba.conf gecici olarak yalniz bu
rem bilgisayardan (localhost) sifresiz girise izin verecek sekilde degistirilir,
rem sifre degistirilir ve dosya hemen eski haline getirilir. Veriler etkilenmez.
:PG_SIFIRLA
echo.
echo       Yeni "postgres" sifresini belirleyin (KAGIDA YAZIN).
call :SIFRE_SOR
call :PG_SERVIS_BUL
if not defined PGSVC goto SIFIRLA_HATA
if not exist "%PGDATA%\pg_hba.conf" goto SIFIRLA_HATA
copy /Y "%PGDATA%\pg_hba.conf" "%PGDATA%\pg_hba.conf.primerlab_yedek" >nul
if errorlevel 1 goto SIFIRLA_HATA
> "%PGDATA%\pg_hba.conf" echo host all postgres 127.0.0.1/32 trust
>> "%PGDATA%\pg_hba.conf" echo host all postgres ::1/128 trust
echo       Sifre degistiriliyor, servis yeniden baslatiliyor...
net stop "%PGSVC%" >nul 2>&1
net start "%PGSVC%" >nul 2>&1
set "SIFIRLAMA="
set /a SDENEME=0
:SIFIRLA_BEKLE
"%PGBIN%\psql.exe" -h localhost -p 5432 -U postgres -q -X -d postgres -c "ALTER USER postgres PASSWORD '%PGPASS%';" >nul 2>"%PGHATA%"
if not errorlevel 1 goto SIFIRLA_OK
set /a SDENEME+=1
if %SDENEME% GEQ 20 goto SIFIRLA_GERI_AL
timeout /t 2 /nobreak >nul
goto SIFIRLA_BEKLE
:SIFIRLA_OK
set "SIFIRLAMA=1"
:SIFIRLA_GERI_AL
copy /Y "%PGDATA%\pg_hba.conf.primerlab_yedek" "%PGDATA%\pg_hba.conf" >nul
net stop "%PGSVC%" >nul 2>&1
net start "%PGSVC%" >nul 2>&1
if not defined SIFIRLAMA goto SIFIRLA_HATA
echo       Sifre degistirildi.
goto PG_DENE

:PG_HAZIR
echo       Baglanti tamam.

rem ------------------------------------------------------------
echo [5/8] Primer Lab veritabani hazirlaniyor...
for /f "delims=" %%P in ('powershell -NoProfile -Command "-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 24 | ForEach-Object {[char]$_})"') do set "APPPASS=%%P"
if not defined APPPASS goto DB_HATA

rem Uygulama kendi rolunu kullanir (primerlab_web). Bu bilgisayarda eski bir Primer Lab
rem varsa onun kullandigi primerlab_app rolunun sifresi degistirilmez.
%PSQL% -d postgres -c "DO $$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='primerlab_web') THEN CREATE ROLE primerlab_web LOGIN PASSWORD '%APPPASS%'; ELSE ALTER ROLE primerlab_web LOGIN PASSWORD '%APPPASS%'; END IF; END$$;"
if errorlevel 1 goto DB_HATA

set "DBVAR="
%PSQL% -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='primerlab'" | findstr /x "1" >nul && set "DBVAR=1"
if not defined DBVAR (
    %PSQL% -d postgres -c "CREATE DATABASE primerlab ENCODING 'UTF8' TEMPLATE template0;"
    if errorlevel 1 goto DB_HATA
    echo       Veritabani olusturuldu.
) else (
    echo       Veritabani zaten var; veriler korunuyor.
)
%PSQL% -d postgres -c "GRANT CONNECT, TEMPORARY ON DATABASE primerlab TO primerlab_web;"
if errorlevel 1 goto DB_HATA
%PSQL% -d primerlab -f "%KIT%kaynak\DB\V33_TAM_KURULUM_SEMA.sql"
if errorlevel 1 goto DB_HATA
%PSQL% -d primerlab -c "GRANT USAGE ON SCHEMA public TO primerlab_web; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO primerlab_web; GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO primerlab_web; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO primerlab_web; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO primerlab_web;"
if errorlevel 1 goto DB_HATA
echo       Tablolar hazir.

rem ------------------------------------------------------------
echo [6/8] Program derleniyor...
taskkill /F /IM PrimerLabV2.exe >nul 2>&1
robocopy "%KIT%kaynak\PrimerLabV2" "%KAYNAK%" /MIR /IS /IT /XD bin obj /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto KOPYA_HATA
rem Onceki derleme dosyalari silinir; program sifirdan derlenir (eski sayfa kalmasin).
if exist "%KAYNAK%\obj" rmdir /s /q "%KAYNAK%\obj"
if exist "%KAYNAK%\bin" rmdir /s /q "%KAYNAK%\bin"

rem Eski bilgisayardan getirilen ek sayfalar. Index.cshtml ve Hekim Portali yeni surumdur, ezilmez.
if exist "%ESKI%\Pages" (
    robocopy "%ESKI%\Pages" "%KAYNAK%\Pages" *.cshtml *.cs /S /XF Index.cshtml Index.cshtml.cs HekimPortali.cshtml TeknisyenPaneli.cshtml /NFL /NDL /NJH /NJS /NP >nul
    if errorlevel 8 goto KOPYA_HATA
)
if exist "%ESKI%\wwwroot" (
    robocopy "%ESKI%\wwwroot" "%KAYNAK%\wwwroot" /E /NFL /NDL /NJH /NJS /NP >nul
    if errorlevel 8 goto KOPYA_HATA
)
rem Eski Hekim Portali sayfalari kaldirilir: yeni portal HekimPortali.cshtml ile gelir;
rem ayni adresi kullanan iki sayfa olursa program acilmaz.
powershell -NoProfile -Command "Get-ChildItem -Path (Join-Path $env:KAYNAK 'Pages') -Filter *.cshtml -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'HekimPortali.cshtml' -and $_.Name -ne 'TeknisyenPaneli.cshtml' -and (Select-String -Path $_.FullName -Pattern '^\s*@page\s+.?/(hekim-portal|teknisyen)' -Quiet) } | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force; Remove-Item -LiteralPath ($_.FullName + '.cs') -Force -ErrorAction SilentlyContinue }"

pushd "%KAYNAK%"
"%DOTNET%" publish PrimerLabV2.csproj -c Release -o "%UYGULAMA%" -nologo
set "DERLEME=%errorlevel%"
popd
if not "%DERLEME%"=="0" goto DERLEME_HATA

rem Baglanti bilgisi yalniz bu bilgisayarda; kullanicilar okuyabilir, yalniz yonetici degistirebilir.
powershell -NoProfile -Command "$j = @{ ConnectionStrings = @{ DefaultConnection = 'Host=localhost;Port=5432;Database=primerlab;Username=primerlab_web;Password=%APPPASS%' } } | ConvertTo-Json; [IO.File]::WriteAllText('%UYGULAMA%\appsettings.Production.json', $j)"
if errorlevel 1 goto DB_HATA
icacls "%UYGULAMA%\appsettings.Production.json" /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "*S-1-5-32-545:R" >nul

rem Eski bilgisayarin dosyalari (is dosyalari, mail ekleri). Secrets klasoru bu bilgisayarda acilamaz, alinmaz.
if exist "%ESKI%\App_Data" (
    echo       Eski is dosyalari kopyalaniyor...
    robocopy "%ESKI%\App_Data" "%UYGULAMA%\App_Data" /E /XD Secrets /XO /NFL /NDL /NJH /NJS /NP >nul
    if errorlevel 8 goto KOPYA_HATA
)
echo       Derleme tamam.

rem ------------------------------------------------------------
echo [7/8] Kisayollar ve guvenlik duvari ayarlaniyor...
copy /Y "%KIT%PrimerLab_Baslat.bat" "%HEDEF%\PrimerLab_Baslat.bat" >nul
copy /Y "%KIT%PrimerLab_Durdur.bat" "%HEDEF%\PrimerLab_Durdur.bat" >nul
copy /Y "%KIT%PORTAL_INTERNET_AC.bat" "%HEDEF%\PORTAL_INTERNET_AC.bat" >nul
copy /Y "%KIT%PrimerLab_SifreSifirla.bat" "%HEDEF%\PrimerLab_SifreSifirla.bat" >nul
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Primer Lab.lnk'); $s.TargetPath='%HEDEF%\PrimerLab_Baslat.bat'; $s.WorkingDirectory='%HEDEF%'; $s.WindowStyle=7; $s.IconLocation='%SystemRoot%\System32\shell32.dll,13'; $s.Save()"
rem Hekim Portali ayni Wi-Fi'deki cihazlardan acilabilsin (yalniz "Ozel" ag profili).
netsh advfirewall firewall delete rule name="Primer Lab 5169" >nul 2>&1
netsh advfirewall firewall add rule name="Primer Lab 5169" dir=in action=allow protocol=TCP localport=5169 profile=private >nul
echo.
choice /c EH /n /m "      Bilgisayar acilinca Primer Lab otomatik baslasin mi? (E/H): "
if errorlevel 2 (
    del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Primer Lab.lnk" >nul 2>&1
) else (
    powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Primer Lab.lnk'); $s.TargetPath='%HEDEF%\PrimerLab_Baslat.bat'; $s.Arguments='sessiz'; $s.WorkingDirectory='%HEDEF%'; $s.WindowStyle=7; $s.Save()"
)

rem ------------------------------------------------------------
echo [8/8] Primer Lab baslatiliyor...
rem Program yonetici olarak degil, normal kullanici yetkisiyle baslatilir
rem (boylece sonraki guncellemeler de onu kapatabilir).
explorer.exe "%HEDEF%\PrimerLab_Baslat.bat"
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 60;$i++){ try { if((Invoke-WebRequest -UseBasicParsing '%URL%' -TimeoutSec 2).StatusCode -eq 200){$ok=$true;break} } catch {}; Start-Sleep 1 }; if(-not $ok){exit 1}"
if errorlevel 1 goto BASLATMA_HATA

rem Eski bilgisayardan alinan tam yedek varsa geri yuklemeyi teklif et.
set "YEDEK="
for %%F in ("%ESKI%\*.json") do set "YEDEK=%%~fF"
if defined YEDEK (
    echo.
    echo       Eski bilgisayarin yedegi bulundu: "%YEDEK%"
    choice /c EH /n /m "      Bu yedek simdi geri yuklensin mi? Yeni veritabanindaki veriler yedektekiyle degisir. (E/H): "
    if not errorlevel 2 (
        curl.exe -s -o "%HEDEF%\geri_yukleme_sonucu.txt" -w "%%{http_code}" -F "file=@%YEDEK%" -F "confirm=RESTORE" "%URL%/api/backup/restore" > "%HEDEF%\geri_yukleme_kodu.txt"
        findstr /x "200" "%HEDEF%\geri_yukleme_kodu.txt" >nul
        if errorlevel 1 (
            echo       UYARI: Yedek geri yuklenemedi. Ayrinti: %HEDEF%\geri_yukleme_sonucu.txt
        ) else (
            echo       Yedek basariyla geri yuklendi.
        )
    )
)

echo.
echo ============================================================
echo  KURULUM TAMAMLANDI
echo ============================================================
echo  - Masaustundeki "Primer Lab" kisayolu ile acabilirsiniz.
echo  - Adres: %URL%
echo  - Hekim Portalini internete acmak icin: C:\PrimerLab\PORTAL_INTERNET_AC.bat
echo.
echo  Gmail baglantisini ve Primer AI anahtarini Ayarlar'dan yeniden girin
echo  ^(guvenlik geregi eski bilgisayarin sifreli anahtarlari burada acilamaz^).
echo ============================================================
pause
exit /b 0

rem ============================================================
:PG_BUL
set "PGBIN="
for /f "delims=" %%D in ('dir /b /ad /o-n "%ProgramFiles%\PostgreSQL" 2^>nul') do (
    if not defined PGBIN if exist "%ProgramFiles%\PostgreSQL\%%D\bin\psql.exe" set "PGBIN=%ProgramFiles%\PostgreSQL\%%D\bin"
)
exit /b 0

:PG_SERVIS_BUL
set "PGSVC="
set "PGDATA="
for /f "usebackq tokens=1,* delims=|" %%A in (`powershell -NoProfile -Command "$i = Get-ItemProperty 'HKLM:\SOFTWARE\PostgreSQL\Installations\*' -ErrorAction SilentlyContinue | Where-Object { $_.'Service ID' } | Select-Object -First 1; if ($i) { $i.'Service ID' + '|' + $i.'Data Directory' }"`) do (
    set "PGSVC=%%A"
    set "PGDATA=%%B"
)
if not defined PGSVC goto PG_SERVIS_SC
sc query "%PGSVC%" >nul 2>&1
if errorlevel 1 set "PGSVC="
:PG_SERVIS_SC
if not defined PGSVC for /f "tokens=2" %%S in ('sc query state^= all ^| findstr /i /c:"SERVICE_NAME: postgresql"') do if not defined PGSVC set "PGSVC=%%S"
if not defined PGDATA set "PGDATA=%PGBIN%\..\data"
exit /b 0

:SIFRE_SOR
set "PGPASS="
set /p "PGPASS=      Sifre: "
if not defined PGPASS goto SIFRE_SOR
powershell -NoProfile -Command "if ($env:PGPASS -cmatch '^[A-Za-z0-9]{8,64}$') { exit 0 } else { exit 1 }"
if errorlevel 1 (
    echo       Gecersiz: en az 8 karakter, yalniz harf ve rakam kullanin.
    goto SIFRE_SOR
)
exit /b 0

rem ============================================================
:KIT_EKSIK
echo HATA: Kurulum dosyalari eksik. Zip dosyasinin tamamini acip KURULUM.bat'i oradan calistirin.
goto SON_HATA
:WINGET_YOK
echo HATA: Windows "Uygulama Yukleyici" (winget) bulunamadi.
echo Microsoft Store aciliyor; "Uygulama Yukleyici"yi guncelleyip KURULUM.bat'i tekrar calistirin.
start "" "ms-windows-store://pdp/?productid=9NBLGGH4NNS1"
goto SON_HATA
:DOTNET_HATA
echo HATA: .NET 10 SDK kurulamadi. Internet baglantisini kontrol edip tekrar deneyin.
goto SON_HATA
:PG_HATA
echo HATA: PostgreSQL kurulamadi. Internet baglantisini kontrol edip tekrar deneyin.
goto SON_HATA
:PG_BAGLANTI_HATA
echo HATA: PostgreSQL'e baglanilamadi. Sunucunun verdigi mesaj:
type "%PGHATA%"
echo.
echo Bu mesajin fotografini Claude'a gonderin.
goto SON_HATA
:PG_ONAR_HATA
echo HATA: PostgreSQL servisi onarilamadi. Yukaridaki mesajlarin fotografini Claude'a gonderin.
echo Servis: %PGSVC%   Veri klasoru: %PGDATA%
goto SON_HATA
:SIFIRLA_HATA
echo HATA: postgres sifresi sifirlanamadi. Sunucunun verdigi mesaj:
if exist "%PGHATA%" type "%PGHATA%"
echo Servis: %PGSVC%   Veri klasoru: %PGDATA%
echo Bu ekranin fotografini Claude'a gonderin.
goto SON_HATA
:DB_HATA
echo HATA: Veritabani hazirlanamadi. Yukaridaki hata mesajini Claude'a iletin.
goto SON_HATA
:KOPYA_HATA
echo HATA: Dosyalar kopyalanamadi. C:\PrimerLab klasorunun acik olmadigindan emin olun.
goto SON_HATA
:DERLEME_HATA
echo HATA: Program derlenemedi. Yukaridaki hata mesajini Claude'a iletin.
goto SON_HATA
:BASLATMA_HATA
echo HATA: Program baslatildi ancak acilmadi.
echo Ayrinti icin %UYGULAMA% klasorunde PrimerLabV2.exe'yi cift tiklayip mesaji okuyun.
goto SON_HATA
:SON_HATA
echo.
echo Kurulum tamamlanmadi. Sorunu giderip KURULUM.bat'i tekrar calistirabilirsiniz;
echo tamamlanan adimlar atlanir, veriler silinmez.
pause
exit /b 1
