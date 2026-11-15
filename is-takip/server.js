'use strict';
/*
 * Klinik ⇄ Teknisyen İş Takip Sistemi — sunucu
 * Bağımlılık yok: yalnızca Node.js (>=18) yerleşik modülleri kullanılır.
 * Veriler ./data/db.json içinde, yüklenen dosyalar ./data/uploads içinde tutulur.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_UPLOAD = 300 * 1024 * 1024; // 300 MB
const SESSION_DAYS = 30;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Veri katmanı                                                        */
/* ------------------------------------------------------------------ */
const now = () => new Date().toISOString();
const uid = (p) => p + '_' + crypto.randomBytes(8).toString('hex');

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return salt + ':' + hash;
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 64);
  const real = Buffer.from(hash, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}

function emptyDb() {
  return { users: [], sessions: [], patients: [], cases: [], events: [], files: [], reads: {} };
}

let db;
function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    db = Object.assign(emptyDb(), JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } else {
    db = emptyDb();
    seed();
    saveNow();
  }
}
let saveTimer = null;
function saveNow() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 150);
}
process.on('SIGINT', () => { saveNow(); process.exit(0); });
process.on('SIGTERM', () => { saveNow(); process.exit(0); });

function seed() {
  const mk = (name, email, role, org, phone) => {
    const u = { id: uid('u'), name, email, role, org, phone, password: hashPassword('1234'), createdAt: now() };
    db.users.push(u);
    return u;
  };
  const k1 = mk('Dt. Ayşe Yılmaz', 'klinik@demo.com', 'clinic', 'Gülüş Ağız ve Diş Sağlığı Kliniği', '0212 555 10 10');
  mk('Dt. Mehmet Kaya', 'klinik2@demo.com', 'clinic', 'Kaya Dental', '0216 555 20 20');
  const t1 = mk('Tekn. Can Demir', 'teknisyen@demo.com', 'technician', 'Demir Dental Laboratuvarı', '0532 555 30 30');
  mk('Tekn. Elif Şahin', 'teknisyen2@demo.com', 'technician', 'Şahin CAD/CAM Lab', '0533 555 40 40');

  const p1 = { id: uid('p'), name: 'Ali Veli', clinicId: k1.id, createdBy: k1.id, phone: '0505 111 22 33', birthDate: '1980-04-12', gender: 'E', notes: 'Penisilin alerjisi var.', createdAt: now() };
  const p2 = { id: uid('p'), name: 'Zeynep Arslan', clinicId: k1.id, createdBy: k1.id, phone: '', birthDate: '1992-09-03', gender: 'K', notes: '', createdAt: now() };
  db.patients.push(p1, p2);

  const day = 864e5;
  const c1 = newCase({
    patientId: p1.id, from: k1, to: t1, title: 'Üst çene zirkonyum köprü', workType: 'Köprü',
    teeth: [14, 15, 16], shade: 'A2', material: 'Zirkonyum', priority: 'normal',
    dueDate: new Date(Date.now() + 5 * day).toISOString().slice(0, 10),
    description: 'Ağız içi tarama STL dosyaları ekte. Okluzyon kontrolü önemli.'
  });
  addEvent(c1, t1.id, 'status', 'İş kabul edildi', { from: 'gonderildi', to: 'kabul' });
  c1.status = 'kabul';
  addEvent(c1, t1.id, 'note', 'Merhaba hocam, dosyalar ulaştı. Cuma provaya gönderebiliriz.');
  addEvent(c1, k1.id, 'note', 'Teşekkürler, hasta cuma 14:00 için randevulu.');

  newCase({
    patientId: p2.id, from: k1, to: t1, title: 'Gece plağı', workType: 'Plak / Splint',
    teeth: [], shade: '', material: 'Şeffaf akrilik', priority: 'acil',
    dueDate: new Date(Date.now() + 1 * day).toISOString().slice(0, 10),
    description: 'Bruksizm. Sert plak, 2 mm.'
  });
}

