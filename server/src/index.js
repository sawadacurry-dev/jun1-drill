// 準一級 単語ドリル 通知サーバー（Cloudflare Workers）
//
//   POST /subscribe    { subscription, hour }  … 端末を登録（hour = 通知する時刻 0〜23、日本時間）
//   POST /unsubscribe  { endpoint }            … 登録を解除
//   GET  /health                               … 動作確認
//   毎時0分（Cron）                            … その時刻を選んだ端末に通知を送る
//
// 通知の文面は端末側（app/sw.js）がその日の学習状況から作るので、ここは合図を送るだけ。
// Web Push の暗号化（RFC 8291）と VAPID 署名（RFC 8292）は Web Crypto だけで実装している。

const ALLOWED_ORIGINS = ['https://sawadacurry-dev.github.io', 'http://localhost:8080'];
const PUSH_HOSTS = /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;
const MAX_SUBS = 500;
const SUBJECT = 'https://sawadacurry-dev.github.io/jun1-drill/';

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(req.url);
    try {
      if (url.pathname === '/health') return json({ ok: true });

      if (url.pathname === '/subscribe' && req.method === 'POST') {
        if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'forbidden' }, 403);
        const body = await req.json();
        const sub = body.subscription;
        const hour = Number.isInteger(body.hour) && body.hour >= 0 && body.hour <= 23 ? body.hour : 20;
        if (!sub || typeof sub.endpoint !== 'string' || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return json({ error: 'invalid subscription' }, 400);
        const host = new URL(sub.endpoint).hostname;
        if (new URL(sub.endpoint).protocol !== 'https:' || !PUSH_HOSTS.test(host)) return json({ error: 'unknown push service' }, 400);
        const id = await sha256hex(sub.endpoint);
        const existing = await env.SUBS.get(id);
        if (!existing) {
          const count = (await env.SUBS.list({ limit: MAX_SUBS })).keys.length;
          if (count >= MAX_SUBS) return json({ error: 'full' }, 503);
        }
        await env.SUBS.put(id, JSON.stringify({ sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, hour, created: existing ? JSON.parse(existing).created : Date.now() }));
        return json({ ok: true, hour });
      }

      if (url.pathname === '/unsubscribe' && req.method === 'POST') {
        const body = await req.json();
        if (typeof body.endpoint === 'string') await env.SUBS.delete(await sha256hex(body.endpoint));
        return json({ ok: true });
      }

      // 管理用：今すぐ全員（または指定時刻の人）に送る。秘密のトークンが必要
      if (url.pathname === '/admin/send' && req.method === 'POST') {
        if (!env.ADMIN_TOKEN || req.headers.get('Authorization') !== 'Bearer ' + env.ADMIN_TOKEN) return json({ error: 'unauthorized' }, 401);
        const h = url.searchParams.get('hour');
        return json(await sendAll(env, h === null ? null : Number(h)));
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    const hourJst = (new Date(event.scheduledTime).getUTCHours() + 9) % 24;
    ctx.waitUntil(sendAll(env, hourJst));
  },
};

async function sendAll(env, hour) {
  let cursor, sent = 0, removed = 0, failed = 0;
  do {
    const page = await env.SUBS.list({ cursor });
    for (const k of page.keys) {
      const raw = await env.SUBS.get(k.name);
      if (!raw) continue;
      const rec = JSON.parse(raw);
      if (hour !== null && rec.hour !== hour) continue;
      const res = await sendPush(env, rec.sub, JSON.stringify({ type: 'daily' }));
      if (res.status === 404 || res.status === 410) { await env.SUBS.delete(k.name); removed++; }
      else if (res.ok) sent++;
      else failed++;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return { hour, sent, removed, failed };
}

// ---------- Web Push ----------
const enc = new TextEncoder();
const b64u = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
};
const concat = (...arrs) => { const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };

async function sha256hex(s) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

async function vapidHeader(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const header = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u.enc(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })));
  const pub = b64u.dec(env.VAPID_PUBLIC_KEY);
  const jwk = { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)) };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + payload));
  return 'vapid t=' + header + '.' + payload + '.' + b64u.enc(sig) + ', k=' + env.VAPID_PUBLIC_KEY;
}

// RFC 8291 (aes128gcm) でメッセージを暗号化
async function encrypt(sub, plaintext) {
  const uaPub = b64u.dec(sub.keys.p256dh);
  const authSecret = b64u.dec(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concat(enc.encode(plaintext), new Uint8Array([2])); // 2 = 最後のレコード
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, cipher);
}

async function sendPush(env, sub, message) {
  const body = await encrypt(sub, message);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': await vapidHeader(env, sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': String(6 * 3600),
      'Urgency': 'normal',
    },
    body,
  });
}
