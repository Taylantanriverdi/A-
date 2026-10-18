# Kılavuzdaki çizimler (SVG). kilavuz_olustur.py tarafından kullanılır.
ACC = '#2563eb'      # vurgulanan / yeni parça
DONE = '#cbd5e1'     # önceden takılmış parça
EDGE = '#475569'
SERVO = '#1e293b'
TXT = '#1d2330'


def _servo(x, y, w, h, renk=SERVO):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="{renk}"/>'


def _eksen_no(x, y, n):
    return (f'<circle cx="{x}" cy="{y}" r="11" fill="#f59e0b" stroke="#fff" stroke-width="2"/>'
            f'<text x="{x}" y="{y + 4.5}" font-size="13" font-weight="700" text-anchor="middle" fill="#fff">{n}</text>')


def kol(adim=7, vurgu=None, etiket=True, en=420):
    """Kolun yandan görünüşü. adim: kaçıncı montaj adımına kadar çizilecek (1..7).
    vurgu: o adımda eklenen parça mavi gösterilir."""
    def c(n):
        return ACC if n == vurgu else DONE
    p = []
    # zemin
    p.append('<rect x="20" y="332" width="300" height="10" rx="3" fill="#e2e8f0"/>')
    if adim >= 1:
        p.append(f'<rect x="85" y="268" width="130" height="64" rx="8" fill="{c(1)}" stroke="{EDGE}"/>')
        p.append(f'<rect x="132" y="282" width="36" height="40" rx="3" fill="{SERVO}" opacity=".85"/>')
        p.append('<line x1="150" y1="262" x2="150" y2="282" stroke="#94a3b8" stroke-width="4"/>')
    if adim >= 2:
        p.append(f'<rect x="72" y="252" width="156" height="16" rx="6" fill="{c(2)}" stroke="{EDGE}"/>')
    if adim >= 3:
        p.append(f'<path d="M118 252 L128 192 L172 192 L182 252 Z" fill="{c(3)}" stroke="{EDGE}"/>')
        p.append(_servo(133, 200, 34, 34))
    if adim >= 4:
        p.append(f'<line x1="150" y1="216" x2="232" y2="112" stroke="{EDGE}" stroke-width="28" stroke-linecap="round"/>')
        p.append(f'<line x1="150" y1="216" x2="232" y2="112" stroke="{c(4)}" stroke-width="26" stroke-linecap="round"/>')
        p.append(_servo(216, 96, 32, 32))
    if adim >= 5:
        p.append(f'<line x1="232" y1="112" x2="322" y2="138" stroke="{EDGE}" stroke-width="22" stroke-linecap="round"/>')
        p.append(f'<line x1="232" y1="112" x2="322" y2="138" stroke="{c(5)}" stroke-width="20" stroke-linecap="round"/>')
        p.append(_servo(310, 127, 22, 22))
    if adim >= 6:
        p.append(f'<rect x="330" y="128" width="30" height="22" rx="4" fill="{c(6)}" stroke="{EDGE}"/>')
        p.append(_servo(336, 132, 18, 14))
    if adim >= 7:
        p.append(f'<rect x="360" y="124" width="18" height="30" rx="3" fill="{c(7)}" stroke="{EDGE}"/>')
        p.append(f'<path d="M378 126 L406 118 L408 126 L382 133 Z" fill="{c(7)}" stroke="{EDGE}"/>')
        p.append(f'<path d="M378 152 L406 160 L408 152 L382 145 Z" fill="{c(7)}" stroke="{EDGE}"/>')
    if etiket:
        if adim >= 1: p.append(_eksen_no(64, 300, 1))
        if adim >= 3: p.append(_eksen_no(110, 216, 2))
        if adim >= 4: p.append(_eksen_no(232, 76, 3))
        if adim >= 5: p.append(_eksen_no(318, 104, 4))
        if adim >= 6: p.append(_eksen_no(345, 178, 5))
        if adim >= 7: p.append(_eksen_no(416, 139, 6))
    return (f'<svg viewBox="0 0 440 350" width="{en}" role="img" font-family="Inter, sans-serif">'
            + ''.join(p) + '</svg>')