/* ------------------------------------------------------------------ */
/* İş akışı                                                            */
/* ------------------------------------------------------------------ */
const STATUS = {
  gonderildi: 'Gönderildi',
  kabul: 'Kabul edildi',
  reddedildi: 'Reddedildi',
  uretimde: 'Üretimde',
  prova: 'Provada',
  revizyon: 'Revizyon',
  hazir: 'Hazır',
  teslim: 'Teslim edildi',
  tamamlandi: 'Tamamlandı',
  iptal: 'İptal'
};
// who: clinic | technician | sender | receiver
const TRANSITIONS = {
  gonderildi: [
    { to: 'kabul', who: 'receiver', label: 'İşi kabul et' },
    { to: 'reddedildi', who: 'receiver', label: 'Reddet', needNote: true },
    { to: 'iptal', who: 'sender', label: 'İptal et' }
  ],
  kabul: [
    { to: 'uretimde', who: 'technician', label: 'Üretime başla' },
    { to: 'iptal', who: 'clinic', label: 'İptal et' }
  ],
  uretimde: [
    { to: 'prova', who: 'technician', label: 'Provaya gönder' },
    { to: 'hazir', who: 'technician', label: 'Hazır olarak işaretle' }
  ],
  prova: [
    { to: 'uretimde', who: 'clinic', label: 'Prova onaylandı, devam' },
    { to: 'revizyon', who: 'clinic', label: 'Revizyon iste', needNote: true }
  ],
  revizyon: [
    { to: 'uretimde', who: 'technician', label: 'Revizyona başla' }
  ],
  hazir: [
    { to: 'teslim', who: 'technician', label: 'Teslim et / kargoya ver' }
  ],
  teslim: [
    { to: 'tamamlandi', who: 'clinic', label: 'Teslim alındı, tamamla' },
    { to: 'revizyon', who: 'clinic', label: 'Revizyon iste', needNote: true }
  ],
  reddedildi: [
    { to: 'gonderildi', who: 'sender', label: 'Yeniden gönder' },
    { to: 'iptal', who: 'sender', label: 'İptal et' }
  ],
  tamamlandi: [],
  iptal: []
};
const PRIORITIES = ['dusuk', 'normal', 'yuksek', 'acil'];

function nextCaseNo() {
  const year = new Date().getFullYear();
  const n = db.cases.filter((c) => c.no && c.no.startsWith(year + '-')).length + 1;
  return `${year}-${String(n).padStart(4, '0')}`;
}

function newCase({ patientId, from, to, title, workType, teeth, shade, material, priority, dueDate, description }) {
  const clinic = from.role === 'clinic' ? from : to;
  const tech = from.role === 'technician' ? from : to;
  const c = {
    id: uid('c'), no: nextCaseNo(), patientId,
    clinicId: clinic.id, technicianId: tech.id, fromId: from.id, toId: to.id,
    title: String(title || workType || 'İş').slice(0, 200), workType: workType || '',
    teeth: Array.isArray(teeth) ? teeth.map(Number).filter((t) => t >= 11 && t <= 48) : [],
    shade: shade || '', material: material || '',
    priority: PRIORITIES.includes(priority) ? priority : 'normal',
    dueDate: dueDate || null, description: description || '',
    status: 'gonderildi', createdAt: now(), updatedAt: now()
  };
  db.cases.push(c);
  addEvent(c, from.id, 'created', `İş oluşturuldu ve ${to.name} (${to.org}) kişisine gönderildi`);
  return c;
}

function addEvent(c, userId, type, text, meta) {
  const e = { id: uid('e'), caseId: c.id, userId, type, text: String(text || '').slice(0, 5000), meta: meta || null, at: now() };
  db.events.push(e);
  c.updatedAt = e.at;
  return e;
}

function roleIn(c, user) {
  const r = new Set();
  if (c.clinicId === user.id) r.add('clinic');
  if (c.technicianId === user.id) r.add('technician');
  if (c.fromId === user.id) r.add('sender');
  if (c.toId === user.id) r.add('receiver');
  return r;
}
function allowedActions(c, user) {
  const roles = roleIn(c, user);
  return (TRANSITIONS[c.status] || []).filter((t) => roles.has(t.who));
}
const canSeeCase = (c, user) => c.clinicId === user.id || c.technicianId === user.id;
function canSeePatient(p, user) {
  if (p.clinicId === user.id || p.createdBy === user.id) return true;
  return db.cases.some((c) => c.patientId === p.id && canSeeCase(c, user));
}

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */
const publicUser = (u) => u && ({ id: u.id, name: u.name, email: u.email, role: u.role, org: u.org, phone: u.phone || '' });
const userById = (id) => db.users.find((u) => u.id === id);

