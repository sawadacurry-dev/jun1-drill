// オフラインでも開けるようにファイルを保存しておく ＋ 毎日の通知を表示する
const CACHE = 'jun1-drill-v8';
const FILES = ['./', './index.html', './style.css', './app.js', './srs.js', './push-config.js', './words.js', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// ネット優先・つながらなければ保存分を使う（更新がすぐ反映されるように）
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// ---------- 通知 ----------
function idbGet(key) {
  return new Promise((resolve) => {
    const req = indexedDB.open('jun1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readonly');
      const g = tx.objectStore('kv').get(key);
      g.onsuccess = () => { resolve(g.result || null); req.result.close(); };
      g.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}
// アプリと同じく朝4時で日付が変わる
function todayStr(offsetDays) {
  const d = new Date(Date.now() - 4 * 3600 * 1000);
  d.setDate(d.getDate() + (offsetDays || 0));
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
// 今日の問題数を計算して通知の文を作る
async function buildMessage() {
  const s = await idbGet('summary');
  const t = todayStr(0);
  if (!s) return { title: '準一級 単語ドリル', body: '今日の単語練習をはじめましょう。' };
  if (s.session && s.session.date === t && s.session.pos >= s.session.total && s.session.total > 0) {
    const tm = todayStr(1);
    const tomorrow = s.dues.filter((d) => d <= tm).length;
    return { title: '今日の分は完了しています 🎉', body: '明日の復習は ' + tomorrow + ' 問です。この調子で続けましょう。' };
  }
  if (s.session && s.session.date === t && s.session.pos > 0) {
    const left = s.session.total - s.session.pos;
    return { title: '今日の問題があと ' + left + ' 問', body: '続きをやって、忘れかけた単語を取り戻しましょう。' };
  }
  const due = s.dues.filter((d) => d <= t).length;
  const reviews = Math.min(s.daily, due);
  const news = Math.min(s.daily - reviews, s.unseen);
  const total = reviews + news;
  if (total === 0) return { title: '準一級 単語ドリル', body: '今日の問題はありません。' };
  return {
    title: '今日の問題は ' + total + ' 問',
    body: '復習 ' + reviews + ' 問・新出 ' + news + ' 問' + (due > reviews ? '（期限の来た復習があと ' + (due - reviews) + ' 問）' : '') + '。忘れる前に解きましょう。',
  };
}
async function notify() {
  const m = await buildMessage();
  return self.registration.showNotification(m.title, {
    body: m.body,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'daily',
    renotify: true,
    data: { url: './' },
  });
}
// iPhone では通知を必ず表示しないと通知の権限が取り消されるので、どんな場合も表示する
self.addEventListener('push', (e) => { e.waitUntil(notify()); });
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'test-notification') e.waitUntil(notify()); });
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  })());
});
