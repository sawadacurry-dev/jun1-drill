// 忘却曲線にもとづく復習スケジュール
//
// 記憶は時間とともに指数関数的に薄れる（エビングハウスの忘却曲線）:
//     記憶率 R(t) = 0.9 ^ (t / S)
//   t = 前回の学習からの日数
//   S = 記憶の強さ（記憶率が 90% まで下がるのにかかる日数）
//
// 「記憶率が 90% まで下がった頃」＝ t = S 日後に復習を出す。
// 復習で思い出せるたびに S が伸び、忘れ方がゆるやかになる（曲線が平らになる）。
//   - 解き方が良いほど S は大きく伸びる
//   - 忘れかけた頃（記憶率が低いとき）に思い出せた場合ほど、大きく伸びる（間隔効果）
//   - 忘れた／あやしいときは S が縮み、すぐにまた出る
//
// 評価 grade: 5 完璧 / 4 良い / 3 ふつう / 2 あやしい / 1 忘れた
(function (root) {
  const DAY_START_HOUR = 4; // 朝4時で日付が変わる扱い（夜更かし対策）
  const FAST_MS = 10000;    // 「すばやく正解」の目安
  const TARGET = 0.9;       // この記憶率まで下がったら復習
  const WEAK_LAPSES = 3;
  const WEAK_EASE = 1.8;

  function todayStr(now) {
    const d = new Date(now || Date.now());
    d.setHours(d.getHours() - DAY_START_HOUR);
    return ymd(d);
  }
  function ymd(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return ymd(new Date(y, m - 1, d + n));
  }
  function diffDays(a, b) { // b - a
    const [y1, m1, d1] = a.split('-').map(Number);
    const [y2, m2, d2] = b.split('-').map(Number);
    return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
  }

  // 解き方から評価を決める
  // r = { gaveUp, misses, hintLevel(0-3), ms }
  function gradeOf(r) {
    if (r.gaveUp) return 1;
    if (r.hintLevel >= 2 || r.misses >= 2) return 2;
    if (r.hintLevel === 1 || r.misses === 1) return 3;
    return r.ms <= FAST_MS ? 5 : 4;
  }

  function newCard() {
    // ease = 覚えやすさ（その単語の S の伸びやすさ）
    return { stability: 0, interval: 0, ease: 2.5, due: null, last: null, lapses: 0, seen: 0, reps: 0, lastGrade: null };
  }
  function stabilityOf(c) {
    return c.stability || c.interval || 0; // 旧形式のデータにも対応
  }

  // 記憶率の予測（0〜1）。一度も学習していなければ null
  function retention(c, today) {
    if (!c || !c.last) return null;
    const S = stabilityOf(c) || 1;
    return Math.pow(TARGET, Math.max(0, diffDays(c.last, today)) / S);
  }
  // S 日の記憶の強さで、t 日後の記憶率
  function curve(S, t) { return Math.pow(TARGET, t / Math.max(S, 0.1)); }

  function fuzz(days, seed) {
    if (days < 7) return days;
    // ±5% のゆらぎ（同じ日に復習が固まるのを防ぐ）
    const x = Math.sin(seed * 9301 + 49297) * 10000;
    const r = (x - Math.floor(x)) * 0.1 - 0.05;
    return Math.max(1, Math.round(days * (1 + r)));
  }

  // カードを更新して返す（元のオブジェクトは変更しない）
  function schedule(card, grade, today, seed) {
    const c = Object.assign(newCard(), card);
    const isNew = !c.last;
    const S = stabilityOf(c);
    const R = isNew ? null : retention(c, today);
    let S2;

    if (isNew) {
      // 初めて：学習直後から急に忘れるので、どの評価でも翌日に1回目の復習
      S2 = 1;
      if (grade === 5) c.ease = 2.6;
      else if (grade <= 2) c.ease = 2.2;
      if (grade === 1) c.lapses += 1;
    } else if (grade === 1) {
      // 忘れた：記憶の強さを大きく下げる（ただし一度覚えた分の下地は少し残る）
      c.lapses += 1;
      c.ease = Math.max(1.3, c.ease - 0.2);
      S2 = Math.max(1, S * 0.2);
    } else if (grade === 2) {
      // あやしい：記憶の強さを下げて早めにもう一度
      c.ease = Math.max(1.3, c.ease - 0.15);
      S2 = Math.max(1, S * 0.6);
    } else {
      // 思い出せた：S を伸ばす
      if (grade === 5) c.ease = Math.min(3.0, c.ease + 0.1);
      if (grade === 3) c.ease = Math.max(1.3, c.ease - 0.05);
      if (c.lapses >= WEAK_LAPSES) c.ease = Math.min(c.ease, 2.0); // 苦手は伸びにくく
      const growth = grade === 5 ? c.ease : grade === 4 ? c.ease * 0.92 : 1 + (c.ease - 1) * 0.35;
      // 間隔効果：記憶率が低いときに思い出せたほど強化される（早すぎる復習は効果が小さい）
      const bonus = Math.min(1.75, Math.max(0.5, 1 + (TARGET - R) * 2.5));
      S2 = Math.max(S + 1, S * (1 + (growth - 1) * bonus));
    }

    S2 = Math.min(365, S2);
    c.stability = Math.round(S2 * 100) / 100;
    const interval = Math.min(365, fuzz(Math.max(1, Math.round(S2)), seed || 1));
    c.interval = interval;
    c.due = addDays(today, interval);
    c.last = today;
    c.lastGrade = grade;
    c.seen += 1;
    c.reps = grade >= 3 ? c.reps + 1 : 0;
    c.lastRecall = R; // 今回解いたときの記憶率の予測（表示用）
    return c;
  }

  function isWeak(c) {
    return !!c && c.seen > 0 && (c.lapses >= WEAK_LAPSES || c.ease <= WEAK_EASE);
  }
  // 「習得」= 記憶率が90%に下がるまで21日以上かかるようになった単語
  function isLearned(c) { return !!c && stabilityOf(c) >= 21; }

  const GRADE_LABEL = { 5: '完璧', 4: '良い', 3: 'ふつう', 2: 'あやしい', 1: '忘れた' };

  const api = { todayStr, addDays, diffDays, gradeOf, schedule, newCard, retention, curve, stabilityOf, isWeak, isLearned, GRADE_LABEL, FAST_MS, TARGET };
  if (typeof module !== 'undefined') module.exports = api; else root.SRS = api;
})(this);
