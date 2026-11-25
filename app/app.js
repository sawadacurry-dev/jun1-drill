(function () {
  'use strict';
  const K = { cards: 'jun1.cards', settings: 'jun1.settings', session: 'jun1.session', log: 'jun1.log' };
  const DEFAULT_SETTINGS = { daily: 20, order: 'seq', autoSpeak: true, rate: 0.9, voice: '', sound: true };

  // ---------- データ ----------
  const WORDS = (window.WORDS || []).map((w) => {
    const m = w.en.match(/^(.*?)\[([^\]]+)\](.*)$/);
    return Object.assign({}, w, { before: m ? m[1] : w.en, answer: m ? m[2] : w.word, after: m ? m[3] : '' });
  });
  const BY_NO = new Map(WORDS.map((w) => [w.no, w]));

  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const save = (k, v) => { localStorage.setItem(k, JSON.stringify(v)); scheduleSummary(); };

  let cards = load(K.cards, {});
  let settings = Object.assign({}, DEFAULT_SETTINGS, load(K.settings, {}));
  let session = load(K.session, null);
  let log = load(K.log, {});

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const today = () => SRS.todayStr();

  // ---------- 画面切り替え ----------
  function show(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    $('view-' + name).classList.remove('hidden');
    window.scrollTo(0, 0);
    if (name === 'quiz') fitViewport();
    if (name === 'home') renderHome();
    if (name === 'stats') renderStats();
    if (name === 'settings') renderSettings();
  }
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

  // ---------- 出題リストを作る ----------
  function dueList(t) {
    // 記憶率の予測が低い（忘れかけている）単語から先に出す
    return WORDS.filter((w) => cards[w.no] && cards[w.no].due && cards[w.no].due <= t)
      .map((w) => ({ no: w.no, r: SRS.retention(cards[w.no], t) }))
      .sort((a, b) => a.r - b.r)
      .map((x) => x.no);
  }
  function newList(exclude) {
    const list = WORDS.filter((w) => !cards[w.no] && !exclude.has(w.no)).map((w) => w.no);
    if (settings.order === 'random') {
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    }
    return list;
  }
  function pick(n, exclude) {
    const t = today();
    const reviews = dueList(t).filter((no) => !exclude.has(no)).slice(0, n);
    const news = newList(exclude).slice(0, n - reviews.length);
    return { reviews, news };
  }
  function ensureSession() {
    const t = today();
    if (!session || session.date !== t) {
      const { reviews, news } = pick(settings.daily, new Set());
      session = {
        date: t, pos: 0, results: [],
        queue: reviews.map((no) => ({ no, kind: 'review' })).concat(news.map((no) => ({ no, kind: 'new' }))),
      };
      save(K.session, session);
    }
    return session;
  }
  function extendSession(n) {
    const inQueue = new Set(session.queue.map((q) => q.no));
    const { reviews, news } = pick(n, inQueue);
    session.queue.push(...reviews.map((no) => ({ no, kind: 'review' })), ...news.map((no) => ({ no, kind: 'new' })));
    save(K.session, session);
    return reviews.length + news.length;
  }

  // ---------- ホーム ----------
  function renderHome() {
    const s = ensureSession();
    const rest = s.queue.slice(s.pos);
    const firstTime = rest.filter((q) => !q.retry);
    $('home-total').textContent = rest.length;
    $('home-review').textContent = firstTime.filter((q) => q.kind === 'review').length;
    $('home-new').textContent = firstTime.filter((q) => q.kind === 'new').length;
    const done = rest.length === 0;
    $('home-done').classList.toggle('hidden', !done);
    $('btn-start').classList.toggle('hidden', done);
    $('btn-start').textContent = s.pos > 0 ? '続きから' : 'スタート';
    $('btn-more').classList.toggle('hidden', !done || WORDS.length === 0);

    const vals = Object.values(cards);
    const learned = vals.filter(SRS.isLearned).length;
    $('home-learned').textContent = learned;
    $('home-all').textContent = WORDS.length;
    $('home-bar').style.width = (WORDS.length ? (100 * learned) / WORDS.length : 0) + '%';
    $('home-streak').textContent = streak();
    const tm = SRS.addDays(today(), 1);
    $('home-due-tomorrow').textContent = vals.filter((c) => c.due && c.due <= tm).length - dueTodayAfterSession();
    $('home-weak').textContent = vals.filter(SRS.isWeak).length;
  }
  function dueTodayAfterSession() {
    // 「明日の復習」から、今日のセッションでこれから解く復習（今日中に片付く分）を除く
    const rest = new Set(session.queue.slice(session.pos).filter((q) => q.kind === 'review' && !q.retry).map((q) => q.no));
    return rest.size;
  }
  function streak() {
    let n = 0; let d = today();
    if (!log[d]) d = SRS.addDays(d, -1);
    while (log[d]) { n++; d = SRS.addDays(d, -1); }
    return n;
  }
  $('btn-start').addEventListener('click', startQuiz);
  $('btn-more').addEventListener('click', () => {
    const added = extendSession(10);
    if (added === 0) { alert('今日出せる単語はもうありません。'); return; }
    startQuiz();
  });

  // ---------- 出題 ----------
  let cur = null; // 今の問題の状態

  function startQuiz() {
    ensureSession();
    if (session.pos >= session.queue.length) { show('home'); return; }
    show('quiz');
    nextQuestion();
  }

  function nextQuestion() {
    if (session.pos >= session.queue.length) { finish(); return; }
    const q = session.queue[session.pos];
    const w = BY_NO.get(q.no);
    if (!w) { session.pos++; save(K.session, session); nextQuestion(); return; }
    cur = { q, w, misses: 0, hintLevel: 0, gaveUp: false, answered: false, start: Date.now() };

    $('q-pos').textContent = session.pos; // 解き終えた数
    $('q-len').textContent = session.queue.length;
    $('q-bar').style.width = (100 * session.pos) / session.queue.length + '%';
    const tag = q.retry ? ['もう一度', 'retry'] : q.kind === 'new' ? ['新出', 'new'] : ['復習', 'review'];
    $('q-tag').textContent = tag[0];
    $('q-tag').className = 'qtab ' + tag[1];

    $('q-ja').innerHTML = esc(w.ja).replace(/【(.+?)】/g, '<span class="mark">$1</span>');
    $('q-before').textContent = w.before.replace(/\s+$/, '');
    $('q-after').textContent = w.after.replace(/^\s+/, '');
    // 空欄の前後に空白があるときだけ余白をとる（"bachelor's" のような場合は詰める）
    $('q-input').classList.toggle('sp-l', /\s$/.test(w.before));
    $('q-input').classList.toggle('sp-r', /^\s/.test(w.after));
    $('q-hint').innerHTML = '';
    setFeedback('', '');
    $('q-result').classList.add('hidden');
    $('q-toolbar').classList.remove('hidden');
    $('hint-left').textContent = 0;
    $('btn-hint').disabled = false;
    const inp = $('q-input');
    inp.value = '';
    $('quiz-scroll').scrollTop = 0;
    lastLen = 0;
    inp.readOnly = false;
    inp.className = inp.className.replace(/\b(ok|ng)\b/g, '').trim();
    autoSize();
    inp.focus();
  }

  // 空欄の幅を入力した文字に合わせて伸ばす
  function autoSize() {
    const inp = $('q-input');
    const m = $('q-measure');
    m.textContent = inp.value || 'xxxx';
    inp.style.width = Math.max(m.offsetWidth + 18, 64) + 'px';
  }

  function norm(s) {
    return s.trim().toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ');
  }
  function lev(a, b) {
    const m = a.length, n = b.length;
    const d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[m][n];
  }

  function setFeedback(text, cls) {
    const f = $('q-feedback');
    f.textContent = text;
    f.className = 'feedback ' + cls;
  }

  $('q-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!cur) return;
    if (cur.answered) { goNext(); return; }
    const v = norm($('q-input').value);
    if (!v) return;
    const ans = norm(cur.w.answer);
    if (v === ans) { sfx.ok(); complete(false); return; }
    cur.misses++;
    const inp = $('q-input');
    inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake');
    if (v === norm(cur.w.word)) { sfx.near(); setFeedback('単語は合っています。文中の形（活用）に注意！', 'near'); return; }
    const tol = ans.length >= 8 ? 2 : 1;
    if (lev(v, ans) <= tol) { sfx.near(); setFeedback('惜しい！ スペルを確認してもう一度', 'near'); return; }
    sfx.wrong();
    setFeedback('ちがいます。もう一度', 'wrong');
    inp.select();
  });

  // タイプ音
  let lastLen = 0;
  $('q-input').addEventListener('focus', (e) => { lastLen = e.target.value.length; });
  $('q-input').addEventListener('input', (e) => {
    const len = e.target.value.length;
    keyClick(len < lastLen);
    lastLen = len;
    autoSize();
  });

  // ヒント: 入力のうち合っている部分の「次の1文字」を教える（何も打っていなければ頭文字）
  // ここまで全部合っていれば、その1文字を空欄に足す。途中から違うときは入力には触らず、文字を教えるだけ
  $('btn-hint').addEventListener('click', () => {
    if (!cur || cur.answered) return;
    const a = cur.w.answer;
    const inp = $('q-input');
    const typed = inp.value;
    let p = 0;
    while (p < typed.length && p < a.length && typed[p].toLowerCase() === a[p].toLowerCase()) p++;
    if (p >= a.length - 1) { inp.focus(); return; } // 残り1文字以下なら教えない
    cur.hintLevel = Math.min(3, cur.hintLevel + 1);
    cur.hints = (cur.hints || 0) + 1;
    const n = a.replace(/[^A-Za-z]/g, '').length;
    const allRight = p === typed.length;
    if (allRight) {
      inp.value = a.slice(0, p + 1);
      lastLen = inp.value.length;
      autoSize();
      keyClick(false);
      $('q-hint').innerHTML = '※ 次の文字は <code>' + esc(a.charAt(p)) + '</code>（全部で' + n + '文字）';
    } else {
      const head = p === 0 ? '頭文字' : '<code>' + esc(a.slice(0, p)) + '</code> の次';
      $('q-hint').innerHTML = '※ ' + head + 'は <code>' + esc(a.charAt(p)) + '</code>（全部で' + n + '文字）';
    }
    $('hint-left').textContent = cur.hints;
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  });
  $('btn-submit').addEventListener('click', () => $('q-form').requestSubmit());
  $('btn-q-settings').addEventListener('click', () => { stopSpeak(); cur = null; settingsFrom = 'quiz'; show('settings'); });
  let settingsFrom = 'home';
  $('btn-settings-back').addEventListener('click', () => {
    if (settingsFrom === 'quiz') { settingsFrom = 'home'; startQuiz(); } else show('home');
  });
  document.querySelector('[data-go=settings]').addEventListener('click', () => { settingsFrom = 'home'; });

  // スマホでキーボードが出たとき：出題画面を「見えている範囲」にぴったり合わせる
  // （iPhone の Safari はキーボードで画面全体をずらすので、その位置と高さを追いかける）
  const root = document.documentElement;
  let fullH = window.innerHeight;
  function fitViewport() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;
    fullH = Math.max(fullH, window.innerHeight, h);
    root.style.setProperty('--vvh', h + 'px');
    root.style.setProperty('--vvt', top + 'px');
    const kb = fullH - h > 150; // 150px 以上縮んだらキーボードが出ている
    root.classList.toggle('kb-open', kb);
    if (!$('view-quiz').classList.contains('hidden')) {
      // 出題中は後ろのページがずれないように固定
      if (window.scrollY !== 0 && !vv) window.scrollTo(0, 0);
      keepInputVisible();
    }
  }
  function keepInputVisible() {
    const sc = $('quiz-scroll');
    const target = !$('q-result').classList.contains('hidden') ? $('q-result') : $('q-input');
    const r = target.getBoundingClientRect(), s = sc.getBoundingClientRect();
    if (r.bottom > s.bottom - 8) sc.scrollTop += r.bottom - s.bottom + 12;
    else if (r.top < s.top + 8) sc.scrollTop -= s.top - r.top + 12;
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
  }
  window.addEventListener('resize', fitViewport);
  window.addEventListener('orientationchange', () => { fullH = 0; setTimeout(fitViewport, 300); });
  fitViewport();
  // 出題中に後ろのページがスクロールしてしまうのを防ぐ（iPhone 対策）
  document.addEventListener('touchmove', (e) => {
    if ($('view-quiz').classList.contains('hidden')) return;
    if (!e.target.closest('#quiz-scroll')) e.preventDefault();
  }, { passive: false });

  $('btn-giveup').addEventListener('click', () => {
    if (!cur || cur.answered) return;
    sfx.giveup();
    complete(true);
  });

  function complete(gaveUp) {
    cur.answered = true;
    cur.gaveUp = gaveUp;
    const ms = Date.now() - cur.start;
    const grade = SRS.gradeOf({ gaveUp, misses: cur.misses, hintLevel: cur.hintLevel, ms });
    const w = cur.w;
    const t = today();
    let nextText;
    let curveHtml = '';

    if (!cur.q.retry) {
      const before = cards[w.no];
      const oldS = before ? SRS.stabilityOf(before) : 0;
      cards[w.no] = SRS.schedule(before || SRS.newCard(), grade, t, w.no + t.length + (before ? before.seen : 0));
      save(K.cards, cards);
      log[t] = (log[t] || 0) + 1;
      save(K.log, log);
      if (grade === 1) session.queue.push({ no: w.no, kind: cur.q.kind, retry: true });
      const c = cards[w.no];
      const iv = c.interval;
      nextText = (grade === 1 ? 'このあともう一度出ます。' : '') + '次の復習は' + (iv === 1 ? '明日' : iv + '日後');
      curveHtml = curveSvg(oldS, before && before.last ? SRS.diffDays(before.last, t) : 0, c.lastRecall, c.stability, iv);
    } else {
      nextText = gaveUp ? '明日また出ます' : '次の復習は明日';
    }
    $('r-curve').innerHTML = curveHtml;
    session.results.push({ no: w.no, grade, retry: !!cur.q.retry });
    session.pos++;
    save(K.session, session);

    const inp = $('q-input');
    inp.value = w.answer;
    inp.readOnly = true;
    inp.classList.add(gaveUp ? 'ng' : 'ok');
    autoSize();
    setFeedback(gaveUp ? '' : '正解！', gaveUp ? '' : 'ok');
    $('q-toolbar').classList.add('hidden');
    $('r-grade').textContent = cur.q.retry ? '練習' : SRS.GRADE_LABEL[grade];
    $('r-grade').className = 'grade g' + (cur.q.retry ? 'r' : grade);
    $('r-word').innerHTML = '<b>' + esc(w.word) + '</b>　' + esc(w.meaning);
    $('r-next').textContent = nextText;
    $('q-result').classList.remove('hidden');
    requestAnimationFrame(keepInputVisible);
    $('q-bar').style.width = (100 * session.pos) / session.queue.length + '%';
    $('q-len').textContent = session.queue.length;
    $('q-pos').textContent = session.pos;
    inp.focus();
    if (settings.autoSpeak) speak(w.before + w.answer + w.after);
  }

  // 忘却曲線の図：前回からの忘れ方（灰色）→ 今回の学習で100%に戻る → 次の復習まで（青）
  function curveSvg(oldS, elapsed, recall, newS, iv) {
    const W = 300, H = 92, L = 30, Rm = 8, T = 8, B = 20;
    const x0 = -Math.max(elapsed, 0), x1 = iv * 1.25;
    const xs = (d) => L + ((d - x0) / (x1 - x0)) * (W - L - Rm);
    const ymin = 0.5;
    const ys = (r) => T + ((1 - r) / (1 - ymin)) * (H - T - B);
    const path = (S, from, to, shift) => {
      let p = '';
      for (let i = 0; i <= 40; i++) {
        const d = from + ((to - from) * i) / 40;
        const r = Math.max(ymin, SRS.curve(S, d - shift));
        p += (i ? 'L' : 'M') + xs(d).toFixed(1) + ' ' + ys(r).toFixed(1);
      }
      return p;
    };
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="curve">';
    [1, 0.9, 0.75, 0.5].forEach((r) => {
      svg += '<line x1="' + L + '" x2="' + (W - Rm) + '" y1="' + ys(r) + '" y2="' + ys(r) + '" class="' + (r === 0.9 ? 'g90' : 'grid') + '"/>' +
        '<text x="' + (L - 4) + '" y="' + (ys(r) + 3) + '" class="ax" text-anchor="end">' + Math.round(r * 100) + '%</text>';
    });
    if (elapsed > 0 && oldS > 0) svg += '<path d="' + path(oldS, x0, 0, x0) + '" class="old"/>';
    if (elapsed > 0) svg += '<line x1="' + xs(0) + '" x2="' + xs(0) + '" y1="' + ys(Math.max(ymin, recall || ymin)) + '" y2="' + ys(1) + '" class="jump"/>';
    svg += '<path d="' + path(newS, 0, x1, 0) + '" class="new"/>';
    svg += '<circle cx="' + xs(0) + '" cy="' + ys(1) + '" r="3.5" class="now"/>';
    svg += '<circle cx="' + xs(iv) + '" cy="' + ys(SRS.curve(newS, iv)) + '" r="4.5" class="due"/>';
    svg += '<text x="' + xs(0) + '" y="' + (H - 5) + '" class="ax" text-anchor="middle">今日</text>';
    svg += '<text x="' + Math.min(xs(iv), W - 20) + '" y="' + (H - 5) + '" class="ax due-t" text-anchor="middle">' + iv + '日後</text>';
    if (elapsed > 0) svg += '<text x="' + xs(x0) + '" y="' + (H - 5) + '" class="ax" text-anchor="start">前回</text>';
    svg += '</svg>';
    let note;
    if (!(elapsed > 0) || recall == null) {
      note = '覚えたばかりの単語はすぐ忘れやすいので、記憶が90%まで下がる' + (iv === 1 ? '明日' : iv + '日後') + 'に復習します。';
    } else {
      note = '前回から' + elapsed + '日で、記憶は約' + Math.round(recall * 100) + '%まで下がっていました。' +
        '今回で記憶の強さが ' + fmtS(oldS) + '日 → ' + fmtS(newS) + '日 になり、90%まで下がる' + iv + '日後にまた出します。';
    }
    return svg + '<div class="curve-note">' + note + '</div>';
  }
  function fmtS(s) { return s >= 10 ? Math.round(s) : (Math.round(s * 10) / 10); }

  function goNext() {
    stopSpeak();
    nextQuestion();
  }
  $('btn-next').addEventListener('click', goNext);
  $('btn-speak').addEventListener('click', () => { if (cur) speak(cur.w.before + cur.w.answer + cur.w.after); });
  $('btn-quit').addEventListener('click', () => { stopSpeak(); cur = null; show('home'); });

  function finish() {
    cur = null;
    const first = session.results.filter((r) => !r.retry);
    const cnt = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    first.forEach((r) => cnt[r.grade]++);
    $('f-summary').innerHTML =
      '<div class="f-total">' + first.length + '問 解きました</div>' +
      [5, 4, 3, 2, 1].map((g) => '<div class="f-row"><span class="grade g' + g + '">' + SRS.GRADE_LABEL[g] + '</span><b>' + cnt[g] + '</b></div>').join('');
    show('finish');
  }

  // ---------- 効果音（音声ファイルを使わず、その場で合成） ----------
  let actx = null;
  function ac() {
    if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; actx = new C(); }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  // スマホのキーボードのような「カチッ」という短く乾いたクリック音
  let clickBuf = null;
  function keyClick(isDelete) {
    if (!settings.sound) return;
    const a = ac(); if (!a) return;
    if (!clickBuf) {
      // 約6ミリ秒：最初の1ミリ秒で鋭く立ち上がり、すぐ消える
      const n = Math.floor(a.sampleRate * 0.006);
      clickBuf = a.createBuffer(1, n, a.sampleRate);
      const d = clickBuf.getChannelData(0);
      for (let i = 0; i < n; i++) {
        const env = Math.exp(-i / (n * 0.12));
        d[i] = (Math.random() * 2 - 1) * env;
      }
    }
    const t = a.currentTime;
    const src = a.createBufferSource(); src.buffer = clickBuf;
    src.playbackRate.value = isDelete ? 0.8 : 1 + (Math.random() - 0.5) * 0.08;
    const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000;
    const pk = a.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = isDelete ? 3500 : 5000; pk.Q.value = 2; pk.gain.value = 8;
    const g = a.createGain(); g.gain.value = 0.9;
    src.connect(hp).connect(pk).connect(g).connect(a.destination);
    src.start(t);
    // 「チッ」という芯（ごく短い高音）
    const o = a.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(isDelete ? 1500 : 2200, t);
    const og = a.createGain(); og.gain.setValueAtTime(0.12, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    o.connect(og).connect(a.destination); o.start(t); o.stop(t + 0.015);
  }
  function tone(freqs, dur, type, vol) {
    if (!settings.sound) return;
    const a = ac(); if (!a) return;
    let t = a.currentTime;
    freqs.forEach((f) => {
      const o = a.createOscillator(); o.type = type; o.frequency.value = f;
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
      t += dur * 0.6;
    });
  }
  const sfx = {
    ok: () => tone([880, 1320], 0.16, 'triangle', 0.25),
    wrong: () => tone([180, 150], 0.14, 'square', 0.08),
    near: () => tone([660], 0.12, 'triangle', 0.18),
    giveup: () => tone([440, 330], 0.15, 'sine', 0.18),
  };

  // ---------- 読み上げ ----------
  // 声の質で順位づけ（数字が大きいほど自然な発音）
  // Edge: "Microsoft Aria Online (Natural)" など / Chrome: "Google US English" / iPhone・Mac: Samantha, Ava (Enhanced/Premium)
  function voiceScore(v) {
    const n = v.name;
    let s = 0;
    if (/natural|neural/i.test(n)) s += 100;
    if (/online/i.test(n)) s += 20;
    if (/premium/i.test(n)) s += 90;
    if (/enhanced/i.test(n)) s += 70;
    if (/^Google/i.test(n)) s += 60;
    if (/Samantha|Ava|Allison|Susan|Zoe|Evan|Nathan|Tom|Alex/i.test(n)) s += 40;
    if (/en[-_]US/i.test(v.lang)) s += 10; else if (/en[-_]GB/i.test(v.lang)) s += 5;
    if (/Zira|David|Mark|Hazel|George/i.test(n) && !/natural/i.test(n)) s -= 20; // Windows の古い機械音声
    if (/compact|eloquence|bad news|bells|bubbles|cellos|jester|organ|trinoids|whisper|zarvox|albert|boing|wobble|superstar|good news|bahh|junior|ralph|fred|kathy|grandma|grandpa|rocko|shelley|flo|reed|sandy/i.test(n)) s -= 200; // 効果音系の声
    return s;
  }
  let voices = [];
  let voicesReady = null;
  function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    voices = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang) && voiceScore(v) > -100);
    voices.sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
    if (!$('view-settings').classList.contains('hidden')) renderVoiceOptions();
  }
  function waitVoices() {
    // 声の一覧は遅れて届くことがある。届く前に読むと日本語の声で読まれて片言になるので待つ
    if (voices.length) return Promise.resolve();
    if (!voicesReady) {
      voicesReady = new Promise((resolve) => {
        let tries = 0;
        const t = setInterval(() => { loadVoices(); if (voices.length || ++tries > 30) { clearInterval(t); resolve(); } }, 100);
      });
    }
    return voicesReady;
  }
  function bestVoice() {
    return voices.find((x) => x.name === settings.voice) || voices[0] || null;
  }
  if ('speechSynthesis' in window) {
    loadVoices();
    speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', loadVoices);
  }
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    waitVoices().then(() => {
      const v = bestVoice();
      // 英語の声がないまま読ませると、ブラウザは日本語の声で英文を読んでしまう（カタカナ英語になる）。
      // その場合は読まずに知らせる。
      if (!v) { toast('このブラウザには英語の声がないため読み上げできません。Chrome か Edge で開いてください。'); return; }
      const u = new SpeechSynthesisUtterance(text);
      u.voice = v;
      u.lang = v.lang;
      u.rate = settings.rate;
      speechSynthesis.speak(u);
    });
  }
  let toastTimer = null;
  function toast(msg) {
    let t = $('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
  }
  function stopSpeak() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }

  // ---------- 記録 ----------
  function renderStats() {
    const vals = Object.values(cards);
    const t = today();
    const items = [
      ['学習した単語', vals.length + ' / ' + WORDS.length],
      ['習得（記憶の強さ21日以上）', vals.filter(SRS.isLearned).length],
      ['今の記憶率（予測・平均）', vals.length ? Math.round(100 * vals.reduce((s, c) => s + (SRS.retention(c, t) || 0), 0) / vals.length) + '%' : '-'],
      ['今日の期限', vals.filter((c) => c.due && c.due <= t).length],
      ['連続学習', streak() + '日'],
      ['今日解いた数', log[t] || 0],
      ['累計解答数', Object.values(log).reduce((a, b) => a + b, 0)],
    ];
    $('s-grid').innerHTML = items.map(([k, v]) => '<div><small>' + k + '</small><b>' + v + '</b></div>').join('');

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = SRS.addDays(t, i);
      const n = vals.filter((c) => c.due && (i === 0 ? c.due <= d : c.due === d)).length;
      days.push([i === 0 ? '今日' : i === 1 ? '明日' : d.slice(5).replace('-', '/'), n]);
    }
    const max = Math.max(1, ...days.map((d) => d[1]));
    $('s-forecast').innerHTML = days.map(([l, n]) =>
      '<div class="fc"><div class="fc-bar" style="height:' + (80 * n) / max + 'px"></div><b>' + n + '</b><small>' + l + '</small></div>').join('');

    const weak = WORDS.filter((w) => SRS.isWeak(cards[w.no])).sort((a, b) => cards[b.no].lapses - cards[a.no].lapses || cards[a.no].ease - cards[b.no].ease);
    $('s-weak').innerHTML = weak.length ? weak.map((w) =>
      '<li><b>' + esc(w.word) + '</b> <span>' + esc(w.meaning) + '</span><small>忘れた ' + cards[w.no].lapses + '回・記憶率 ' + Math.round(100 * (SRS.retention(cards[w.no], t) || 0)) + '%</small></li>').join('')
      : '<li class="note">まだありません</li>';
  }

  // ---------- 設定 ----------
  function renderSettings() {
    $('set-daily').value = settings.daily;
    $('set-order').value = settings.order;
    $('set-autospeak').checked = settings.autoSpeak;
    $('set-sound').checked = settings.sound;
    $('set-rate').value = settings.rate;
    $('rate-val').textContent = '×' + Number(settings.rate).toFixed(2);
    renderVoiceOptions();
  }
  function renderVoiceOptions() {
    const sel = $('set-voice');
    const top = voices[0];
    sel.innerHTML = '<option value="">自動（いちばん自然な声: ' + esc(top ? top.name : 'なし') + '）</option>' +
      voices.map((v) => '<option value="' + esc(v.name) + '">' + (voiceScore(v) >= 60 ? '★ ' : '') + esc(v.name) + ' (' + esc(v.lang) + ')</option>').join('');
    sel.value = settings.voice;
    const note = $('voice-note');
    if (!voices.length) note.textContent = 'このブラウザには英語の声がありません。';
    else if (voiceScore(top) < 60) note.textContent = '機械的な声しか見つかりませんでした。PCなら Microsoft Edge で開くと、自然な声（Natural）が無料で使えます。iPhoneは「設定 → アクセシビリティ → 読み上げコンテンツ → 声 → 英語」で高音質の声をダウンロードできます。';
    else note.textContent = '★ は自然に聞こえる声です。';
  }
  function saveSettings() { save(K.settings, settings); }
  $('set-daily').addEventListener('change', (e) => {
    const n = Math.max(1, Math.min(200, parseInt(e.target.value, 10) || DEFAULT_SETTINGS.daily));
    e.target.value = n;
    const old = settings.daily;
    settings.daily = n;
    saveSettings();
    // 今日まだ始めていなければ、今日の分も作り直す
    if (session && session.date === today() && session.pos === 0 && n !== old) { session = null; save(K.session, null); }
  });
  $('set-order').addEventListener('change', (e) => {
    settings.order = e.target.value; saveSettings();
    if (session && session.date === today() && session.pos === 0) { session = null; save(K.session, null); }
  });
  $('set-autospeak').addEventListener('change', (e) => { settings.autoSpeak = e.target.checked; saveSettings(); });
  $('set-sound').addEventListener('change', (e) => { settings.sound = e.target.checked; saveSettings(); if (settings.sound) sfx.ok(); });
  $('set-rate').addEventListener('input', (e) => { settings.rate = Number(e.target.value); $('rate-val').textContent = '×' + settings.rate.toFixed(2); saveSettings(); });
  $('set-voice').addEventListener('change', (e) => { settings.voice = e.target.value; saveSettings(); });
  $('btn-test-voice').addEventListener('click', () => speak('This is how the example sentences will sound.'));

  $('btn-export').addEventListener('click', () => {
    const data = { app: 'jun1-drill', version: 1, exported: new Date().toISOString(), cards, settings, log, session };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'jun1-drill-backup-' + today() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('file-import').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (d.app !== 'jun1-drill' || typeof d.cards !== 'object') throw new Error('形式がちがいます');
        if (!confirm('今の学習記録を、このファイルの内容で置き換えます。よろしいですか？')) return;
        cards = d.cards; settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {}); log = d.log || {}; session = d.session || null;
        save(K.cards, cards); save(K.settings, settings); save(K.log, log); save(K.session, session);
        alert('読み込みました');
        show('home');
      } catch (err) { alert('読み込めませんでした: ' + err.message); }
    };
    r.readAsText(f);
    e.target.value = '';
  });
  $('btn-reset').addEventListener('click', () => {
    if (!confirm('学習記録をすべて消します。元に戻せません。よろしいですか？')) return;
    cards = {}; log = {}; session = null;
    save(K.cards, cards); save(K.log, log); save(K.session, null);
    show('home');
  });

  // ---------- ホーム画面に追加の案内（iPhone の Safari で開いているときだけ） ----------
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !standalone && !localStorage.getItem('jun1.a2hsClosed')) $('a2hs').classList.remove('hidden');
  $('a2hs-close').addEventListener('click', () => { $('a2hs').classList.add('hidden'); localStorage.setItem('jun1.a2hsClosed', '1'); });

  // ---------- 毎日の通知 ----------
  // 通知が届いたとき、Service Worker が「今日の問題数」を計算できるように、要約を IndexedDB に置いておく
  function idbPut(key, value) {
    return new Promise((resolve) => {
      if (!('indexedDB' in window)) return resolve();
      const req = indexedDB.open('jun1', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        const tx = req.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => resolve();
      };
      req.onerror = () => resolve();
    });
  }
  let summaryTimer = null;
  function scheduleSummary() {
    clearTimeout(summaryTimer);
    summaryTimer = setTimeout(writeSummary, 300);
  }
  function writeSummary() {
    const vals = Object.values(cards);
    const s = session || {};
    idbPut('summary', {
      daily: settings.daily,
      dues: vals.map((c) => c.due).filter(Boolean),
      unseen: WORDS.length - vals.length,
      session: s.date ? { date: s.date, total: (s.queue || []).length, pos: s.pos || 0 } : null,
      updated: Date.now(),
    });
  }

  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  function b64urlToBytes(s) {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  async function renderPush() {
    const st = $('push-status');
    const show = (id, on) => $(id).classList.toggle('hidden', !on);
    show('btn-push-on', false); show('push-code-wrap', false); show('btn-push-test', false);
    if (!pushSupported || !window.isSecureContext) {
      st.textContent = isIOS && !standalone
        ? 'iPhone では、ホーム画面に追加したアイコンから開いたときだけ通知を設定できます（iOS 16.4 以降）。'
        : 'このブラウザでは通知を使えません。';
      return;
    }
    if (Notification.permission === 'denied') {
      st.textContent = '通知が拒否されています。iPhone の「設定 → 通知 → 準一級単語」で通知をオンにしてください。';
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) {
      st.textContent = '毎日20時ごろに「今日の問題」が何問あるかをお知らせします。';
      show('btn-push-on', true);
      return;
    }
    st.textContent = '通知はオンです（毎日20時ごろ）。';
    $('push-code').value = JSON.stringify(sub.toJSON());
    show('push-code-wrap', !localStorage.getItem('jun1.pushSent'));
    show('btn-push-test', true);
  }
  $('btn-push-on').addEventListener('click', async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { renderPush(); return; }
      const reg = await navigator.serviceWorker.ready;
      await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(window.PUSH_CONFIG.vapidPublicKey) });
      writeSummary();
      renderPush();
    } catch (err) { alert('通知をオンにできませんでした: ' + err.message); }
  });
  $('btn-push-copy').addEventListener('click', async () => {
    const t = $('push-code');
    try { await navigator.clipboard.writeText(t.value); } catch (e) { t.select(); document.execCommand('copy'); }
    toast('コピーしました。Claude に貼り付けて送ってください。');
    localStorage.setItem('jun1.pushSent', '1');
  });
  $('btn-push-test').addEventListener('click', async () => {
    writeSummary();
    const reg = await navigator.serviceWorker.ready;
    if (reg.active) reg.active.postMessage({ type: 'test-notification' });
  });
  document.querySelector('[data-go=settings]').addEventListener('click', renderPush);
  $('btn-q-settings').addEventListener('click', renderPush);

  // ---------- オフライン対応 ----------
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  show('home');
  writeSummary();
})();
