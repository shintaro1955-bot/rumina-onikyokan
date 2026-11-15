// 歩行距離の畳み込み（ルート自動記録）。ここが狂うと耐久部門の順位が丸ごと変わる。
import { foldDistance, workWindow } from '../lib/walk-ingest.mjs';
let ok = true;
const check = (l, c, x) => { ok = ok && c; console.log((c ? 'PASS' : 'FAIL') + '  ' + l + (x ? '  ' + x : '')); };
const T0 = Date.parse('2026-11-14T10:00:00+09:00');
const step = (i, north) => ({ t: T0 + i * 240000, lat: 35.0 + north / 111320, lon: 139.0 });   // 4分おき・北へ north メートル
// 4分ごとに200m進む＝時速3km＝歩き
{ const pts = [0, 200, 400, 600].map((m, i) => step(i, m)); const d = foldDistance(pts, { noiseM: 20 }); check('4分で200mずつは歩き（約600m）', Math.abs(d.walkM - 600) < 5 && d.rideM === 0, JSON.stringify(d)); }
// 4分で3km＝時速45km＝乗り物
{ const pts = [step(0, 0), step(1, 3000)]; const d = foldDistance(pts, { noiseM: 20 }); check('4分で3kmは乗り物', d.walkM === 0 && Math.abs(d.rideM - 3000) < 20, JSON.stringify(d)); }
// 立ち止まり中のGPSの揺れ（10m）は歩きに入れない
{ const pts = [0, 10, 3, 12, 5].map((m, i) => step(i, m)); const d = foldDistance(pts, { noiseM: 20 }); check('20m未満の揺れは数えない', d.walkM === 0, JSON.stringify(d)); const e = foldDistance(pts); check('打刻のとき（noiseなし）は従来どおり数える', e.walkM > 0, JSON.stringify(e)); }
// 30分以上あいた区間は繋がない
{ const pts = [step(0, 0), { t: T0 + 3600e3, lat: 35.0 + 500 / 111320, lon: 139.0 }]; const d = foldDistance(pts, { noiseM: 20 }); check('30分以上の空白はまたがない', d.walkM === 0 && d.rideM === 0, JSON.stringify(d)); }
// 数える時間帯
{ const w = workWindow('2026-11-14', NaN, NaN); check('打刻が無い日は 8:00〜21:00', w.from === Date.parse('2026-11-14T08:00:00+09:00') && w.to === Date.parse('2026-11-14T21:00:00+09:00')); }
{ const cin = Date.parse('2026-11-14T09:30:00+09:00'), cout = Date.parse('2026-11-14T19:10:00+09:00'); const w = workWindow('2026-11-14', cin, cout); check('出勤〜勤務終了の間', w.from === cin && w.to === cout); }
{ const cin = Date.parse('2026-11-14T09:30:00+09:00'); const w = workWindow('2026-11-14', cin, NaN); check('出勤だけの日は 21:00 まで', w.from === cin && w.to === Date.parse('2026-11-14T21:00:00+09:00')); }
console.log(ok ? 'ALL PASS' : 'SOME FAIL'); process.exit(ok ? 0 : 1);