def baglanti():
    """ESP32 - PCA9685 - güç kaynağı - servolar bağlantı şeması."""
    s = []
    def kutu(x, y, w, h, baslik, renk='#f8fafc', kenar='#334155'):
        s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{renk}" stroke="{kenar}" stroke-width="1.5"/>')
        s.append(f'<text x="{x + w / 2}" y="{y + 20}" text-anchor="middle" font-size="14" font-weight="700" fill="{TXT}">{baslik}</text>')
    def pin(x, y, ad, sag=False):
        s.append(f'<circle cx="{x}" cy="{y}" r="4" fill="#334155"/>')
        if sag:
            s.append(f'<text x="{x - 9}" y="{y + 4}" text-anchor="end" font-size="11" fill="{TXT}">{ad}</text>')
        else:
            s.append(f'<text x="{x + 9}" y="{y + 4}" font-size="11" fill="{TXT}">{ad}</text>')
    def tel(d, renk, w=3):
        s.append(f'<path d="{d}" fill="none" stroke="{renk}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"/>')

    # ESP32
    kutu(20, 150, 150, 170, 'ESP32 DevKit')
    pin(170, 200, '3V3', sag=True); pin(170, 230, 'GND', sag=True)
    pin(170, 260, 'GPIO21 (SDA)', sag=True); pin(170, 290, 'GPIO22 (SCL)', sag=True)
    s.append('<rect x="70" y="320" width="50" height="14" rx="3" fill="#94a3b8"/>')
    s.append(f'<text x="95" y="352" text-anchor="middle" font-size="11" fill="{TXT}">USB → bilgisayar</text>')
    # PCA9685
    kutu(290, 150, 190, 230, 'PCA9685')
    pin(290, 200, 'VCC'); pin(290, 230, 'GND'); pin(290, 260, 'SDA'); pin(290, 290, 'SCL')
    # mavi vida klemensi (PCA9685'in üst kenarında)
    s.append('<rect x="330" y="126" width="100" height="24" rx="4" fill="#3b82f6"/>')
    s.append('<text x="355" y="142" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">GND</text>')
    s.append('<text x="405" y="142" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">V+</text>')
    s.append(f'<text x="440" y="142" font-size="11" fill="{TXT}">mavi vida klemensi</text>')
    for i in range(6):
        y = 200 + i * 28
        s.append(f'<rect x="440" y="{y - 9}" width="30" height="18" rx="3" fill="#e2e8f0" stroke="#334155"/>')
        s.append(f'<text x="455" y="{y + 4}" text-anchor="middle" font-size="10" fill="{TXT}">K{i}</text>')
    # ESP32 -> PCA9685
    tel('M170 200 L290 200', '#dc2626'); tel('M170 230 L290 230', '#111827')
    tel('M170 260 L290 260', '#2563eb'); tel('M170 290 L290 290', '#16a34a')
    # Güç kaynağı: (−) solda, (+) sağda; teller kesişmeden klemense gider
    kutu(20, 20, 200, 60, 'Güç kaynağı 5–6 V, 10 A')
    s.append(f'<text x="90" y="72" text-anchor="middle" font-size="12" font-weight="700" fill="{TXT}">(−)</text>')
    s.append(f'<text x="150" y="72" text-anchor="middle" font-size="12" font-weight="700" fill="{TXT}">(+)</text>')
    tel('M150 80 L150 92 L405 92 L405 126', '#dc2626')
    tel('M90 80 L90 104 L355 104 L355 126', '#111827')
    # 1000 µF kondansatör: V+ ile GND arasında
    tel('M380 92 L380 100', '#dc2626', 2); tel('M380 114 L380 118 L355 118', '#111827', 2)
    s.append('<rect x="372" y="100" width="16" height="14" rx="2" fill="#0f172a"/>')
    s.append(f'<text x="440" y="108" font-size="11" fill="{TXT}">← 1000 µF kondansatör</text>')
    # Servolar
    adlar = ['Taban', 'Omuz', 'Dirsek', 'Bilek eğim', 'Bilek dönüş', 'Kıskaç']
    for i, ad in enumerate(adlar):
        y = 200 + i * 28
        tel(f'M470 {y} L560 {y}', '#f59e0b', 3)
        s.append(f'<rect x="560" y="{y - 10}" width="34" height="20" rx="3" fill="{SERVO}"/>')
        s.append(f'<text x="602" y="{y + 4}" font-size="12" fill="{TXT}">{ad}</text>')
    # açıklama
    lej = [('#dc2626', 'Artı (+)'), ('#111827', 'Toprak (GND)'), ('#2563eb', 'SDA'), ('#16a34a', 'SCL'), ('#f59e0b', 'Servo kablosu')]
    for i, (r, t) in enumerate(lej):
        x = 20 + i * 135
        s.append(f'<line x1="{x}" y1="410" x2="{x + 26}" y2="410" stroke="{r}" stroke-width="4"/>')
        s.append(f'<text x="{x + 32}" y="414" font-size="11" fill="{TXT}">{t}</text>')
    return '<svg viewBox="0 0 700 425" width="100%" role="img" font-family="Inter, sans-serif">' + ''.join(s) + '</svg>'


