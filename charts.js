/* ============================================================
   Rumina 鬼教官 — 自作SVGチャート（ミニマル・依存なし）
   フラット／単色アクセント／装飾なし。
   ============================================================ */
const ACCENT = '#34d399';   // emerald-400
const MUTE = '#3f3f46';     // neutral-700
const LINE = '#27272a';     // neutral-800
const TXT = '#71717a';      // neutral-500

/* ---- 100ピンポン ゲージ（半円・フラット） ---- */
function pingGauge(value, target) {
  const pct = Math.min(value / target, 1);
  const w = 300, h = 168, cx = w / 2, cy = 150, r = 120;
  const pt = (a, rad) => [cx + rad * Math.cos(a), cy - rad * Math.sin(a)];
  function arc(to, color, sw) {
    const a0 = Math.PI, a1 = Math.PI - Math.PI * to;
    const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
    const large = (a0 - a1) > Math.PI ? 1 : 0;
    return `<path d="M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
  }
  return `
  <svg viewBox="0 0 ${w} ${h}" class="w-full max-w-[300px]">
    ${arc(1, LINE, 10)}
    ${arc(pct, ACCENT, 10)}
    <text x="${cx}" y="${cy - 36}" text-anchor="middle" fill="#e4e4e7" font-size="46" font-weight="700" style="font-variant-numeric:tabular-nums">${value}</text>
    <text x="${cx}" y="${cy - 12}" text-anchor="middle" fill="${TXT}" font-size="12">/ ${target}　達成${Math.round(value / target * 100)}%</text>
  </svg>`;
}

/* ---- レーダー（本人 vs トップ・線のみ） ---- */
function radarChart(axes) {
  const w = 320, h = 280, cx = w / 2, cy = h / 2 + 2, R = 100, n = axes.length;
  const pt = (i, val) => {
    const a = -Math.PI / 2 + i * (2 * Math.PI / n), rad = R * (val / 100);
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  };
  let grid = '';
  [0.5, 1].forEach(g => {
    let d = ''; for (let i = 0; i < n; i++) { const [x, y] = pt(i, g * 100); d += (i ? 'L' : 'M') + x + ' ' + y + ' '; }
    grid += `<path d="${d}Z" fill="none" stroke="${LINE}" stroke-width="1"/>`;
  });
  let labels = '';
  for (let i = 0; i < n; i++) { const [lx, ly] = pt(i, 122); labels += `<text x="${lx}" y="${ly}" fill="${TXT}" font-size="11" text-anchor="middle" dominant-baseline="middle">${axes[i].key}</text>`; }
  const poly = (key, stroke, fill) => { let d = ''; for (let i = 0; i < n; i++) { const [x, y] = pt(i, Math.min(axes[i][key], 100)); d += (i ? 'L' : 'M') + x + ' ' + y + ' '; } return `<path d="${d}Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`; };
  return `
  <svg viewBox="0 0 ${w} ${h}" class="w-full max-w-[340px] mx-auto">
    ${grid}
    ${poly('top', '#52525b', 'none')}
    ${poly('me', ACCENT, 'rgba(52,211,153,0.12)')}
    ${labels}
  </svg>`;
}

/* ---- 時間帯別 活動密度（フラット棒・空白は赤） ---- */
function hourlyDensity(rows, idleHours) {
  if (!rows.length) return '';
  const w = 620, h = 200, padL = 24, padB = 28, padT = 10;
  const max = Math.max(...rows.map(r => r.ping), 1);
  const bw = (w - padL - 8) / rows.length, chartH = h - padB - padT;
  let bars = '';
  rows.forEach((r, i) => {
    const x = padL + i * bw + 3, bh = (r.ping / max) * chartH, y = padT + chartH - bh;
    const idle = idleHours.includes(r.hour);
    bars += `<rect x="${x}" y="${y}" width="${bw - 6}" height="${Math.max(0, bh)}" rx="2" fill="${idle ? '#f43f5e' : MUTE}"><title>${r.hour}:00 ピンポン${r.ping}</title></rect>`;
    bars += `<text x="${x + (bw - 6) / 2}" y="${h - padB + 15}" fill="${TXT}" font-size="10" text-anchor="middle">${r.hour}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" class="w-full">${bars}</svg>`;
}

/* ---- 断り文句ランキング（フラット横棒） ---- */
function objectionBars(rows) {
  if (!rows.length) return '<div class="text-sm text-neutral-500">データなし</div>';
  const max = Math.max(...rows.map(r => r.count), 1);
  return rows.map((r, i) => `
    <div>
      <div class="flex justify-between text-[13px] mb-1"><span class="text-neutral-300">${i + 1}. ${r.label}</span><span class="text-neutral-500 tabular-nums">${r.count}</span></div>
      <div class="h-1.5 rounded-full bg-neutral-800 overflow-hidden"><div class="h-full rounded-full bg-neutral-500" style="width:${r.count / max * 100}%"></div></div>
    </div>`).join('');
}

window.CHARTS = { pingGauge, radarChart, hourlyDensity, objectionBars };
