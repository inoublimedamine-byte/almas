const CACHE='almas-v4';
const SHELL=['./','./index.html','./serveur.html','./manifest.webmanifest','./manifest-serveur.webmanifest','./icon-192.png','./icon-512.png','./bell.mp3'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET')return;
  const u=new URL(r.url);
  // App pages: network first (gets updates), fall back to cache when offline
  if(r.mode==='navigate'||u.origin===location.origin){
    e.respondWith(fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp))}return res}).catch(()=>caches.match(r).then(m=>m||caches.match('./index.html'))));
    return;
  }
  // Product photos from other sites: cache after first load
  if(r.destination==='image'){
    e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp));return res}).catch(()=>m)));
  }
});

// ===== Notifications Push (commande QR / addition demandée), même app fermée =====
self.addEventListener('push',e=>{
  let d={};try{d=e.data?e.data.json():{}}catch(_){d={body:e.data&&e.data.text()}}
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    if(cs.some(c=>c.visibilityState==='visible'))return; // l'app est ouverte à l'écran : la cloche in-app sonne déjà
    return self.registration.showNotification(d.title||'📲 كوموند جديدة',{
    body:d.body||'',tag:d.tag||'almas-order',renotify:true,requireInteraction:true,
    vibrate:[300,150,300,150,300],icon:'./icon-192.png',badge:'./icon-192.png',data:{url:'./index.html'}
  });
  }));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    const c=cs.find(x=>x.url.includes('index.html')||x.url.endsWith('/'))||cs[0];
    return c?c.focus():self.clients.openWindow((e.notification.data&&e.notification.data.url)||'./index.html');
  }));
});
