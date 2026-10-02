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
import * as oral from './oral.mjs';
import * as lessons from './lessons.mjs';
import { isExcludedPerson } from './cyzen.mjs';

const SEED = join(new URL('..', import.meta.url).pathname, 'seed', 'training-seed.json');

/* ---- ステップの定義（仕様書 第2-1章） ---- */
export const STEPS = {
  1: {
    key: 'must30', title: '必修暗記テスト「鬼の30箇条」', count: 30, pass: 'perfect', cooldownMin: 30, dailyCap: 5,
    purpose: '玄関先で法令に触れないための最低限を、考えなくても言える状態にする',
    contents: '第一声で伝える3つ／断られたときの引き際／クーリングオフ／太陽光と蓄電池の基礎／記録と報告の決めごと',
    studyMin: 20, examMin: 15,
    passRule: '30問すべて正解。1問でも落とすと合格になりません',
    retryRule: '不合格から30分あけて再受験。1日5回まで',
  },
  2: {
    key: 'basic100', title: '基礎知識100問テスト', count: 100, pass: 90, cooldownMin: 0, dailyCap: 0, safetyAllCorrect: true, blockedByReview: true,
    purpose: 'お客様の質問に、その場で事実で答えられるようにする',
    contents: '太陽光の基礎／蓄電池／機器と工事／制度と電気料金／経済性／法令順守／業界と制度の歴史',
    studyMin: 45, examMin: 40,
    passRule: '90点以上。あわせて、法令に関わる問題を1問も落とさないこと',
    retryRule: '間違えた問題が復習キューに入ります。2回連続で正解して卒業するまで受け直せません',
  },
  3: {
    key: 'law', title: '特商法テスト', count: 30, pass: 'perfect', cooldownMin: 60 * 24, dailyCap: 0, expiresMonths: 6,
    purpose: '訪問販売で、お客様と会社と自分を守る',
    contents: '特定商取引法／消費者契約法／景品表示法。行政処分と罰則まで',
    studyMin: 25, examMin: 15,
    passRule: '30問すべて正解',
    retryRule: '不合格から24時間あけて再受験',
    note: '合格から6ヶ月で失効します。法改正があったときも失効します',
  },
  4: {
    key: 'oral', title: '鬼教官 最終口頭試問', count: 5, pass: 8, cooldownMin: 60 * 24, dailyCap: 0,
    purpose: '覚えたことを、自分の口から言えるかを見る。選べることと言えることは別',
    contents: '玄関先の5場面。名乗りと目的／断られたときの引き際／クーリングオフ／試算の前提／不利になる事実',
    studyMin: 0, examMin: 20,
    passRule: '10点満点で8点以上。0点の問が1つでもあると不合格。言ってはいけない言い回しが1つでも出たら不合格',
    retryRule: '不合格から24時間あけて再受験',
    note: '選択肢はありません。話すか、打ち込むかで答えます',
  },
};
/* STEP2のカテゴリ配分（仕様書 第10-1章） */
export const STEP_KEYS = ['must30', 'basic100', 'law', 'oral'];
export const BASIC_MIX = { A_basic: 20, B_battery: 15, C_equipment: 12, D_system: 18, E_economics: 10, F_compliance: 10, G_history: 15 };

function root() {
  const db = getDb();
  db.training ||= { questions: [], attempts: [], review: {}, cert: {}, audit: [], asks: [], seededAt: null };
  const t = db.training;
  t.questions ||= []; t.attempts ||= []; t.review ||= {}; t.cert ||= {}; t.audit ||= []; t.asks ||= [];
  return t;
}