function unreadCount(c, user) {
  const last = (db.reads[user.id] || {})[c.id] || '';
  return db.events.filter((e) => e.caseId === c.id && e.userId !== user.id && e.at > last).length;
}

function caseSummary(c, user) {
  const p = db.patients.find((x) => x.id === c.patientId);
  return {
    ...c,
    statusLabel: STATUS[c.status],
    patientName: p ? p.name : '—',
    clinic: publicUser(userById(c.clinicId)),
    technician: publicUser(userById(c.technicianId)),
    from: publicUser(userById(c.fromId)),
    to: publicUser(userById(c.toId)),
    direction: c.toId === user.id ? 'incoming' : 'outgoing',
    fileCount: db.files.filter((f) => f.caseId === c.id).length,
    noteCount: db.events.filter((e) => e.caseId === c.id && e.type === 'note').length,
    unread: unreadCount(c, user),
    actions: allowedActions(c, user)
  };
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(data);
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (ch) => {
      size += ch.length;
      if (size > limit) { reject(new HttpError(413, 'İstek çok büyük')); req.destroy(); return; }
      chunks.push(ch);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Geçersiz JSON')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
// Her sekme kendi oturum anahtarini "Authorization: Bearer" basligiyla gonderir;
// boylece ayni tarayicida bir sekmede klinik, digerinde teknisyen olarak calisilabilir.
// EventSource baslik gonderemedigi icin canli akista ?sid= kullanilir; cerez yedek yontemdir.
function requestToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return { token: h.slice(7).trim(), via: 'header' };
  const q = new URL(req.url, 'http://x').searchParams.get('sid');
  if (q) return { token: q, via: 'query' };
  const c = parseCookies(req).sid;
  return c ? { token: c, via: 'cookie' } : { token: null, via: null };
}
function newSessionToken(u) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions = db.sessions.filter((s) => new Date(s.expiresAt) > new Date());
  db.sessions.push({ token, userId: u.id, expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5).toISOString() });
  save();
  return token;
}
function currentUser(req) {
  const { token } = requestToken(req);
  if (!token) return null;
  const s = db.sessions.find((x) => x.token === token);
  if (!s || new Date(s.expiresAt) < new Date()) return null;
  return userById(s.userId) || null;
}
function requireUser(req) {
  const u = currentUser(req);
  if (!u) fail(401, 'Oturum açmanız gerekiyor');
  return u;
}
function getCaseFor(id, user) {
  const c = db.cases.find((x) => x.id === id);
  if (!c || !canSeeCase(c, user)) fail(404, 'İş bulunamadı');
  return c;
}

/* ------------------------------------------------------------------ */
/* Gerçek zamanlı bildirim (Server-Sent Events)                        */
/* ------------------------------------------------------------------ */
const streams = new Map(); // userId -> Set<res>
function notify(userIds, payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const id of new Set(userIds)) {
    for (const res of streams.get(id) || []) res.write(msg);
  }
}
const notifyCase = (c, actor, kind, text) =>
  notify([c.clinicId, c.technicianId], { kind, caseId: c.id, patientId: c.patientId, caseNo: c.no, actorId: actor.id, actorName: actor.name, text });
setInterval(() => { for (const set of streams.values()) for (const r of set) r.write(': ping\n\n'); }, 25000).unref();

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

route('POST', '/api/register', async (req, res) => {
  const b = await readJson(req);
  const email = String(b.email || '').trim().toLowerCase();
  if (!b.name || !email || !b.password) fail(400, 'Ad, e-posta ve şifre zorunlu');
  if (String(b.password).length < 4) fail(400, 'Şifre en az 4 karakter olmalı');
  if (!['clinic', 'technician'].includes(b.role)) fail(400, 'Rol klinik veya teknisyen olmalı');
  if (db.users.some((u) => u.email === email)) fail(409, 'Bu e-posta zaten kayıtlı');
  const u = { id: uid('u'), name: String(b.name).trim(), email, role: b.role, org: String(b.org || '').trim(), phone: String(b.phone || ''), password: hashPassword(b.password), createdAt: now() };
  db.users.push(u);
  save();
  startSession(res, u);
});

function startSession(res, u) {
  const token = newSessionToken(u);
  send(res, 200, { user: publicUser(u), token }, {
    'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`
  });
}

