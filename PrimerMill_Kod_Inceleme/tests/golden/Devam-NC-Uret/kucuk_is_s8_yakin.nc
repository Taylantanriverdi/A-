(@@ dosya kucuk_is_devam.nc Satir=6 Takim=4 HaritaBas=15 HaritaOrijinal=6 Tekrar=0.75)
%
(PrimerMill DEVAM: kucuk_is.nc satir 7 / 13, mod yakin)
G0 G17 G40 G49 G54 G80 G90
M9
M5
GOSUB Z_SAFE
GOSUB AZXY_SAFE
G0 B0.0
T4 M6
S20000 M3
GOSUB Z_SAFE
GOSUB AZXY_SAFE
G0 A0 B0
G90 F1000
GOSUB Z_SAFE
G0 X1 Y2
G1 Z-1 F500
G1 X5 Y5
GOSUB Z_SAFE
M5
M30
%
