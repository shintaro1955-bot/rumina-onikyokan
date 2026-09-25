/* ============================================================
   初心者研修「営業解禁ゲート」

   仕様書のSupabase前提（Postgres/RLS/auth.users）は、このアプリの作りに
   読み替えている：テーブル→db.jsonのコレクション、RLS→サーバ側の権限チェック。
   採点はすべてここで行い、**出題APIは answer_index を返さない**。

   運用の決めごと（2026-09-25 オーナー承認）：
   ・営業解禁は**状態を出すだけ**。発到停止は運用ルールで行う（このアプリに
     アポ登録・訪問記録・顧客登録が無く、止める対象を持たないため）。
   ・承認は owner。上長ロールは後から足せるよう approve() は役割を引数で受ける。
   ・**verified_by が空の問題は出題しない**。確認が済むまで新人に届かない。
   ============================================================ */
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { getDb, save } from './store.mjs';

const SEED = join(new URL('..', import.meta.url).pathname, 'seed', 'training-seed.json');

/* ---- ステップの定義（仕様書 第2-1章） ---- */
export const STEPS = {
  1: { key: 'must30', title: '必修暗記テスト「鬼の30箇条」', count: 30, pass: 'perfect', cooldownMin: 30, dailyCap: 5 },
  2: { key: 'basic100', title: '基礎知識100問テスト', count: 100, pass: 90, cooldownMin: 0, dailyCap: 0, safetyAllCorrect: true, blockedByReview: true },
  3: { key: 'law', title: '特商法テスト', count: 30, pass: 'perfect', cooldownMin: 60 * 24, dailyCap: 0, expiresMonths: 6 },
  4: { key: 'oral', title: '鬼教官 最終口頭試問', count: 5, pass: 'ai' },
};
/* STEP2のカテゴリ配分（仕様書 第10-1章） */
export const BASIC_MIX = { A_basic: 20, B_battery: 15, C_equipment: 12, D_system: 18, E_economics: 10, F_compliance: 10, G_history: 15 };

function root() {
  const db = getDb();
  db.training ||= { questions: [], attempts: [], review: {}, cert: {}, audit: [], seededAt: null };
  const t = db.training;
  t.questions ||= []; t.attempts ||= []; t.review ||= {}; t.cert ||= {}; t.audit ||= [];
  return t;
}

/** 初回起動時に問題を投入する。既にある code は触らない（管理画面の編集を潰さない）。 */
export function seedQuestions() {
  const t = root();
  if (!existsSync(SEED)) return { seeded: 0, total: t.questions.length, note: 'seedファイルがありません' };
  let rows; try { rows = JSON.parse(readFileSync(SEED, 'utf8')); } catch (e) { return { seeded: 0, error: e.message }; }
  const have = new Set(t.questions.map(q => q.code));
  let n = 0;
  for (const r of rows) {
    if (have.has(r.code)) continue;
    t.questions.push({
      id: randomUUID(), code: r.code, testType: r.test_type, category: r.category,
      tags: r.tags || [], question: r.question, choices: r.choices, answerIndex: r.answer_index,
      explanation: r.explanation, talkExample: r.talk_example || '', difficulty: r.difficulty || 1,
      sourceNote: r.source_note || '', verifiedBy: null, verifiedAt: null,
      isActive: false,                 // 確認が入るまで出題しない
      updatedAt: new Date().toISOString(),
    });
    n++;
  }
  if (n) { t.seededAt = new Date().toISOString(); save(); }
  return { seeded: n, total: t.questions.length };
}

/* ---- 監査ログ（追記のみ。消す手段を用意しない） ---- */
export function audit(actor, targetUser, action, detail = {}) {
  const t = root();
  t.audit.push({ id: t.audit.length + 1, actor: actor || null, target: targetUser || null, action, detail, at: new Date().toISOString() });
  if (t.audit.length > 20000) t.audit.splice(0, t.audit.length - 20000);   // 上限だけ設ける
  save();
}
export function auditList({ limit = 200, user = '' } = {}) {
  const t = root();
  return t.audit.filter(r => !user || r.target === user || r.actor === user).slice(-limit).reverse();
}

