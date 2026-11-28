/* Almas — liaison Supabase (chargé APRÈS le script principal de index.html) */
(function () {
  // ===== À CONFIGURER (mêmes valeurs que dans menu.html) =====
  const SB_URL = 'https://rxgjfaolfznnvkqzounv.supabase.co';
  const SB_KEY = 'sb_publishable__mkqYHMSQgU0JDZH5PahKw_ugMLqOLz'; // clé "anon" uniquement
  // ===========================================================
  if (!window.supabase || SB_KEY.indexOf('VOTRE') === 0) return; // pas configuré : l'app reste 100 % locale

  // --- Stockage de la session : IndexedDB (pas limité comme localStorage, que les photos de l'app peuvent remplir)
  //     + copie dans localStorage quand c'est possible. Une session déjà enregistrée dans localStorage est reprise. ---
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) {}
  const idb = (() => {
    let p;
    const open = () => p || (p = new Promise((res, rej) => {
      const r = indexedDB.open('almas_cloud', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = (mode, fn) => open().then(d => new Promise((res, rej) => {
      const t = d.transaction('kv', mode), q = fn(t.objectStore('kv'));
      t.oncomplete = () => res(q.result); t.onerror = t.onabort = () => rej(t.error);
    }));
    return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(v, k)), del: k => tx('readwrite', s => s.delete(k)) };
  })();
  const store = {
    async getItem(k) {
      try { const v = await idb.get(k); if (v != null) return v; } catch (_) {}
      try { return localStorage.getItem(k); } catch (_) { return null; }
    },
    async setItem(k, v) {
      try { await idb.set(k, v); } catch (_) {}
      try { localStorage.setItem(k, v); } catch (_) {}
    },
    async removeItem(k) {
      try { await idb.del(k); } catch (_) {}
      try { localStorage.removeItem(k); } catch (_) {}
    }
  };

  const sb = supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storage: store, lock: (n, t, fn) => fn() } }); // lock : évite le blocage au démarrage si l'ancienne page a gardé le verrou
  const $ = id => document.getElementById(id);
  let user = null, ch = null, lastSig = '', timer = null, ac;

  // --- Son + vibration (le navigateur exige un premier clic pour autoriser le son) ---
  document.addEventListener('click', () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch (e) {} }, { once: true });
  const beep = () => {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      [880, 1175].forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * .2;
        o.frequency.value = f; o.connect(g); g.connect(ac.destination);
        g.gain.setValueAtTime(.25, t); g.gain.exponentialRampToValueAtTime(.001, t + .18);
        o.start(t); o.stop(t + .19);
      });
      if (navigator.vibrate) navigator.vibrate(200);
    } catch (e) {}
  };

  // --- Interface : boutons flottants + panneau de connexion dans Réglages ---
  document.head.insertAdjacentHTML('beforeend', '<style>header .wrap{flex-wrap:wrap;row-gap:10px}header .hleft{width:100%;align-items:stretch}header .hact{width:100%}header .hact .hbtn{flex:1;min-width:0;min-height:64px;justify-content:center}header .hbtn i{font-size:24px}header .hbtn em{font-size:11px;white-space:nowrap}</style>');
  document.querySelector('header .hact').insertAdjacentHTML('beforeend',
    '<div id="cl" class="hide" style="display:contents">' +
    '<button id="clO" class="hbtn"><i>📲</i><em>كوموند QR</em><b id="clN" class="cnt zero">0</b></button>' +
    '<button id="clS" class="hbtn"><i>📷</i><em>مسح QR</em></button></div>');
  const sec = $('settings');
  if (sec) sec.insertAdjacentHTML('beforeend',
    '<div class="panel"><strong>☁️ كوموندات الحرفاء بالـQR</strong><div class="mini" id="clInfo" style="margin:6px 0">… (cloud v2)</div>' +
    '<input class="field" id="clE" type="email" autocomplete="username" placeholder="Email">' +
    '<input class="field" id="clP" type="password" autocomplete="current-password" placeholder="كلمة السر">' +
    '<button class="btn gold hide" id="clIn">دخول</button><button class="btn light hide" id="clOut">خروج</button>' +
    '<button class="btn light hide" id="clBk">☁️ احفظ نسخة احتياطية توّا</button>' +
    '<button class="btn light hide" id="clRs">↩️ استرجاع نسخة من السحاب</button></div>');

  // --- Connexion mémorisée : session persistante + reconnexion automatique si elle saute ---
  const CRED = 'almas_cl_cred';
  let manualOut = false;
  const saveCred = (e, p) => store.setItem(CRED, JSON.stringify({ e, p }));
  const loadCred = async () => { try { return JSON.parse(await store.getItem(CRED)); } catch (_) { return null; } };
  let relogging = false;
  async function autoRelogin(n) {
    n = typeof n === 'number' ? n : 0;
    if (relogging || user || manualOut) return;
    const k = await loadCred(); if (!k || user) return;
    relogging = true;
    let retry = false;
    try {
      const r = await sb.auth.signInWithPassword({ email: k.e, password: k.p });
      if (r.error) {
        if (/invalid login|invalid credentials/i.test(r.error.message || '')) store.removeItem(CRED); // mot de passe changé : on arrête
        else retry = true;                                                                              // réseau / serveur : on réessaie
      }
    } catch (_) { retry = true; }
    relogging = false;
    if (retry && n < 6) setTimeout(() => autoRelogin(n + 1), 3000 * (n + 1));
  }
  window.addEventListener('online', () => autoRelogin());

  // --- Connexion ---
  let ready = false;
  setTimeout(() => {   // si Supabase n'a rien répondu après 6 s : on affiche l'état réel et on tente la reconnexion automatique
    if (ready) return;
    $('clIn').classList.remove('hide'); $('clInfo').textContent = 'موش متصل (cloud v2)';
    autoRelogin();
  }, 6000);
  async function onUser(u) {
    ready = true;
    user = u;
    $('cl').classList.toggle('hide', !u);
    $('clOut').classList.toggle('hide', !u);
    $('clIn').classList.toggle('hide', !!u);
    $('clBk').classList.toggle('hide', !u);
    $('clRs').classList.toggle('hide', !u);
    $('clInfo').textContent = u ? 'متصل: ' + u.email + ' (cloud v2)' : 'موش متصل (cloud v2)';
    if (u) { listen(); refreshPending(); syncMenu(true); setTimeout(() => cloudBackup(false), 8000); }
    else if (ch) { sb.removeChannel(ch); ch = null; }
  }
  sb.auth.onAuthStateChange((_e, s) => { onUser(s && s.user); if (_e === 'SIGNED_OUT' && !manualOut) setTimeout(() => autoRelogin(), 500); });
  sb.auth.getSession().then(r => { onUser(r.data.session && r.data.session.user); if (!r.data.session) autoRelogin(); });
  $('clIn').onclick = async () => {
    const em = $('clE').value.trim(), pw = $('clP').value;
    manualOut = false;
    const r = await sb.auth.signInWithPassword({ email: em, password: pw });
    if (!r.error) await saveCred(em, pw);
    $('clP').value = '';
    toast(r.error ? 'الدخول فشل: تأكد من الإيميل وكلمة السر' : 'تعمل الدخول');
  };
  $('clOut').onclick = () => { manualOut = true; store.removeItem(CRED); sb.auth.signOut(); };

  // --- Prix et articles : app -> Supabase (après chaque sauvegarde locale) ---
  async function syncMenu(force) {
    if (!user || !db.items.length) return;
    const rows = db.items.map((p, i) => ({
      local_id: p.id, name: p.name, category: p.category || 'Boisson chaude',
      price_millimes: Math.round(Number(p.price) * 1000) || 0,
      image_url: p.img || null,
      name_fr: (p.nameFr || '').trim() || null,
      available: p.available !== false, sort: Math.max(0, categories.indexOf(p.category || 'Boisson chaude')) * 1000 + i
    }));
    const sig = JSON.stringify(rows);
    if (!force && sig === lastSig) return;
    let up = await sb.from('menu_items').upsert(rows, { onConflict: 'local_id' });
    const drop = [];   // colonnes pas encore créées (image_url, name_fr) : on synchronise sans elles
    for (const col of ['name_fr', 'image_url']) {
      if (up.error && new RegExp(col).test(up.error.message || '')) {
        drop.push(col);
        up = await sb.from('menu_items').upsert(rows.map(r => { const x = { ...r }; drop.forEach(d => delete x[d]); return x; }), { onConflict: 'local_id' });
      }
    }
    if (up.error) return;
    await sb.from('menu_items').delete().not('local_id', 'in', '(' + rows.map(r => r.local_id).join(',') + ')');
    lastSig = sig;
  }
  const persist0 = persist;
  persist = function () { persist0.apply(this, arguments); clearTimeout(timer); timer = setTimeout(() => syncMenu(false), 1500); };

  // --- Sauvegarde cloud : une copie par jour (30 jours gardés), jamais depuis une base vide ---
  let bkTimer = null, lastBk = 0;
  async function cloudBackup(manual) {
    if (!user || key === '__none' || !db || !Array.isArray(db.orders)) return;
    const data = JSON.parse(JSON.stringify(db));
    delete data._account;
    if (JSON.stringify(data).length > 3e6) (data.items || []).forEach(p => { delete p.img; }); // trop lourd : sans photos
    const r = await sb.from('app_backups').upsert({ day: dayKey(), data, updated_at: new Date().toISOString() }, { onConflict: 'day' });
    if (r.error) { if (manual) toast('ما تحفظتش النسخة. عاود جرّب'); return; }
    lastBk = Date.now();
    sb.from('app_backups').delete().lt('updated_at', new Date(Date.now() - 30 * 864e5).toISOString()).then(() => {});
    if (manual) toast('☁️ تحفظت النسخة الاحتياطية');
  }
  const persist1 = persist;
  persist = function () {
    persist1.apply(this, arguments);
    clearTimeout(bkTimer);
    bkTimer = setTimeout(() => { if (Date.now() - lastBk > 30 * 60 * 1000) cloudBackup(false); }, 60000);
  };
  $('clBk').onclick = () => cloudBackup(true);
  $('clRs').onclick = async () => {
    const l = await sb.from('app_backups').select('day,updated_at').order('updated_at', { ascending: false }).limit(5);
    if (l.error || !l.data.length) return toast('ما فما حتى نسخة في السحاب');
    const d = await dlg({ title: '↩️ استرجاع من السحاب', msg: 'اختار النسخة (التاريخ)', buttons: l.data.map((x, i) => ({ t: x.day, cls: i ? '' : 'gold', v: x.day })).concat([{ t: 'إلغاء', v: null }]) });
    if (!d || d.v == null) return;
    const r = await sb.from('app_backups').select('data').eq('day', d.v).single();
    if (r.error || !r.data) return toast('ما تحمّلتش النسخة');
    const n = r.data.data;
    if (!n || !Array.isArray(n.items) || !Array.isArray(n.orders)) return toast('النسخة غير صحيحة');
    if (!(await askConfirm('استرجاع', 'استرجاع نسخة ' + d.v + '؟ سيتم تعويض بيانات التطبيق الحالية.', 'استرجاع'))) return;
    if (!Array.isArray(n.tables)) n.tables = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, items: [] }));
    n.items.forEach(p => { if (!p.img) { const o = db.items.find(x => x.id === p.id); if (o && o.img) p.img = o.img; } });
    db = n; normDb(); persist(); toast('تم الاسترجاع');
  };

  // --- Commandes clients en direct ---
  async function refreshPending() {
    if (!user) return;
    const r = await sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'nouvelle');
    $('clN').textContent = r.count || 0;
    $('clN').classList.toggle('zero', !r.count);
  }
  function listen() {
    if (ch) return;
    ch = sb.channel('almas-orders').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, p => {
      const n = p.new || {};
      if (p.eventType === 'INSERT') { beep(); toast('📲 كوموند جديدة — ' + tl(n.table_no)); }
      else if (p.eventType === 'UPDATE' && n.bill_requested && !(p.old && p.old.bill_requested)) { beep(); toast('🧾 ' + tl(n.table_no) + ' تطلب الحساب'); }
      refreshPending();
    }).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'loyalty_cards' }, p => {
      const n = p.new || {};
      if (n.completed_at && !n.reward_sent) { beep(); toast('🎁 حريف كمّل 10 كوموندات — شوف الوفاء في الإعدادات'); }
      if (typeof lyRefresh === 'function') lyRefresh();
    }).subscribe();
  }
  async function showPending() {
    const r = await sb.from('orders')
      .select('id,table_no,note,total_millimes,order_lines(name,price_millimes,qty,menu_items(local_id))')
      .eq('status', 'nouvelle').order('created_at');
    if (r.error) return toast('ما تحمّلتش الكوموندات');
    if (!r.data.length) return toast('ما فماش كوموندات جدّد');
    for (const o of r.data) {
      const txt = o.order_lines.map(l => l.name + ' × ' + l.qty).join('\n') + (o.note ? '\n📝 ' + o.note : '') + '\n\n' + money(o.total_millimes / 1000);
      const d = await dlg({ title: '📲 ' + tl(o.table_no), msg: txt, buttons: [{ t: 'قبول وزيد للطاولة', cls: 'gold', v: 'ok' }, { t: 'رفض', v: 'no' }, { t: 'بعد', v: null }] });
      if (!d || d.v == null) break;
      const st = d.v === 'ok' ? 'acceptee' : 'annulee';
      // le statut ne change que si la commande est encore "nouvelle" : évite un double ajout
      const u = await sb.from('orders').update({ status: st }).eq('id', o.id).eq('status', 'nouvelle').select('id');
      if (u.error || !u.data.length) continue;
      if (d.v === 'ok') {
        let t = db.tables.find(x => x.id === o.table_no);
        if (!t && o.table_no >= 100) { t = { id: o.table_no, items: [], takeaway: true }; db.tables.push(t); } // ticket à emporter
        if (!t) { toast('طاولة ' + o.table_no + ' موش موجودة في التطبيق'); continue; }
        if (!t.items.length) t.since = Date.now();
        o.order_lines.forEach(l => {
          const pid = (l.menu_items && l.menu_items.local_id) || null, price = l.price_millimes / 1000;
          const e = pid && t.items.find(c => c.pid === pid && c.price === price);
          if (e) e.q += l.qty; else t.items.push({ pid, name: l.name, price, q: l.qty });
        });
        persist();
      }
    }
    refreshPending();
  }

  // --- Bouton « تخدمت » dans le détail d'une table : les commandes acceptées passent à "servie" ---
  const renderDetail0 = renderTableDetail;
  renderTableDetail = function () {
    renderDetail0.apply(this, arguments);
    const t = db.tables.find(x => x.id === activeTable), box = $('tableDetail');
    const wrap = box && box.querySelector('.table-detail');
    if (!user || !t || !t.items.length || !wrap) return;
    const b = document.createElement('button');
    b.className = 'btn gold hide'; b.id = 'clServed';
    const g = wrap.querySelector('.btn.gold:not(#clServed)');
    g ? wrap.insertBefore(b, g) : wrap.appendChild(b);
    const tn = t.id;
    sb.from('orders').select('id', { count: 'exact', head: true }).eq('table_no', tn).eq('status', 'acceptee').then(r => {
      if (!b.isConnected || r.error || !r.count) return;
      b.textContent = '✅ تخدمت (' + r.count + ')';
      b.classList.remove('hide');
    });
    b.onclick = async () => {
      b.disabled = true;
      const u = await sb.from('orders').update({ status: 'servie' }).eq('table_no', tn).eq('status', 'acceptee').select('id');
      if (u.error) { b.disabled = false; return toast('ما تبدلتش الحالة. عاود جرّب'); }
      toast('✅ ' + tl(tn) + ': تخدمت');
      b.remove();
    };
    // 🎁 Solde cadeau : si un client connecté de cette table a du solde, bouton pour le déduire de l'addition
    if (!t.items.some(i => i.loy)) {
      sb.from('orders').select('customer_id').eq('table_no', tn).in('status', ['acceptee', 'servie']).not('customer_id', 'is', null).then(async r => {
        if (r.error || !r.data || !r.data.length) return;
        for (const id of [...new Set(r.data.map(x => x.customer_id))].slice(0, 3)) {
          const x = await sb.rpc('owner_customer_info', { p_customer: id });
          if (x.error || !x.data || !(x.data.balance > 0)) continue;
          const w2 = $('tableDetail') && $('tableDetail').querySelector('.table-detail');
          if (!w2 || activeTable !== tn || $('clLoy' + id)) continue;
          const lb = document.createElement('button');
          lb.className = 'btn light'; lb.id = 'clLoy' + id;
          lb.textContent = '🎁 رصيد ' + x.data.first + ': ' + fmtM(x.data.balance) + ' — خصم';
          const cg = w2.querySelector('[onclick^="closeTable"]');
          cg ? w2.insertBefore(lb, cg) : w2.appendChild(lb);
          lb.onclick = () => redeemOnTable(tn, id, x.data);
        }
      });
    }
  };
  async function redeemOnTable(tn, cid, info) {
    const t = db.tables.find(x => x.id === tn); if (!t) return;
    const max = Math.min(info.balance / 1000, t.items.reduce((s, c) => s + c.price * c.q, 0));
    if (!(max > 0)) return toast('مجموع الطاولة صفر');
    const r = await dlg({ title: '🎁 خصم رصيد الوفاء', msg: info.first + ' ' + info.last + '\nالرصيد: ' + fmtM(info.balance) + '\nقدّاش تخصم من هالحساب؟', input: { type: 'number', value: max }, buttons: [{ t: 'خصم', cls: 'gold', v: 'ok' }, { t: 'إلغاء', v: null }] });
    if (!r || r.v !== 'ok') return;
    const mm = Math.round(Math.min(Number(r.text) || 0, max) * 1000);
    if (mm <= 0) return;
    const u = await sb.rpc('owner_redeem', { p_customer: cid, p_amount: mm, p_table: tn });
    if (u.error) return toast(/solde/.test(u.error.message) ? 'الرصيد ما يكفيش' : 'ما تخصمش. عاود جرّب');
    const t2 = db.tables.find(x => x.id === tn); if (!t2) return;
    t2.items.push({ pid: null, name: '🎁 رصيد الوفاء — ' + info.first, price: -mm / 1000, q: 1, loy: true });
    persist(); activeTable = tn; renderTableDetail(); toast('🎁 تخصم ' + fmtM(mm));
  }

  // --- Paiement : quand une table est soldée, ses commandes cloud passent à "payée" ---
  const closeTable0 = closeTable;
  closeTable = async function (id) {
    await closeTable0.apply(this, arguments);
    const t = db.tables.find(x => x.id === id);
    if (user && (!t || !t.items.length))
      sb.from('orders').update({ status: 'payee' }).eq('table_no', id).in('status', ['acceptee', 'servie']).then(refreshPending);
  };

  // --- Scan du QR de l'addition (téléphone du client) ---
  async function payScan(ids) {
    const r = await sb.from('orders').select('id,table_no,status,total_millimes').in('id', ids);
    const os = r.data || [];
    if (!os.length) return toast('الكود موش معروف');
    const live = os.filter(o => o.status !== 'annulee');
    const open = live.filter(o => o.status !== 'payee');
    if (!open.length) return toast(live.length ? 'هالحساب خالص من قبل' : 'الكوموندات ملغاة');
    const pend = open.filter(o => o.status === 'nouvelle').length;
    if (pend === open.length) return toast('الكوموندات ما تقبلتش بعد. اقبلها الأول من 📲');
    const tn = os[0].table_no, t = db.tables.find(x => x.id === tn);
    const tot = t ? t.items.reduce((s, c) => s + c.price * c.q, 0) : 0;
    const cloud = open.reduce((s, o) => s + o.total_millimes, 0);
    const d = await dlg({
      title: '🧾 ' + tl(tn),
      msg: 'كوموندات الحريف (' + open.length + '): ' + money(cloud / 1000) + '\nمجموع الطاولة: ' + money(tot) + (pend ? '\n⚠️ ' + pend + ' كوموند ما تقبلتش بعد (اقبلها من 📲)' : ''),
      buttons: [{ t: 'خلاص الطاولة', cls: 'gold', v: 'ok' }, { t: 'إلغاء', v: null }]
    });
    if (d && d.v === 'ok') closeTable(tn);
  }
  async function scan() {
    if (!('BarcodeDetector' in window)) return toast('هالمتصفح ما يدعمش مسح QR. استعمل Chrome على أندرويد');
    let s;
    try { s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
    catch (e) { return toast('الكاميرا ما تحلّتش'); }
    const det = new BarcodeDetector({ formats: ['qr_code'] });
    const w = document.createElement('div');
    w.style.cssText = 'position:fixed;inset:0;z-index:95;background:#000;display:flex;flex-direction:column';
    w.innerHTML = '<video autoplay playsinline muted style="flex:1;min-height:0;object-fit:cover"></video><button class="btn light" style="margin:12px;width:auto">إلغاء</button>';
    document.body.appendChild(w);
    const v = w.querySelector('video'); v.srcObject = s;
    const stop = () => { s.getTracks().forEach(t => t.stop()); w.remove(); };
    w.querySelector('button').onclick = stop;
    const loop = async () => {
      if (!w.isConnected) return;
      try {
        const r = await det.detect(v), m = r[0] && /^almas:([0-9a-f-]{36}(?:,[0-9a-f-]{36})*)$/.exec(r[0].rawValue);
        if (m) { stop(); return payScan(m[1].split(',')); }
      } catch (e) {}
      setTimeout(loop, 300);
    };
    loop();
  }

  // --- Serveurs : fiches (nom, code, téléphone, email), WhatsApp, rappel > 1 h ---
  const LIMIT = 60 * 60 * 1000;
  let staff = [];
  const alerted = new Set();
  const waLink = (ph, msg) => { let d = String(ph || '').replace(/\D/g, ''); if (d.length === 8) d = '216' + d; return d ? 'https://wa.me/' + d + '?text=' + encodeURIComponent(msg) : ''; };
  if (sec) sec.insertAdjacentHTML('beforeend',
    '<div class="panel hide" id="stP"><strong>👥 السيرفورات</strong><div id="stList" style="margin:6px 0"></div>' +
    '<button class="btn gold" id="stAdd">➕ زيد سيرفور</button><button class="btn light" id="stChk">⏰ كوموندات/طواول فوق الساعة</button></div>');
  async function loadStaff() {
    const r = await sb.from('staff').select('id,name,phone,email,active').or('active.is.null,active.eq.true').order('name');
    if (r.error) { $('stList').innerHTML = '<div class="mini" style="color:var(--red)">ما تحمّلتش القائمة: ' + safe(r.error.message) + '</div>'; return; }
    staff = r.data || [];
    $('stList').innerHTML = staff.length ? staff.map(s => '<div class="row"><div class="grow"><strong>' + safe(s.name) + '</strong><small>' + safe([s.phone, s.email].filter(Boolean).join(' · ') || 'بلا رقم') + '</small></div>' +
      '<button class="btn light" style="width:auto;margin:0" data-wa="' + s.id + '">💬</button><button class="btn light" style="width:auto;margin:0 0 0 6px;color:var(--red)" data-del="' + s.id + '">🗑️</button></div>').join('') : '<div class="mini">ما فما حتى سيرفور</div>';
    $('stList').querySelectorAll('[data-wa]').forEach(b => b.onclick = () => {
      const s = staff.find(x => x.id === b.dataset.wa), l = waLink(s && s.phone, 'السلام ' + s.name);
      l ? window.open(l, '_blank') : toast('ما عندوش رقم تلفون');
    });
    $('stList').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const s = staff.find(x => x.id === b.dataset.del);
      if (!(await askConfirm('نحّي السيرفور', s.name + ' ما يعاودش يدخل للتطبيق. متأكد؟', 'نحّي'))) return;
      const u = await sb.from('staff').update({ active: false }).eq('id', s.id);
      toast(u.error ? 'ما تنحاش. عاود جرّب' : 'تنحّى ' + s.name); loadStaff();
    });
  }
  sb.auth.onAuthStateChange((_e, s) => { $('stP').classList.toggle('hide', !(s && s.user)); if (s && s.user) loadStaff(); });
  sb.auth.getSession().then(r => { const u = r.data.session && r.data.session.user; $('stP').classList.toggle('hide', !u); if (u) loadStaff(); });
  $('stAdd').onclick = async () => {
    let f = {};
    const r = await dlg({
      title: '➕ سيرفور جديد', msg: 'الإسم والكود باش يدخل بيهم للتطبيق',
      html: '<input class="field" id="sN" placeholder="الإسم"><input class="field" id="sC" inputmode="numeric" placeholder="الكود السري (4 أرقام على الأقل)"><input class="field" id="sT" type="tel" placeholder="رقم التلفون (WhatsApp)"><input class="field" id="sE" type="email" placeholder="Email (اختياري)">',
      buttons: [{ t: 'تسجيل', cls: 'gold', v: 'ok' }, { t: 'إلغاء', v: null }],
      onMount: w => { f = { n: w.querySelector('#sN'), c: w.querySelector('#sC'), t: w.querySelector('#sT'), e: w.querySelector('#sE') }; }
    });
    if (!r || r.v !== 'ok') return;
    const name = f.n.value.trim(), pin = f.c.value.trim();
    if (!name || pin.length < 4) return toast('الإسم والكود (4 على الأقل) مطلوبين');
    const x = await sb.rpc('add_staff', { p_name: name, p_pin: pin, p_phone: f.t.value.trim() || null, p_email: f.e.value.trim() || null });
    if (x.error) return toast(/duplicate|unique/i.test(x.error.message) ? 'الإسم موجود من قبل' : 'ما تسجّلش. تأكد أنك دخلت ملفات SQL');
    toast('تسجّل ' + name); loadStaff();
  };
  async function overdue() {
    const now = Date.now(), out = [];
    db.tables.forEach(t => { if (t.items && t.items.length && t.since && now - t.since > LIMIT) out.push({ k: 't' + t.id, txt: tl(t.id) + ' — ' + Math.floor((now - t.since) / 6e4) + ' دق' }); });
    if (user) {
      const r = await sb.from('staff_orders').select('id,table_label,created_at,staff_id').eq('status', 'open').lt('created_at', new Date(now - LIMIT).toISOString());
      if (!staff.length) await loadStaff();
      (r.data || []).forEach(o => {
        const s = staff.find(x => x.id === o.staff_id) || {}, m = Math.floor((now - new Date(o.created_at)) / 6e4);
        out.push({ k: 'o' + o.id, txt: (s.name || '?') + ' · ' + o.table_label + ' — ' + m + ' دق', wa: waLink(s.phone, 'السلام ' + (s.name || '') + '، ' + o.table_label + ' محلولة من ' + m + ' دقيقة. تأكد من الخلاص أو الحساب.') });
      });
    }
    return out;
  }
  $('stChk').onclick = async () => {
    const out = await overdue();
    if (!out.length) return toast('ما فما حتى حاجة فوق الساعة ✅');
    const d = await dlg({ title: '⏰ فوق الساعة', msg: 'اضغط على سيرفور باش تبعثلو تذكير WhatsApp', buttons: out.map((x, i) => ({ t: (x.wa ? '💬 ' : '') + x.txt, v: i })).concat([{ t: 'سكّر', v: null }]) });
    if (d && d.v != null && out[d.v].wa) window.open(out[d.v].wa, '_blank');
  };
  setInterval(async () => {
    const out = await overdue(), fresh = out.filter(x => !alerted.has(x.k));
    if (fresh.length) { fresh.forEach(x => alerted.add(x.k)); beep(); toast('⏰ ' + fresh.length + ' فوق الساعة: ' + fresh[0].txt); }
  }, 5 * 60 * 1000);

  // --- Fidélité : 10 commandes payées = 5 % du total. Le client reçoit le message sur WhatsApp (tu appuies sur envoyer). ---
  if (sec) sec.insertAdjacentHTML('beforeend',
    '<div class="panel hide" id="lyP"><strong>🎁 الوفاء (Fidélité)</strong><div class="mini" id="lyInfo" style="margin:6px 0"></div>' +
    '<button class="btn gold" id="lyRw">🎁 مكافآت تستنى</button><button class="btn light" id="lyCl">👥 الحرفاء المسجلين</button><button class="btn light" id="lyBd">🎂 أعياد ميلاد (7 أيام)</button></div>');
  const fmtM = m => money((Number(m) || 0) / 1000);
  async function lyPending() {
    const r = await sb.from('loyalty_cards')
      .select('id,total_millimes,reward_millimes,completed_at,customers(first_name,last_name,phone)')
      .not('completed_at', 'is', null).eq('reward_sent', false).order('completed_at');
    return r.error ? null : r.data;
  }
  async function lyRefresh() {
    if (!user || !$('lyInfo')) return;
    const d = await lyPending();
    $('lyInfo').textContent = d == null ? 'ما تحمّلتش. شغّل fidelite.sql في Supabase' : d.length ? '🎁 ' + d.length + ' مكافأة تستنى الإرسال' : 'ما فما حتى مكافأة تستنى ✅';
    $('lyRw').textContent = '🎁 مكافآت تستنى' + (d && d.length ? ' (' + d.length + ')' : '');
    const bd = await lyBirthdays();
    if (bd && bd.length) { $('lyInfo').textContent += ' · 🎂 ' + bd.length + ' عيد ميلاد في 7 أيام'; $('lyBd').textContent = '🎂 أعياد ميلاد (' + bd.length + ')'; }
  }
  // anniversaires des 7 prochains jours (la date de naissance est déjà enregistrée à l'inscription)
  async function lyBirthdays() {
    const r = await sb.from('customers').select('first_name,last_name,phone,birth_date').limit(2000);
    if (r.error) return null;
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    return r.data.map(c => {
      const p = String(c.birth_date || '').split('-').map(Number); if (p.length < 3) return null;
      let n = new Date(t0.getFullYear(), p[1] - 1, p[2]); if (n < t0) n = new Date(t0.getFullYear() + 1, p[1] - 1, p[2]);
      return { c, days: Math.round((n - t0) / 864e5), age: n.getFullYear() - p[0], d: p[2] + '/' + p[1] };
    }).filter(x => x && x.days <= 7).sort((a, b) => a.days - b.days);
  }
  $('lyBd').onclick = async () => {
    const l = await lyBirthdays();
    if (l == null) return toast('ما تحمّلتش. تأكد أنك شغّلت fidelite.sql');
    if (!l.length) return toast('ما فما حتى عيد ميلاد في 7 أيام 🎂');
    const d = await dlg({ title: '🎂 أعياد ميلاد', msg: 'اضغط على حريف باش تبعثلو تهنئة WhatsApp', buttons: l.map((x, i) => ({ t: (x.days === 0 ? '🎉 اليوم · ' : x.d + ' · ') + x.c.first_name + ' ' + x.c.last_name + ' (' + x.age + ')', cls: x.days === 0 ? 'gold' : '', v: i })).concat([{ t: 'سكّر', v: null }]) });
    if (!d || d.v == null) return;
    const x = l[d.v].c, w = waLink(x.phone, 'عيد ميلاد سعيد ' + x.first_name + ' 🎂🎉\nكل عام وانت بخير. فريق Almas يستناك باش نحتفلو معاك ☕');
    w ? window.open(w, '_blank') : toast('ما عندوش رقم تلفون');
  };
  const lyShow = u => { $('lyP').classList.toggle('hide', !u); if (u) lyRefresh(); };
  sb.auth.onAuthStateChange((_e, s) => lyShow(s && s.user));
  sb.auth.getSession().then(r => lyShow(r.data.session && r.data.session.user));
  $('lyRw').onclick = async () => {
    const d = await lyPending();
    if (d == null) return toast('ما تحمّلتش. تأكد أنك شغّلت fidelite.sql');
    if (!d.length) return toast('ما فما حتى مكافأة تستنى ✅');
    const r = await dlg({ title: '🎁 مكافآت الوفاء', msg: 'اختار حريف باش تبعثلو رسالة WhatsApp', buttons: d.map((x, i) => ({ t: x.customers.first_name + ' ' + x.customers.last_name + ' — ' + fmtM(x.reward_millimes), cls: i ? '' : 'gold', v: i })).concat([{ t: 'سكّر', v: null }]) });
    if (!r || r.v == null) return;
    const x = d[r.v], c = x.customers;
    const msg = 'مبروك ' + c.first_name + ' 🎉\nكمّلت 10 كوموندات في Almas وربحت ' + fmtM(x.reward_millimes) + ' (5% من ' + fmtM(x.total_millimes) + ').\nتنجم تستعملها في زيارتك الجاية. وتحلّتلك بطاقة جديدة 🎁';
    const l = waLink(c.phone, msg);
    if (!l) return toast('ما عندوش رقم تلفون');
    window.open(l, '_blank');
    if (await askConfirm('المكافأة', 'تبعثت الرسالة لـ ' + c.first_name + '؟ نسجّلها كمبعوثة.', 'إيه، تبعثت')) {
      const u = await sb.from('loyalty_cards').update({ reward_sent: true, reward_sent_at: new Date().toISOString() }).eq('id', x.id);
      toast(u.error ? 'ما تسجّلتش. عاود جرّب' : 'تسجّلت ✅'); lyRefresh();
    }
  };
  $('lyCl').onclick = async () => {
    const r = await sb.from('customers').select('id,first_name,last_name,phone', { count: 'exact' }).order('created_at', { ascending: false }).limit(60);
    if (r.error) return toast('ما تحمّلتش. تأكد أنك شغّلت fidelite.sql');
    if (!r.data.length) return toast('ما فما حتى حريف مسجّل بعد');
    const d = await dlg({ title: '👥 الحرفاء (' + (r.count || r.data.length) + ')', msg: 'اضغط على حريف: كاشيات، رصيد، WhatsApp', buttons: r.data.map((x, i) => ({ t: x.first_name + ' ' + x.last_name + ' · ' + x.phone, v: i })).concat([{ t: 'سكّر', v: null }]) });
    if (d && d.v != null) clientActions(r.data[d.v]);
  };
  async function clientActions(x) {
    const i = await sb.rpc('owner_customer_info', { p_customer: x.id }), inf = i.data || {};
    const d = await dlg({ title: x.first_name + ' ' + x.last_name, msg: '📞 ' + x.phone + '\nالكاشيات: ' + (inf.stamps == null ? '?' : inf.stamps) + '/10\n🎁 الرصيد: ' + fmtM(inf.balance || 0),
      buttons: [{ t: '➕ زيد كاشي', cls: 'gold', v: 'add' }, { t: '➖ نحّي آخر كاشي', v: 'rm' }, { t: '💬 WhatsApp', v: 'wa' }, { t: 'سكّر', v: null }] });
    if (!d || !d.v) return;
    if (d.v === 'wa') { const l = waLink(x.phone, 'السلام ' + x.first_name); return l && window.open(l, '_blank'); }
    if (d.v === 'add') {
      const a = await dlg({ title: '➕ كاشي لـ ' + x.first_name, msg: 'مبلغ الكوموند بالدينار (يدخل في حساب الـ5%). اكتب 0 كان ما تحبش', input: { type: 'number', value: 0 }, buttons: [{ t: 'زيد', cls: 'gold', v: 'ok' }, { t: 'إلغاء', v: null }] });
      if (!a || a.v !== 'ok') return;
      const mm = Math.max(0, Math.round((Number(a.text) || 0) * 1000));
      const r = await sb.rpc('owner_add_stamp', { p_customer: x.id, p_amount: mm });
      if (r.error) return toast('ما تزادتش. عاود جرّب');
      toast(r.data.completed ? '🎉 تكمّلت الفيش! الرصيد: ' + fmtM(r.data.info.balance) : '✅ تزاد كاشي (' + r.data.info.stamps + '/10)');
    } else if (d.v === 'rm') {
      if (!(await askConfirm('نحّي كاشي', 'نحّي آخر كاشي من فيش ' + x.first_name + '؟', 'نحّي'))) return;
      const r = await sb.rpc('owner_remove_stamp', { p_customer: x.id });
      if (r.error) return toast(/aucune_case/.test(r.error.message) ? 'ما فما حتى كاشي في الفيش الحالية' : 'ما تنحّاش. عاود جرّب');
      toast('تنحّى كاشي (' + r.data.info.stamps + '/10)');
    }
    lyRefresh();
  }

  $('clO').onclick = showPending;
  $('clS').onclick = scan;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshPending(); });
})();
