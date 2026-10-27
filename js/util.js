// Pure helpers: ids, time parsing/formatting, exercise field definitions,
// session-length estimates, and per-exercise progress metrics.

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const DAY = 86400000;

// "1:30" or "1.30" -> 90, "90" -> 90, "1:02:03" -> 3723, "" -> null.
// '.' is accepted as a separator because the iPhone decimal keypad has no ':'.
// plain: unit for a bare number ('sec' or 'min').
export function parseDur(str, plain = 'sec') {
  if (str === null || str === undefined) return null;
  const s = String(str).trim().replace(/[.,]/g, ':');
  if (!s) return null;
  if (!s.includes(':')) { const n = Number(s); return Number.isFinite(n) ? Math.round(plain === 'min' ? n * 60 : n) : null; }
  const parts = s.split(':').map(Number);
  if (parts.some(p => !Number.isFinite(p))) return null;
  return Math.round(parts.reduce((acc, p) => acc * 60 + p, 0));
}

export function fmtDur(sec) {
  if (sec === null || sec === undefined || sec === '') return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// Human length: "45 min", "1 h 05"
export function fmtLength(sec) {
  if (!sec || sec < 0) return '0 min';
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')}`;
}

export function localISO(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

// Monday 00:00 (local) of the week containing d.
export function startOfWeek(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - (x.getDay() + 6) % 7);
  return x;
}
// Calendar-day arithmetic in local time, so DST changes don't shift dates.
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export const fmtDate = (ms, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(ms).toLocaleDateString('en-GB', opts);
export const fmtTime = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export const num = v => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const fmtNum = v => (v === null || v === undefined) ? '' : String(Math.round(v * 100) / 100);

// ---------- Exercise types ----------

export const TYPES = {
  weight: 'Weight × reps',
  bodyweight: 'Bodyweight × reps',
  hold: 'Timed hold',
  stretch: 'Stretch',
  interval: 'Cardio intervals',
  steady: 'Cardio steady',
};

export const MODALITIES = { row: 'Rower', ski: 'SkiErg', bike: 'Bike', run: 'Run', other: 'Other' };

export const isCardio = ex => ex.type === 'interval' || ex.type === 'steady';

function modalityFields(modality) {
  switch (modality) {
    case 'row': case 'ski': return [
      { key: 'split', label: '/500m', kind: 'dur', ph: '2:00' },
      { key: 'watts', label: 'W', kind: 'num', ph: '' },
    ];
    case 'bike': return [
      { key: 'watts', label: 'W', kind: 'num', ph: '' },
      { key: 'cadence', label: 'rpm', kind: 'num', ph: '' },
    ];
    case 'run': return [{ key: 'pace', label: '/km', kind: 'dur', ph: '5:00' }];
    default: return [{ key: 'watts', label: 'W', kind: 'num', ph: '' }];
  }
}

// Input fields for one logged set / round of an exercise.
export function fieldsFor(ex) {
  switch (ex.type) {
    case 'weight': return [
      { key: 'kg', label: 'kg', kind: 'num' },
      { key: 'reps', label: ex.perSide ? 'reps/side' : 'reps', kind: 'num' },
    ];
    case 'bodyweight': return [
      { key: 'kg', label: '± kg', kind: 'num', ph: '0' },
      { key: 'reps', label: ex.perSide ? 'reps/side' : 'reps', kind: 'num' },
    ];
    case 'hold': case 'stretch': return [
      { key: 'time', label: ex.perSide ? 'time/side' : 'time', kind: 'dur', ph: '0:30' },
    ];
    case 'interval': return [
      { key: 'time', label: 'work', kind: 'dur' },
      ...modalityFields(ex.modality),
    ];
    case 'steady': return [
      { key: 'time', label: 'time', kind: 'dur', ph: '45:00' },
      { key: 'dist', label: 'km', kind: 'num' },
      { key: 'hr', label: 'avg HR', kind: 'num' },
      ...modalityFields(ex.modality),
    ];
    default: return [];
  }
}

export const setLabel = ex => ex.type === 'interval' ? 'Round' : 'Set';

export function fmtField(f, v) {
  if (v === null || v === undefined || v === '') return '';
  return f.kind === 'dur' ? fmtDur(v) : fmtNum(v);
}

// Compact one-line summary of a set, e.g. "80 kg × 8", "BW+10 × 6", "0:45", "4:00 @ 245 W"
export function summariseSet(ex, s) {
  const reps = s.reps ?? '–';
  switch (ex.type) {
    case 'weight': return `${fmtNum(s.kg) || '–'} kg × ${reps}`;
    case 'bodyweight': {
      const kg = num(s.kg);
      const load = !kg ? 'BW' : kg > 0 ? `BW+${fmtNum(kg)}` : `BW${fmtNum(kg)}`;
      return `${load} × ${reps}`;
    }
    case 'hold': case 'stretch': return fmtDur(s.time) || '–';
    case 'interval': {
      const bits = [fmtDur(s.time) || '–'];
      const m = cardioBits(ex, s);
      return m ? `${bits[0]} @ ${m}` : bits[0];
    }
    case 'steady': {
      const bits = [];
      if (s.time) bits.push(fmtDur(s.time));
      if (s.dist) bits.push(`${fmtNum(s.dist)} km`);
      const m = cardioBits(ex, s);
      if (m) bits.push(m);
      if (s.hr) bits.push(`${s.hr} bpm`);
      return bits.join(' · ') || '–';
    }
  }
  return '';
}

function cardioBits(ex, s) {
  const b = [];
  if (s.split) b.push(`${fmtDur(s.split)}/500m`);
  if (s.pace) b.push(`${fmtDur(s.pace)}/km`);
  if (s.watts) b.push(`${s.watts} W`);
  if (s.cadence) b.push(`${s.cadence} rpm`);
  return b.join(' ');
}

// ---------- Targets ----------

export function defaultTarget(ex) {
  switch (ex.type) {
    case 'weight': case 'bodyweight': return { sets: 3, reps: 10, rest: 90 };
    case 'hold': return { sets: 3, time: 30, rest: 60 };
    case 'stretch': return { sets: 2, time: 30, rest: 15 };
    case 'interval': return { sets: 6, time: 60, rest: 60 };
    case 'steady': return { sets: 1, time: 2700, rest: 0 };
  }
  return { sets: 3, reps: 10, rest: 90 };
}

// Which target fields the routine editor shows for a type.
export function targetFields(ex) {
  switch (ex.type) {
    case 'weight': case 'bodyweight': return [
      { key: 'sets', label: 'Sets', kind: 'num' },
      { key: 'reps', label: ex.perSide ? 'Reps/side' : 'Reps', kind: 'num' },
      { key: 'rest', label: 'Rest', kind: 'dur' },
    ];
    case 'hold': case 'stretch': return [
      { key: 'sets', label: 'Sets', kind: 'num' },
      { key: 'time', label: ex.perSide ? 'Hold/side' : 'Hold', kind: 'dur' },
      { key: 'rest', label: 'Rest', kind: 'dur' },
    ];
    case 'interval': return [
      { key: 'sets', label: 'Rounds', kind: 'num' },
      { key: 'time', label: 'Work', kind: 'dur' },
      { key: 'rest', label: 'Rest', kind: 'dur' },
    ];
    case 'steady': return [{ key: 'time', label: 'Duration', kind: 'dur' }];
  }
  return [];
}

// A fresh set pre-filled from the target.
export function setFromTarget(ex, t) {
  switch (ex.type) {
    case 'weight': return { kg: null, reps: t.reps ?? null };
    case 'bodyweight': return { kg: null, reps: t.reps ?? null };
    case 'hold': case 'stretch': return { time: t.time ?? null };
    case 'interval': return { time: t.time ?? null };
    case 'steady': return { time: t.time ?? null };
  }
  return {};
}

// ---------- Blocks & estimates ----------

// Consecutive items sharing a group id form one superset block.
export function blocks(items) {
  const out = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (it.group && last && last.group === it.group) last.items.push(it);
    else out.push({ group: it.group || null, items: [it] });
  }
  return out;
}

function workPerSet(ex, t, cfg) {
  const sides = ex.perSide ? 2 : 1;
  switch (ex.type) {
    case 'weight': case 'bodyweight':
      return Math.max((num(t.reps) || 0) * cfg.secPerRep * sides, cfg.minSetSec);
    case 'hold': case 'stretch': return (num(t.time) || 0) * sides;
    case 'interval': case 'steady': return num(t.time) || 0;
  }
  return cfg.minSetSec;
}

// items: [{exId, target:{sets,reps,time,rest}, group}]
export function estimateSec(items, exMap, cfg) {
  const bl = blocks(items);
  let total = 0, counted = 0;
  for (const b of bl) {
    let work = 0, rounds = 0, rest = 0;
    for (const it of b.items) {
      const ex = exMap.get(it.exId);
      if (!ex) continue;
      const t = it.target || {};
      const sets = Math.max(0, Math.round(num(t.sets) ?? (ex.type === 'steady' ? 1 : 0)));
      work += sets * workPerSet(ex, t, cfg);
      rounds = Math.max(rounds, sets);
      if (ex.type !== 'steady') rest = Math.max(rest, num(t.rest) || 0);
    }
    if (!rounds) continue;
    total += work + Math.max(0, rounds - 1) * rest;
    counted++;
  }
  total += Math.max(0, counted - 1) * cfg.changeoverSec;
  return total;
}

// ---------- Personal records ----------

// Score for one set; the highest-scoring set ever is the PR. null = can't be scored.
//   weight: kg × reps (volume), so 20 kg × 10 beats 40 kg × 4
//   bodyweight: reps × (bodyweight + added kg)
//   hold/stretch: longest time
//   interval: watts × minutes (work); rower/ski split converts to watts; runs use distance (time / pace)
//   steady: distance, else distance from time / pace
export function setScore(ex, s, bw = 75) {
  const kg = num(s.kg), reps = num(s.reps), time = num(s.time), pace = num(s.pace);
  switch (ex.type) {
    case 'weight': return kg && reps ? kg * reps : null;
    case 'bodyweight': return reps ? reps * (bw + (kg || 0)) : null;
    case 'hold': case 'stretch': return time || null;
    case 'interval': {
      if (!time) return null;
      if (ex.modality === 'run') return pace ? time / pace : null;
      const split = num(s.split);
      const w = num(s.watts) || (split ? 2.8 / Math.pow(split / 500, 3) : null);
      return w ? w * time / 60 : null;
    }
    case 'steady': return num(s.dist) || (time && pace ? time / pace : null);
  }
  return null;
}

// ---------- Progress metrics ----------

const done = it => (it.sets || []).filter(s => s.done !== false);
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

// Sets × reps: every rep logged in the session.
const totalReps = {
  key: 'treps', label: 'Total reps', unit: 'reps',
  get(it) {
    const d = done(it).filter(s => num(s.reps) !== null);
    const r = d.reduce((t, s) => t + num(s.reps), 0);
    return d.length ? { y: r, label: `${r} reps (${d.length} set${d.length === 1 ? '' : 's'})` } : null;
  },
  fmt: v => `${fmtNum(v)}`,
};

// Returns metric definitions available for an exercise. First is the default.
export function metricsFor(ex) {
  switch (ex.type) {
    case 'weight': return [{
      key: 'top', label: 'Max weight', unit: 'kg',
      get(it) {
        let best = null;
        for (const s of done(it)) {
          const kg = num(s.kg); if (kg === null) continue;
          const reps = num(s.reps) || 0;
          if (!best || kg > best.kg || (kg === best.kg && reps > best.reps)) best = { kg, reps };
        }
        return best ? { y: best.kg, label: `${fmtNum(best.kg)} kg × ${best.reps}` } : null;
      },
      fmt: v => `${fmtNum(v)} kg`,
    }, {
      key: 'volume', label: 'Volume', unit: 'kg',
      get(it) {
        const v = done(it).reduce((t, s) => t + (num(s.kg) || 0) * (num(s.reps) || 0), 0);
        return v ? { y: v, label: `${fmtNum(v)} kg total` } : null;
      },
      fmt: v => `${fmtNum(Math.round(v))} kg`,
    }, totalReps];
    case 'bodyweight': return [
      {
        key: 'reps', label: 'Max reps', unit: 'reps',
        get(it) { const r = done(it).map(s => num(s.reps)).filter(v => v !== null); return r.length ? { y: Math.max(...r), label: `${Math.max(...r)} reps` } : null; },
        fmt: v => `${fmtNum(v)}`,
      },
      totalReps,
      {
        key: 'load', label: 'Reps × added kg', unit: '',
        get(it) {
          let best = null;
          for (const s of done(it)) {
            const kg = num(s.kg), r = num(s.reps);
            if (!kg || kg <= 0 || !r) continue;
            if (!best || kg * r > best.y) best = { y: kg * r, label: `+${fmtNum(kg)} kg × ${r}` };
          }
          return best;
        },
        fmt: v => fmtNum(v),
      },
    ];
    case 'hold': case 'stretch': return [{
      key: 'hold', label: 'Longest hold', unit: 's',
      get(it) { const t = done(it).map(s => num(s.time)).filter(v => v); return t.length ? { y: Math.max(...t), label: fmtDur(Math.max(...t)) } : null; },
      fmt: v => fmtDur(v),
    }];
    case 'interval': case 'steady': {
      const out = [];
      const m = ex.modality;
      if (m !== 'run') out.push({
        key: 'watts', label: 'Average watts', unit: 'W',
        get(it) { const w = done(it).map(s => num(s.watts)).filter(v => v); const a = avg(w); return a ? { y: a, label: `${Math.round(a)} W` } : null; },
        fmt: v => `${Math.round(v)} W`,
      });
      if (m === 'row' || m === 'ski') out.push({
        key: 'split', label: 'Average split', unit: '/500m', invert: true,
        get(it) { const w = done(it).map(s => num(s.split)).filter(v => v); const a = avg(w); return a ? { y: a, label: `${fmtDur(a)}/500m` } : null; },
        fmt: v => fmtDur(v),
      });
      if (m === 'run') out.push({
        key: 'pace', label: 'Average pace', unit: '/km', invert: true,
        get(it) { const w = done(it).map(s => num(s.pace)).filter(v => v); const a = avg(w); return a ? { y: a, label: `${fmtDur(a)}/km` } : null; },
        fmt: v => fmtDur(v),
      });
      if (ex.type === 'steady') out.push({
        key: 'dist', label: 'Distance', unit: 'km',
        get(it) { const d = done(it).map(s => num(s.dist)).filter(v => v); return d.length ? { y: d[0], label: `${fmtNum(d[0])} km` } : null; },
        fmt: v => `${fmtNum(v)} km`,
      });
      return out;
    }
  }
  return [];
}

// 7-day trailing mean at each entry date; tolerates missing days.
export function rollingMean(entries, days = 7) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const ts = sorted.map(e => new Date(e.date + 'T12:00:00').getTime());
  return sorted.map((e, i) => {
    let sum = 0, n = 0;
    for (let j = i; j >= 0 && ts[i] - ts[j] < days * DAY; j--) { sum += sorted[j].kg; n++; }
    return { x: ts[i], y: sum / n };
  });
}