/* ---- 認定 ---- */
export function cert(user) {
  const t = root();
  t.cert[user] ||= { status: 'locked', step1At: null, step2At: null, step3At: null, step3Expires: null, step4At: null, approvedBy: null, approvedAt: null, suspendedReason: null, updatedAt: new Date().toISOString() };
  const c = t.cert[user];
  // 期限切れは読むたびに反映（バッチに頼らない）
  if (c.step3Expires && c.status === 'cleared' && Date.parse(c.step3Expires) < Date.now()) {
    c.status = 'suspended'; c.suspendedReason = '特商法認定の有効期限切れ'; c.updatedAt = new Date().toISOString();
    save(); audit('system', user, 'suspend', { reason: '期限切れ' });
  }
  return c;
}
export function certPublic(user) {
  const c = cert(user);
  return { status: c.status, step1At: c.step1At, step2At: c.step2At, step3At: c.step3At, step3Expires: c.step3Expires, step4At: c.step4At, approvedAt: c.approvedAt, suspendedReason: c.suspendedReason };
}

/** いま受けられるステップ（順番にしか開かない） */
export function unlockedStep(user) {
  const c = cert(user);
  if (!c.step1At) return 1;
  if (!c.step2At) return 2;
  if (!c.step3At || (c.step3Expires && Date.parse(c.step3Expires) < Date.now())) return 3;
  if (!c.step4At) return 4;
  return 5;   // 上長承認待ち
}

/* ---- 出題 ---- */
const activeOf = (t, testType) => t.questions.filter(q => q.isActive && q.verifiedBy && q.testType === testType);
const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

/** 出題可能かと、足りない場合の内訳を返す（問題バンクが育つまでの見える化）。 */
export function availability(step) {
  const t = root(); const S = STEPS[step]; if (!S) return null;
  if (step === 2) {
    const per = {};
    for (const [cat, need] of Object.entries(BASIC_MIX)) per[cat] = { need, have: activeOf(t, 'basic100').filter(q => q.category === cat).length };
    const total = Object.values(per).reduce((n, x) => n + x.have, 0);
    return { step, need: S.count, have: total, ok: Object.values(per).every(x => x.have >= x.need), per };
  }
  const have = activeOf(t, S.key).length;
  return { step, need: S.count, have, ok: have >= S.count };
}

/** クールダウン・回数制限・復習キューのチェック。受けられない理由を返す。 */
export function canStart(user, step) {
  const S = STEPS[step]; if (!S) return { ok: false, why: 'ステップが不正です' };
  const u = unlockedStep(user);
  if (step > u) return { ok: false, why: `STEP${u}に合格するまで受けられません` };
  const t = root();
  const mine = t.attempts.filter(a => a.user === user && a.step === step);
  const last = mine[mine.length - 1];
  if (S.cooldownMin && last && !last.passed && last.finishedAt) {
    const until = Date.parse(last.finishedAt) + S.cooldownMin * 60000;
    if (Date.now() < until) return { ok: false, why: '再受験までお待ちください', retryAt: new Date(until).toISOString() };
  }
  if (S.dailyCap) {
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);   // JST
    const n = mine.filter(a => a.startedAt && new Date(Date.parse(a.startedAt) + 9 * 3600 * 1000).toISOString().slice(0, 10) === today).length;
    if (n >= S.dailyCap) return { ok: false, why: `本日の受験回数の上限（${S.dailyCap}回）に達しました` };
  }
  if (S.blockedByReview) {
    const left = reviewQueue(user).length;
    if (left) return { ok: false, why: `復習キューが残っています（${left}問）。2回連続正解で卒業です`, reviewLeft: left };
  }
  const av = availability(step);
  if (!av.ok) return { ok: false, why: `確認済みの問題が足りません（${av.have}/${av.need}問）`, availability: av };
  return { ok: true };
}