/** 初回起動時に問題を投入する。既にある code は触らない（管理画面の編集を潰さない）。 */
export function seedQuestions() {
  const t = root();
  if (!existsSync(SEED)) return { seeded: 0, total: t.questions.length, note: 'seedファイルがありません' };
  let rows; try { rows = JSON.parse(readFileSync(SEED, 'utf8')); } catch (e) { return { seeded: 0, error: e.message }; }
  const byCode = new Map(t.questions.map(q => [q.code, q]));
  let n = 0, updated = 0, opened = 0;
  for (const r of rows) {
    const body = {
      code: r.code, testType: r.test_type, category: r.category,
      tags: r.tags || [], question: r.question, choices: r.choices, answerIndex: r.answer_index,
      explanation: r.explanation, talkExample: r.talk_example || '', difficulty: r.difficulty || 1,
      sourceNote: r.source_note || '',
      // 社内の運用と合っているかは、法令や製品知識と違って外から確かめようがない。
      // どの問題がそれかを持たせ、確認画面で名指しできるようにする。
      needsOwnerCheck: r.needs_owner_check || null,
    };
    const cur = byCode.get(r.code);
    if (!cur) {
      // 出典つきで同梱したものは、最初から出題する。
      // 管理者が押すまで新人が何もできない状態にしない（2026-09-30 オーナー判断）。
      t.questions.push({ id: randomUUID(), ...body, verifiedBy: null, verifiedAt: null, isActive: true, updatedAt: new Date().toISOString() });
      n++;
      continue;
    }
    // 既にある問題：**人が確認済みのものは絶対に書き換えない**（承認を無かったことにしない）。
    // まだ確認待ちのものだけ、seedの直しを反映する。
    if (cur.verifiedBy) continue;
    let changed = false;
    // 以前の版で閉じてあったものを開ける。ただし管理者が明示的に止めたもの（suspended）は触らない。
    if (cur.isActive === false && !cur.suspended) { cur.isActive = true; opened++; }
    for (const [k, v] of Object.entries(body)) {
      if (JSON.stringify(cur[k]) !== JSON.stringify(v)) { cur[k] = v; changed = true; }
    }
    if (changed) { cur.updatedAt = new Date().toISOString(); updated++; }
  }
  if (n || updated || opened) { t.seededAt = new Date().toISOString(); save(); }
  return { seeded: n, updated, opened, total: t.questions.length };
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
/* STEP4（口頭試問）が使える状態か。
   問題が揃っていて、かつ採点につながることの両方が要る。
   どちらかが欠けている間は、STEP3までの合格をもって「面談で判断する」段へ進める。
   ここを塞いだままにすると、STEP1〜3を全部通した人が永久に営業解禁に到達できない。 */
export function oralReady() { try { return !!oral.ready().ok; } catch (e) { return false; } }
export function oralStatus() { try { return oral.ready(); } catch (e) { return { ok: false, questions: 0, ai: false }; } }

export function unlockedStep(user) {
  const c = cert(user);
  if (!c.step1At) return 1;
  if (!c.step2At) return 2;
  if (!c.step3At || (c.step3Expires && Date.parse(c.step3Expires) < Date.now())) return 3;
  if (!c.step4At) return oralReady() ? 4 : 5;   // 口頭試問が未整備なら面談へ回す
  return 5;   // 承認待ち
}

/* ---- 出題 ----
   出題されるのは isActive のものだけ。**確認者（verifiedBy）は見ない。**

   以前は「人が確認するまで1問も出さない」錠前にしていた。中身を誰も読んでいない
   状態で新人に出したくなかったため。ただ、その結果として管理者が押すまで新人が
   教材すら開けず、行き止まりになっていた。
   2026-09-30 オーナー判断で錠前を外す。確認は**誰が中身を見たかの記録**として残す
   （研修管理に「まだ確認していない問題」として出るので、抜けは追える）。

   新人を現場に出さない関門は、こちらではなく**段階開放（stageOf / STAGES）**が持つ。
   研修を通した人だけが現場の画面とデータに入れる、という線はそのまま。 */
const activeOf = (t, testType) => t.questions.filter(q => q.isActive && q.testType === testType);
const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

/** 出題可能かと、足りない場合の内訳を返す（問題バンクが育つまでの見える化）。 */
export function availability(step) {
  const t = root(); const S = STEPS[step]; if (!S) return null;
  if (step === 4) {
    // 口頭試問は選択式と問題の持ち方が違う（seed/oral.json）。採点につながるかも条件に入る。
    const r = oralStatus();
    return { step, need: oral.COUNT, have: r.questions, ok: !!r.ok, ai: r.ai };
  }
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
  if (S.cooldownMin && last && !last.passed && last.finishedAt && !last.notGraded) {
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

/* ---- STEP4：口頭試問 ----
   選択式と別の経路にする。問題の形（選択肢がない）も採点の仕方（辞書＋AI）も違うため、
   既存の start/grade に無理に相乗りさせない。記録の置き場（attempts）だけ共有する。 */

/** 口頭試問を始める。5局面から1問ずつ。 */
export function startOral(user) {
  const gate = canStart(user, 4);
  if (!gate.ok) return { ok: false, ...gate };
  if (!oralReady()) return { ok: false, why: '口頭試問はいま使えません。STEP3までの合格として面談で判断します' };
  const t = root();
  const picked = oral.draw();
  if (picked.length < oral.COUNT) return { ok: false, why: '問題が足りません' };
  const attempt = {
    id: randomUUID(), user, step: 4, kind: 'oral', startedAt: new Date().toISOString(), finishedAt: null,
    score: null, total: oral.COUNT * 2, passed: null, questionIds: [], codes: picked.map(q => q.code),
    answers: [], aborted: false,
  };
  t.attempts.push(attempt); save();
  audit(user, user, 'start', { step: 4, total: picked.length });
  return { ok: true, attemptId: attempt.id, step: 4, total: picked.length, pass: oral.PASS_SCORE, max: oral.COUNT * 2, questions: picked.map(oral.forExam) };
}

/** 口頭試問の採点。answers = [{ code, answer, via }]
    採点につながらなかったときは**落とさない**。受験を無かったことにして面談へ回す。 */
export async function gradeOral(user, attemptId, answers = []) {
  const t = root();
  const a = t.attempts.find(x => x.id === attemptId && x.user === user && x.step === 4);
  if (!a) return { ok: false, why: '受験が見つかりません' };
  if (a.finishedAt) return { ok: false, why: 'この受験はすでに終了しています' };

  const r = await oral.grade((answers || []).filter(x => (a.codes || []).includes(x.code)));
  if (!r.graded) {
    // 機械が動かないことを理由に人を不合格にしない。回数も消費させない。
    a.finishedAt = new Date().toISOString(); a.aborted = true; a.passed = null; a.notGraded = true;
    save(); audit(user, user, 'oral_not_graded', { why: r.why });
    return { ok: true, graded: false, why: r.why };
  }

  a.finishedAt = new Date().toISOString();
  a.score = r.total; a.total = r.max; a.passed = r.passed;
  // 本人の答えと採点理由を残す。面談なしで解禁になるので、あとから経緯を追えること。
  a.answers = r.items.map(i => ({ code: i.code, phase: i.phase, answer: i.answer, via: i.via, score: i.score,
    missing: i.missing, comment: i.comment, risks: i.risks.map(x => ({ id: x.id, level: x.level, label: x.label })) }));
  a.model = r.model;
  if (r.passed) markPassed(user, 4);
  save();
  audit(user, user, r.passed ? 'pass' : 'fail', { step: 4, score: r.total, total: r.max, highCount: r.highCount });
  return { ok: true, graded: true, ...r, cert: certPublic(user), unlocked: unlockedStep(user) };
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
  // STEP4が未整備のうちは、STEP3までの合格で「承認待ち（面談で判断）」にする。
  if (c.step1At && c.step2At && c.step3At && (c.step4At || !oralReady()) && c.status !== 'cleared') c.status = 'pending';
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
  if (c.status !== 'pending') return { ok: false, why: oralReady() ? 'STEP4まで合格していません' : 'STEP3まで合格していません' };
  // 口頭試問が未整備の間は、面談で判断したことを記録に残す（あとで経緯を追えるように）
  const viaInterview = !c.step4At && !oralReady();
  c.status = 'cleared'; c.approvedBy = actor; c.approvedAt = new Date().toISOString(); c.updatedAt = c.approvedAt;
  save(); audit(actor, user, 'approve', { comment, viaInterview });
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

/* ---- 社内の運用に依る記載の了承 ----
   18問に「当社の運用と合っているか」という確認事項を付けていた。
   2026-10-02 オーナー指示：**現状の記載のままで了承**。

   確認事項そのものは消さない。`ownerAccepted.was` に残す。
   運用が変わったとき、どの問題を直せばよいかを後から引けるようにするため。
   画面には「社内の運用の確認が要る」ではなく「現状のまま了承（日付）」と出る。 */
export function acceptOwnerChecks(actor, by = 'オーナー', note = '') {
  const t = root();
  const at = new Date().toISOString();
  const hit = [];
  for (const q of t.questions) {
    if (!q.needsOwnerCheck) continue;
    q.ownerAccepted = { at, by: String(by), was: String(q.needsOwnerCheck), note: String(note || '') };
    q.needsOwnerCheck = null;
    if (!q.verifiedBy) { q.verifiedBy = `${by}（現状の記載のまま了承）`; q.verifiedAt = at; }
    q.isActive = q.isActive !== false;
    q.updatedAt = at;
    hit.push(q.code);
  }
  if (hit.length) save();
  audit(actor, null, 'owner_accept_checks', { count: hit.length, codes: hit, by });
  return { ok: true, count: hit.length, codes: hit };
}

/** 了承した問題の一覧（あとから見返せるように）。 */
export function ownerAcceptedList() {
  return root().questions.filter(q => q.ownerAccepted)
    .map(q => ({ code: q.code, question: q.question, was: q.ownerAccepted.was, at: q.ownerAccepted.at, by: q.ownerAccepted.by }));
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
    cert: certPublic(user), unlocked: unlockedStep(user), best, oralReady: oralReady(),
    stage: stageOf(user), stages: STAGES, steps: STEPS,
    reviewLeft: reviewQueue(user).length,
    availability: [1, 2, 3].map(s => availability(s)),
    gates: [1, 2, 3, 4].reduce((m, s) => (m[s] = canStart(user, s), m), {}),
  };
}




/** まとめて確認済みにする（owner）。
    3つのタブを順に押す手間を省くだけで、意味は同じ。
    provisional=true は「まだ中身を読んでいないが、動かして見たい」ための仮確認。
    確認者名に（仮）を付けて記録し、あとから1回で取り消せる。
    **本確認と見分けがつかない記録を残さない**ため、名前を分けている。 */
export function verifyAll(actor, verifiedBy, provisional = false) {
  const name = String(verifiedBy || '').trim();
  if (!name) return { ok: false, why: '確認者名が必要です' };
  const t = root();
  const label = provisional ? `${name}（仮確認・中身は未読）` : name;
  let n = 0;
  for (const q of t.questions) {
    if (q.verifiedBy) continue;
    q.verifiedBy = label; q.verifiedAt = new Date().toISOString(); q.isActive = true; n++;
  }
  if (n) save();
  audit(actor, null, provisional ? 'verify_all_provisional' : 'verify_all', { verifiedBy: label, count: n });
  return { ok: true, count: n, provisional, verifiedBy: label };
}

/** 仮確認だけを取り消す。本確認には触らない。 */
export function unverifyProvisional(actor) {
  const t = root();
  let n = 0;
  for (const q of t.questions) {
    if (q.verifiedBy && /（仮確認/.test(q.verifiedBy)) { q.verifiedBy = null; q.verifiedAt = null; q.isActive = false; n++; }
  }
  if (n) save();
  audit(actor, null, 'unverify_provisional', { count: n });
  return { ok: true, count: n };
}

/** 管理画面から問題を作る・直す（owner）。
    種として配る seed とは別に、**現場で気づいたことをその場で問題にできる**ようにする。
    新しく作った問題も verifiedBy が入るまで出題されない（seedと同じ扱い）。
    既にある code を渡すと上書き。**人が確認済みの問題を書き換えたら、確認は外れる**
    （中身が変わったのに「確認済み」のままにはしない）。 */
export function upsertQuestion(actor, q = {}) {
  const t = root();
  const code = String(q.code || '').trim().toUpperCase();
  if (!code) return { ok: false, why: '問題コードが必要です' };
  const testType = String(q.testType || '').trim();
  if (!STEP_KEYS.includes(testType)) return { ok: false, why: '試験の種類が不正です' };
  const question = String(q.question || '').trim();
  if (!question) return { ok: false, why: '設問が必要です' };
  const choices = (Array.isArray(q.choices) ? q.choices : []).map(x => String(x == null ? '' : x).trim()).filter(Boolean);
  if (choices.length !== 4) return { ok: false, why: '選択肢は4つ必要です' };
  if (new Set(choices).size !== 4) return { ok: false, why: '選択肢が重複しています' };
  const answerIndex = Number(q.answerIndex);
  if (!(answerIndex >= 0 && answerIndex < 4)) return { ok: false, why: '正解の選択肢を選んでください' };
  const explanation = String(q.explanation || '').trim();
  if (!explanation) return { ok: false, why: '解説が必要です（なぜそれが正解かを残す）' };
  const category = String(q.category || '').trim() || (testType === 'basic100' ? 'A_basic' : testType === 'law' ? 'LAW' : 'MUST30');
  if (testType === 'basic100' && !Object.keys(BASIC_MIX).includes(category)) return { ok: false, why: '基礎知識のカテゴリが不正です' };

  const body = {
    code, testType, category, tags: Array.isArray(q.tags) ? q.tags : [],
    question, choices, answerIndex, explanation,
    talkExample: String(q.talkExample || '').trim(),
    sourceNote: String(q.sourceNote || '').trim(),
    needsOwnerCheck: q.needsOwnerCheck ? String(q.needsOwnerCheck) : null,
    ownerAccepted: q.ownerAccepted || null,
    difficulty: Number(q.difficulty) || 2,
  };
  const cur = t.questions.find(x => x.code === code);
  if (cur) {
    const wasVerified = !!cur.verifiedBy;
    Object.assign(cur, body, { updatedAt: new Date().toISOString() });
    // 中身を書き換えたら確認はやり直し。確認済みの表示だけ残すことはしない。
    if (wasVerified) { cur.verifiedBy = null; cur.verifiedAt = null; cur.isActive = false; }
    save(); audit(actor, null, 'question_update', { code, reVerify: wasVerified });
    return { ok: true, mode: 'update', code, reVerify: wasVerified };
  }
  t.questions.push({ id: randomUUID(), ...body, verifiedBy: null, verifiedAt: null, isActive: false, updatedAt: new Date().toISOString() });
  save(); audit(actor, null, 'question_create', { code });
  return { ok: true, mode: 'create', code };
}


/* ---- 必修教材（学習モード） ----
   テストだけ作って、学ぶ場所を用意していなかった。
   確認済みの問題は、設問・正解・解説・根拠が揃っている＝そのまま教材になる。
   **受験の前に読める**ようにする。研修の一番最初から開く。
   確認が済んでいない問題は教材にも出さない（出題と同じ線） */
export function study(step) {
  const S = STEPS[step]; if (!S) return { ok: false, why: 'ステップが不正です' };
  const t = root();
  const rows = activeOf(t, S.key);
  const av = availability(step);
  const cards = rows.map(q => ({
    code: q.code, category: q.category, tags: q.tags || [],
    question: q.question, answer: q.choices[q.answerIndex],
    explanation: q.explanation, talkExample: q.talkExample || '', sourceNote: q.sourceNote || '',
  }));
  // カテゴリごとにまとめる（100問を一列で読ませない）
  const groups = {};
  for (const c of cards) (groups[c.category] ||= []).push(c);
  return {
    ok: true, step, title: S.title, purpose: S.purpose, contents: S.contents,
    studyMin: S.studyMin, examMin: S.examMin, passRule: S.passRule, retryRule: S.retryRule, note: S.note || null,
    ready: av.ok, have: av.have, need: av.need,
    total: cards.length, groups,
    // 読み物（章）。一問一答だけでは学べないので、先にこちらを読ませる。
    lessons: lessons.indexOf(step),
  };
}

/* ---- 質問の受付 ----
   分からないまま止まる人を減らす。宛先を持たないアプリなので、
   ここでは**受け取って管理者に見せる**ところまでをやる。 */
export function ask(user, kind, body) {
  const t = root();
  t.asks ||= [];
  const text = String(body || '').trim();
  if (!text) return { ok: false, why: '内容を書いてください' };
  const row = { id: t.asks.length + 1, user, kind: String(kind || 'その他'), body: text.slice(0, 2000), at: new Date().toISOString(), answeredAt: null, answer: null };
  t.asks.push(row);
  if (t.asks.length > 2000) t.asks.splice(0, t.asks.length - 2000);
  save(); audit(user, user, 'ask', { kind: row.kind });
  return { ok: true, id: row.id };
}
export function myAsks(user) { return (root().asks || []).filter(a => a.user === user).slice().reverse(); }
export function askList({ limit = 100 } = {}) { return (root().asks || []).slice(-limit).reverse(); }
export function answerAsk(actor, id, answer) {
  const t = root(); const a = (t.asks || []).find(x => x.id === Number(id));
  if (!a) return { ok: false, why: '見つかりません' };
  a.answer = String(answer || '').trim(); a.answeredAt = new Date().toISOString();
  save(); audit(actor, a.user, 'ask_answer', { id: a.id });
  return { ok: true };
}

/* ---- 研修の段に応じて、アプリのどこまで開けるか ----
   このアプリは「現役営業の日次コーチ」と「新人の営業解禁ゲート」の2つを抱えている。
   新人にToday（cyzenの行動量）やLeague（順位）を見せても中身が無く、
   何をすればいいのか分からない画面が並ぶだけになる。
   **通した段の分だけ開く**ことにして、次に何が開くかを本人に見せる。 */
export const STAGES = {
  start:     { label: '研修前',   views: ['training'],                        next: 'STEP1に合格すると ロープレ道場 が開きます' },
  practice:  { label: '研修中',   views: ['training', 'roleplay'],            next: 'STEP3に合格すると Academy（教材）が開きます' },
  pending:   { label: '承認待ち', views: ['training', 'roleplay', 'academy'], next: '承認されると、現場の画面がすべて開きます' },
  field:     { label: '営業解禁', views: null,                                next: null },   // null＝制限なし
  suspended: { label: '停止中',   views: ['training'],                        next: '再認定するまで現場に出ないこと' },
};

/** その人がいまどの段にいるか。 */
export function stageOf(user) {
  const c = cert(user);
  if (c.status === 'cleared') return 'field';
  if (c.status === 'suspended') return 'suspended';
  const u = unlockedStep(user);
  if (u >= 4) return 'pending';     // STEP3まで合格
  if (u >= 2) return 'practice';    // STEP1合格
  return 'start';
}

/** 管理一覧（owner）。 */
export function roster() {
  const t = root();
  // 取引終了の会社の人は研修の対象者から外す（受験記録は消さない）
  const users = Object.keys(getDb().users || {}).filter(k => {
    const u = getDb().users[k] || {};
    return !isExcludedPerson({ code: u.repId, name: u.name, corp: u.corp });
  });
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
    .map(q => ({ code: q.code, testType: q.testType, category: q.category, tags: q.tags, question: q.question, choices: q.choices, answer: q.choices[q.answerIndex], explanation: q.explanation, talkExample: q.talkExample, sourceNote: q.sourceNote, needsOwnerCheck: q.needsOwnerCheck || null, ownerAccepted: q.ownerAccepted || null, verifiedBy: q.verifiedBy, isActive: q.isActive }));
}
