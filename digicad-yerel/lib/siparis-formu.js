'use strict';
// ═══════════════════════════════════════════════════════════════════
//  SİPARİŞ TAKİP FORMU (sunucu tarafı)
//  Yönetim panelindeki "Sipariş Formu → Yazdır" (printOrderForm) çıktısının
//  BİREBİR aynısı. Hekim portalından gelen talep, panelin "Forma Aktar"
//  (_fillOrderFormFromSubmission) kurallarıyla forma çevrilir.
//  Panel şablonunda değişiklik yapılırsa bu dosya da güncellenmelidir.
// ═══════════════════════════════════════════════════════════════════

const ORDER_MATERIALS = ['ZIRCONIA', 'METAL DESTEKLİ PORSELEN', 'EMAX', 'LAMİNE', 'PMMA', 'TITANIUM'];
const FDI_QUADRANTS = {
  ur: [18, 17, 16, 15, 14, 13, 12, 11],
  ul: [21, 22, 23, 24, 25, 26, 27, 28],
  br: [48, 47, 46, 45, 44, 43, 42, 41],
  bl: [31, 32, 33, 34, 35, 36, 37, 38],
};

const escHtml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const buyuk = s => String(s || '').toLocaleUpperCase('tr-TR');
function fmtDate(d) {
  if (!d) return '-';
  const [y, m, g] = String(d).split('-');
  return `${g}.${m}.${y}`;
}
function bugun() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Hekim talebi → form alanları (panelin "Forma Aktar" kurallarıyla aynı)
function talepten(sub) {
  const teeth = (Array.isArray(sub.teeth) ? sub.teeth : []).map(Number).filter(Boolean);
  const jobLines = Array.isArray(sub.jobTypes) && sub.jobTypes.length
    ? sub.jobTypes.map(j => ({ type: j.type || 'Belirsiz', qty: j.qty || 1 }))
    : (sub.jobType ? [{ type: sub.jobType, qty: teeth.length || 1 }] : []);
  const ilkTur = buyuk((jobLines[0] || {}).type);
  const material = ilkTur ? (ORDER_MATERIALS.find(m => ilkTur.includes(m.split(' ')[0])) || '') : '';

  const jawLabel = sub.jaw === 'upper' ? 'ÜST ÇENE' : sub.jaw === 'lower' ? 'ALT ÇENE' : sub.jaw === 'both' ? 'ÜST + ALT ÇENE' : '';
  const dosyalar = (Array.isArray(sub.files) ? sub.files : []).filter(Boolean)
    .map(f => f.link ? `${String(f.name || 'Bağlantı').replace(/\.url$/, '')} (${f.linkUrl || ''})` : String(f.name || 'dosya'));
  let n = '';
  if (jawLabel) n += `ÇENE: ${jawLabel}\n`;
  if (dosyalar.length) n += `TARAMA DOSYALARI: ${dosyalar.join(', ')}\n`;
  if (sub.implantBrand) n += `İMPLANT: ${buyuk(sub.implantBrand)}\n`;
  if (sub.designSource === 'doctor') n += 'HEKİM KENDİ TASARIMINI GÖNDERDİ (DOĞRUDAN ÜRETİM)\n';
  if (sub.notes) n += buyuk(sub.notes);

  return {
    doctorName: buyuk(sub.doctorName || sub.drName),
    patient: buyuk(sub.patient),
    color: buyuk(sub.color),
    qty: teeth.length || '',
    dateout: sub.dateout || bugun(),
    notes: n.trim(),
    material,
    teeth,
    jobLines,
  };
}

