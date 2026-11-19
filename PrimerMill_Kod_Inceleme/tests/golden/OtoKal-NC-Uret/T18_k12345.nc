%
(PrimerMill OTOMATIK KALIBRASYON  disk 18 mm  kimlik 12345  <TARIH>)
(Iletken temas: titanyum disk prob girisine bagli ve tutucudan izole, is mili sasede)
(IS MILI DONMEZ. T1 istenince kalibrasyon pimini veya T1 frezini tak.)
#4100 = 0
#4199 = 12345
GOSUB CHECK_EMPTY_TOOL
G0 G17 G40 G49 G54 G80 G90
M5
M9
G0 B0.0
T1 M6
M5
(takim boyu: sensor)
GOSUB user_1
M5
(UST YUZ B0 A0)
GOSUB Z_SAFE
G0 A0.0 B0.0
(P0 ust merkez)
G0 X0 Y0
G38.2 Z3 F200
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - ust merkez - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [3 + 12]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - ust merkez - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - ust merkez - kablo, izolasyon, disk kalinligi"
endif
#4101 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - ust merkez - kablo, izolasyon, disk kalinligi"
endif
#4102 = #5063
G0 Z[#5063 + 6]
(tekrarlanabilirlik: merkez 5 kez)
G0 Z[#4101 + 0.4]
G38.2 Z[#4101 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - tekrar - kablo, izolasyon, disk kalinligi"
endif
#4141 = #5063
G0 Z[#4101 + 0.4]
G38.2 Z[#4101 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - tekrar - kablo, izolasyon, disk kalinligi"
endif
#4142 = #5063
G0 Z[#4101 + 0.4]
G38.2 Z[#4101 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - tekrar - kablo, izolasyon, disk kalinligi"
endif
#4143 = #5063
G0 Z[#4101 + 0.4]
G38.2 Z[#4101 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - tekrar - kablo, izolasyon, disk kalinligi"
endif
#4144 = #5063
G0 Z[#4101 + 0.4]
G38.2 Z[#4101 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - tekrar - kablo, izolasyon, disk kalinligi"
endif
#4145 = #5063
G0 Z[#4101 + 6]
(P1 ust X+)
G0 X25 Y0
G0 Z[#4101 + 6]
G38.2 Z[#4101 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - ust X+ - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4101 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - ust X+ - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - ust X+ - kablo, izolasyon, disk kalinligi"
endif
#4103 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - ust X+ - kablo, izolasyon, disk kalinligi"
endif
#4104 = #5063
G0 Z[#4101 + 6]
(P2 ust X-)
G0 X-25 Y0
G0 Z[#4101 + 6]
G38.2 Z[#4101 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - ust X- - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4101 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - ust X- - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - ust X- - kablo, izolasyon, disk kalinligi"
endif
#4105 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - ust X- - kablo, izolasyon, disk kalinligi"
endif
#4106 = #5063
G0 Z[#4101 + 6]
(P3 ust Y+)
G0 X0 Y25
G0 Z[#4101 + 6]
G38.2 Z[#4101 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - ust Y+ - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4101 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - ust Y+ - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - ust Y+ - kablo, izolasyon, disk kalinligi"
endif
#4107 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - ust Y+ - kablo, izolasyon, disk kalinligi"
endif
#4108 = #5063
G0 Z[#4101 + 6]
(P4 ust Y-)
G0 X0 Y-25
G0 Z[#4101 + 6]
G38.2 Z[#4101 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - ust Y- - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4101 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - ust Y- - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - ust Y- - kablo, izolasyon, disk kalinligi"
endif
#4109 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - ust Y- - kablo, izolasyon, disk kalinligi"
endif
#4110 = #5063
G0 Z[#4101 + 6]
(A15 B0)
GOSUB Z_SAFE
G0 A15 B0.0
(P5 A+ Y-)
G0 X0 Y-8
G0 Z[#4101 + 6]
G38.2 Z[#4101 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - A+ Y- - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4101 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - A+ Y- - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - A+ Y- - kablo, izolasyon, disk kalinligi"
endif
#4111 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - A+ Y- - kablo, izolasyon, disk kalinligi"
endif
#4112 = #5063
G0 Z[#4101 + 6]
(P6 A+ Y+)
G0 X0 Y8
G0 Z[#4101 + 6]
G38.2 Z[#4101 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - A+ Y+ - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4101 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - A+ Y+ - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - A+ Y+ - kablo, izolasyon, disk kalinligi"
endif
#4113 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - A+ Y+ - kablo, izolasyon, disk kalinligi"
endif
#4114 = #5063
G0 Z[#4101 + 6]
(A-15 B0)
GOSUB Z_SAFE
G0 A-15 B0.0
(P7 A- Y-)
G0 X0 Y-8
G0 Z[#4101 + 6]
G38.2 Z[#4101 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - A- Y- - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4101 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - A- Y- - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - A- Y- - kablo, izolasyon, disk kalinligi"
endif
#4115 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - A- Y- - kablo, izolasyon, disk kalinligi"
endif
#4116 = #5063
G0 Z[#4101 + 6]
(P8 A- Y+)
G0 X0 Y8
G0 Z[#4101 + 6]
G38.2 Z[#4101 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - A- Y+ - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4101 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - A- Y+ - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - A- Y+ - kablo, izolasyon, disk kalinligi"
endif
#4117 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - A- Y+ - kablo, izolasyon, disk kalinligi"
endif
#4118 = #5063
G0 Z[#4101 + 6]
(B15 A0)
GOSUB Z_SAFE
G0 A0.0
GOSUB AZXY_SAFE
G0 B15
(P9 B+ X-)
G0 X-8 Y0
G0 Z[#4101 + 6]
G38.2 Z[#4101 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - B+ X- - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4101 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - B+ X- - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - B+ X- - kablo, izolasyon, disk kalinligi"
endif
#4119 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - B+ X- - kablo, izolasyon, disk kalinligi"
endif
#4120 = #5063
G0 Z[#4101 + 6]
(P10 B+ X+)
G0 X8 Y0
G0 Z[#4101 + 6]
G38.2 Z[#4101 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - B+ X+ - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4101 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - B+ X+ - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - B+ X+ - kablo, izolasyon, disk kalinligi"
endif
#4121 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - B+ X+ - kablo, izolasyon, disk kalinligi"
endif
#4122 = #5063
G0 Z[#4101 + 6]
(B-15 A0)
GOSUB Z_SAFE
G0 A0.0
GOSUB AZXY_SAFE
G0 B-15
(P11 B- X-)
G0 X-8 Y0
G0 Z[#4101 + 6]
G38.2 Z[#4101 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - B- X- - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4101 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - B- X- - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - B- X- - kablo, izolasyon, disk kalinligi"
endif
#4123 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - B- X- - kablo, izolasyon, disk kalinligi"
endif
#4124 = #5063
G0 Z[#4101 + 6]
(P12 B- X+)
G0 X8 Y0
G0 Z[#4101 + 6]
G38.2 Z[#4101 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - B- X+ - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4101 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - B- X+ - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - B- X+ - kablo, izolasyon, disk kalinligi"
endif
#4125 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - B- X+ - kablo, izolasyon, disk kalinligi"
endif
#4126 = #5063
G0 Z[#4101 + 6]
(ALT YUZ B180)
GOSUB Z_SAFE
G0 A0.0
GOSUB AZXY_SAFE
G0 B180.0
(P13 alt merkez)
G0 X0 Y0
G38.2 Z3 F200
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - alt merkez - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [3 + 12]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - alt merkez - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - alt merkez - kablo, izolasyon, disk kalinligi"
endif
#4127 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - alt merkez - kablo, izolasyon, disk kalinligi"
endif
#4128 = #5063
G0 Z[#5063 + 6]
(P14 alt X+)
G0 X25 Y0
G0 Z[#4127 + 6]
G38.2 Z[#4127 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - alt X+ - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4127 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - alt X+ - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - alt X+ - kablo, izolasyon, disk kalinligi"
endif
#4129 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - alt X+ - kablo, izolasyon, disk kalinligi"
endif
#4130 = #5063
G0 Z[#4127 + 6]
(P15 alt X-)
G0 X-25 Y0
G0 Z[#4127 + 6]
G38.2 Z[#4127 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - alt X- - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4127 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - alt X- - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - alt X- - kablo, izolasyon, disk kalinligi"
endif
#4131 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - alt X- - kablo, izolasyon, disk kalinligi"
endif
#4132 = #5063
G0 Z[#4127 + 6]
(P16 alt Y+)
G0 X0 Y25
G0 Z[#4127 + 6]
G38.2 Z[#4127 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - alt Y+ - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4127 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - alt Y+ - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - alt Y+ - kablo, izolasyon, disk kalinligi"
endif
#4133 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - alt Y+ - kablo, izolasyon, disk kalinligi"
endif
#4134 = #5063
G0 Z[#4127 + 6]
(P17 alt Y-)
G0 X0 Y-25
G0 Z[#4127 + 6]
G38.2 Z[#4127 - 6] F120
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - alt Y- - kablo, izolasyon, disk kalinligi"
endif
if [#5063 > [[#4127 + 6] - 0.02]]
  errmsg "PM KALIBRASYON: prob baslangicta aktif - alt Y- - disk sasede degiyor olabilir"
endif
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - alt Y- - kablo, izolasyon, disk kalinligi"
endif
#4135 = #5063
G0 Z[#5063 + 0.4]
G38.2 Z[#5063 - 0.8] F10
if [#5067 == 0]
  errmsg "PM KALIBRASYON: temas yok - alt Y- - kablo, izolasyon, disk kalinligi"
endif
#4136 = #5063
G0 Z[#4127 + 6]
(bitti)
GOSUB Z_SAFE
G0 A0.0
GOSUB AZXY_SAFE
G0 B0.0
#4100 = 1
msg "PM KALIBRASYON: olcum bitti - PrimerMill > Ayarlar > OTO KALIBRASYON > SONUCLARI OKU"
M5
T0 M6
G30
M30
%
