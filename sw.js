const CACHE = 'dino-run-v2.0.0-3f8fbaa93682';
const FILES = ['./','index.html','style.css','game.js','engine.js','renderer.js','storage.js','dinos.js','portraits.js','vendor/three.module.js','manifest.webmanifest','assets/icon.svg','assets/icon-180.png','assets/icon-192.png','assets/icon-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(file=>new Request(file,{cache:'reload'}))))); });
self.addEventListener('message', event => { if(event.data?.type === 'ACTIVATE') self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil((async()=> { for(const key of await caches.keys()) if(key.startsWith('dino-run-') && key !== CACHE) await caches.delete(key); await self.clients.claim(); })()); });
self.addEventListener('fetch', event => {
  const url=new URL(event.request.url);
  if(event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  event.respondWith((async()=> { const cache=await caches.open(CACHE); const match=await cache.match(event.request,{ignoreSearch:true}); if(match) return match; if(event.request.mode === 'navigate') return (await cache.match('./')) || fetch(event.request); return fetch(event.request); })());
});