// printOrderForm ile aynı HTML (otomatik yazdırma betiği hariç)
function html(f) {
  const jobLines = f.jobLines || [];
  const teethSet = new Set(f.teeth);
  const drawTeethRow = (nums) => nums.map(n => {
    const sel = teethSet.has(n);
    return `<td style="width:30px;text-align:center;padding:2px;border:1px solid #ccc;background:${sel ? '#1a2740' : '#fff'};color:${sel ? '#fff' : '#1a2740'};font-weight:${sel ? '700' : '500'};font-size:11px">${n}</td>`;
  }).join('');
  const drawNumRow = (nums) => nums.map(n => `<td style="width:30px;text-align:center;padding:1px;font-size:8px;color:#888">${n}</td>`).join('');

  const matList = ORDER_MATERIALS.map(m => {
    const checked = f.material === m;
    return `<div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-bottom:6px">
      <span style="display:inline-block;width:14px;height:14px;border:1.5px solid #1a2740;text-align:center;line-height:12px;font-size:12px">${checked ? '✓' : ''}</span>
      ${escHtml(m)}
    </div>`;
  }).join('');

  const jobLinesBlock = jobLines.length > 1
    ? `<div>
        <div class="lbl">İŞ KALEMLERİ</div>
        <table style="width:100%;border-collapse:collapse;margin-top:4px">
          ${jobLines.map(l => `<tr>
            <td style="padding:3px 0;font-size:13px;font-weight:700;border-bottom:1px dotted #ccc">${escHtml(l.type)}</td>
            <td style="padding:3px 0;font-size:13px;font-weight:700;text-align:right;border-bottom:1px dotted #ccc;width:50px">${l.qty} ad.</td>
          </tr>`).join('')}
        </table>
      </div>`
    : `<div>
        <div class="lbl">ÜYE SAYISI</div>
        <div class="val-big">${f.qty || ''}</div>
      </div>`;

  return `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>Sipariş Takip Formu</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html{background:#fff}
  body{font-family:Arial,sans-serif;color:#1a2740;padding:20px;font-size:12px}
  .head{display:grid;grid-template-columns:240px 1fr;gap:20px;align-items:center;border-bottom:2px solid #1a2740;padding-bottom:14px;margin-bottom:14px}
  .logo-wrap{text-align:center}
  .logo{font-size:42px;font-weight:900;letter-spacing:2px;line-height:1}
  .name{font-size:12px;font-weight:700;margin-top:4px}
  .addr{font-size:9px;color:#5a6b7a;margin-top:4px;line-height:1.4}
  .form-title{text-align:center;font-size:18px;font-weight:700;letter-spacing:3px;margin-top:8px}
  .row{display:grid;border:1.5px solid #1a2740;margin-bottom:10px}
  .row-2{grid-template-columns:1fr 1fr}
  .cell{padding:10px 12px;border-right:1.5px solid #1a2740}
  .cell:last-child{border-right:none}
  .lbl{font-size:10px;font-weight:700;letter-spacing:.8px;margin-bottom:6px}
  .val{font-size:18px;font-weight:700;min-height:28px;border-bottom:1px dotted #ccc;padding:4px 0}
  .val-big{font-size:22px;text-align:center;padding:8px 0;border-bottom:1px dotted #ccc}
  .notes{border:1.5px solid #1a2740;padding:10px 12px;min-height:130px;margin-top:10px}
  .notes .val-text{white-space:pre-wrap;font-size:13px;font-weight:500;line-height:1.6;margin-top:6px;overflow-wrap:anywhere}
  .tooth-table{margin:0 auto;border-collapse:collapse}
  .quad-divider{border:none;height:1.5px;background:#1a2740;margin:0}
</style></head>
<body>
  <div class="head">
    <div class="logo-wrap">
      <div class="logo">DC</div>
      <div class="name">DIGICAD DENTAL STUDIO</div>
      <div class="addr">
        Oğuzlar Mh. 1379 Sk. 13/12<br>
        Balgat / Çankaya / Ankara<br>
        0(505) 648 18 93<br>0(553) 002 76 76
      </div>
    </div>
    <div>
      <table class="tooth-table">
        <tr>${drawNumRow(FDI_QUADRANTS.ur)}<td style="width:4px"></td>${drawNumRow(FDI_QUADRANTS.ul)}</tr>
        <tr>${drawTeethRow(FDI_QUADRANTS.ur)}<td style="width:4px;border-left:2px solid #1a2740"></td>${drawTeethRow(FDI_QUADRANTS.ul)}</tr>
        <tr><td colspan="${FDI_QUADRANTS.ur.length * 2 + 1}"><hr class="quad-divider"></td></tr>
        <tr>${drawTeethRow(FDI_QUADRANTS.br)}<td style="width:4px;border-left:2px solid #1a2740"></td>${drawTeethRow(FDI_QUADRANTS.bl)}</tr>
        <tr>${drawNumRow(FDI_QUADRANTS.br)}<td style="width:4px"></td>${drawNumRow(FDI_QUADRANTS.bl)}</tr>
      </table>
      <div class="form-title">SİPARİŞ TAKİP FORMU</div>
    </div>
  </div>

  <div class="row row-2">
    <div class="cell"><div class="lbl">KLİNİK / HEKİM</div><div class="val">${escHtml(f.doctorName || '')}</div></div>
    <div class="cell"><div class="lbl">HASTA ADI - SOYADI</div><div class="val">${escHtml(f.patient || '')}</div></div>
  </div>

  <div class="row row-2" style="min-height:200px">
    <div class="cell" style="display:flex;flex-direction:column;gap:14px">
      <div>
        <div class="lbl">RENK</div>
        <div class="val-big">${escHtml(f.color || '')}</div>
      </div>
      ${jobLinesBlock}
      ${f.dateout ? `<div><div class="lbl">TESLİM TARİHİ</div><div class="val" style="text-align:center;font-size:14px">${fmtDate(f.dateout)}</div></div>` : ''}
    </div>
    <div class="cell">
      <div class="lbl">MATERYAL</div>
      <div style="margin-top:8px">${matList}</div>
    </div>
  </div>

  <div class="notes">
    <div class="lbl">NOTLAR</div>
    <div class="val-text">${escHtml(f.notes || '')}</div>
  </div>
</body></html>`;
}

module.exports = { talepten, html, ORDER_MATERIALS };
