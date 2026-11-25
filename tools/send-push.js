// 登録された端末に毎日の通知を送る（GitHub Actions から実行）
// 必要な環境変数:
//   VAPID_PRIVATE_KEY   … 通知用の秘密鍵（GitHub Secrets）
//   PUSH_SUBSCRIPTIONS  … 端末の登録情報（アプリの設定画面で出るコード。複数なら JSON 配列）
// 通知の文面は端末側（app/sw.js）が「今日の問題数」から作るので、ここでは合図だけ送る。
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const cfg = fs.readFileSync(path.join(__dirname, '..', 'app', 'push-config.js'), 'utf8');
const publicKey = (cfg.match(/vapidPublicKey:\s*'([^']+)'/) || [])[1];
const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
const rawSubs = (process.env.PUSH_SUBSCRIPTIONS || '').trim();

if (!publicKey || !privateKey) { console.error('通知用の鍵が設定されていません'); process.exit(1); }
if (!rawSubs) { console.log('まだ端末が登録されていないので、何も送りません'); process.exit(0); }

let subs = JSON.parse(rawSubs);
if (!Array.isArray(subs)) subs = [subs];

webpush.setVapidDetails('https://sawadacurry-dev.github.io/jun1-drill/', publicKey, privateKey);

(async () => {
  let failed = 0;
  for (const [i, sub] of subs.entries()) {
    try {
      const res = await webpush.sendNotification(sub, JSON.stringify({ type: 'daily' }), { TTL: 6 * 3600, urgency: 'normal' });
      console.log(`端末${i + 1}: 送信しました (${res.statusCode})`);
    } catch (err) {
      failed++;
      if (err.statusCode === 404 || err.statusCode === 410) {
        console.error(`端末${i + 1}: 登録が無効になっています。アプリの設定画面で通知をオンにし直し、新しいコードを登録してください。`);
      } else {
        console.error(`端末${i + 1}: 送信に失敗しました (${err.statusCode || err.code || '原因不明'}) ${err.body || err.message || ''}`);
      }
    }
  }
  if (failed === subs.length) process.exit(1);
})();
