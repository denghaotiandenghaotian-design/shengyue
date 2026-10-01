/* 声阅 PWA Service Worker —— 离线可用的应用外壳 + CDN 运行时缓存 */
const VERSION = 'shengyue-pwa-v1';
const CORE_CACHE = VERSION + '-core';
const RUNTIME_CACHE = VERSION + '-runtime';
const SHARE_CACHE = VERSION + '-share';           // 分享目标接收到的文件暂存区
const SHARE_KEY = '/__shengyue_shared__';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png'
];

// 装机（不因个别资源失败而整体失败）
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CORE_CACHE);
    await Promise.all(CORE_ASSETS.map((u) => c.add(u).catch(() => null)));
    await self.skipWaiting();
  })());
});

// 激活：清理旧版本缓存并立即接管
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Web Share Target：从微信等应用「分享」过来的文件（POST multipart/form-data）
  if (req.method === 'POST' && url.origin === self.location.origin) {
    e.respondWith(handleShare(req));
    return;
  }

  if (req.method !== 'GET') return;

  // 页面导航：网络优先，离线回退缓存的首页
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CORE_CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const isRuntime =
    sameOrigin ||
    /(^|\.)cdnjs\.cloudflare\.com$|(^|\.)fonts\.googleapis\.com$|(^|\.)fonts\.gstatic\.com$/.test(url.host);

  if (!isRuntime) return;

  // 缓存优先 + 后台填充（本应用资源是静态的，缓存优先最稳）
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && (res.status === 200 || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});

// —— Web Share Target 处理 ——
// 从分享请求里取出文件，暂存到 Cache，再 303 重定向回应用首页由页面读取
async function handleShare(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (file && file.size) {
      const cache = await caches.open(SHARE_CACHE);
      const headers = new Headers({
        'Content-Type': file.type || 'application/octet-stream',
        'X-Shengyue-Filename': encodeURIComponent(file.name || 'shared')
      });
      await cache.put(SHARE_KEY, new Response(file, { headers }));
    }
  } catch (err) {
    // 解析失败也照常跳回应用，让用户手动选择文件
  }
  const target = new URL('./index.html?shared=1', self.location).href;
  return Response.redirect(target, 303);
}
