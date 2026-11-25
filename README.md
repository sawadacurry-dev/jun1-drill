# 準一級 単語ドリル

**公開URL: https://sawadacurry-dev.github.io/jun1-drill/**

スマホでこのURLを開き、「ホーム画面に追加」するとアプリのように使えます。`main` ブランチに push すると、`app` フォルダの中身が GitHub Pages に自動で公開し直されます（`.github/workflows/pages.yml`）。

英検準1級の単語1,680語を、例文の空欄補充で覚えるスマホ向けWebアプリです。忘却曲線に沿って、毎日の出題を自動で決めます。

## フォルダ構成
| 場所 | 中身 |
|---|---|
| `準一級単語一覧.csv` | 元の単語リスト |
| `data/sentences/*.tsv` | 例文（`No ⇥ 英文 ⇥ 和訳`）。英文の答えの部分は `[ ]`、和訳で対応する部分は `【 】` で囲む |
| `app/` | アプリ本体（このフォルダをそのまま公開する） |
| `tools/build.js` | CSVと例文から `app/words.js` を作り、例文をチェックする |
| `tools/serve.js` | PCで試すための簡易サーバー |

## PCで試す
```powershell
node tools/serve.js
```
起動したら、ブラウザで http://localhost:8080 を開きます。

## 例文を直したとき
`data/sentences/` のファイルを編集したら、次のコマンドでアプリ用のデータを作り直します。
```powershell
node tools/build.js
```


## 出題のしくみ（忘却曲線）
記憶は時間とともに指数関数的に薄れていきます（エビングハウスの忘却曲線）。このアプリでは、単語ごとに次の式で「今どれくらい覚えているか」を予測します。

    記憶率 = 0.9 ^ (前回からの日数 ÷ 記憶の強さ)

「記憶の強さ」は、記憶率が90%まで下がるのにかかる日数です。**記憶率が90%まで下がる日に復習を出します。** 思い出すたびに記憶の強さが伸びるので、忘れ方がゆるやかになり、復習の間隔もだんだん延びていきます（詳しくは `app/srs.js`）。

| 解き方 | 評価 | 記憶の強さの変化 | 間隔の例（毎回この評価なら） |
|---|---|---|---|
| ノーミス・ヒントなしで、10秒以内に正解 | 完璧 | 約2.5倍以上 | 1→3→8→22→68日 |
| ノーミス・ヒントなしで正解 | 良い | 約2.3倍 | 1→2→5→12→28日 |
| 1回ミス、またはヒント1回 | ふつう | 少しだけ伸びる | 1→2→3→4→6日 |
| ヒント2回以上、または2回以上ミス | あやしい | 0.6倍に縮む | 翌日など |
| 答えを見た | 忘れた | 0.2倍に縮む | その日の最後にもう一度＋翌日以降 |

- 初めての単語は、どの評価でも翌日に1回目の復習があります（覚えた直後がいちばん忘れやすいため）。
- 忘れかけた頃（記憶率が低いとき）に思い出せた場合ほど、記憶の強さが大きく伸びます。逆に、早すぎる復習は効果が小さくなります（間隔効果）。
- 期限が来た復習は、記憶率の予測が低い単語から出します。
- 答えた後の画面に、その単語の忘却曲線と次の復習日が表示されます。
- ヒントは、入力のうち合っている部分の次の1文字を教えます。ここまで全部合っていればその文字を空欄に足し、途中から違うときは入力はそのままで文字だけ教えます。
- 1文字違いなどの惜しいミスは「惜しい！」と表示され、もう一度入力できます（1回ミスとして数えます）。
- 1日は朝4時に切り替わります。
- 学習記録は端末のブラウザに保存されます。設定画面から書き出し・読み込みができます。

## 毎日の通知
- 設定の「通知をオンにする」を押すと、毎日選んだ時刻（初期設定は20時）に「今日の問題は○問（復習○・新出○）」と通知します。終わっていれば「今日の分は完了」、途中なら「あと○問」になります。
- 通知サーバーは Cloudflare Workers（）です。端末の登録を受け付けて KV に保存し、毎時0分にその時刻を選んだ端末へ送ります。
  - アドレス: https://jun1-drill-push.jun1-drill-app.workers.dev
  - 公開・更新:  → 
╭─────────────────────────────────╮
│ Did you mean "wrangler deploy"? │
╰─────────────────────────────────╯

wrangler

COMMANDS
  wrangler docs [search..]        📚 Open Wrangler's command documentation in your browser
  wrangler complete [shell]       ⌨️ Generate and handle shell completions

  wrangler email                  Manage Cloudflare Email services [open beta]