route('POST', '/api/login', async (req, res) => {
  const b = await readJson(req);
  const u = db.users.find((x) => x.email === String(b.email || '').trim().toLowerCase());
  if (!u || !checkPassword(b.password, u.password)) fail(401, 'E-posta veya şifre hatalı');
  startSession(res, u);
});

route('POST', '/api/logout', async (req, res) => {
  const { token } = requestToken(req);
  db.sessions = db.sessions.filter((s) => s.token !== token);
  save();
  // Cerez yalnizca bu sekmenin oturumuna aitse silinir (diger sekmeler etkilenmesin)
  const headers = parseCookies(req).sid === token ? { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' } : {};
  send(res, 200, { ok: true }, headers);
});

route('GET', '/api/me', async (req, res) => {
  const u = requireUser(req);
  // Cerezle acilan yeni sekmeye kendi anahtari verilir; sonra baska sekmedeki girislerden etkilenmez
  const tabToken = requestToken(req).via === 'cookie' ? newSessionToken(u) : undefined;
  send(res, 200, { user: publicUser(u), statuses: STATUS, priorities: PRIORITIES, tabToken });
});

route('PATCH', '/api/me', async (req, res) => {
  const u = requireUser(req);
  const b = await readJson(req);
  if (b.name) u.name = String(b.name).trim();
  if (b.org !== undefined) u.org = String(b.org).trim();
  if (b.phone !== undefined) u.phone = String(b.phone).trim();
  if (b.newPassword) {
    if (!checkPassword(b.currentPassword, u.password)) fail(400, 'Mevcut şifre hatalı');
    u.password = hashPassword(b.newPassword);
  }
  save();
  send(res, 200, { user: publicUser(u) });
});

route('GET', '/api/partners', async (req, res) => {
  const u = requireUser(req);
  const want = u.role === 'clinic' ? 'technician' : 'clinic';
  send(res, 200, db.users.filter((x) => x.role === want).map(publicUser));
});

/* --- Hastalar --- */
route('GET', '/api/patients', async (req, res, { query }) => {
  const u = requireUser(req);
  const q = (query.get('q') || '').toLocaleLowerCase('tr');
  const list = db.patients
    .filter((p) => canSeePatient(p, u))
    .filter((p) => !q || p.name.toLocaleLowerCase('tr').includes(q) || (p.phone || '').includes(q))
    .map((p) => {
      const cases = db.cases.filter((c) => c.patientId === p.id && canSeeCase(c, u))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((c) => caseSummary(c, u));
      return { ...p, clinic: publicUser(userById(p.clinicId)), cases, lastActivity: cases[0] ? cases[0].updatedAt : p.createdAt };
    })
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  send(res, 200, list);
});

route('POST', '/api/patients', async (req, res) => {
  const u = requireUser(req);
  const b = await readJson(req);
  if (!String(b.name || '').trim()) fail(400, 'Hasta adı zorunlu');
  let clinicId = u.id;
  if (u.role === 'technician') {
    const cl = userById(b.clinicId);
    if (!cl || cl.role !== 'clinic') fail(400, 'Hastanın bağlı olduğu kliniği seçin');
    clinicId = cl.id;
  }
  const p = {
    id: uid('p'), name: String(b.name).trim(), clinicId, createdBy: u.id,
    phone: String(b.phone || ''), birthDate: b.birthDate || '', gender: b.gender || '', notes: String(b.notes || ''), createdAt: now()
  };
  db.patients.push(p);
  save();
  send(res, 201, p);
});

route('GET', '/api/patients/:id', async (req, res, { params }) => {
  const u = requireUser(req);
  const p = db.patients.find((x) => x.id === params.id);
  if (!p || !canSeePatient(p, u)) fail(404, 'Hasta bulunamadı');
  const cases = db.cases.filter((c) => c.patientId === p.id && canSeeCase(c, u))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => caseSummary(c, u));
  send(res, 200, { ...p, clinic: publicUser(userById(p.clinicId)), cases, canEdit: p.clinicId === u.id || p.createdBy === u.id });
});

route('PATCH', '/api/patients/:id', async (req, res, { params }) => {
  const u = requireUser(req);
  const p = db.patients.find((x) => x.id === params.id);
  if (!p || !(p.clinicId === u.id || p.createdBy === u.id)) fail(404, 'Hasta bulunamadı');
  const b = await readJson(req);
  for (const k of ['name', 'phone', 'birthDate', 'gender', 'notes']) if (b[k] !== undefined) p[k] = String(b[k]);
  if (!p.name.trim()) fail(400, 'Hasta adı zorunlu');
  save();
  send(res, 200, p);
});

