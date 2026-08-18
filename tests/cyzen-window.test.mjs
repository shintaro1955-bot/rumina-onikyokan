// 期間の分割が cyzen の上限（報告書=7日／履歴=15日）に収まるか確かめる。
// 8日窓・16日窓は実測でHTTP400になることを確認済み。
import { splitWindows } from '../lib/cyzen-api.mjs';
let ok = true;
const check = (l, c, x) => { ok = ok && c; console.log((c ? 'PASS' : 'FAIL') + '  ' + l + (x ? '  ' + x : '')); };
const span = ([s, e]) => Math.round((e - s) / 86400000) + 1;   // 両端を含む日数

for (const [label, days, limit] of [['報告書(6日刻み)', 6, 7], ['履歴(14日刻み)', 14, 15]]) {
  const w = splitWindows(new Date('2026-08-01'), new Date('2026-08-31'), days);
  const max = Math.max(...w.map(span));
  check(`${label}：どの窓も${limit}日以内`, max <= limit, `最大${max}日 / ${w.length}窓`);
  check(`  ${label}：月初から始まる`, w[0][0].toISOString().slice(0, 10) === '2026-08-01');
  check(`  ${label}：月末で終わる`, w[w.length - 1][1].toISOString().slice(0, 10) === '2026-08-31');
  // 隙間なく連続しているか（1件でも抜けるとアポ数が過少になる）
  let gap = 0;
  for (let i = 1; i < w.length; i++) if (Math.round((w[i][0] - w[i - 1][1]) / 86400000) !== 1) gap++;
  check(`  ${label}：窓の間に抜けが無い`, gap === 0, '抜け=' + gap);
}
const one = splitWindows(new Date('2026-08-10'), new Date('2026-08-10'), 6);
check('1日だけ指定しても1窓になる', one.length === 1 && span(one[0]) === 1);
console.log(ok ? '\n=> 全ケースPASS' : '\n=> 失敗あり');
process.exit(ok ? 0 : 1);
