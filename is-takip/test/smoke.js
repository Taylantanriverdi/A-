// Uçtan uca API testi: geçici veri klasöründe sunucuyu başlatır, iki rolle tam akışı dener.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'istakip-'));
const { server } = require('../server');

function client(base) {
  let cookie = '';
  return async (method, p, body, raw) => {
    const headers = { cookie };
    let payload;
    if (raw) { payload = raw; headers['content-type'] = 'application/octet-stream'; }
    else if (body) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const r = await fetch(base + p, { method, headers, body: payload });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data };
  };
}

server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const K = client(base), T = client(base), T2 = client(base);
  try {
    assert.equal((await K('GET', '/me')).status, 401);
    assert.equal((await K('POST', '/login', { email: 'klinik@demo.com', password: 'yanlis' })).status, 401);
    assert.equal((await K('POST', '/login', { email: 'klinik@demo.com', password: '1234' })).status, 200);
    assert.equal((await T('POST', '/login', { email: 'teknisyen@demo.com', password: '1234' })).status, 200);
    assert.equal((await T2('POST', '/login', { email: 'teknisyen2@demo.com', password: '1234' })).status, 200);

    const techs = (await K('GET', '/partners')).data;
    const tech = techs.find((u) => u.email === 'teknisyen@demo.com');
    const p = (await K('POST', '/patients', { name: 'Test Hasta', phone: '555' })).data;
    const c = (await K('POST', '/cases', { patientId: p.id, toId: tech.id, workType: 'Kron', teeth: [11, 21, 99], dueDate: '2030-01-01', note: 'ilk not' })).data;
    assert.equal(c.status, 'gonderildi');
    assert.deepEqual(c.teeth, [11, 21]);
    assert.match(c.no, /^\d{4}-\d{4}$/);

    // Teknisyen gelen işi görür, başka teknisyen göremez
    const tc = (await T('GET', '/cases/' + c.id)).data;
    assert.equal(tc.direction, 'incoming');
    assert.ok(tc.unread >= 2);
    assert.deepEqual(tc.actions.map((a) => a.to), ['kabul', 'reddedildi']);
    assert.equal((await T2('GET', '/cases/' + c.id)).status, 404);
    assert.equal((await T2('GET', '/patients/' + p.id)).status, 404);

    // Yetkisiz geçiş reddedilir
    assert.equal((await K('PATCH', '/cases/' + c.id, { status: 'kabul' })).status, 403);
    assert.equal((await T('PATCH', '/cases/' + c.id, { status: 'reddedildi' })).status, 400); // not zorunlu

    // Tam akış
    const flow = [[T, 'kabul'], [T, 'uretimde'], [T, 'prova'], [K, 'revizyon', 'Kontakt sıkı'], [T, 'uretimde'], [T, 'prova'], [K, 'uretimde'], [T, 'hazir'], [T, 'teslim'], [K, 'tamamlandi']];
    for (const [who, st, note] of flow) {
      const r = await who('PATCH', '/cases/' + c.id, { status: st, note });
      assert.equal(r.status, 200, `${st}: ${JSON.stringify(r.data)}`);
      assert.equal(r.data.status, st);
    }

    // Notlar ve okundu
    assert.equal((await T('POST', `/cases/${c.id}/notes`, { text: 'Hazır, kargoda' })).status, 201);
    assert.equal((await T('POST', `/cases/${c.id}/notes`, { text: '  ' })).status, 400);
    assert.ok((await K('GET', '/cases/' + c.id)).data.unread >= 1);
    await K('POST', `/cases/${c.id}/read`);
    assert.equal((await K('GET', '/cases/' + c.id)).data.unread, 0);

    // STL yükle / indir / sil
    const stl = Buffer.alloc(84 + 50); stl.writeUInt32LE(1, 80);
    const up = await T('PUT', `/cases/${c.id}/files?name=${encodeURIComponent('üst çene.stl')}`, null, stl);
    assert.equal(up.status, 201);
    assert.equal(up.data.name, 'üst çene.stl');
    assert.equal(up.data.path, undefined);
    const dl = await K('GET', '/files/' + up.data.id);
    assert.equal(dl.status, 200);
    assert.equal(dl.data.length, stl.length);
    assert.equal((await T2('GET', '/files/' + up.data.id)).status, 404);
    assert.equal((await K('DELETE', '/files/' + up.data.id)).status, 403);
    const trav = await T('PUT', `/cases/${c.id}/files?name=${encodeURIComponent('../../evil.js')}`, null, Buffer.from('x'));
    assert.equal(trav.data.name, 'evil.js');

    // Teknisyen klinik adına hasta açıp kliniğe iş gönderir
    const clinics = (await T('GET', '/partners')).data;
    const kl = clinics.find((u) => u.email === 'klinik@demo.com');
    const p2 = (await T('POST', '/patients', { name: 'Lab Hastası', clinicId: kl.id })).data;
    const c2 = (await T('POST', '/cases', { patientId: p2.id, toId: kl.id, workType: 'Model' })).data;
    assert.equal(c2.clinicId, kl.id);
    const kc2 = (await K('GET', '/cases/' + c2.id)).data;
    assert.equal(kc2.direction, 'incoming');
    assert.ok(kc2.actions.some((a) => a.to === 'kabul'));

    // Hastalar listesinde işler hastanın altında
    const plist = (await K('GET', '/patients')).data;
    assert.ok(plist.find((x) => x.id === p.id).cases.some((x) => x.id === c.id));
    assert.ok(plist.find((x) => x.id === p2.id), 'teknisyenin açtığı hasta klinikte görünür');

    const stats = (await K('GET', '/stats')).data;
    assert.ok(stats.total >= 3 && stats.avgDays !== null);

    // Kayıt
    const N = client(base);
    assert.equal((await N('POST', '/register', { name: 'Yeni', email: 'Yeni@x.com', password: '1234', role: 'clinic' })).status, 200);
    assert.equal((await N('POST', '/register', { name: 'Yeni', email: 'yeni@x.com', password: '1234', role: 'clinic' })).status, 409);

    // CSRF: yabancı köken reddedilir
    const bad = await fetch(base + '/logout', { method: 'POST', headers: { origin: 'http://evil.com' } });
    assert.equal(bad.status, 403);

    console.log('✓ Tüm testler geçti');
  } catch (e) {
    console.error('✗ Test başarısız:', e);
    process.exitCode = 1;
  } finally {
    server.close();
    process.exit();
  }
});
