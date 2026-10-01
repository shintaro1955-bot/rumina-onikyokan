// 取引終了の会社（既定：アフターホーム／KARMA）の人が、名簿・ランキング・
// アポコーチ・研修・寺子屋・LINE宛先・歩行集計のどこにも出てこないことを確かめる。
// 同梱スナップショットを読む（アフターホームは5名）。作業用の保存先は一時フォルダにする。
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onikyokan-exclude-'));
process.env.DATA_DIR = tmp;
process.env.CYZEN_DATA_DIR = join(tmp, 'cyzen-none');      // CSVは無し＝同梱スナップショットを使う
process.env.TERAKOYA_LIST = join(tmp, 'terakoya-targets.csv');
delete process.env.EXCLUDE_COMPANIES;
delete process.env.PORTAL_URL;

let ok = true;
const check = (l, c, x) => { ok = ok && c; console.log((c ? 'PASS' : 'FAIL') + '  ' + l + (x ? '  ' + x : '')); };

const ex = await import('../lib/exclude.mjs');

/* ---- 1) 会社名の突き合わせ（表記ゆれ） ---- */
for (const v of ['アフターホーム株式会社', 'ｱﾌﾀｰﾎｰﾑ', 'アポインター/パートナー/アフターホーム株式会社', '合同会社KARMA'])
  check(`除外になる：${v}`, ex.isExcludedCompany(v));
for (const v of ['G.WORTH株式会社', 'HY株式会社', '株式会社Fit Founder', '株式会社テクノホーム', '', null])
  check(`除外にならない：${v}`, !ex.isExcludedCompany(v));

/* ---- 2) 環境変数 EXCLUDE_COMPANIES での上書き ---- */
process.env.EXCLUDE_COMPANIES = '["ABC商事"]';
check('JSON配列で上書きできる', ex.excludedCompanies().join() === 'ABC商事' && !ex.isExcludedCompany('アフターホーム'));
process.env.EXCLUDE_COMPANIES = 'アフターホーム, KARMA、Foo';
check('カンマ・読点区切りでも書ける', ex.excludedCompanies().length === 3);
process.env.EXCLUDE_COMPANIES = 'アフターホーム,KARMA,G.WORTH';
check('G.WORTH も足せる（表記ゆれも吸収）', ex.isExcludedCompany('Ｇ．ＷＯＲＴＨ株式会社') && ex.isExcludedCompany('g worth'));
process.env.EXCLUDE_COMPANIES = '';
check('空文字なら誰も外さない', ex.excludedCompanies().length === 0);
delete process.env.EXCLUDE_COMPANIES;
check('未設定なら既定の2社', ex.excludedCompanies().join() === ex.EXCLUDE_DEFAULT.join());

/* ---- 3) cyzen の名簿・日次から外れている ---- */
const cyzen = await import('../lib/cyzen.mjs');
const AH = { '00-0190': '岩本顕', '00-0191': '河野大輝', '00-0192': '浅井詩音', '00-0326': '森井桃花', '00-0254': '中道健太' };
const codes = Object.keys(AH), names = Object.values(AH);
const users = cyzen.usersMap();
check('名簿にアフターホームの人がいない', codes.every(c => !users.has(c)));
check('名簿に除外3社の属性が残っていない', [...users.values()].every(u => !ex.isExcludedCompany(u.attr)));
check('日次レコードにも残っていない', cyzen.records().every(r => !codes.includes(r.code)));
check('除外した人の一覧に5名とも載る', codes.every(c => cyzen.excludedPeople().some(p => p.code === c)));
check('status に除外人数が出る', cyzen.status().excluded >= 5, 'excluded=' + cyzen.status().excluded);
check('KPI一覧(roster)に出ない', cyzen.roster().rows.every(r => !codes.includes(r.code)));
check('伸び(trends)に出ない', cyzen.trends().rows.every(r => !codes.includes(r.code)));
check('氏名からコードを引けない（SSOで紐付かない）', names.every(n => cyzen.codeByName(n) === null));
const dates = [...new Set(cyzen.records().map(r => r.date))];
check('日ごとの実績(dayFacts)に出ない', dates.every(d => cyzen.dayFacts(d).every(r => !codes.includes(r.code))));
check('連続アポ記録に出ない', cyzen.apoStreaks().every(r => !codes.includes(r.code)));
check('氏名・コード・会社名のどれでも除外と判定', cyzen.isExcludedPerson({ name: '岩本 顕' }) && cyzen.isExcludedPerson({ code: '00-0326' }) && cyzen.isExcludedPerson({ corp: 'ｱﾌﾀｰﾎｰﾑ株式会社' }));
const keep = [...users.values()].find(u => u.name);
check('残る人は除外にならない', !cyzen.isExcludedPerson({ name: keep.name }), keep.name);