def servo_konnektor():
    s = ['<svg viewBox="0 0 330 90" width="330" role="img" font-family="Inter, sans-serif">']
    renk = [('#78350f', 'Kahverengi = GND'), ('#dc2626', 'Kırmızı = V+'), ('#f59e0b', 'Turuncu = Sinyal')]
    for i, (r, t) in enumerate(renk):
        y = 20 + i * 24
        s.append(f'<line x1="10" y1="{y}" x2="120" y2="{y}" stroke="{r}" stroke-width="6" stroke-linecap="round"/>')
        s.append(f'<text x="170" y="{y + 4}" font-size="12" fill="{TXT}">{t}</text>')
    s.append('<rect x="120" y="8" width="38" height="72" rx="4" fill="#111827"/>')
    s.append('</svg>')
    return ''.join(s)


def servo_ortala():
    """Servo üstten görünüş, 90° (orta) konumda kol takma."""
    s = ['<svg viewBox="0 0 300 220" width="300" role="img" font-family="Inter, sans-serif">']
    s.append(f'<rect x="70" y="70" width="160" height="80" rx="6" fill="{SERVO}"/>')
    s.append('<rect x="50" y="98" width="20" height="24" rx="2" fill="#334155"/><rect x="230" y="98" width="20" height="24" rx="2" fill="#334155"/>')
    s.append('<circle cx="120" cy="110" r="26" fill="#334155"/>')
    s.append('<path d="M120 110 L120 22" stroke="#e2e8f0" stroke-width="16" stroke-linecap="round"/>')
    s.append('<circle cx="120" cy="110" r="9" fill="#94a3b8"/>')
    s.append('<path d="M40 110 A80 80 0 0 1 200 110" fill="none" stroke="#94a3b8" stroke-dasharray="4 4"/>')
    for a, t, x, y in [(0, '0°', 28, 114), (90, '90°', 120, 14), (180, '180°', 212, 114)]:
        s.append(f'<text x="{x}" y="{y}" text-anchor="middle" font-size="12" font-weight="700" fill="{ACC}">{t}</text>')
    s.append(f'<text x="150" y="190" text-anchor="middle" font-size="12" fill="{TXT}">Servo 90°\'deyken kolu (horn)</text>')
    s.append(f'<text x="150" y="206" text-anchor="middle" font-size="12" fill="{TXT}">parçaya dik gelecek şekilde tak</text>')
    s.append('</svg>')
    return ''.join(s)