/** 受験開始。問題を選んで attempt を作り、**正解を含まない**問題文を返す。 */
export function start(user, step) {
  const gate = canStart(user, step);
  if (!gate.ok) return { ok: false, ...gate };
  const t = root(); const S = STEPS[step];
  let picked = [];
  if (step === 2) {
    for (const [cat, need] of Object.entries(BASIC_MIX)) {
      picked.push(...shuffle(activeOf(t, 'basic100').filter(q => q.category === cat)).slice(0, need));
    }
    picked = shuffle(picked);
  } else {
    picked = shuffle(activeOf(t, S.key)).slice(0, S.count);
  }
  const attempt = {
    id: randomUUID(), user, step, startedAt: new Date().toISOString(), finishedAt: null,
    score: null, total: picked.length, passed: null, questionIds: picked.map(q => q.id), answers: [], aborted: false,
  };
  t.attempts.push(attempt); save();
  audit(user, user, 'start', { step, total: picked.length });
  return { ok: true, attemptId: attempt.id, step, total: picked.length, questions: picked.map(publicQuestion) };
}

/** 新人に返す形。正解・解説は含めない。選択肢は毎回シャッフルし、並びを控えておく。 */
function publicQuestion(q) {
  // 採点は選んだ文字列で行うので、並び順を送り返す必要はない（順番からの推測も防ぐ）
  return { id: q.id, code: q.code, category: q.category, question: q.question, choices: shuffle(q.choices) };
}

/**
 * 採点。answers = [{questionId, choiceText, ms}]（表示順が毎回違うので**選んだ文字列**で受ける）
 * 時間切れ・無回答は choiceText を空で送れば不正解として扱う。
 */
export function grade(user, attemptId, answers = []) {
  const t = root();
  const a = t.attempts.find(x => x.id === attemptId && x.user === user);
  if (!a) return { ok: false, why: '受験が見つかりません' };
  if (a.finishedAt) return { ok: false, why: 'この受験はすでに終了しています' };
  const S = STEPS[a.step];
  const byId = new Map(t.questions.map(q => [q.id, q]));
  const sent = new Map(answers.map(x => [x.questionId, x]));

  const detail = [];
  let correct = 0, safetyMiss = 0;
  for (const qid of a.questionIds) {
    const q = byId.get(qid); if (!q) continue;
    const got = sent.get(qid);
    const chosen = got ? String(got.choiceText ?? '') : '';
    const ok = chosen !== '' && chosen === q.choices[q.answerIndex];
    if (ok) correct++; else if ((q.tags || []).includes('safety_law')) safetyMiss++;
    if (!ok) pushReview(user, qid); else bumpReview(user, qid);
    detail.push({ questionId: qid, code: q.code, chosen, correct: ok, answer: q.choices[q.answerIndex], explanation: q.explanation, talkExample: q.talkExample, ms: got ? got.ms : null });
  }

  const total = a.questionIds.length;
  let passed;
  if (S.pass === 'perfect') passed = correct === total;
  else passed = (Math.round(correct / Math.max(1, total) * 100) >= S.pass) && (!S.safetyAllCorrect || safetyMiss === 0);

  a.finishedAt = new Date().toISOString(); a.score = correct; a.total = total; a.passed = passed;
  a.answers = detail.map(d => ({ questionId: d.questionId, correct: d.correct, ms: d.ms }));
  if (passed) markPassed(user, a.step);
  save();
  audit(user, user, passed ? 'pass' : 'fail', { step: a.step, score: correct, total, safetyMiss });

  return {
    ok: true, passed, score: correct, total, safetyMiss,
    rate: Math.round(correct / Math.max(1, total) * 100),
    byCategory: categoryRate(detail, byId),
    detail, cert: certPublic(user), reviewLeft: reviewQueue(user).length,
  };
}

