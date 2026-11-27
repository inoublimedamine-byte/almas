/* Almas — liaison Supabase (chargé APRÈS le script principal de index.html) */
(function () {
  // ===== À CONFIGURER (mêmes valeurs que dans menu.html) =====
  const SB_URL = 'https://rxgjfaolfznnvkqzounv.supabase.co';
  const SB_KEY = 'sb_publishable__mkqYHMSQgU0JDZH5PahKw_ugMLqOLz'; // clé "anon" uniquement
  // ===========================================================
  if (!window.supabase || SB_KEY.indexOf('VOTRE') === 0) return; // pas configuré : l'app reste 100 % locale

  const sb = supabase.createClient(SB_URL, SB_KEY);
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
    '<div class="panel"><strong>☁️ كوموندات الحرفاء بالـQR</strong><div class="mini" id="clInfo" style="margin:6px 0"></div>' +
    '<input class="field" id="clE" type="email" autocomplete="username" placeholder="Email">' +
    '<input class="field" id="clP" type="password" autocomplete="current-password" placeholder="كلمة السر">' +
    '<button class="btn gold" id="clIn">دخول</button><button class="btn light hide" id="clOut">خروج</button>' +
    '<button class="btn light hide" id="clBk">☁️ احفظ نسخة احتياطية توّا</button>' +
    '<button class="btn light hide" id="clRs">↩️ استرجاع نسخة من السحاب</button></div>');

  // --- Connexion ---
  async function onUser(u) {
    user = u;
    $('cl').classList.toggle('hide', !u);
    $('clOut').classList.toggle('hide', !u);
    $('clIn').classList.toggle('hide', !!u);
    $('clBk').classList.toggle('hide', !u);
    $('clRs').classList.toggle('hide', !u);
    $('clInfo').textContent = u ? 'متصل: ' + u.email : 'موش متصل';
    if (u) { listen(); refreshPending(); syncMenu(true); setTimeout(() => cloudBackup(false), 8000); }
    else if (ch) { sb.removeChannel(ch); ch = null; }
  }
  sb.auth.onAuthStateChange((_e, s) => onUser(s && s.user));
  sb.auth.getSession().then(r => onUser(r.data.session && r.data.session.user));
  $('clIn').onclick = async () => {
    const r = await sb.auth.signInWithPassword({ email: $('clE').value.trim(), password: $('clP').value });
    $('clP').value = '';
    toast(r.error ? 'الدخول فشل: تأكد من الإيميل وكلمة السر' : 'تعمل الدخول');
  };
  $('clOut').onclick = () => sb.auth.signOut();

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
  };

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
    const r = await sb.from('staff').select('id,name,phone,email').eq('active', true).order('name');
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

  $('clO').onclick = showPending;
  $('clS').onclick = scan;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshPending(); });
})();