/* --- İşler --- */
route('GET', '/api/cases', async (req, res, { query }) => {
  const u = requireUser(req);
  const status = query.get('status');
  const dir = query.get('dir');
  const q = (query.get('q') || '').toLocaleLowerCase('tr');
  let list = db.cases.filter((c) => canSeeCase(c, u)).map((c) => caseSummary(c, u));
  if (status === 'active') list = list.filter((c) => !['tamamlandi', 'iptal'].includes(c.status));
  else if (status) list = list.filter((c) => c.status === status);
  if (dir) list = list.filter((c) => c.direction === dir);
  if (q) list = list.filter((c) => [c.no, c.title, c.patientName, c.workType, c.clinic?.org, c.technician?.org].join(' ').toLocaleLowerCase('tr').includes(q));
  list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  send(res, 200, list);
});

route('POST', '/api/cases', async (req, res) => {
  const u = requireUser(req);
  const b = await readJson(req);
  const p = db.patients.find((x) => x.id === b.patientId);
  if (!p || !canSeePatient(p, u)) fail(400, 'Hasta seçin');
  const to = userById(b.toId);
  if (!to || to.role === u.role) fail(400, u.role === 'clinic' ? 'Teknisyen seçin' : 'Klinik seçin');
  if (u.role === 'technician' && p.clinicId !== to.id) fail(400, 'Hasta seçilen kliniğe ait değil');
  if (u.role === 'clinic' && p.clinicId !== u.id) fail(400, 'Hasta kliniğinize ait değil');
  if (!String(b.title || b.workType || '').trim()) fail(400, 'İş başlığı veya türü zorunlu');
  const c = newCase({ ...b, from: u, to });
  if (b.note && String(b.note).trim()) addEvent(c, u.id, 'note', b.note);
  markRead(c, u);
  save();
  notifyCase(c, u, 'new', `Yeni iş: ${p.name} — ${c.title}`);
  send(res, 201, caseSummary(c, u));
});

route('GET', '/api/cases/:id', async (req, res, { params }) => {
  const u = requireUser(req);
  const c = getCaseFor(params.id, u);
  const p = db.patients.find((x) => x.id === c.patientId);
  const events = db.events.filter((e) => e.caseId === c.id)
    .map((e) => ({ ...e, user: publicUser(userById(e.userId)) }));
  const files = db.files.filter((f) => f.caseId === c.id).map(fileOut);
  const lastRead = (db.reads[u.id] || {})[c.id] || '';
  const otherId = c.clinicId === u.id ? c.technicianId : c.clinicId;
  const otherRead = (db.reads[otherId] || {})[c.id] || '';
  send(res, 200, { ...caseSummary(c, u), patient: p, events, files, lastRead, otherRead, transitions: TRANSITIONS, statusLabels: STATUS });
});

route('PATCH', '/api/cases/:id', async (req, res, { params }) => {
  const u = requireUser(req);
  const c = getCaseFor(params.id, u);
  const b = await readJson(req);
  if (b.status) {
    const t = allowedActions(c, u).find((x) => x.to === b.status);
    if (!t) fail(403, 'Bu aşamada bu işlemi yapamazsınız');
    if (t.needNote && !String(b.note || '').trim()) fail(400, 'Bu işlem için açıklama yazmalısınız');
    const prev = c.status;
    c.status = b.status;
    if (b.status === 'gonderildi') {
      // reddedilen iş yeniden gönderildiğinde başka birine yönlendirilebilir
      const to = b.toId && userById(b.toId);
      if (to && to.role !== u.role) {
        c.toId = to.id;
        if (to.role === 'clinic') c.clinicId = to.id; else c.technicianId = to.id;
      }
    }
    if (b.status === 'tamamlandi') c.completedAt = now();
    addEvent(c, u.id, 'status', t.label + (b.note ? ` — ${b.note}` : ''), { from: prev, to: b.status, note: b.note || '' });
    notifyCase(c, u, 'status', `${c.no}: ${STATUS[prev]} → ${STATUS[c.status]}`);
  }
  const editable = ['title', 'workType', 'shade', 'material', 'description'];
  const changes = [];
  if (c.fromId === u.id || u.role === 'clinic') {
    for (const k of editable) if (b[k] !== undefined && b[k] !== c[k]) { c[k] = String(b[k]); changes.push(k); }
    if (Array.isArray(b.teeth)) { c.teeth = b.teeth.map(Number).filter((t) => t >= 11 && t <= 48); changes.push('teeth'); }
  }
  if (b.priority && PRIORITIES.includes(b.priority) && b.priority !== c.priority) { c.priority = b.priority; changes.push('priority'); }
  if (b.dueDate !== undefined && b.dueDate !== c.dueDate) {
    const old = c.dueDate;
    c.dueDate = b.dueDate || null;
    addEvent(c, u.id, 'due', `Teslim tarihi değişti: ${old || 'yok'} → ${c.dueDate || 'yok'}`, { from: old, to: c.dueDate });
    notifyCase(c, u, 'update', `${c.no}: teslim tarihi güncellendi`);
  }
  if (changes.length) {
    addEvent(c, u.id, 'edit', 'İş bilgileri güncellendi', { fields: changes });
    notifyCase(c, u, 'update', `${c.no}: bilgiler güncellendi`);
  }
  markRead(c, u);
  save();
  send(res, 200, caseSummary(c, u));
});

