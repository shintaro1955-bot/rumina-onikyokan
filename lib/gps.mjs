/* ============================================================
   Phase 2 — GPS照合エンジン
   位置ログから「停止クラスタ（＝訪問）」と「移動」を判定し、
   空白時間を [移動 / 滞在(無会話) / 実サボり] に裏取りする。
   入力: track = [{ t:秒(録音開始からの経過), lat, lng }]
   ============================================================ */

function haversine(a, b) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 位置ログを stop / move の区間列に分解する。 */
export function buildIntervals(track, { radiusM = 25, minDwellSec = 40 } = {}) {
  const pts = (track || []).filter(p => p && Number.isFinite(p.t)).slice().sort((a, b) => a.t - b.t);
  if (pts.length < 2) return [];
  const intervals = [];
  let i = 0;
  while (i < pts.length - 1) {
    // i を起点に、半径内に留まる連続点をまとめて停止候補にする
    let j = i + 1;
    while (j < pts.length && haversine(pts[i], pts[j]) <= radiusM) j++;
    const endIdx = j - 1;
    const dwell = pts[endIdx].t - pts[i].t;
    if (dwell >= minDwellSec && endIdx > i) {
      intervals.push({ type: 'stop', start: pts[i].t, end: pts[endIdx].t, lat: pts[i].lat, lng: pts[i].lng });
      i = endIdx;                       // 停止の終端から続行（次は移動になる）
      if (i < pts.length - 1) { intervals.push({ type: 'move', start: pts[i].t, end: pts[i + 1].t }); i++; }
    } else {
      intervals.push({ type: 'move', start: pts[i].t, end: pts[i + 1].t });
      i++;
    }
  }
  // 連続する move を結合
  const merged = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && last.type === 'move' && iv.type === 'move') last.end = iv.end;
    else merged.push({ ...iv });
  }
  return merged;
}

/**
 * GPS区間 × 会話区間を突き合わせ、空白の裏取りサマリを返す。
 * @param {Array} track 位置ログ
 * @param {Array} speechSegs 文字起こしセグメント（会話のある時間帯の判定に使用）
 */
export function reconcile(track, speechSegs, opts = {}) {
  const intervals = buildIntervals(track, opts);
  if (!intervals.length) return null;

  const hasSpeech = (s, e) => (speechSegs || []).some(g => g.endSec > s && g.startSec < e);
  const SABORI = opts.saboriMinSec ?? 600;   // 無会話の停止がこの秒数以上なら“実サボり”、未満は不在の玄関先

  let movingSec = 0, staySec = 0, idleSec = 0, visitClusters = 0, noAnswerStops = 0;
  for (const iv of intervals) {
    const dur = iv.end - iv.start;
    if (iv.type === 'move') { movingSec += dur; continue; }
    if (hasSpeech(iv.start, iv.end)) { staySec += dur; visitClusters++; }   // 停止＋会話 = 訪問(接客)
    else if (dur >= SABORI) idleSec += dur;                                 // 長い無会話停止 = 実サボり
    else noAnswerStops++;                                                   // 短い無会話停止 = 不在/インターホン(ドアは押した)
  }
  const min = s => Math.round(s / 60);
  return {
    connected: true,
    movingTimeMinutes: min(movingSec),
    stayTimeMinutes: min(staySec),
    verifiedIdleMinutes: min(idleSec),   // 移動でも接客でもない滞在＝裏取り後の“実サボり”
    visitClusters,                        // 会話が発生した訪問
    noAnswerStops,                        // 不在/インターホンのみ
    totalStops: visitClusters + noAnswerStops,   // ＝総ピンポン数（GPS推定）
    intervals,
  };
}
