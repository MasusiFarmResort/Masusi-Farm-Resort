const CACHE="masusi-resort-v56-clean";const ASSETS=["./","./index.html","./style.css","./app.js","./operations.js","./config.js","./manifest.json","./assets/logo-placeholder.svg","./assets/resort-bg.svg","./second-screen.html"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)))});