route('POST', '/api/cases/:id/notes', async (req, res, { params }) => {
  const u = requireUser(req);
  const c = getCaseFor(params.id, u);
  const b = await readJson(req);
  const text = String(b.text || '').trim();
  if (!text) fail(400, 'Not boş olamaz');
  const e = addEvent(c, u.id, 'note', text);
  markRead(c, u);
  save();
  notifyCase(c, u, 'note', `${u.name}: ${text.slice(0, 80)}`);
  send(res, 201, { ...e, user: publicUser(u) });
});

function markRead(c, u) {
  db.reads[u.id] = db.reads[u.id] || {};
  db.reads[u.id][c.id] = now();
}
route('POST', '/api/cases/:id/read', async (req, res, { params }) => {
  const u = requireUser(req);
  const c = getCaseFor(params.id, u);
  markRead(c, u);
  save();
  const otherId = c.clinicId === u.id ? c.technicianId : c.clinicId;
  notify([otherId], { kind: 'read', caseId: c.id });
  send(res, 200, { ok: true });
});

/* --- Dosyalar --- */
const fileOut = (f) => ({ ...f, path: undefined, user: publicUser(userById(f.uploadedBy)) });

route('PUT', '/api/cases/:id/files', async (req, res, { params, query }) => {
  const u = requireUser(req);
  const c = getCaseFor(params.id, u);
  const name = path.basename(String(query.get('name') || 'dosya')).replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'dosya';
  const len = Number(req.headers['content-length'] || 0);
  if (len > MAX_UPLOAD) fail(413, 'Dosya 300 MB sınırını aşıyor');
  const id = uid('f');
  const dest = path.join(UPLOAD_DIR, id);
  const size = await new Promise((resolve, reject) => {
    let n = 0;
    const out = fs.createWriteStream(dest);
    req.on('data', (ch) => {
      n += ch.length;
      if (n > MAX_UPLOAD) { req.destroy(); out.destroy(); fs.rm(dest, () => {}); reject(new HttpError(413, 'Dosya çok büyük')); }
    });
    req.pipe(out);
    out.on('finish', () => resolve(n));
    out.on('error', reject);
    req.on('error', reject);
  });
  if (!size) { fs.rm(dest, () => {}); fail(400, 'Boş dosya'); }
  const f = {
    id, caseId: c.id, name, size, mime: String(req.headers['content-type'] || 'application/octet-stream'),
    category: String(query.get('category') || ''), uploadedBy: u.id, at: now()
  };
  db.files.push(f);
  addEvent(c, u.id, 'file', `Dosya yüklendi: ${name}`, { fileId: id, size });
  markRead(c, u);
  save();
  notifyCase(c, u, 'file', `${c.no}: ${name} yüklendi`);
  send(res, 201, fileOut(f));
});

route('GET', '/api/files/:id', async (req, res, { params, query }) => {
  const u = requireUser(req);
  const f = db.files.find((x) => x.id === params.id);
  if (!f) fail(404, 'Dosya bulunamadı');
  getCaseFor(f.caseId, u);
  const fp = path.join(UPLOAD_DIR, f.id);
  if (!fs.existsSync(fp)) fail(404, 'Dosya diskte yok');
  const inline = query.get('inline') === '1';
  res.writeHead(200, {
    'Content-Type': inline ? (f.mime || 'application/octet-stream') : 'application/octet-stream',
    'Content-Length': fs.statSync(fp).size,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600'
  });
  fs.createReadStream(fp).pipe(res);
});

