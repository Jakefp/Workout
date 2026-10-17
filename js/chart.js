// Minimal SVG time-series chart with a crosshair tooltip.
// series: [{ name, points:[{x(ms), y, label?}], mark:'line'|'dots'|'both', tone:'accent'|'muted' }]
import { fmtDate, esc } from './util.js';

function niceTicks(min, max, count = 4) {
  if (min === max) { const d = Math.abs(min) * 0.05 || 1; min -= d; max += d; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

export function renderChart(el, { series, yFmt = v => String(v), note = '' }) {
  const pts = series.flatMap(s => s.points);
  if (!pts.length) {
    el.innerHTML = `<div class="chart-empty">Nothing to chart yet — log a session and it'll show here.</div>`;
    return;
  }
  const W = Math.max(280, el.clientWidth || 340), H = 190;
  const L = 48, R = 14, T = 12, B = 26;
  let xmin = Math.min(...pts.map(p => p.x)), xmax = Math.max(...pts.map(p => p.x));
  if (xmax - xmin < 2 * 86400000) { const mid = (xmin + xmax) / 2; xmin = mid - 3 * 86400000; xmax = mid + 3 * 86400000; }
  const ticks = niceTicks(Math.min(...pts.map(p => p.y)), Math.max(...pts.map(p => p.y)));
  const ymin = ticks[0], ymax = ticks[ticks.length - 1];
  const sx = x => L + (x - xmin) / (xmax - xmin) * (W - L - R);
  const sy = y => T + (1 - (y - ymin) / (ymax - ymin || 1)) * (H - T - B);

  const grid = ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}"/>
    <text class="axis" x="${L - 6}" y="${sy(t) + 4}" text-anchor="end">${esc(yFmt(t))}</text>`).join('');
  const nx = Math.min(4, Math.max(2, Math.floor((W - L - R) / 90)));
  const xt = [];
  for (let i = 0; i < nx; i++) xt.push(xmin + (xmax - xmin) * i / (nx - 1));
  const spanDays = (xmax - xmin) / 86400000;
  const xl = xt.map((x, i) => `<text class="axis" x="${sx(x)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle'}">${esc(fmtDate(x, spanDays > 300 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }))}</text>`).join('');

  const marks = series.map(s => {
    const p = [...s.points].sort((a, b) => a.x - b.x);
    let out = '';
    if ((s.mark === 'line' || s.mark === 'both') && p.length > 1) {
      out += `<path class="line ${s.tone}" d="${p.map((q, i) => `${i ? 'L' : 'M'}${sx(q.x).toFixed(1)},${sy(q.y).toFixed(1)}`).join('')}"/>`;
    }
    if (s.mark === 'dots' || s.mark === 'both' || p.length === 1) {
      out += p.map(q => `<circle class="dot ${s.tone}" cx="${sx(q.x).toFixed(1)}" cy="${sy(q.y).toFixed(1)}" r="4"/>`).join('');
    }
    return out;
  }).join('');

  el.innerHTML = `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(series.map(s => s.name).join(', '))} over time">
        ${grid}${xl}${marks}
        <line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/>
        <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
      </svg>
      <div class="tip" style="display:none"></div>
    </div>
    ${series.length > 1 ? `<div class="legend">${series.map(s => `<span><i class="sw ${s.tone} ${s.mark}"></i>${esc(s.name)}</span>`).join('')}</div>` : ''}
    ${note ? `<div class="chart-note">${esc(note)}</div>` : ''}`;

  const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), cross = el.querySelector('.cross');
  const xs = [...new Set(pts.map(p => p.x))].sort((a, b) => a - b);
  const move = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    const x0 = xmin + (px - L) / (W - L - R) * (xmax - xmin);
    let best = xs[0];
    for (const x of xs) if (Math.abs(x - x0) < Math.abs(best - x0)) best = x;
    const cx = sx(best);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.display = '';
    const rows = series.map(s => {
      const q = s.points.find(p => p.x === best);
      return q ? `<div><span class="k">${esc(s.name)}</span> <b>${esc(q.label ?? yFmt(q.y))}</b></div>` : '';
    }).join('');
    tip.innerHTML = `<div class="d">${esc(fmtDate(best, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</div>${rows}`;
    tip.style.display = '';
    const left = cx / W * r.width;
    tip.style.left = Math.min(Math.max(left - tip.offsetWidth / 2, 0), r.width - tip.offsetWidth) + 'px';
  };
  const leave = () => { tip.style.display = 'none'; cross.style.display = 'none'; };
  const hit = el.querySelector('.hit');
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
}