/* ---- 4) 配信・コーチの対象から外れている ---- */
const hasAH = (arr, key = 'name') => (arr || []).some(x => names.includes(x[key]));
const { buildFacts } = await import('../lib/digest.mjs');
const f = buildFacts();
check('日次ダイジェストの順位に出ない', f && !hasAH(f.ranked));
const { buildApoMessages } = await import('../lib/coachapo.mjs');
const apo = buildApoMessages({ all: true });
check('アポコーチの送信対象に出ない', apo.ok && !hasAH(apo.messages));
const { buildPersonalMessages } = await import('../lib/coachdm.mjs');
const dm = buildPersonalMessages({ all: true });
check('行動量コーチの送信対象に出ない', dm.ok !== false && !hasAH(dm.messages));
const terakoya = await import('../lib/terakoya.mjs');
const inv = terakoya.buildAppointerInvites();
check('アポインター全員への案内に出ない', inv.ok && !hasAH(inv.targets));

// 寺子屋の対象者CSV（人が作ったリスト）に残っていても外す
writeFileSync(process.env.TERAKOYA_LIST, '氏名,所属会社,役割区分,要因分類,8月出退勤日数\n山田太郎,ｱﾌﾀｰﾎｰﾑ株式会社,アポインター,アポ低下,10\n岩本顕,,アポインター,アポ低下,10\n' + keep.name + ',HY株式会社,アポインター,アポ低下,10\n');
const ti = terakoya.buildInvites();
check('寺子屋の対象者CSVから会社名・氏名で外す', ti.ok && ti.droppedByCompany === 2 && ti.targets.length === 1 && !hasAH(ti.targets), JSON.stringify({ dropped: ti.droppedByCompany, n: ti.count }));

/* ---- 5) アプリのアカウント（研修ゲート・LINE宛先） ---- */
const { getDb } = await import('../lib/store.mjs');
const db = getDb();
db.users['ah1'] = { username: 'ah1', name: '岩本顕', role: 'rep', repId: '00-0190', lineId: 'U-ah1' };
db.users['ah2'] = { username: 'ah2', name: '別名さん', role: 'rep', repId: null, lineId: 'U-ah2', corp: 'アフターホーム株式会社' };
db.users['ok1'] = { username: 'ok1', name: keep.name, role: 'rep', repId: [...users.keys()].find(c => users.get(c) === keep), lineId: 'U-ok1' };
const training = await import('../lib/training.mjs');
const tr = training.roster().map(r => r.user);
check('研修ゲートの対象者から外す', !tr.includes('ah1') && !tr.includes('ah2') && tr.includes('ok1'), tr.join(','));
const { resolveLineIds } = await import('../lib/reminders.mjs');
const li = await resolveLineIds(['岩本顕', keep.name]);
check('LINE宛先の解決で外す', li.byCode && !li.byCode.has('00-0190') && li.byCode.has(db.users.ok1.repId));

/* ---- 6) 歩行集計（walk-daily.json）から外す ---- */
writeFileSync(join(tmp, 'walk-daily.json'), JSON.stringify({
  users: { u1: { code: '00-0190', name: '岩本顕' }, u2: { code: db.users.ok1.repId, name: keep.name } },
  days: { 'u1|2026-09-30': { uid: 'u1', date: '2026-09-30', walkM: 9000, rideM: 0, points: 50, areas: { '東京都港区': 5 }, apoAreas: { '東京都港区': 1 } },
          'u2|2026-09-30': { uid: 'u2', date: '2026-09-30', walkM: 5000, rideM: 0, points: 40, areas: { '東京都港区': 4 }, apoAreas: { '東京都港区': 1 } } },
}));
const wi = await import('../lib/walk-ingest.mjs');
check('歩行ランキングから外す', wi.stats({ days: 30 }).rows.every(r => r.code !== '00-0190'));
check('その日の歩行・エリア別アポからも外す', wi.dayStats('2026-09-30').rows.length === 1 && wi.hotAreas({ ym: '2026-09' }).rows[0].people.every(p => p.code !== '00-0190'));

console.log(ok ? '\n=> 全ケースPASS' : '\n=> 失敗あり');
process.exit(ok ? 0 : 1);