function categoryRate(detail, byId) {
  const m = {};
  for (const d of detail) {
    const q = byId.get(d.questionId); if (!q) continue;
    m[q.category] ||= { correct: 0, total: 0 };
    m[q.category].total++; if (d.correct) m[q.category].correct++;
  }
  for (const k of Object.keys(m)) m[k].rate = Math.round(m[k].correct / Math.max(1, m[k].total) * 100);
  return m;
}

/** 中断（タブを閉じた等）。回数にはカウントし、不合格として閉じる。 */
export function abort(user, attemptId) {
  const t = root();
  const a = t.attempts.find(x => x.id === attemptId && x.user === user);
  if (!a || a.finishedAt) return { ok: false };
  a.finishedAt = new Date().toISOString(); a.aborted = true; a.passed = false; a.score = 0;
  save(); audit(user, user, 'abort', { step: a.step });
  return { ok: true };
}

function markPassed(user, step) {
  const c = cert(user); const now = new Date().toISOString();
  if (step === 1) c.step1At = now;
  if (step === 2) c.step2At = now;
  if (step === 3) {
    c.step3At = now;
    const d = new Date(); d.setMonth(d.getMonth() + STEPS[3].expiresMonths);
    c.step3Expires = d.toISOString();
  }
  if (step === 4) c.step4At = now;
  if (c.status === 'locked') c.status = 'in_training';
  if (c.step1At && c.step2At && c.step3At && c.step4At && c.status !== 'cleared') c.status = 'pending';
  if (c.status === 'suspended' && step === 3) c.status = c.approvedAt ? 'cleared' : 'pending';
  c.suspendedReason = c.status === 'suspended' ? c.suspendedReason : null;
  c.updatedAt = now; save();
}

/* ---- 復習キュー（2回連続正解で卒業） ---- */
function pushReview(user, qid) {
  const t = root(); t.review[user] ||= {};
  t.review[user][qid] = { consecutive: 0, addedAt: t.review[user][qid]?.addedAt || new Date().toISOString() };
}
function bumpReview(user, qid) {
  const t = root(); const r = t.review[user]?.[qid]; if (!r) return;
  r.consecutive = (r.consecutive || 0) + 1;
  if (r.consecutive >= 2) delete t.review[user][qid];
}
export function reviewQueue(user) {
  const t = root(); const m = t.review[user] || {};
  const byId = new Map(t.questions.map(q => [q.id, q]));
  return Object.entries(m).map(([qid, r]) => {
    const q = byId.get(qid); if (!q) return null;
    return { ...publicQuestion(q), consecutive: r.consecutive || 0 };
  }).filter(Boolean);
}
/** 復習の1問に答える。2回連続正解で卒業。 */
export function answerReview(user, questionId, choiceText) {
  const t = root(); const q = t.questions.find(x => x.id === questionId);
  if (!q) return { ok: false };
  const ok = String(choiceText ?? '') === q.choices[q.answerIndex];
  if (ok) bumpReview(user, questionId); else { const r = t.review[user]?.[questionId]; if (r) r.consecutive = 0; }
  save();
  return { ok: true, correct: ok, answer: q.choices[q.answerIndex], explanation: q.explanation, talkExample: q.talkExample, left: reviewQueue(user).length };
}