def ps4():
    s = ['<svg viewBox="-190 0 1020 290" width="100%" role="img" font-family="Inter, sans-serif">']
    s.append('<path d="M190 70 Q320 50 450 70 L520 220 Q530 270 480 262 L420 200 L220 200 L160 262 Q110 270 120 220 Z" fill="#e2e8f0" stroke="#334155" stroke-width="2"/>')
    s.append('<rect x="200" y="46" width="60" height="16" rx="6" fill="#94a3b8"/><rect x="380" y="46" width="60" height="16" rx="6" fill="#94a3b8"/>')
    s.append('<text x="230" y="58" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">L2</text><text x="410" y="58" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">R2</text>')
    s.append('<g fill="#475569"><rect x="200" y="100" width="14" height="40"/><rect x="187" y="113" width="40" height="14"/></g>')
    s.append('<g fill="#94a3b8"><circle cx="440" cy="100" r="9"/><circle cx="420" cy="120" r="9"/><circle cx="460" cy="120" r="9"/><circle cx="440" cy="140" r="9"/></g>')
    s.append('<circle cx="270" cy="170" r="22" fill="#475569"/><circle cx="370" cy="170" r="22" fill="#475569"/>')
    s.append('<rect x="395" y="82" width="12" height="20" rx="3" fill="#475569"/>')
    def not_(x1, y1, x2, y2, t, sol=True):
        s.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{ACC}" stroke-width="1.5"/>')
        s.append(f'<circle cx="{x1}" cy="{y1}" r="3" fill="{ACC}"/>')
        anc = 'end' if sol else 'start'
        dx = -6 if sol else 6
        s.append(f'<text x="{x2 + dx}" y="{y2 + 4}" text-anchor="{anc}" font-size="15" fill="{TXT}">{t}</text>')
    not_(230, 54, 150, 20, 'L2: Kıskaç AÇ')
    not_(207, 108, 120, 80, '↑ ↓: Bilek eğimi (4)')
    not_(190, 120, 120, 120, '← →: Hız %25 / %50 / %100')
    not_(270, 170, 120, 200, 'Sol çubuk: ↔ Taban (1), ↕ Omuz (2)')
    not_(410, 54, 490, 20, 'R2: Kıskaç KAPAT', sol=False)
    not_(401, 90, 520, 70, 'OPTIONS: Başlangıç pozisyonu', sol=False)
    not_(370, 170, 520, 200, 'Sağ çubuk: ↕ Dirsek (3), ↔ Bilek dönüş (5)', sol=False)
    s.append('</svg>')
    return ''.join(s)


def akis():
    adimlar = ['Malzeme', '3D baskı', 'Elektronik', 'Yazılım', 'Servo ortalama', 'Mekanik montaj', 'Kalibrasyon', 'Kullanım']
    s = ['<svg viewBox="0 0 700 120" width="100%" role="img" font-family="Inter, sans-serif">']
    for i, a in enumerate(adimlar):
        x = 10 + (i % 4) * 172
        y = 10 + (i // 4) * 58
        s.append(f'<rect x="{x}" y="{y}" width="150" height="42" rx="21" fill="{ACC if i == 0 else "#eff4ff"}" stroke="{ACC}"/>')
        s.append(f'<text x="{x + 75}" y="{y + 26}" text-anchor="middle" font-size="13" font-weight="600" fill="{"#fff" if i == 0 else TXT}">{i + 1}. {a}</text>')
        if i % 4 != 3:
            s.append(f'<path d="M{x + 152} {y + 21} L{x + 168} {y + 21}" stroke="{ACC}" stroke-width="2" marker-end="url(#ok)"/>')
    s.append(f'<defs><marker id="ok" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="{ACC}"/></marker></defs>')
    s.append('</svg>')
    return ''.join(s)