ACCOUNT
  wrangler auth                   🔐 Manage authentication
  wrangler login                  🔓 Login to Cloudflare
  wrangler logout                 🚪 Logout from Cloudflare
  wrangler whoami                 🕵️ Retrieve your user information

COMPUTE & AI
  wrangler agent-memory           🧠 Manage Agent Memory namespaces [private beta]
  wrangler ai                     🤖 Manage AI models
  wrangler ai-search              🔍 Manage AI Search instances [open beta]
  wrangler browser                🌐 Manage Browser Run sessions [open beta]
  wrangler containers             📦 Manage Containers
  wrangler delete [name]          🗑️ Delete a Worker from Cloudflare
  wrangler deploy [path]          🆙 Deploy a Worker to Cloudflare
  wrangler deployments            🚢 List and view the current and past deployments for your Worker
  wrangler dev [script]           👂 Start a local server for developing your Worker
  wrangler dispatch-namespace     🏗️ Manage dispatch namespaces
  wrangler flagship               🚩 Manage Flagship apps and feature flags [open beta]
  wrangler init [name]            📥 Initialize a basic Worker
  wrangler pages                  ⚡️ Configure Cloudflare Pages
  wrangler preview [script]       👀 Create a Preview deployment of the current Worker [open beta]
  wrangler queues                 📬 Manage Workers Queues
  wrangler rollback [version-id]  🔙 Rollback a deployment for a Worker
  wrangler secret                 🤫 Generate a secret that can be referenced in a Worker
  wrangler setup                  🪄 Setup a project to work on Cloudflare
  wrangler tail [worker]          🦚 Start a log tailing session for a Worker
  wrangler triggers               🎯 Updates the triggers of your current deployment [experimental]
  wrangler types [path]           📝 Generate types from your Worker configuration
  wrangler versions               🫧 List, view, upload and deploy Versions of your Worker to Cloudflare
  wrangler vpc                    🌐 Manage VPC [open beta]
  wrangler workflows              🔁 Manage Workflows

STORAGE & DATABASES
  wrangler artifacts              🧱 Manage Artifacts namespaces and repos [open beta]
  wrangler basin                  🏞️ Manage Basin products
  wrangler d1                     🗄️ Manage Workers D1 databases
  wrangler hyperdrive             🚀 Manage Hyperdrive databases
  wrangler k2                     ⛰️ Manage K2 streams [open beta]
  wrangler kv                     🗂️ Manage Workers KV Namespaces
  wrangler r2                     📦 Manage R2 buckets & objects
  wrangler secrets-store          🔐 Manage the Secrets Store [open beta]
  wrangler vectorize              🧮 Manage Vectorize indexes

NETWORKING & SECURITY
  wrangler cert                   🪪 Manage client mTLS certificates and CA certificate chains used for secured connections [open beta]
  wrangler mtls-certificate       🪪 Manage certificates used for mTLS connections
  wrangler tunnel                 🚇 Manage Cloudflare Tunnels [experimental]
  wrangler turnstile              🛡️ Manage Turnstile widgets [alpha]

GLOBAL FLAGS
  -c, --config          Path to Wrangler configuration file  [string]
      --cwd             Run as if Wrangler was started in the specified directory instead of the current working directory  [string]
  -e, --env             Environment to use for operations, and for selecting .env and .dev.vars files  [string]
      --env-file        Path to an .env file to load - can be specified multiple times - values from earlier files are overridden by values in later files  [array]
  -h, --help            Show help  [boolean]
      --install-skills  Install Cloudflare skills for detected AI coding agents before running the command  [boolean] [default: false]
      --profile         Use a specific auth profile  [string]
  -v, --version         Show version number  [boolean]

Please report any issues to https://github.com/cloudflare/workers-sdk/issues/new/choose
  - 秘密の値（ で設定）: （通知用の秘密鍵）、（管理用の一斉送信  に使う）
- 通知の文面は端末側（）がその日の学習状況から作るので、学習記録がサーバーに送られることはありません。サーバーにあるのは端末の登録情報と通知の時刻だけです。
- iPhone では、ホーム画面に追加したアイコンから開いたときだけ使えます（iOS 16.4 以降）。
- 通知用の鍵が変わったときは、アプリを開いたときに自動で登録し直します。

## 続けたくなる仕掛け
- **記憶の木**（ホーム）: 覚えている単語（予測）が葉になって育つ。忘れかけの単語は色あせた葉になり、復習すると緑に戻る。
- **単語図鑑**: 1,680語を記憶の強さで色分け。忘れかけると色があせる。タップで例文・記憶率・次の復習日。
- **合格までのペース予測**: 今のペースで全語に出会う日・定着する目安。試験日を入れると、必要な1日の新出数を逆算。
- **称号**: 出会った語数・定着した語数・忘れかけた単語を取り戻した回数などで獲得（続けた日数ではない）。