route('DELETE', '/api/files/:id', async (req, res, { params }) => {
  const u = requireUser(req);
  const f = db.files.find((x) => x.id === params.id);
  if (!f) fail(404, 'Dosya bulunamadı');
  const c = getCaseFor(f.caseId, u);
  if (f.uploadedBy !== u.id) fail(403, 'Yalnızca kendi yüklediğiniz dosyayı silebilirsiniz');
  db.files = db.files.filter((x) => x.id !== f.id);
  fs.rm(path.join(UPLOAD_DIR, f.id), () => {});
  addEvent(c, u.id, 'file', `Dosya silindi: ${f.name}`);
  save();
  notifyCase(c, u, 'file', `${c.no}: ${f.name} silindi`);
  send(res, 200, { ok: true });
});

/* --- Pano / istatistik --- */
route('GET', '/api/stats', async (req, res) => {
  const u = requireUser(req);
  const mine = db.cases.filter((c) => canSeeCase(c, u));
  const today = new Date().toISOString().slice(0, 10);
  const active = mine.filter((c) => !['tamamlandi', 'iptal'].includes(c.status));
  const byStatus = {};
  for (const k of Object.keys(STATUS)) byStatus[k] = mine.filter((c) => c.status === k).length;
  const done = mine.filter((c) => c.completedAt);
  const avgDays = done.length
    ? done.reduce((s, c) => s + (new Date(c.completedAt) - new Date(c.createdAt)), 0) / done.length / 864e5 : null;
  const recent = db.events
    .filter((e) => mine.some((c) => c.id === e.caseId))
    .slice(-25).reverse()
    .map((e) => {
      const c = mine.find((x) => x.id === e.caseId);
      const p = db.patients.find((x) => x.id === c.patientId);
      return { ...e, user: publicUser(userById(e.userId)), caseNo: c.no, caseTitle: c.title, patientName: p ? p.name : '' };
    });
  send(res, 200, {
    total: mine.length,
    active: active.length,
    waitingMe: active.filter((c) => allowedActions(c, u).length > 0).length,
    incomingNew: mine.filter((c) => c.status === 'gonderildi' && c.toId === u.id).length,
    overdue: active.filter((c) => c.dueDate && c.dueDate < today).length,
    dueToday: active.filter((c) => c.dueDate === today).length,
    unread: mine.reduce((s, c) => s + unreadCount(c, u), 0),
    patients: db.patients.filter((p) => canSeePatient(p, u)).length,
    byStatus, avgDays, recent
  });
});

route('GET', '/api/stream', async (req, res) => {
  const u = requireUser(req);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  if (!streams.has(u.id)) streams.set(u.id, new Set());
  streams.get(u.id).add(res);
  req.on('close', () => streams.get(u.id)?.delete(res));
});

/* ------------------------------------------------------------------ */
/* Statik dosyalar                                                     */
/* ------------------------------------------------------------------ */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const fp = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!fp.startsWith(PUBLIC_DIR)) return send(res, 403, 'Yasak');
  fs.readFile(fp, (err, buf) => {
    if (err) return send(res, 404, 'Bulunamadı');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

/* ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'İzin verilmiyor');
    return serveStatic(req, res, url.pathname);
  }
  // Basit CSRF koruması: durum değiştiren isteklerde aynı köken beklenir
  if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
    const host = req.headers.host;
    try { if (new URL(req.headers.origin).host !== host) return send(res, 403, { error: 'Geçersiz köken' }); }
    catch { return send(res, 403, { error: 'Geçersiz köken' }); }
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.re);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    try {
      await r.handler(req, res, { params, query: url.searchParams });
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Sunucu hatası' });
    }
    return;
  }
  send(res, 404, { error: 'Bulunamadı' });
});

loadDb();
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n  Klinik ⇄ Teknisyen İş Takip çalışıyor:  http://localhost:${PORT}\n`);
    console.log('  Demo hesaplar (şifre: 1234):');
    console.log('    Klinik     → klinik@demo.com');
    console.log('    Teknisyen  → teknisyen@demo.com\n');
  });
}
module.exports = { server };
