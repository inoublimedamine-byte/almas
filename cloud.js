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
  document.body.insertAdjacentHTML('beforeend',
    '<div id="cl" class="hide" style="position:fixed;left:10px;bottom:78px;z-index:30;display:flex;gap:8px">' +
    '<button id="clO" class="btn gold" style="width:auto;margin:0;padding:11px 14px">📲 <span id="clN">0</span></button>' +
    '<button id="clS" class="btn light" style="width:auto;margin:0;padding:11px 14px" aria-label="مسح QR">📷</button></div>');
  const sec = $('settings');
  if (sec) sec.insertAdjacentHTML('beforeend',
    '<div class="panel"><strong>☁️ كوموندات الحرفاء بالـQR</strong><div class="mini" id="clInfo" style="margin:6px 0"></div>' +
    '<input class="field" id="clE" type="email" autocomplete="username" placeholder="Email">' +
    '<input class="field" id="clP" type="password" autocomplete="current-password" placeholder="كلمة السر">' +
    '<button class="btn gold" id="clIn">دخول</button><button class="btn light hide" id="clOut">خروج</button></div>');

  // --- Connexion ---
  async function onUser(u) {
    user = u;
    $('cl').classList.toggle('hide', !u);
    $('clOut').classList.toggle('hide', !u);
    $('clIn').classList.toggle('hide', !!u);
    $('clInfo').textContent = u ? 'متصل: ' + u.email : 'موش متصل';
    if (u) { listen(); refreshPending(); syncMenu(true); }
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
      available: p.available !== false, sort: i
    }));
    const sig = JSON.stringify(rows);
    if (!force && sig === lastSig) return;
    const up = await sb.from('menu_items').upsert(rows, { onConflict: 'local_id' });
    if (up.error) return;
    await sb.from('menu_items').delete().not('local_id', 'in', '(' + rows.map(r => r.local_id).join(',') + ')');
    lastSig = sig;
  }
  const persist0 = persist;
  persist = function () { persist0.apply(this, arguments); clearTimeout(timer); timer = setTimeout(() => syncMenu(false), 1500); };

  // --- Commandes clients en direct ---
  async function refreshPending() {
    if (!user) return;
    const r = await sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'nouvelle');
    $('clN').textContent = r.count || 0;
  }
  function listen() {
    if (ch) return;
    ch = sb.channel('almas-orders').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, p => {
      const n = p.new || {};
      if (p.eventType === 'INSERT') { beep(); toast('📲 كوموند جديدة — طاولة ' + n.table_no); }
      else if (p.eventType === 'UPDATE' && n.bill_requested && !(p.old && p.old.bill_requested)) { beep(); toast('🧾 طاولة ' + n.table_no + ' تطلب الحساب'); }
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
      const d = await dlg({ title: '📲 طاولة ' + o.table_no, msg: txt, buttons: [{ t: 'قبول وزيد للطاولة', cls: 'gold', v: 'ok' }, { t: 'رفض', v: 'no' }, { t: 'بعد', v: null }] });
      if (!d || d.v == null) break;
      const st = d.v === 'ok' ? 'acceptee' : 'annulee';
      // le statut ne change que si la commande est encore "nouvelle" : évite un double ajout
      const u = await sb.from('orders').update({ status: st }).eq('id', o.id).eq('status', 'nouvelle').select('id');
      if (u.error || !u.data.length) continue;
      if (d.v === 'ok') {
        const t = db.tables.find(x => x.id === o.table_no);
        if (!t) { toast('طاولة ' + o.table_no + ' موش موجودة في التطبيق'); continue; }
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

  // --- Paiement : quand une table est soldée, ses commandes cloud passent à "payée" ---
  const closeTable0 = closeTable;
  closeTable = async function (id) {
    await closeTable0.apply(this, arguments);
    const t = db.tables.find(x => x.id === id);
    if (user && t && !t.items.length)
      sb.from('orders').update({ status: 'payee' }).eq('table_no', id).in('status', ['acceptee', 'servie']).then(refreshPending);
  };

  // --- Scan du QR de l'addition (téléphone du client) ---
  async function payScan(id) {
    const r = await sb.from('orders').select('id,table_no,status,total_millimes').eq('id', id).maybeSingle();
    const o = r.data;
    if (!o) return toast('الكود موش معروف');
    if (o.status === 'payee') return toast('هالكوموند خالصة من قبل');
    if (o.status === 'annulee') return toast('هالكوموند ملغاة');
    if (o.status === 'nouvelle') return toast('هالكوموند ما تقبلتش بعد. اقبلها الأول من 📲');
    const t = db.tables.find(x => x.id === o.table_no);
    const tot = t ? t.items.reduce((s, c) => s + c.price * c.q, 0) : 0;
    const d = await dlg({ title: '🧾 طاولة ' + o.table_no, msg: 'كوموند الحريف: ' + money(o.total_millimes / 1000) + '\nمجموع الطاولة: ' + money(tot), buttons: [{ t: 'خلاص الطاولة', cls: 'gold', v: 'ok' }, { t: 'إلغاء', v: null }] });
    if (d && d.v === 'ok') closeTable(o.table_no);
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
        const r = await det.detect(v), m = r[0] && /^almas:([0-9a-f-]{36})$/.exec(r[0].rawValue);
        if (m) { stop(); return payScan(m[1]); }
      } catch (e) {}
      setTimeout(loop, 300);
    };
    loop();
  }
  $('clO').onclick = showPending;
  $('clS').onclick = scan;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshPending(); });
})();