/* ---- 管理 ---- */
export function approve(actor, user, comment = '') {
  const c = cert(user);
  if (c.status !== 'pending') return { ok: false, why: 'STEP4まで合格していません' };
  c.status = 'cleared'; c.approvedBy = actor; c.approvedAt = new Date().toISOString(); c.updatedAt = c.approvedAt;
  save(); audit(actor, user, 'approve', { comment });
  return { ok: true, cert: certPublic(user) };
}
export function suspend(actor, user, reason) {
  if (!reason) return { ok: false, why: '理由が必要です' };
  const c = cert(user);
  c.status = 'suspended'; c.suspendedReason = reason; c.updatedAt = new Date().toISOString();
  save(); audit(actor, user, 'suspend', { reason });
  return { ok: true, cert: certPublic(user) };
}
/** 法改正アラート：全員の特商法認定を失効させる。 */
export function expireAllLaw(actor, reason) {
  const t = root(); let n = 0;
  for (const [user, c] of Object.entries(t.cert)) {
    if (!c.step3At) continue;
    c.step3At = null; c.step3Expires = null;
    if (c.status === 'cleared' || c.status === 'pending') { c.status = 'suspended'; c.suspendedReason = reason || '法改正による再受験'; }
    c.updatedAt = new Date().toISOString(); n++;
  }
  save(); audit(actor, null, 'law_alert', { reason, affected: n });
  return { ok: true, affected: n };
}
/** 問題の確認（確認者名を入れて有効化）。名前が入るまで出題されない。 */
export function verifyQuestion(actor, code, verifiedBy, active = true) {
  const t = root(); const q = t.questions.find(x => x.code === code);
  if (!q) return { ok: false, why: '問題が見つかりません' };
  if (active && !verifiedBy) return { ok: false, why: '確認者名が必要です' };
  q.verifiedBy = verifiedBy || null; q.verifiedAt = verifiedBy ? new Date().toISOString() : null;
  q.isActive = !!(active && verifiedBy); q.updatedAt = new Date().toISOString();
  save(); audit(actor, null, 'question_verify', { code, verifiedBy, active: q.isActive });
  return { ok: true, code: q.code, isActive: q.isActive };
}

/** 本人の研修ダッシュボード用。 */
export function overview(user) {
  const t = root();
  const mine = t.attempts.filter(a => a.user === user);
  const best = {};
  for (const s of [1, 2, 3, 4]) {
    const xs = mine.filter(a => a.step === s && !a.aborted);
    best[s] = { attempts: mine.filter(a => a.step === s).length, best: xs.length ? Math.max(...xs.map(a => a.score || 0)) : null, total: STEPS[s].count, title: STEPS[s].title };
  }
  return {
    cert: certPublic(user), unlocked: unlockedStep(user), best,
    reviewLeft: reviewQueue(user).length,
    availability: [1, 2, 3].map(s => availability(s)),
    gates: [1, 2, 3, 4].reduce((m, s) => (m[s] = canStart(user, s), m), {}),
  };
}

/** 管理一覧（owner）。 */
export function roster() {
  const t = root();
  const users = Object.keys(getDb().users || {});
  return users.map(u => {
    const c = cert(u);
    const mine = t.attempts.filter(a => a.user === u);
    return { user: u, name: (getDb().users[u] || {}).name || u, status: c.status, step1At: c.step1At, step2At: c.step2At, step3At: c.step3At, step3Expires: c.step3Expires, step4At: c.step4At, approvedAt: c.approvedAt, attempts: mine.length, reviewLeft: reviewQueue(u).length };
  });
}

/** 問題バンクの状態（owner）。正解は返さない。 */
export function questionStats() {
  const t = root();
  const by = {};
  for (const q of t.questions) {
    by[q.testType] ||= { total: 0, active: 0, unverified: 0, byCategory: {} };
    by[q.testType].total++;
    if (q.isActive) by[q.testType].active++; else by[q.testType].unverified++;
    by[q.testType].byCategory[q.category] ||= { total: 0, active: 0 };
    by[q.testType].byCategory[q.category].total++;
    if (q.isActive) by[q.testType].byCategory[q.category].active++;
  }
  return { total: t.questions.length, by, seededAt: t.seededAt };
}
export function listQuestions({ testType = '', onlyUnverified = false, limit = 500 } = {}) {
  const t = root();
  return t.questions
    .filter(q => (!testType || q.testType === testType) && (!onlyUnverified || !q.isActive))
    .slice(0, limit)
    // owner専用。確認作業には正解が要るので answer を含める（受験側のAPIには出さない）
    .map(q => ({ code: q.code, testType: q.testType, category: q.category, tags: q.tags, question: q.question, choices: q.choices, answer: q.choices[q.answerIndex], explanation: q.explanation, talkExample: q.talkExample, sourceNote: q.sourceNote, verifiedBy: q.verifiedBy, isActive: q.isActive }));
}
