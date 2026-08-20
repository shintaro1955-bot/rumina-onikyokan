/* ============================================================
   Rumina Field OS ドメインデータ（db.json 上に保存）
   目標 / Momentum重み / 学習進捗 / ソーシャル(投稿・リアクション・既読)
   store.mjs の getDb()/save() の上に薄く載せる。
   ============================================================ */
import { getDb, save } from './store.mjs';

function root() {
  const db = getDb();
  if (!db.fieldos) db.fieldos = { goals: {}, weights: null, learning: {}, posts: [], reactions: [], reads: {} };
  const f = db.fieldos;
  f.goals ||= {}; f.learning ||= {}; f.posts ||= []; f.reactions ||= []; f.reads ||= {};
  return f;
}
const now = () => new Date().toISOString();
const clamp01 = x => Math.max(0, Math.min(1, x || 0));

/* ---------- 目標（本人単位・日次の訪問目標が主） ---------- */
export function getGoal(user) { return root().goals[user] || null; }
export function setGoal(user, g) {
  const rec = { visits: Math.max(1, Math.round(g.visits || 50)), apo: g.apo != null ? Math.max(0, Math.round(g.apo)) : null, updatedAt: now() };
  root().goals[user] = rec; save(); return rec;
}
export function goalVisits(user) { const g = getGoal(user); return g ? g.visits : 50; }

/* ---------- Momentum Score の重み（owner設定・版管理） ---------- */
const DEFAULT_WEIGHTS = { version: 1, goal: 35, conversion: 25, continuity: 15, learning: 15, report: 10 };
export function getWeights() { const w = root().weights; return w && w.version ? w : DEFAULT_WEIGHTS; }
export function setWeights(w) {
  const keys = ['goal', 'conversion', 'continuity', 'learning', 'report'];
  const cur = getWeights();
  const next = {};
  let sum = 0;
  for (const k of keys) { next[k] = Math.max(0, Math.round(w[k] != null ? w[k] : cur[k])); sum += next[k]; }
  if (sum !== 100) return { error: `合計が100になりません（現在${sum}）` };
  next.version = (cur.version || 1) + 1; next.updatedAt = now();
  root().weights = next; save(); return next;
}

/* ---------- Momentum Score 0〜1000 ----------
   各要素 0..1 を重み(%)で合成。位置情報はスコア化しない。稼働時間だけで有利にしない。
   agg = personSummary(本人のcyzen集計) を想定。learnRate は学習の到達率。 */
export function momentum(agg, user, learnRate = 0) {
  const w = getWeights();
  if (!agg || agg.empty) return { score: null, confidence: 'insufficient', parts: null, weights: w, note: '算出に十分なデータがありません' };
  const target = goalVisits(user);
  const parts = {
    goal: clamp01((agg.visitsPerDay || 0) / target),                         // 行動目標達成率
    conversion: clamp01((agg.apoRate || 0) / 5.5),                            // アポ転換（あるべき5.5%を1.0）
    continuity: clamp01((agg.days || 0) / Math.max(1, (agg.periodDays || 1) * 0.6)), // 稼働の継続
    learning: clamp01(learnRate),                                            // 学習・ロープレ
    report: clamp01(agg.reportRate || 0),                                    // 報告品質
  };
  const raw = (parts.goal * w.goal + parts.conversion * w.conversion + parts.continuity * w.continuity + parts.learning * w.learning + parts.report * w.report) / 100;
  const score = Math.round(raw * 1000);
  const confidence = (agg.days || 0) >= 3 ? 'ok' : 'low';
  return { score, confidence, parts, weights: w };
}

/* ---------- 学習進捗（間隔復習：翌日/3日/7日/14日） ---------- */
const REVIEW_STEPS = [1, 3, 7, 14];
export function getLearning(user) { return root().learning[user] || {}; }
export function learnRate(user, targetPerWeek = 5) {
  const l = getLearning(user);
  const weekAgo = Date.now() - 7 * 86400000;
  const done = Object.values(l).filter(m => m.lastCompletedAt && Date.parse(m.lastCompletedAt) >= weekAgo).length;
  return clamp01(done / targetPerWeek);
}
export function completeDrill(user, moduleId, score) {
  const f = root(); f.learning[user] ||= {};
  const prev = f.learning[user][moduleId] || { reps: 0, xp: 0 };
  const reps = (prev.reps || 0) + 1;
  const stepDays = REVIEW_STEPS[Math.min(reps - 1, REVIEW_STEPS.length - 1)];
  const nextReview = new Date(Date.now() + stepDays * 86400000).toISOString().slice(0, 10);
  const xp = (prev.xp || 0) + 10 + Math.round((score || 0) / 10);
  const rec = { moduleId, status: 'completed', reps, score: score ?? null, xp, lastCompletedAt: now(), nextReviewAt: nextReview, reviewIntervalDays: stepDays };
  f.learning[user][moduleId] = rec; save();
  return rec;
}
export function dueReviews(user) {
  const l = getLearning(user); const today = new Date().toISOString().slice(0, 10);
  return Object.values(l).filter(m => m.nextReviewAt && m.nextReviewAt <= today);
}
export function totalXp(user) { return Object.values(getLearning(user)).reduce((s, m) => s + (m.xp || 0), 0); }

/* ---------- ソーシャル（上長投稿・リアクション・既読） ---------- */
export function addPost(post) {
  const f = root();
  const rec = {
    id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
    type: post.type || 'notice', title: String(post.title || '').slice(0, 120), body: String(post.body || '').slice(0, 4000),
    author: post.author || '本部', important: !!post.important, scope: post.scope || 'company',
    createdAt: now(),
  };
  f.posts.unshift(rec); f.posts = f.posts.slice(0, 500); save(); return rec;
}
export function listPosts(limit = 30) { return root().posts.slice(0, limit); }
export function deletePost(id) { const f = root(); f.posts = f.posts.filter(p => p.id !== id); save(); }
export function react(user, targetId, kind) {
  const f = root();
  const i = f.reactions.findIndex(r => r.user === user && r.targetId === targetId);
  if (i >= 0) { if (f.reactions[i].kind === kind) { f.reactions.splice(i, 1); save(); return { removed: true }; } f.reactions[i].kind = kind; }
  else f.reactions.push({ user, targetId, kind, at: now() });
  save(); return { kind };
}
export function reactionsFor(targetId) {
  const rs = root().reactions.filter(r => r.targetId === targetId);
  const by = {}; rs.forEach(r => (by[r.kind] = (by[r.kind] || 0) + 1));
  return { total: rs.length, by };
}
export function markRead(user, postId) {
  const f = root(); f.reads[postId] ||= {}; if (!f.reads[postId][user]) { f.reads[postId][user] = now(); save(); } return true;
}
export function readInfo(postId) { return Object.keys(root().reads[postId] || {}); }
