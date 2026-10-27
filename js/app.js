import { db } from './db.js';
import { SEED_EXERCISES, SEED_VERSION, MUSCLES, CATEGORIES } from './seed.js';
import { renderChart } from './chart.js';
import {
  uid, esc, DAY, parseDur, fmtDur, fmtLength, localISO, startOfWeek, addDays, fmtDate, fmtTime, num,
  TYPES, MODALITIES, isCardio, fieldsFor, fmtField, summariseSet, setLabel,
  defaultTarget, targetFields, setFromTarget, blocks, estimateSec, metricsFor, rollingMean, setScore,
  prefs, parseField, fmtBody, fmtBodyDelta, toBody, kgFromStLb, weekLetters,
} from './util.js';

const APP_NAME = 'Workout_jfp';
const FILE_PREFIX = 'workout_jfp';
const APP_VERSION = '1.3.3';
const DEFAULT_CFG = { secPerRep: 3, minSetSec: 20, changeoverSec: 60 };
const BACKUP_DAYS = 14;
const THEMES = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const THEME_BG = { light: '#f4f2ed', dark: '#121212' };

// ---------------- State ----------------
const S = { ex: new Map(), routines: [], sessions: [], weights: [], meta: {} };
const UI = {
  exq: '', excat: 'All', exmus: '', exarch: false,
  wrange: '3M', metric: {}, draft: null, exDraft: null, picker: null, menu: null,
  week: null, pday: null, planAdd: false, hview: 'month', hcur: Date.now(), hday: null,
  upd: {}, sheet: null, freshInstall: false,
};

// Shown once after updating to this version (and from Settings → What's new).
const WHATS_NEW = [
  ['➕', '270+ new exercises', 'Including swimming, hiking, boxing and other cardio, plus a new red Rehab category for isometric holds.'],
  ['📏', 'Your units', 'Choose kg or lb for lifting, kg, lb or stone for bodyweight, km or miles for distance, and whether weeks start on Monday or Sunday. Find them in Settings → Units.'],
  ['🗓️', 'Add to Calendar fixed', 'Add week to Calendar opens your Calendar app again in one tap. Routines are added as all-day events; set times in your calendar if you want them.'],
  ['🆕', 'New exercises while building', 'Create an exercise from the Add exercises list. Names that already exist are flagged.'],
  ['💬', 'Clearer choices', 'Pop-ups now say what each button does. For example, finishing a changed routine lets you update it, save it as a new routine, or keep the change as a one-off.'],
];
const cfg = () => ({ ...DEFAULT_CFG, ...(S.meta.settings || {}) });
const setSettings = patch => setMeta('settings', { ...(S.meta.settings || {}), ...patch });
// Copy unit / week-start settings into util's prefs, which formatting and parsing read.
function applyPrefs() {
  const u = cfg().units || {};
  prefs.load = u.load === 'lb' ? 'lb' : 'kg';
  prefs.body = ['lb', 'st'].includes(u.body) ? u.body : 'kg';
  prefs.dist = u.dist === 'mi' ? 'mi' : 'km';
  prefs.weekStart = cfg().weekStart === 'sun' ? 0 : 1;
}

// ---------------- Dialogs ----------------
// In-app replacement for confirm/alert with buttons that say what they do.
// buttons: [{ label, value, style: 'primary' | 'ghost' | 'danger', needsText }]
// input: { value, placeholder } adds a text field; the result is then { value, text }.
// Resolves to the chosen value, or null if dismissed by tapping outside.
function ask({ title, message = '', buttons, input = null }) {
  return new Promise(resolve => {
    const el = document.getElementById('dialog');
    el.innerHTML = `<div class="scrim" data-dlg="x"></div>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t">
        <h3 id="dlg-t">${esc(title)}</h3>
        ${message ? `<p class="dlg-msg">${esc(message)}</p>` : ''}
        ${input ? `<input class="in" id="dlg-in" maxlength="60" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}">` : ''}
        <div class="dlg-btns">${buttons.map((b, i) => `<button class="btn ${b.style === 'danger' ? 'danger' : b.style === 'primary' ? '' : 'ghost'}" data-dlg="${i}">${esc(b.label)}</button>`).join('')}</div>
      </div>`;
    el.classList.add('open'); document.body.classList.add('noscroll');
    const inp = el.querySelector('#dlg-in');
    if (inp) setTimeout(() => { inp.focus(); inp.select(); }, 50);
    const finish = v => {
      el.removeEventListener('click', onClick);
      el.classList.remove('open'); el.innerHTML = '';
      if (!document.querySelector('#sheet.open')) document.body.classList.remove('noscroll');
      resolve(v);
    };
    const onClick = ev => {
      const b = ev.target.closest('[data-dlg]'); if (!b) return;
      ev.preventDefault(); ev.stopPropagation();
      if (b.dataset.dlg === 'x') return finish(null);
      const btn = buttons[+b.dataset.dlg];
      if (inp && btn.needsText && !inp.value.trim()) { inp.focus(); return; }
      finish(inp ? { value: btn.value, text: inp.value.trim() } : btn.value);
    };
    el.addEventListener('click', onClick);
  });
}
// Information only: one button.
const tell = (title, message = '') => ask({ title, message, buttons: [{ label: 'Got it', value: true, style: 'primary' }] });
// Yes/no with explicit labels; resolves true only for the first button.
const sure = async (title, message, yes, no = 'Cancel', danger = true) =>
  await ask({ title, message, buttons: [{ label: yes, value: true, style: danger ? 'danger' : 'primary' }, { label: no, value: false }] }) === true;
// Weekly plan, stored in meta 'plan': { 'YYYY-MM-DD': [{ id, routineId }] }
const plan = () => S.meta.plan || {};
const savePlan = p => setMeta('plan', p);
const exList = () => [...S.ex.values()].sort((a, b) => a.name.localeCompare(b.name));
const sessionsDesc = () => [...S.sessions].sort((a, b) => b.start - a.start);

// ---------------- Persistence ----------------
const timers = {};
const debounce = (key, fn, ms = 250) => { clearTimeout(timers[key]); timers[key] = setTimeout(fn, ms); };
const setMeta = (key, value) => { S.meta[key] = value; return value === undefined ? db.del('meta', key) : db.put('meta', { key, value }); };
const saveActive = () => debounce('active', () => setMeta('active', S.meta.active));
const putEx = ex => { S.ex.set(ex.id, ex); return db.put('exercises', ex); };
const putRoutine = r => { const i = S.routines.findIndex(x => x.id === r.id); if (i < 0) S.routines.push(r); else S.routines[i] = r; return db.put('routines', r); };
const saveRoutineSoon = r => debounce('rt' + r.id, () => putRoutine(r));
const putSession = s => { const i = S.sessions.findIndex(x => x.id === s.id); if (i < 0) S.sessions.push(s); else S.sessions[i] = s; return db.put('sessions', s); };

async function loadAll() {
  const [ex, routines, sessions, weights, meta] = await Promise.all(
    ['exercises', 'routines', 'sessions', 'weights', 'meta'].map(s => db.all(s)));
  S.ex = new Map(ex.map(e => [e.id, e]));
  S.routines = routines.sort((a, b) => (a.created || 0) - (b.created || 0));
  S.sessions = sessions; S.weights = weights;
  S.meta = Object.fromEntries(meta.map(m => [m.key, m.value]));
  UI.freshInstall = !S.meta.firstUse;
  const seedEx = ({ since, ...e }) => putEx({ id: uid(), archived: false, custom: false, modality: null, perSide: false, ...e });
  if (!S.ex.size && !S.meta.seeded) {
    for (const e of SEED_EXERCISES) await seedEx(e);
    await setMeta('seeded', true);
    await setMeta('seedVersion', SEED_VERSION);
  } else if ((S.meta.seedVersion || 1) < SEED_VERSION) {
    // Migration: add library exercises introduced after this install was seeded, skipping names that exist.
    const have = new Set([...S.ex.values()].map(e => e.name.trim().toLowerCase()));
    for (const e of SEED_EXERCISES) {
      if ((e.since || 1) > (S.meta.seedVersion || 1) && !have.has(e.name.toLowerCase())) await seedEx(e);
    }
    await setMeta('seedVersion', SEED_VERSION);
  }
  if (!S.meta.firstUse) await setMeta('firstUse', Date.now());
}

// ---------------- Queries ----------------
function lastPerf(exId, excludeId) {
  for (const s of sessionsDesc()) {
    if (s.id === excludeId) continue;
    const it = s.items.find(i => i.exId === exId && i.sets.some(x => x.done !== false));
    if (it) return { session: s, item: it, sets: it.sets.filter(x => x.done !== false) };
  }
  return null;
}
const usage = exId => S.sessions.filter(s => s.items.some(i => i.exId === exId)).length;
const routineLastDone = rid => sessionsDesc().find(s => s.routineId === rid);
function sessionsByDay() {
  const m = new Map();
  for (const s of sessionsDesc()) {
    const k = localISO(new Date(s.start));
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s);
  }
  return m;
}
// Pair each planned entry with a session of the same routine that day; the rest are unplanned extras.
function planStatus(entries, sessions) {
  const left = [...sessions];
  const out = entries.map(e => {
    const i = left.findIndex(s => s.routineId && s.routineId === e.routineId);
    return { ...e, session: i < 0 ? null : left.splice(i, 1)[0] };
  });
  return { entries: out, extra: left };
}
// ---------------- Personal records ----------------
const bodyweight = () => [...S.weights].sort((a, b) => b.date.localeCompare(a.date))[0]?.kg || 75;
// Best-ever set per exercise, once it has been logged in 2+ sessions: Map exId -> { v, setId, sessionId }.
// Earliest set wins a tie. excludeId leaves one session out (the live one).
function prIndex(excludeId, minSessions = 2) {
  const bw = bodyweight();
  const best = new Map(), seen = new Map();
  for (const s of [...S.sessions].sort((a, b) => a.start - b.start)) {
    if (s.id === excludeId) continue;
    for (const it of s.items) {
      const ex = S.ex.get(it.exId); if (!ex) continue;
      if (!seen.has(ex.id)) seen.set(ex.id, new Set());
      seen.get(ex.id).add(s.id);
      for (const st of it.sets) {
        if (st.done === false) continue;
        const v = setScore(ex, st, bw);
        if (v !== null && v > (best.get(ex.id)?.v ?? -Infinity)) best.set(ex.id, { v, setId: st.id, sessionId: s.id });
      }
    }
  }
  for (const id of [...best.keys()]) if (seen.get(id).size < minSessions) best.delete(id);
  return best;
}

// ---------------- Categories & colours ----------------
// Built-in categories plus any the user added in Settings (settings.customCats).
const cats = () => [...new Set([...CATEGORIES, ...(cfg().customCats || [])])];
const DEFAULT_CAT_HEX = { Strength: '#e2531c', Calisthenics: '#2f6fd6', Stretch: '#8a5cc7', Cardio: '#14968a', Rehab: '#d42a2a' };
const CUSTOM_HEX = ['#d4a017', '#c2378a', '#5b8c2a', '#0f7fbf', '#7a6a58'];
const customHex = c => CUSTOM_HEX[Math.max(0, (cfg().customCats || []).indexOf(c)) % CUSTOM_HEX.length];
// Hex for the colour picker; overrides live in settings.catColors.
const catHex = c => cfg().catColors?.[c] || DEFAULT_CAT_HEX[c] || customHex(c);
// CSS colour: built-ins without an override use the theme-aware tokens.
const catColor = c => cfg().catColors?.[c]
  || (CATEGORIES.includes(c) ? `var(--cat-${c.toLowerCase()})` : cats().includes(c) ? customHex(c) : 'var(--ink-3)');
const catDot = c => `<i class="cd" style="background:${catColor(c)}" aria-hidden="true"></i>`;
const exDot = ex => ex?.category ? catDot(ex.category) : '';
function catCounts(items) {
  const n = {};
  for (const it of items) { const c = S.ex.get(it.exId)?.category; if (c) n[c] = (n[c] || 0) + 1; }
  return n;
}
// One dot per category in a list of items, most-used first.
function catDotsFor(items) {
  const n = catCounts(items); const order = cats();
  const list = Object.keys(n).sort((a, b) => n[b] - n[a] || order.indexOf(a) - order.indexOf(b));
  return list.length ? list.map(catDot).join('') : catDot('');
}
const catDots = ss => catDotsFor(ss.flatMap(s => s.items));

// Training load for the History shading: minutes × effort (unrated sessions count as 3).
const sessionLoad = s => ((s.end ? s.end - s.start : (s.estSec || 0) * 1000) / 60000) * (s.effort || 3);
const dayLoad = ss => ss.reduce((t, s) => t + sessionLoad(s), 0);
// Reference "hard day": the biggest daily load in the last 90 days (at least 45 min at effort 3).
function heatRef(byDay) {
  const from = localISO(addDays(new Date(), -90));
  let max = 135;
  for (const [iso, ss] of byDay) if (iso >= from) max = Math.max(max, dayLoad(ss));
  return max;
}
// 0–100 shade for a day; sqrt spreads the lighter end so short sessions still show.
const heat = (ss, ref) => ss ? Math.round(Math.min(1, Math.sqrt(dayLoad(ss) / ref)) * 100) : 0;
const backupDue = () => (S.sessions.length || S.weights.length) &&
  Date.now() - (S.meta.lastBackup || S.meta.firstUse || Date.now()) > BACKUP_DAYS * DAY;

// Items -> estimate input
const routineEst = r => estimateSec(r.items, S.ex, cfg());
const sessionEst = s => estimateSec(s.items.map(it => ({
  exId: it.exId, group: it.group, target: { ...it.target, sets: it.sets.length, rest: it.rest },
})), S.ex, cfg());

// Block letters A, B, C… and member labels A1, A2
function labelsFor(items) {
  const map = {};
  blocks(items).forEach((b, bi) => {
    const L = String.fromCharCode(65 + (bi % 26));
    b.items.forEach((it, mi) => { map[it.uid] = b.items.length > 1 ? `${L}${mi + 1}` : L; });
  });
  return map;
}

// Move the whole block containing uid up/down past the neighbouring block.
function moveBlock(items, id, dir) {
  const bl = blocks(items);
  const i = bl.findIndex(b => b.items.some(it => it.uid === id));
  const j = i + dir;
  if (i < 0 || j < 0 || j >= bl.length) return items;
  [bl[i], bl[j]] = [bl[j], bl[i]];
  return bl.flatMap(b => b.items);
}
function pairWithNext(items, id) {
  const bl = blocks(items);
  const i = bl.findIndex(b => b.items.some(it => it.uid === id));
  if (i < 0 || i + 1 >= bl.length) return;
  const g = bl[i].group || uid();
  const rest = Math.max(...[...bl[i].items, ...bl[i + 1].items].map(it => num(it.rest ?? it.target?.rest) || 0));
  for (const it of [...bl[i].items, ...bl[i + 1].items]) {
    it.group = g;
    if ('rest' in it) it.rest = rest; else it.target.rest = rest;
  }
}
function unpair(items, id) {
  const idx = items.findIndex(it => it.uid === id);
  const it = items[idx]; const g = it.group;
  if (!g) return items;
  const members = items.filter(x => x.group === g);
  const others = items.filter(x => x.uid !== id);
  it.group = null;
  const lastIdx = others.map(x => x.group).lastIndexOf(g);
  others.splice(lastIdx + 1, 0, it);
  if (members.length === 2) members.forEach(m => { m.group = null; });
  return others;
}

// A superset left with one member is no longer a superset.
function tidyGroups(items) {
  for (const b of blocks(items)) if (b.items.length === 1) b.items[0].group = null;
}

// ---------------- Session construction ----------------
function newSessionItem(ex, target, group = null) {
  const t = { ...defaultTarget(ex), ...(target || {}) };
  const last = lastPerf(ex.id);
  const keys = fieldsFor(ex).map(f => f.key);
  const n = Math.max(1, Math.round(num(t.sets) || 1));
  const sets = [];
  for (let i = 0; i < n; i++) {
    const src = last ? last.sets[Math.min(i, last.sets.length - 1)] : setFromTarget(ex, t);
    const s = { id: uid(), done: false, touched: false };
    for (const k of keys) s[k] = src[k] ?? null;
    sets.push(s);
  }
  return { uid: uid(), exId: ex.id, group, target: t, rest: num(t.rest) || 0, note: '', sets };
}

async function startSession(routineId) {
  if (S.meta.active) {
    const a = S.meta.active;
    const choice = await ask({
      title: 'A session is already in progress',
      message: `“${a.name}” started at ${fmtTime(a.start)} and hasn’t been finished.`,
      buttons: [
        { label: `Go back to “${a.name}”`, value: 'resume', style: 'primary' },
        { label: 'Discard it and start the new one', value: 'discard', style: 'danger' },
        { label: 'Cancel', value: null },
      ],
    });
    if (choice === 'resume') return go('session');
    if (choice !== 'discard') return;
  }
  const r = S.routines.find(x => x.id === routineId);
  const sess = {
    id: uid(), routineId: r?.id || null, name: r?.name || 'Workout', start: Date.now(), end: null, note: '',
    items: (r?.items || []).filter(it => S.ex.get(it.exId)).map(it => newSessionItem(S.ex.get(it.exId), it.target, it.group)),
  };
  S.meta.active = sess; setMeta('active', sess);
  go('session');
}

const signature = items => {
  const lab = labelsFor(items);
  return JSON.stringify(items.map(it => [it.exId, lab[it.uid], it.sets ? it.sets.length : num(it.target.sets),
    num(it.target.reps), num(it.target.time), num(it.rest ?? it.target.rest)]));
};

async function finishSession() {
  const sess = S.meta.active;
  const doneCount = sess.items.reduce((n, it) => n + it.sets.filter(s => s.done).length, 0);
  if (!doneCount) {
    const c = await ask({
      title: 'Nothing to save yet',
      message: 'No sets are ticked. Tick the sets you did, or discard this session.',
      buttons: [{ label: 'Keep logging', value: false, style: 'primary' }, { label: 'Discard session', value: true, style: 'danger' }],
    });
    if (c === true) await discardSession(true);
    return;
  }
  const undone = sess.items.reduce((n, it) => n + it.sets.filter(s => !s.done).length, 0);
  const dropNote = undone ? `${undone} unticked set${undone === 1 ? '' : 's'} will be left out.` : '';
  const r = sess.routineId && S.routines.find(x => x.id === sess.routineId);
  const asRoutine = sess.items.map(it => ({ uid: it.uid, exId: it.exId, group: it.group, target: { ...it.target, sets: it.sets.length, rest: it.rest } }));
  const changed = r && signature(asRoutine) !== signature(r.items);
  const choice = changed
    ? await ask({
      title: `You changed “${r.name}”`,
      message: `This session differs from the routine (exercises, order, sets or targets). How should it be saved?${dropNote ? '\n\n' + dropNote : ''}`,
      buttons: [
        { label: `Update “${r.name}” going forward`, value: 'update', style: 'primary' },
        { label: 'Save as a new routine…', value: 'new' },
        { label: 'Just this once (routines stay as they are)', value: 'once' },
        { label: 'Keep logging', value: null },
      ],
    })
    : await ask({
      title: 'Finish and save this session?',
      message: dropNote || 'Everything you ticked will be saved to History.',
      buttons: [
        { label: 'Finish and save', value: 'once', style: 'primary' },
        ...(r ? [] : [{ label: 'Finish and save as a routine…', value: 'new' }]),
        { label: 'Keep logging', value: null },
      ],
    });
  if (!choice) return;
  let saveMsg = 'Session saved';
  if (choice === 'update') {
    r.items = asRoutine.map(it => ({ ...it, uid: uid() }));
    await putRoutine(r);
    saveMsg = `Session saved · “${r.name}” updated`;
  }
  if (choice === 'new') {
    const res = await ask({
      title: 'Name the new routine',
      message: r ? `“${r.name}” stays as it was. The new routine appears on Train.` : 'It appears on Train, ready to start next time.',
      input: { value: r ? `${r.name} (variation)` : (sess.name === 'Workout' ? '' : sess.name), placeholder: 'e.g. Upper body B' },
      buttons: [{ label: 'Save routine and finish', value: 'save', style: 'primary', needsText: true }, { label: 'Back', value: null }],
    });
    if (!res || res.value !== 'save') return finishSession();
    const nr = { id: uid(), name: res.text, created: Date.now(), items: asRoutine.map(it => ({ ...it, uid: uid() })) };
    tidyGroups(nr.items);
    await putRoutine(nr);
    // A routine-less session now belongs to its new routine; a changed routine's session stays
    // linked to the original so the week plan still counts it as done.
    if (!r) { sess.routineId = nr.id; sess.name = nr.name; }
    saveMsg = `Session saved · new routine “${nr.name}”`;
  }
  const estSec = sessionEst(sess);
  const saved = {
    ...sess, end: Date.now(), estSec,
    items: sess.items.map(it => ({ ...it, sets: it.sets.filter(s => s.done).map(({ touched, ...s }) => s) }))
      .filter(it => it.sets.length),
  };
  tidyGroups(saved.items);
  await putSession(saved);
  await setMeta('active', undefined);
  try { navigator.storage?.persist?.(); } catch { }
  toast(saveMsg);
  location.replace('#/history/' + saved.id);
}
async function discardSession(skipConfirm) {
  if (!skipConfirm && !await sure('Discard this session?', 'Nothing from it will be saved, including ticked sets.', 'Discard session', 'Keep logging')) return;
  clearTimeout(timers.active);
  await setMeta('active', undefined);
  go('train');
}

// ---------------- Router ----------------
const main = () => document.getElementById('main');
function go(path) { if (location.hash === '#/' + path) render(); else location.hash = '#/' + path; }
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || 'train', id: parts[1], sub: parts[2] };
}
const VIEWS = {
  train: () => trainView(), routine: r => routineView(r.id), session: () => liveSessionView(),
  history: r => r.id ? (r.sub === 'edit' ? editSessionView(r.id) : sessionDetailView(r.id)) : historyView(),
  exercises: () => exercisesView(), exercise: r => exerciseDetailView(r.id), 'exercise-edit': r => exerciseEditView(r.id),
  weight: () => weightView(), settings: () => settingsView(),
};
const TAB = { train: 'train', routine: 'train', session: 'train', history: 'history', exercises: 'exercises', exercise: 'exercises', 'exercise-edit': 'exercises', weight: 'weight', settings: 'settings' };

let mounts = [];
const onMount = fn => mounts.push(fn);
function render(keepScroll = false) {
  const y = window.scrollY;
  const r = route();
  mounts = [];
  const view = VIEWS[r.name] || VIEWS.train;
  main().innerHTML = view(r);
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === (TAB[r.name] || 'train')));
  mounts.forEach(fn => fn());
  if (keepScroll) window.scrollTo(0, y);
}
const rerender = () => render(true);
window.addEventListener('hashchange', () => {
  UI.menu = null;
  // Leaving the exercise form drops its unsaved draft and any "add to routine" hand-off.
  if (route().name !== 'exercise-edit') { UI.exDraft = null; UI.newEx = null; }
  render(); window.scrollTo(0, 0);
});

// ---------------- Shared bits ----------------
const header = (title, { back, right = '' } = {}) => `
  <header class="top">
    ${back ? `<a class="back" href="${back}" aria-label="Back">‹</a>` : ''}
    <h1>${esc(title)}</h1>
    <div class="top-r">${right}</div>
  </header>`;
const backupBanner = () => backupDue() ? `
  <div class="banner">
    <div><b>Back up your data.</b> It's been over ${BACKUP_DAYS} days, and everything lives only on this phone.</div>
    <button class="btn sm" data-act="exportJSON">Back up</button>
  </div>` : '';
const typeTag = ex => `<span class="tag">${esc(TYPES[ex.type])}${ex.modality ? ' · ' + esc(MODALITIES[ex.modality]) : ''}${ex.perSide ? ' · per side' : ''}</span>`;

function toast(msg, action) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-act="${action.act}">${esc(action.label)}</button>` : ''}`;
  t.classList.add('show');
  clearTimeout(timers.toast);
  if (!action) timers.toast = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------------- Train ----------------
function trainView() {
  const a = S.meta.active;
  const routines = S.routines.map(r => {
    const last = routineLastDone(r.id);
    const n = r.items.length;
    return `
      <div class="card routine">
        <a class="routine-main" href="#/routine/${r.id}">
          <div class="routine-name">${esc(r.name)}${n ? `<span class="rdots">${catDotsFor(r.items)}</span>` : ''}</div>
          <div class="muted">${n} exercise${n === 1 ? '' : 's'} · ~${fmtLength(routineEst(r))}${last ? ' · last ' + fmtDate(last.start, { day: 'numeric', month: 'short' }) : ''}</div>
        </a>
        <button class="btn" data-act="start" data-id="${r.id}" ${n ? '' : 'disabled'}>Start</button>
      </div>`;
  }).join('');
  return `
    ${header('Train')}
    ${backupBanner()}
    ${a ? `<a class="card live" href="#/session">
        <div><div class="eyebrow">In progress</div><div class="routine-name">${esc(a.name)}</div>
        <div class="muted">Started ${fmtTime(a.start)} · <span data-elapsed="${a.start}">${fmtLength(Date.now() - a.start > 0 ? (Date.now() - a.start) / 1000 : 0)}</span></div></div>
        <span class="btn">Resume</span></a>` : ''}
    ${weekHtml()}
    <section>
      <div class="sec-h"><h2>Routines</h2><button class="link" data-act="newRoutine">+ New routine</button></div>
      ${routines || `<div class="empty">No routines yet. Create one, e.g. “Pull day” or “Evening stretch”, and pick its exercises.</div>`}
    </section>
    <button class="btn ghost wide" data-act="start" data-id="">Start an empty session</button>`;
}

const curMonday = () => startOfWeek(UI.week ? new Date(UI.week) : new Date());
const weekIsos = mon => [...Array(7)].map((_, i) => localISO(addDays(mon, i)));
const longDay = iso => fmtDate(new Date(iso + 'T12:00:00'), { weekday: 'long', day: 'numeric', month: 'long' });

function weekHtml() {
  const today = localISO();
  const mon = curMonday();
  const isos = weekIsos(mon);
  const sel = isos.includes(UI.pday) ? UI.pday : isos.includes(today) ? today : isos[0];
  const byDay = sessionsByDay();
  const p = plan();
  const st = Object.fromEntries(isos.map(iso => [iso, planStatus(p[iso] || [], byDay.get(iso) || [])]));
  const thisWeek = isos.includes(today);
  const label = thisWeek ? 'This week'
    : `${fmtDate(mon, { day: 'numeric', month: 'short' })} – ${fmtDate(addDays(mon, 6), { day: 'numeric', month: 'short' })}`;
  const strip = isos.map(iso => {
    const d = new Date(iso + 'T12:00:00');
    const { entries, extra } = st[iso];
    const pips = [...entries.map(e => e.session ? 'done' : iso < today ? 'missed' : ''), ...extra.map(() => 'done')]
      .slice(0, 4).map(c => `<i class="pip ${c}"></i>`).join('');
    return `<button class="wday${iso === sel ? ' on' : ''}${iso === today ? ' today' : ''}" data-act="pday" data-v="${iso}">
      <span>${fmtDate(d, { weekday: 'short' })}</span><b>${d.getDate()}</b><span class="pips">${pips}</span></button>`;
  }).join('');
  const doneRow = s => `<a class="plan-row" href="#/history/${s.id}"><span class="pchk">✓</span>
    <span class="grow"><span class="item-name">${esc(s.name)}</span><span class="muted">${s.end ? 'Done · ' + fmtLength((s.end - s.start) / 1000) : 'Done'}</span></span><span class="chev">›</span></a>`;
  const { entries, extra } = st[sel];
  const rows = [
    ...entries.map(e => {
      if (e.session) return doneRow(e.session);
      const r = S.routines.find(x => x.id === e.routineId);
      return `<div class="plan-row"><span class="pchk"><i class="pip ${sel < today ? 'missed' : ''}"></i></span>
        ${r ? `<a class="grow" href="#/routine/${r.id}"><span class="item-name">${esc(r.name)}<span class="rdots">${catDotsFor(r.items)}</span></span><span class="muted">~${fmtLength(routineEst(r))}</span></a>`
          : `<span class="grow muted">Deleted routine</span>`}
        ${r && sel === today && r.items.length ? `<button class="btn sm" data-act="start" data-id="${r.id}">Start</button>` : ''}
        <button class="icon" data-act="planDel" data-v="${sel}" data-id="${e.id}" aria-label="Remove from plan">✕</button></div>`;
    }),
    ...extra.map(doneRow),
  ].join('');
  const add = UI.planAdd
    ? `<div class="chips">${S.routines.map(r => `<button class="chip" data-act="planAdd" data-v="${sel}" data-id="${r.id}">${esc(r.name)}</button>`).join('')
      || '<span class="muted">Create a routine first.</span>'}<button class="chip" data-act="planAddToggle">Cancel</button></div>`
    : `<button class="link" data-act="planAddToggle">+ Plan a routine</button>`;
  return `<section>
    <div class="sec-h"><h2>${label}</h2><div class="wnav">
      <button class="icon" data-act="wk" data-v="-1" aria-label="Previous week">‹</button>
      ${thisWeek ? '' : '<button class="link" data-act="wk" data-v="0">Today</button>'}
      <button class="icon" data-act="wk" data-v="1" aria-label="Next week">›</button></div></div>
    <div class="week">${strip}</div>
    <div class="card plan-day">
      <div class="muted">${longDay(sel)}</div>
      ${rows || '<div class="muted plan-empty">Nothing planned.</div>'}
      ${add}
    </div>
    <div class="plan-actions">
      <button class="link" data-act="planCopy">Copy last week</button>
      ${icsLink()}
    </div>
  </section>`;
}

async function copyLastWeek() {
  const mon = curMonday();
  const src = weekIsos(addDays(mon, -7)), dst = weekIsos(mon);
  const p = { ...plan() };
  const n = src.reduce((k, iso) => k + (p[iso]?.length || 0), 0);
  if (!n) return toast('Last week has no plan to copy');
  if (dst.some(iso => p[iso]?.length) && !await sure('This week already has a plan', 'Copying replaces it with last week’s plan.', 'Replace with last week’s plan', 'Keep this week’s plan')) return;
  dst.forEach((iso, i) => {
    const e = (p[src[i]] || []).map(x => ({ id: uid(), routineId: x.routineId }));
    if (e.length) p[iso] = e; else delete p[iso];
  });
  savePlan(p); toast(`Copied ${n} planned session${n === 1 ? '' : 's'}`); rerender();
}

// One-way export of the visible week's plan as all-day events; times are set in the calendar app.
const icsText = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsFold = line => { let out = ''; while (line.length > 74) { out += line.slice(0, 74) + '\r\n '; line = line.slice(74); } return out + line; };
function buildWeekIcs() {
  const mon = curMonday();
  const p = plan();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [];
  for (const iso of weekIsos(mon)) {
    const next = localISO(addDays(new Date(iso + 'T12:00:00'), 1));
    for (const e of p[iso] || []) {
      const r = S.routines.find(x => x.id === e.routineId);
      if (!r) continue;
      const exNames = r.items.map(it => S.ex.get(it.exId)?.name).filter(Boolean);
      lines.push('BEGIN:VEVENT', `UID:${e.id}@workout-jfp`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${iso.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${next.replace(/-/g, '')}`, 'TRANSP:TRANSPARENT',
        `SUMMARY:${icsText(r.name)}`, `DESCRIPTION:${icsText([`~${fmtLength(routineEst(r))}`, ...exNames].join('\n'))}`, 'END:VEVENT');
    }
  }
  if (!lines.length) return null;
  const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${APP_NAME}//EN`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...lines, 'END:VCALENDAR']
    .map(icsFold).join('\r\n') + '\r\n';
  return { name: `${FILE_PREFIX}-week-${localISO(mon)}.ics`, text };
}
// "Add week to Calendar" is a plain link to a .ics file held in the local cache, which the service
// worker serves as text/calendar: iOS then shows its "Add events" screen and Android hands it to a
// calendar app. Nothing leaves the phone.
//  - The file is written when the Train tab renders, so the tap itself is an ordinary link tap with
//    no waiting in between (iOS only reliably opens files from a direct tap).
//  - Each version of the week's plan gets its own address, so the phone never reuses an older copy.
//  - Without a service worker (a plain browser tab on a computer) the tap falls back to a download.
const ICS_CACHE = `${FILE_PREFIX}-export`;
const strHash = t => { let h = 5381; for (let i = 0; i < t.length; i++) h = (h * 33 ^ t.charCodeAt(i)) >>> 0; return h.toString(36); };
const icsUrl = ics => `./export/${ics.name.replace(/\.ics$/, '')}-${strHash(ics.text)}.ics`;
async function cacheIcs(ics, url) {
  if (!('caches' in window)) return false;
  const cache = await caches.open(ICS_CACHE);
  const full = new URL(url, location.href).href;
  for (const k of await cache.keys()) if (k.url !== full) await cache.delete(k);
  if (!(await cache.match(full))) await cache.put(full, new Response(ics.text, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `inline; filename="${ics.name}"` },
  }));
  UI.icsReady = url;
  return true;
}
function icsLink() {
  const ics = buildWeekIcs();
  if (!ics) return `<button class="link" data-act="planIcs">Add week to Calendar</button>`;
  const url = icsUrl(ics);
  if (UI.icsReady !== url) onMount(() => { cacheIcs(ics, url).catch(() => { }); });
  return `<a class="link" href="${url}" data-act="planIcs" data-v="${url}">Add week to Calendar</a>`;
}
function calExport(d, ev) {
  if (!d.v) return toast('Nothing planned this week');
  const ics = buildWeekIcs();
  if (!ics) { ev.preventDefault(); return toast('Nothing planned this week'); }
  if (!navigator.serviceWorker?.controller) { ev.preventDefault(); return deliver(ics.name, ics.text, 'text/calendar'); }
  if (UI.icsReady === d.v) return;   // let the link open normally
  // Not cached yet (tapped straight after a change): write it, then open it.
  ev.preventDefault();
  cacheIcs(ics, d.v).then(() => { location.href = d.v; }).catch(() => deliver(ics.name, ics.text, 'text/calendar'));
}

// ---------------- Routine editor ----------------
function routineView(id) {
  const r = S.routines.find(x => x.id === id);
  if (!r) return header('Routine', { back: '#/train' }) + `<div class="empty">This routine no longer exists.</div>`;
  const lab = labelsFor(r.items);
  const body = blocks(r.items).map(b => {
    const inner = b.items.map(it => routineItemHtml(r, it, lab, b.items.length > 1)).join('');
    if (b.items.length < 2) return inner;
    const rest = Math.max(...b.items.map(it => num(it.target.rest) || 0));
    return `<div class="superset">
      <div class="ss-h"><span class="eyebrow">Superset</span>
        <label class="inline">Rest after each round <input class="in sm" inputmode="decimal" data-in="rtGroupRest" data-rid="${r.id}" data-group="${b.group}" data-kind="dur" value="${fmtDur(rest)}"></label></div>
      ${inner}</div>`;
  }).join('');
  return `
    ${header('Routine', { back: '#/train', right: `<button class="btn sm" data-act="start" data-id="${r.id}" ${r.items.length ? '' : 'disabled'}>Start</button>` })}
    <input class="title-in" data-in="rtName" data-rid="${r.id}" value="${esc(r.name)}" placeholder="Routine name" aria-label="Routine name">
    <div class="est"><span class="muted">Estimated length</span> <b id="est">~${fmtLength(routineEst(r))}</b></div>
    ${body || `<div class="empty">Add the exercises for this routine. Targets and rest are set per exercise.</div>`}
    <div class="two add-two">
      <button class="btn ghost" data-act="pickForRoutine" data-rid="${r.id}">+ Add exercises</button>
      <button class="btn ghost" data-act="newExForRoutine" data-rid="${r.id}">+ New exercise</button>
    </div>
    <button class="btn wide" data-act="saveRoutine" data-rid="${r.id}">Save routine</button>
    <p class="muted center">Changes save as you go. Start it any time from Train.</p>
    <div class="danger-zone"><button class="link danger" data-act="deleteRoutine" data-rid="${r.id}">Delete routine</button></div>`;
}

function routineItemHtml(r, it, lab, inGroup) {
  const ex = S.ex.get(it.exId);
  if (!ex) return '';
  const fields = targetFields(ex).filter(f => !(inGroup && f.key === 'rest'));
  const open = UI.menu === it.uid;
  return `
    <div class="card item">
      <div class="item-h">
        <span class="badge">${lab[it.uid]}</span>
        <div class="item-t"><div class="item-name">${exDot(ex)}${esc(ex.name)}</div>${typeTag(ex)}</div>
        <button class="icon" data-act="menu" data-uid="${it.uid}" aria-label="Options">⋯</button>
      </div>
      ${open ? itemMenu('rt', r.id, it, r.items) : ''}
      <div class="targets">
        ${fields.map(f => `<label class="tf"><span>${f.label}</span>
          <input class="in" inputmode="decimal" data-in="rt" data-rid="${r.id}" data-uid="${it.uid}" data-key="${f.key}" data-kind="${f.kind}" ${ex.type === 'steady' && f.key === 'time' ? 'data-plain="min"' : ''}
            value="${esc(f.kind === 'dur' ? fmtDur(it.target[f.key]) : (it.target[f.key] ?? ''))}"></label>`).join('')}
      </div>
    </div>`;
}

function itemMenu(scope, ownerId, it, items) {
  const bl = blocks(items);
  const bi = bl.findIndex(b => b.items.some(x => x.uid === it.uid));
  const canPair = bi < bl.length - 1;
  const a = (act, label, extra = '') => `<button class="chip" data-act="${act}" data-scope="${scope}" data-owner="${ownerId}" data-uid="${it.uid}" ${extra}>${label}</button>`;
  return `<div class="menu">
    ${a('itemUp', '↑ Move up', bi === 0 ? 'disabled' : '')}
    ${a('itemDown', '↓ Move down', bi === bl.length - 1 ? 'disabled' : '')}
    ${it.group ? a('itemUnpair', 'Unpair') : a('itemPair', 'Superset with next', canPair ? '' : 'disabled')}
    ${a('itemSwap', 'Swap')}
    ${a('itemRemove', 'Remove', 'data-danger="1"')}
  </div>`;
}

// ---------------- Session (live + edit) ----------------
function ctx(mode) {
  return mode === 'live'
    ? { sess: S.meta.active, save: saveActive }
    : { sess: UI.draft, save: () => { } };
}

function liveSessionView() {
  const s = S.meta.active;
  if (!s) return header('Session', { back: '#/train' }) + `<div class="empty">No session in progress.</div>`;
  const totalSets = s.items.reduce((n, it) => n + it.sets.length, 0);
  const doneSets = s.items.reduce((n, it) => n + it.sets.filter(x => x.done).length, 0);
  onMount(() => tickElapsed());
  return `
    ${header('Session', { back: '#/train', right: `<button class="btn sm" data-act="finish">Finish</button>` })}
    <input class="title-in" data-in="sessName" data-mode="live" value="${esc(s.name)}" aria-label="Session name">
    <div class="est">
      <span><span class="muted">Started</span> ${fmtTime(s.start)}</span>
      <span><span class="muted">Elapsed</span> <b data-elapsed="${s.start}">${fmtLength((Date.now() - s.start) / 1000)}</b></span>
      <span><span class="muted">Est.</span> <b id="sest">~${fmtLength(sessionEst(s))}</b></span>
      <span><span class="muted">Sets</span> <b id="sprog">${doneSets}/${totalSets}</b></span>
    </div>
    ${sessionItemsHtml(s, 'live')}
    <button class="btn ghost wide" data-act="pickForSession" data-mode="live">+ Add exercise</button>
    ${effortHtml(s, 'live')}
    <label class="field"><span>Session note</span><textarea class="in" rows="2" data-in="sessNote" data-mode="live" placeholder="How did it go?">${esc(s.note)}</textarea></label>
    <button class="btn wide" data-act="finish">Finish session</button>
    <div class="danger-zone"><button class="link danger" data-act="discard">Discard session</button></div>`;
}

// Optional session effort, 1–5. Tap the selected value again to clear it.
const effortHtml = (s, mode) => `<div class="field"><span>Effort (optional)</span>
  <div class="effort">${[1, 2, 3, 4, 5].map(n => `<button class="chip ${s.effort === n ? 'on' : ''}" data-act="effort" data-mode="${mode}" data-v="${n}" aria-pressed="${s.effort === n}">${n}</button>`).join('')}</div>
  <small class="muted">1 easy · 3 moderate · 5 all-out</small></div>`;

function sessionItemsHtml(s, mode) {
  if (!s.items.length) return `<div class="empty">Add exercises to start logging.</div>`;
  const lab = labelsFor(s.items);
  return blocks(s.items).map(b => {
    const inner = b.items.map(it => sessionItemHtml(s, it, lab, mode, b.items.length > 1)).join('');
    if (b.items.length < 2) return inner;
    const rest = Math.max(...b.items.map(it => num(it.rest) || 0));
    return `<div class="superset">
      <div class="ss-h"><span class="eyebrow">Superset · alternate sets</span>
        ${mode === 'live' ? `<label class="inline">Rest after each round <input class="in sm" inputmode="decimal" data-in="groupRest" data-mode="${mode}" data-group="${b.group}" data-kind="dur" value="${fmtDur(rest)}"></label>` : ''}</div>
      ${inner}</div>`;
  }).join('');
}

function sessionItemHtml(s, it, lab, mode, inGroup) {
  const ex = S.ex.get(it.exId) || { id: it.exId, name: 'Deleted exercise', type: 'weight' };
  const fields = fieldsFor(ex);
  const last = mode === 'live' ? lastPerf(ex.id, s.id) : null;
  const open = UI.menu === it.uid;
  const live = mode === 'live';
  const t = it.target || {};
  const targetTxt = (() => {
    if (ex.type === 'steady') return t.time ? fmtDur(t.time) : '';
    const per = ex.type === 'weight' || ex.type === 'bodyweight' ? (t.reps ?? '') : fmtDur(t.time);
    return per !== '' && per !== undefined ? `${t.sets} × ${per}${ex.perSide ? '/side' : ''}` : '';
  })();
  const rows = it.sets.map((st, i) => `
    <div class="set-row ${st.done ? 'done' : ''}" data-row="${it.uid}:${i}">
      <span class="set-n">${i + 1}</span>
      ${fields.map(f => `<input class="in" inputmode="decimal" aria-label="${setLabel(ex)} ${i + 1} ${f.label}"
        data-in="set" data-mode="${mode}" data-uid="${it.uid}" data-set="${i}" data-key="${f.key}" data-kind="${f.kind}" ${ex.type === 'steady' && f.key === 'time' ? 'data-plain="min"' : ''}
        placeholder="${esc(f.ph ?? '')}" value="${esc(fmtField(f, st[f.key]))}">`).join('')}
      ${live
      ? `<button class="tick" data-act="tick" data-uid="${it.uid}" data-set="${i}" aria-label="Mark ${setLabel(ex).toLowerCase()} ${i + 1} done" aria-pressed="${st.done ? 'true' : 'false'}">✓</button>`
      : `<button class="icon" data-act="delSet" data-mode="${mode}" data-uid="${it.uid}" data-set="${i}" aria-label="Delete set">✕</button>`}
    </div>`).join('');
  return `
    <div class="card item" id="it-${it.uid}">
      <div class="item-h">
        <span class="badge">${lab[it.uid]}</span>
        <div class="item-t"><div class="item-name">${exDot(ex)}${esc(ex.name)}</div>${typeTag(ex)}</div>
        <button class="icon" data-act="menu" data-uid="${it.uid}" aria-label="Options">⋯</button>
      </div>
      ${open ? itemMenu(mode, s.id, it, s.items) : ''}
      ${live ? `<div class="meta-row">
        ${targetTxt ? `<span><span class="muted">Target</span> ${esc(targetTxt)}</span>` : ''}
        ${!inGroup && ex.type !== 'steady' ? `<label class="inline"><span class="muted">Rest</span> <input class="in sm" inputmode="decimal" data-in="itemRest" data-mode="${mode}" data-uid="${it.uid}" data-kind="dur" value="${fmtDur(it.rest)}"></label>` : ''}
      </div>
      <div class="last">${last ? `<span class="muted">Last · ${fmtDate(last.session.start, { day: 'numeric', month: 'short' })}</span> ${last.sets.map(x => esc(summariseSet(ex, x))).join('<span class="sep"> · </span>')}` : `<span class="muted">No previous ${esc(ex.name)} logged</span>`}</div>` : ''}
      <div class="sets" style="--cols:${fields.length}">
        <div class="set-row head"><span>${setLabel(ex) === 'Round' ? 'Rnd' : 'Set'}</span>${fields.map(f => `<span>${esc(f.label)}</span>`).join('')}<span></span></div>
        ${rows}
      </div>
      <div class="item-actions">
        <button class="link" data-act="addSet" data-mode="${mode}" data-uid="${it.uid}">+ Add ${setLabel(ex).toLowerCase()}</button>
        ${live && it.sets.length ? `<button class="link muted" data-act="popSet" data-uid="${it.uid}">− Remove last</button>` : ''}
      </div>
      <textarea class="in note" rows="1" data-in="itemNote" data-mode="${mode}" data-uid="${it.uid}" placeholder="Note">${esc(it.note)}</textarea>
    </div>`;
}

// Flash gold when a ticked set beats the exercise's best from earlier sessions
// (needs at least one earlier session, so the record spans 2+ logs once saved).
function checkLivePr(sess, it, st, row) {
  const ex = S.ex.get(it.exId); if (!ex) return;
  const prev = prIndex(sess.id, 1).get(ex.id); if (!prev) return;
  const bw = bodyweight();
  const v = setScore(ex, st, bw); if (v === null || v <= prev.v) return;
  const others = sess.items.filter(x => x.exId === ex.id).flatMap(x => x.sets).filter(x => x !== st && x.done);
  if (others.some(x => (setScore(ex, x, bw) ?? -Infinity) >= v)) return;
  row?.classList.add('pr-flash');
  toast(`🥇 New personal record: ${summariseSet(ex, st)}`);
}

function tickElapsed() {
  clearInterval(timers.elapsed);
  const upd = () => document.querySelectorAll('[data-elapsed]').forEach(el => { el.textContent = fmtLength((Date.now() - Number(el.dataset.elapsed)) / 1000); });
  timers.elapsed = setInterval(upd, 20000);
}

function updateSessionCounters() {
  const s = S.meta.active; if (!s) return;
  const e = document.getElementById('sest'); if (e) e.textContent = '~' + fmtLength(sessionEst(s));
  const p = document.getElementById('sprog');
  if (p) p.textContent = `${s.items.reduce((n, it) => n + it.sets.filter(x => x.done).length, 0)}/${s.items.reduce((n, it) => n + it.sets.length, 0)}`;
}

// ---------------- History ----------------
// Visible History period [a, b) for the current view.
function histRange() {
  const c = new Date(UI.hcur);
  if (UI.hview === 'week') {
    const a = startOfWeek(c);
    return { a, b: addDays(a, 7), label: `${fmtDate(a, { day: 'numeric', month: 'short' })} – ${fmtDate(addDays(a, 6), { day: 'numeric', month: 'short', year: 'numeric' })}` };
  }
  if (UI.hview === 'year') return { a: new Date(c.getFullYear(), 0, 1), b: new Date(c.getFullYear() + 1, 0, 1), label: String(c.getFullYear()) };
  const a = new Date(c.getFullYear(), c.getMonth(), 1);
  return { a, b: new Date(c.getFullYear(), c.getMonth() + 1, 1), label: fmtDate(a, { month: 'long', year: 'numeric' }) };
}

function historyCalendar(byDay, a, b) {
  const today = localISO();
  const ref = heatRef(byDay);
  const heatStyle = ss => { const h = heat(ss, ref); return ss ? ` style="--h:${h}%"` : ''; };
  if (UI.hview === 'year') {
    const y = a.getFullYear();
    return `<div class="years">${[...Array(12)].map((_, m) => {
      const first = new Date(y, m, 1);
      const lead = (first.getDay() - prefs.weekStart + 7) % 7;
      const len = new Date(y, m + 1, 0).getDate();
      const cells = '<i class="blank"></i>'.repeat(lead) + [...Array(len)].map((_, i) => {
        const ss = byDay.get(localISO(new Date(y, m, i + 1)));
        return ss ? `<i class="hot"${heatStyle(ss)}></i>` : '<i></i>';
      }).join('');
      return `<button class="ymonth" data-act="hmonth" data-v="${m}"><b>${fmtDate(first, { month: 'short' })}</b><span class="ygrid">${cells}</span></button>`;
    }).join('')}</div>`;
  }
  const days = [];
  for (let d = startOfWeek(a); d < b || days.length % 7; d = addDays(d, 1)) days.push(d);
  return `<div class="cal">${weekLetters().map(x => `<span class="cal-h">${x}</span>`).join('')}${days.map(d => {
    const iso = localISO(d); const ss = byDay.get(iso);
    const h = ss ? heat(ss, ref) : 0;
    return `<button class="cday${ss ? ' hot' : ''}${h > 55 ? ' deep' : ''}${d < a || d >= b ? ' out' : ''}${iso === today ? ' today' : ''}${iso === UI.hday ? ' on' : ''}" data-act="hday" data-v="${iso}" ${ss ? heatStyle(ss) : 'disabled'}>
      <span>${d.getDate()}</span><span class="cdots">${ss ? catDots(ss) : ''}</span></button>`;
  }).join('')}</div>`;
}

function historyView() {
  const byDay = sessionsByDay();
  const { a, b, label } = histRange();
  const inRange = sessionsDesc().filter(s => s.start >= a.getTime() && s.start < b.getTime());
  const list = UI.hday ? (byDay.get(UI.hday) || []) : inRange;
  const total = inRange.reduce((t, s) => t + (s.end ? (s.end - s.start) / 1000 : 0), 0);
  const monthHeads = UI.hview === 'year' && !UI.hday;
  let month = '';
  const rows = list.map(s => {
    const m = fmtDate(s.start, { month: 'long', year: 'numeric' });
    const head = monthHeads && m !== month ? `<h3 class="month">${m}</h3>` : '';
    month = m;
    const sets = s.items.reduce((n, it) => n + it.sets.length, 0);
    const dur = s.end ? fmtLength((s.end - s.start) / 1000) : '';
    return `${head}<a class="card row" href="#/history/${s.id}">
      <div class="date"><b>${fmtDate(s.start, { day: 'numeric' })}</b><span>${fmtDate(s.start, { weekday: 'short' })}</span></div>
      <div class="grow"><div class="routine-name">${esc(s.name)}</div>
      <div class="muted">${dur}${s.estSec ? ` (est ${fmtLength(s.estSec)})` : ''} · ${s.items.length} exercise${s.items.length === 1 ? '' : 's'} · ${sets} set${sets === 1 ? '' : 's'}</div></div>
      <span class="chev">›</span></a>`;
  }).join('');
  const n = inRange.length;
  return `${header('History')}${backupBanner()}
    <div class="chips">${['week', 'month', 'year'].map(v => `<button class="chip ${UI.hview === v ? 'on' : ''}" data-act="hview" data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
    <div class="sec-h"><h2>${esc(label)}</h2><div class="wnav">
      <button class="icon" data-act="hnav" data-v="-1" aria-label="Previous">‹</button>
      <button class="link" data-act="hnav" data-v="0">Today</button>
      <button class="icon" data-act="hnav" data-v="1" aria-label="Next">›</button></div></div>
    <div class="card">${historyCalendar(byDay, a, b)}
      <div class="legend cat-legend">${cats().map(c => `<span>${catDot(c)}${esc(c)}</span>`).join('')}</div>
      <div class="heat-legend"><span>Easier</span><i></i><span>Harder</span></div></div>
    <div class="sec-h"><h2>${UI.hday ? esc(longDay(UI.hday)) : `${n} session${n === 1 ? '' : 's'}`}</h2>
      ${UI.hday ? `<button class="link" data-act="hday" data-v="${UI.hday}">Show all</button>` : total ? `<span class="muted">${fmtLength(total)} total</span>` : ''}</div>
    ${rows || `<div class="empty">${S.sessions.length ? 'No sessions in this period.' : 'Finished sessions appear here.'}</div>`}`;
}

function sessionDetailView(id) {
  const s = S.sessions.find(x => x.id === id);
  if (!s) return header('Session', { back: '#/history' }) + `<div class="empty">Session not found.</div>`;
  const lab = labelsFor(s.items);
  const prs = prIndex();
  const body = blocks(s.items).map(b => {
    const inner = b.items.map(it => {
      const ex = S.ex.get(it.exId) || { name: 'Deleted exercise', type: 'weight' };
      const pr = prs.get(it.exId);
      const hasPr = pr && pr.sessionId === s.id && it.sets.some(st => st.id === pr.setId);
      return `<div class="card item${hasPr ? ' pr' : ''}">
        <div class="item-h"><span class="badge">${lab[it.uid]}</span>
          <div class="item-t">${ex.id ? `<a class="item-name" href="#/exercise/${ex.id}">${exDot(ex)}${esc(ex.name)}</a>` : `<div class="item-name">${esc(ex.name)}</div>`}</div>
          ${hasPr ? '<span class="pr-tag">Personal record</span>' : ''}</div>
        <ol class="set-list">${it.sets.map(st => hasPr && st.id === pr.setId
          ? `<li class="pr">${esc(summariseSet(ex, st))} <span aria-label="Personal record">🥇</span></li>`
          : `<li>${esc(summariseSet(ex, st))}</li>`).join('')}</ol>
        ${it.note ? `<div class="note-ro">${esc(it.note)}</div>` : ''}</div>`;
    }).join('');
    return b.items.length > 1 ? `<div class="superset"><div class="ss-h"><span class="eyebrow">Superset</span></div>${inner}</div>` : inner;
  }).join('');
  const dur = s.end ? (s.end - s.start) / 1000 : 0;
  return `
    ${header('Session', { back: '#/history', right: `<button class="btn sm ghost" data-act="editSession" data-id="${s.id}">Edit</button>` })}
    <h2 class="big">${esc(s.name)}</h2>
    <div class="muted">${fmtDate(s.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${fmtTime(s.start)}${s.end ? '–' + fmtTime(s.end) : ''}${s.effort ? ` · Effort ${s.effort}/5` : ''}</div>
    <div class="stats">
      <div><span>Actual</span><b>${fmtLength(dur)}</b></div>
      <div><span>Estimated</span><b>${s.estSec ? fmtLength(s.estSec) : '–'}</b></div>
      <div><span>Sets</span><b>${s.items.reduce((n, it) => n + it.sets.length, 0)}</b></div>
    </div>
    ${s.note ? `<div class="card note-ro">${esc(s.note)}</div>` : ''}
    ${body}
    <div class="danger-zone"><button class="link danger" data-act="deleteSession" data-id="${s.id}">Delete session</button></div>`;
}

const dtLocal = ms => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

function editSessionView(id) {
  if (!UI.draft || UI.draft.id !== id) {
    const s = S.sessions.find(x => x.id === id);
    if (!s) return header('Edit', { back: '#/history' }) + `<div class="empty">Session not found.</div>`;
    UI.draft = structuredClone(s);
  }
  const d = UI.draft;
  return `
    ${header('Edit session', { back: '#/history/' + id, right: `<button class="btn sm" data-act="saveEdit">Save</button>` })}
    <input class="title-in" data-in="sessName" data-mode="edit" value="${esc(d.name)}" aria-label="Session name">
    <div class="two">
      <label class="field"><span>Start</span><input class="in" type="datetime-local" data-ch="sessTime" data-key="start" value="${dtLocal(d.start)}"></label>
      <label class="field"><span>Finish</span><input class="in" type="datetime-local" data-ch="sessTime" data-key="end" value="${d.end ? dtLocal(d.end) : ''}"></label>
    </div>
    ${sessionItemsHtml(d, 'edit')}
    <button class="btn ghost wide" data-act="pickForSession" data-mode="edit">+ Add exercise</button>
    ${effortHtml(d, 'edit')}
    <label class="field"><span>Session note</span><textarea class="in" rows="2" data-in="sessNote" data-mode="edit">${esc(d.note)}</textarea></label>
    <button class="btn wide" data-act="saveEdit">Save changes</button>`;
}

// ---------------- Exercises ----------------
function filteredExercises() {
  const q = UI.exq.trim().toLowerCase();
  return exList().filter(e =>
    (UI.exarch ? e.archived : !e.archived) &&
    (UI.excat === 'All' || e.category === UI.excat) &&
    (!UI.exmus || (e.muscles || []).includes(UI.exmus)) &&
    (!q || e.name.toLowerCase().includes(q)));
}
function exerciseRows(list) {
  const counts = {};
  for (const s of S.sessions) for (const it of s.items) counts[it.exId] = (counts[it.exId] || 0) + 1;
  return list.map(e => `<a class="card row" href="#/exercise/${e.id}">
      <div class="grow"><div class="item-name">${exDot(e)}${esc(e.name)}</div>
      <div class="muted">${esc(TYPES[e.type])}${e.modality ? ' · ' + esc(MODALITIES[e.modality]) : ''}</div>
      ${e.muscles?.length ? `<div class="muscles">${esc(e.muscles.join(' · '))}</div>` : ''}</div>
      ${counts[e.id] ? `<span class="count">${counts[e.id]}</span>` : ''}<span class="chev">›</span></a>`).join('')
    || `<div class="empty">No exercises match.</div>`;
}
function filterBar(prefix) {
  const st = prefix === 'pk' ? UI.picker : UI;
  const cat = prefix === 'pk' ? st.cat : UI.excat;
  const mus = prefix === 'pk' ? st.mus : UI.exmus;
  return `
    <input class="in search" type="search" placeholder="Search exercises" data-in="${prefix}q" value="${esc(prefix === 'pk' ? st.q : UI.exq)}">
    <div class="chips">${['All', ...cats()].map(c => `<button class="chip ${cat === c ? 'on' : ''}" data-act="${prefix}cat" data-v="${esc(c)}">${c === 'All' ? 'All' : catDot(c) + esc(c)}</button>`).join('')}
      <select class="chip sel" data-ch="${prefix}mus" aria-label="Muscle group"><option value="">All muscles</option>${MUSCLES.map(m => `<option ${mus === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
    </div>`;
}
function exercisesView() {
  return `
    ${header('Exercises', { right: `<a class="btn sm" href="#/exercise-edit/new">+ New</a>` })}
    ${filterBar('ex')}
    <label class="toggle"><input type="checkbox" data-ch="exarch" ${UI.exarch ? 'checked' : ''}> Show archived only</label>
    <div id="exlist">${exerciseRows(filteredExercises())}</div>`;
}

function exerciseDetailView(id) {
  const ex = S.ex.get(id);
  if (!ex) return header('Exercise', { back: '#/exercises' }) + `<div class="empty">Exercise not found.</div>`;
  const metrics = metricsFor(ex);
  const mkey = UI.metric[id] || metrics[0]?.key;
  const metric = metrics.find(m => m.key === mkey) || metrics[0];
  const hist = sessionsDesc().flatMap(s => s.items.filter(i => i.exId === id).map(it => ({ s, it })));
  const pr = prIndex().get(id);
  const prSet = pr && S.sessions.find(s => s.id === pr.sessionId)?.items.flatMap(it => it.sets).find(st => st.id === pr.setId);
  const prSess = pr && S.sessions.find(s => s.id === pr.sessionId);
  if (metric) onMount(() => {
    const pts = hist.map(({ s, it }) => { const v = metric.get(it); return v && { x: s.start, y: v.y, label: v.label }; }).filter(Boolean);
    renderChart(document.getElementById('exchart'), {
      series: [{ name: metric.label, points: pts, mark: 'both', tone: 'accent' }],
      yFmt: metric.fmt, note: metric.invert ? 'Lower is better' : '',
    });
  });
  return `
    ${header('Exercise', { back: '#/exercises', right: `<a class="btn sm ghost" href="#/exercise-edit/${id}">Edit</a>` })}
    <h2 class="big">${esc(ex.name)}</h2>
    <div class="muted">${exDot(ex)}${esc(ex.category)} · ${typeTag(ex)} ${ex.archived ? '<span class="tag warn">Archived</span>' : ''}</div>
    ${ex.muscles?.length ? `<div class="muscles">${esc(ex.muscles.join(' · '))}</div>` : ''}
    ${prSet ? `<a class="card row pr" href="#/history/${prSess.id}"><span class="medal" aria-hidden="true">🥇</span>
      <div class="grow"><div class="muted">Personal record · ${fmtDate(prSess.start, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
      <b>${esc(summariseSet(ex, prSet))}</b></div><span class="chev">›</span></a>` : ''}
    ${metric ? `<section class="card">
      <div class="sec-h"><h2>${esc(metric.label)}</h2></div>
      ${metrics.length > 1 ? `<div class="chips">${metrics.map(m => `<button class="chip ${m.key === metric.key ? 'on' : ''}" data-act="metric" data-id="${id}" data-v="${m.key}">${esc(m.label)}</button>`).join('')}</div>` : ''}
      <div id="exchart" class="chart"></div></section>` : ''}
    <section><div class="sec-h"><h2>History</h2><span class="muted">${hist.length} session${hist.length === 1 ? '' : 's'}</span></div>
      ${hist.slice(0, 50).map(({ s, it }) => { const isPr = pr && s.id === pr.sessionId && it.sets.some(x => x.id === pr.setId); return `<a class="card row${isPr ? ' pr' : ''}" href="#/history/${s.id}">
        <div class="grow"><div class="muted">${fmtDate(s.start, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${esc(s.name)}</div>
        <div>${it.sets.map(x => esc(summariseSet(ex, x)) + (isPr && x.id === pr.setId ? ' 🥇' : '')).join('<span class="sep"> · </span>')}</div>
        ${it.note ? `<div class="note-ro">${esc(it.note)}</div>` : ''}</div></a>`; }).join('') || `<div class="empty">Not logged yet.</div>`}
    </section>
    <div class="danger-zone">
      <button class="link" data-act="archive" data-id="${id}">${ex.archived ? 'Unarchive' : 'Archive'}</button>
      <button class="link danger" data-act="deleteEx" data-id="${id}">Delete permanently</button>
    </div>`;
}

function exerciseEditView(id) {
  const isNew = id === 'new';
  if (!UI.exDraft || UI.exDraft._for !== id) {
    const base = isNew ? { id: uid(), name: '', type: 'weight', category: 'Strength', muscles: [], perSide: false, modality: null, archived: false, custom: true }
      : structuredClone(S.ex.get(id));
    if (!base) return header('Exercise', { back: '#/exercises' }) + `<div class="empty">Exercise not found.</div>`;
    UI.exDraft = { ...base, _for: id };
  }
  const d = UI.exDraft;
  const used = !isNew && usage(d.id) > 0;
  const back = isNew ? (UI.newEx?.back || '#/exercises') : '#/exercise/' + id;
  return `
    ${header(isNew ? 'New exercise' : 'Edit exercise', { back })}
    ${isNew && UI.newEx ? `<p class="muted">${esc(UI.newEx.note)}</p>` : ''}
    <label class="field"><span>Name</span><input class="in" data-in="exName" value="${esc(d.name)}" placeholder="e.g. Ring Dip">
      <small class="name-note" id="exNameNote">${esc(nameProblem(d) || '')}</small></label>
    <label class="field"><span>How it's logged</span>
      <select class="in" data-ch="exType" ${used ? 'disabled' : ''}>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      ${used ? `<small class="muted">Locked because this exercise has logged sessions.</small>` : ''}</label>
    ${isCardio(d) ? `<label class="field"><span>Machine / modality</span>
      <select class="in" data-ch="exMod" ${used ? 'disabled' : ''}>${Object.entries(MODALITIES).map(([k, v]) => `<option value="${k}" ${d.modality === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`
      : `<label class="toggle"><input type="checkbox" data-ch="exSide" ${d.perSide ? 'checked' : ''}> Logged per side (left/right)</label>`}
    <label class="field"><span>Category</span>
      <select class="in" data-ch="exCat">${[...new Set([...cats(), d.category])].map(c => `<option ${d.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <small class="muted">Add your own categories in Settings.</small></label>
    <div class="field"><span>Muscle groups</span>
      <div class="chips">${MUSCLES.map(m => `<button class="chip ${d.muscles.includes(m) ? 'on' : ''}" data-act="exMus" data-v="${m}">${m}</button>`).join('')}</div></div>
    <button class="btn wide" data-act="saveEx" id="saveExBtn" ${nameProblem(d) ? 'disabled' : ''}>${isNew && UI.newEx ? UI.newEx.saveLabel : 'Save exercise'}</button>`;
}
// Why an exercise name can't be saved (empty, or the same as another exercise), or ''.
function nameProblem(d) {
  const n = d.name.trim().toLowerCase();
  if (!n) return 'Give the exercise a name.';
  const dup = exList().find(e => e.id !== d.id && e.name.trim().toLowerCase() === n);
  return dup ? `“${dup.name}” already exists${dup.archived ? ' (archived)' : ''}. Choose a different name, or use the existing exercise.` : '';
}
// Open the new-exercise form from a routine or session; on save the exercise is added there.
function newExerciseFor({ back, note, saveLabel, onCreate, name = '', category }) {
  UI.newEx = { back, note, saveLabel, onCreate };
  UI.exDraft = { id: uid(), name, type: 'weight', category: category && category !== 'All' ? category : 'Strength', muscles: [], perSide: false, modality: null, archived: false, custom: true, _for: 'new' };
  if (category === 'Cardio') { UI.exDraft.type = 'steady'; UI.exDraft.modality = 'run'; UI.exDraft.muscles = ['Cardio']; }
  if (category === 'Stretch') UI.exDraft.type = 'stretch';
  if (category === 'Rehab') UI.exDraft.type = 'hold';
  location.hash = '#/exercise-edit/new';
}

// ---------------- Weight ----------------
const RANGES = { '1M': 31, '3M': 92, '1Y': 366, All: Infinity };
function weightView() {
  const all = [...S.weights].sort((a, b) => b.date.localeCompare(a.date));
  const latest = all[0];
  const roll = rollingMean(S.weights);
  const cutoff = Date.now() - RANGES[UI.wrange] * DAY;
  const inRange = all.filter(w => new Date(w.date + 'T12:00:00').getTime() >= cutoff);
  const avgNow = roll[roll.length - 1]?.y;
  const weekAgo = roll.filter(p => p.x <= Date.now() - 7 * DAY).pop();
  const change = avgNow && weekAgo ? avgNow - weekAgo.y : null;
  // Charts plot in the chosen unit (stone as a decimal, labelled as st + lb).
  const yFmt = prefs.body === 'st' ? v => { const st = Math.floor(v); return `${st} st ${Math.round((v - st) * 14)}`; } : v => `${Math.round(v * 10) / 10}`;
  onMount(() => renderChart(document.getElementById('wchart'), {
    series: [
      { name: 'Daily', points: inRange.map(w => ({ x: new Date(w.date + 'T12:00:00').getTime(), y: toBody(w.kg), label: fmtBody(w.kg) })), mark: 'dots', tone: 'muted' },
      { name: '7-day average', points: roll.filter(p => p.x >= cutoff).map(p => ({ x: p.x, y: toBody(p.y), label: fmtBody(p.y) })), mark: 'line', tone: 'accent' },
    ],
    yFmt,
  }));
  const ph = latest ? (prefs.body === 'st' ? null : toBody(latest.kg).toFixed(1)) : (prefs.body === 'lb' ? '165.0' : '75.0');
  const stPh = latest ? fmtBody(latest.kg).match(/^(\d+) st ([\d.]+)/) : null;
  return `
    ${header('Bodyweight')}
    <div class="card weigh${prefs.body === 'st' ? ' st' : ''}">
      ${prefs.body === 'st'
      ? `<label class="tf"><span>st</span><input class="in big-in" id="wst" inputmode="decimal" placeholder="${stPh ? stPh[1] : '12'}"></label>
         <label class="tf"><span>lb</span><input class="in big-in" id="wlb" inputmode="decimal" placeholder="${stPh ? stPh[2] : '0'}"></label>`
      : `<label class="tf"><span>${prefs.body}</span><input class="in big-in" id="wkg" inputmode="decimal" placeholder="${ph}"></label>`}
      <label class="tf"><span>Date</span><input class="in" id="wdate" type="date" value="${localISO()}" max="${localISO()}"></label>
      <button class="btn" data-act="saveWeight">Log</button>
    </div>
    ${latest ? `<div class="stats">
      <div><span>Latest</span><b>${fmtBody(latest.kg)}</b><small>${fmtDate(new Date(latest.date + 'T12:00:00'), { day: 'numeric', month: 'short' })}</small></div>
      <div><span>7-day avg</span><b>${fmtBody(avgNow)}</b></div>
      <div><span>vs last week</span><b>${change === null ? '–' : fmtBodyDelta(change)}</b></div>
    </div>` : ''}
    <section class="card">
      <div class="chips">${Object.keys(RANGES).map(r => `<button class="chip ${UI.wrange === r ? 'on' : ''}" data-act="wrange" data-v="${r}">${r}</button>`).join('')}</div>
      <div id="wchart" class="chart"></div>
    </section>
    <section><div class="sec-h"><h2>Entries</h2></div>
      ${inRange.map(w => `<div class="card row"><div class="grow">${fmtDate(new Date(w.date + 'T12:00:00'), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
        <b>${fmtBody(w.kg)}</b><button class="icon" data-act="delWeight" data-v="${w.date}" aria-label="Delete entry">✕</button></div>`).join('') || `<div class="empty">No entries in this range.</div>`}
    </section>`;
}

// ---------------- Settings ----------------
const unitRow = (label, key, opts, cur) => `<div class="unit-row"><span>${label}</span>
  <div class="seg">${Object.entries(opts).map(([k, v]) => `<button class="${cur === k ? 'on' : ''}" data-act="unit" data-k="${key}" data-v="${k}" aria-pressed="${cur === k}">${v}</button>`).join('')}</div></div>`;
function settingsView() {
  const c = cfg();
  onMount(async () => {
    const el = document.getElementById('persist');
    if (el && navigator.storage?.persisted) el.textContent = (await navigator.storage.persisted()) ? 'Protected from automatic clearing' : 'Not yet protected (add to Home Screen and log a session)';
  });
  return `
    ${header('Settings')}
    <section class="card">
      <h2>Appearance</h2>
      <div class="chips">${Object.entries(THEMES).map(([k, v]) => `<button class="chip ${(c.theme || 'auto') === k ? 'on' : ''}" data-act="theme" data-v="${k}">${v}</button>`).join('')}</div>
      <p class="muted">Auto follows your phone’s light/dark setting.</p>
    </section>
    <section class="card">
      <h2>Units</h2>
      ${unitRow('Lifting weights', 'load', { kg: 'kg', lb: 'lb' }, prefs.load)}
      ${unitRow('Bodyweight', 'body', { kg: 'kg', lb: 'lb', st: 'st & lb' }, prefs.body)}
      ${unitRow('Distance', 'dist', { km: 'km', mi: 'miles' }, prefs.dist)}
      ${unitRow('Week starts on', 'week', { mon: 'Monday', sun: 'Sunday' }, prefs.weekStart ? 'mon' : 'sun')}
      <p class="muted">Only changes how numbers are shown and typed. Everything already logged converts automatically, and exports stay in kg and km.</p>
    </section>
    <section class="card">
      <h2>Categories</h2>
      <p class="muted">Tap a colour to change it. These colour the dots on exercises, routines and History.</p>
      ${cats().map(cat => {
        const custom = !CATEGORIES.includes(cat);
        const n = [...S.ex.values()].filter(e => e.category === cat).length;
        return `<div class="cat-row">
          <label class="swatch" style="background:${catColor(cat)}" aria-label="Colour for ${esc(cat)}"><input type="color" value="${catHex(cat)}" data-ch="catColor" data-v="${esc(cat)}"></label>
          <span class="grow">${esc(cat)} <span class="muted">· ${n} exercise${n === 1 ? '' : 's'}</span></span>
          ${c.catColors?.[cat] ? `<button class="link muted" data-act="catReset" data-v="${esc(cat)}">Reset</button>` : ''}
          ${custom ? `<button class="icon" data-act="delCat" data-v="${esc(cat)}" aria-label="Remove ${esc(cat)}">✕</button>` : ''}</div>`;
      }).join('')}
      <div class="cat-add"><input class="in" id="newcat" maxlength="24" placeholder="New category, e.g. CrossFit"><button class="btn sm" data-act="addCat">Add</button></div>
    </section>
    <section class="card">
      <h2>Backup</h2>
      <p class="muted">Your data only lives on this phone. Back up to Files / iCloud Drive regularly. Last backup: <b>${S.meta.lastBackup ? fmtDate(S.meta.lastBackup, { day: 'numeric', month: 'short', year: 'numeric' }) : 'never'}</b>.</p>
      <button class="btn wide" data-act="exportJSON">Back up (JSON)</button>
      <label class="btn ghost wide file">Restore from backup<input type="file" accept="application/json,.json" data-ch="importFile" hidden></label>
      <div class="two">
        <button class="btn ghost" data-act="exportSetsCSV">Sets CSV</button>
        <button class="btn ghost" data-act="exportWeightCSV">Bodyweight CSV</button>
      </div>
    </section>
    <section class="card">
      <h2>Session-length estimate</h2>
      <p class="muted">Used for routine and session estimates.</p>
      <label class="tf row-f"><span>Seconds per rep</span><input class="in sm" inputmode="decimal" data-ch="cfg" data-key="secPerRep" value="${c.secPerRep}"></label>
      <label class="tf row-f"><span>Minimum set length (s)</span><input class="in sm" inputmode="decimal" data-ch="cfg" data-key="minSetSec" value="${c.minSetSec}"></label>
      <label class="tf row-f"><span>Changeover between exercises (s)</span><input class="in sm" inputmode="decimal" data-ch="cfg" data-key="changeoverSec" value="${c.changeoverSec}"></label>
    </section>
    <section class="card">
      <h2>Storage</h2>
      <p class="muted" id="persist">Checking…</p>
      <p class="muted">${S.sessions.length} sessions · ${S.routines.length} routines · ${S.ex.size} exercises · ${S.weights.length} weigh-ins</p>
    </section>
    <section class="card">
      <h2>Updates</h2>
      <p class="muted">You’re on <b>${APP_NAME} v${APP_VERSION}</b>.${UI.upd.msg ? ' ' + esc(UI.upd.msg) : ''}</p>
      ${UI.upd.ready ? `<button class="btn wide" data-act="reload">Update now${UI.upd.latest ? ' to v' + esc(UI.upd.latest) : ''}</button>` : ''}
      <div class="two">
        <button class="btn ghost" data-act="checkUpdate" ${UI.upd.busy ? 'disabled' : ''}>${UI.upd.busy ? 'Checking…' : 'Check for updates'}</button>
        <button class="btn ghost" data-act="whatsNew">What’s new</button>
      </div>
    </section>
    <p class="muted center">${APP_NAME} v${APP_VERSION}</p>`;
}

// ---------------- Updates ----------------
let swReg = null;
const markUpdateReady = latest => {
  UI.upd = { ...UI.upd, ready: true, busy: false, latest: latest || UI.upd.latest, msg: 'A new version is ready.' };
  if (route().name === 'settings') rerender();
};
// Reads VERSION from the server's sw.js, e.g. 'workout_jfp-v1.3.1' -> '1.3.1'.
async function latestVersion() {
  const txt = await (await fetch('./sw.js', { cache: 'no-store' })).text();
  return txt.match(/VERSION\s*=\s*'[^']*?v([\d.]+)'/)?.[1] || null;
}
async function checkUpdate() {
  if (!swReg) { UI.upd.msg = 'Updates are only available in the installed app.'; return rerender(); }
  UI.upd = { ...UI.upd, busy: true, msg: '' }; rerender();
  let latest = null;
  try { await swReg.update(); latest = await latestVersion(); } catch {
    UI.upd = { ...UI.upd, busy: false, msg: 'Couldn’t check. Are you offline?' }; return rerender();
  }
  if (!latest || latest === APP_VERSION) { UI.upd = { ...UI.upd, busy: false, ready: false, msg: 'You’re on the latest version.' }; return rerender(); }
  // A newer version exists: wait for its service worker to finish installing, then offer a reload.
  const nw = swReg.installing || swReg.waiting;
  if (nw && nw.state !== 'activated') await new Promise(r => {
    nw.addEventListener('statechange', () => { if (nw.state === 'activated' || nw.state === 'redundant') r(); });
    setTimeout(r, 15000);
  });
  markUpdateReady(latest);
}

function applyTheme() {
  const t = S.meta.settings?.theme || 'auto';
  const root = document.documentElement;
  if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
  // index.html has two theme-color metas: light first, dark second.
  const [ml, md] = document.querySelectorAll('meta[name="theme-color"]');
  if (ml) ml.content = THEME_BG[t === 'dark' ? 'dark' : 'light'];
  if (md) md.content = THEME_BG[t === 'light' ? 'light' : 'dark'];
  // Mirrored so index.html can apply it before first paint.
  try { localStorage.setItem('theme', t); } catch { }
}

// ---------------- Picker sheet ----------------
function openPicker(opts) {
  UI.picker = { multi: true, q: '', cat: 'All', mus: '', sel: new Set(), title: 'Add exercises', ...opts };
  renderSheet();
}
function pickerList() {
  const p = UI.picker;
  const q = p.q.trim().toLowerCase();
  const list = exList().filter(e => !e.archived && (p.cat === 'All' || e.category === p.cat) &&
    (!p.mus || (e.muscles || []).includes(p.mus)) && (!q || e.name.toLowerCase().includes(q)));
  return list.map(e => `<button class="pick ${p.sel.has(e.id) ? 'on' : ''}" data-act="pick" data-id="${e.id}">
      <span class="grow"><span class="item-name">${exDot(e)}${esc(e.name)}</span><span class="muted">${esc(TYPES[e.type])}${e.muscles?.length ? ' · ' + esc(e.muscles.join(', ')) : ''}</span></span>
      <span class="check">${p.sel.has(e.id) ? '✓' : ''}</span></button>`).join('')
    || `<div class="empty">No exercise called “${esc(p.q.trim())}” yet.</div>`;
}
const pickerCreate = () => {
  const q = UI.picker.q.trim();
  return `<button class="pick create" data-act="pickNew"><span class="grow"><span class="item-name">+ Create ${q ? `“${esc(q)}”` : 'a new exercise'}</span>
    <span class="muted">${UI.picker.multi ? 'It’s added straight away' : 'It’s swapped in straight away'}</span></span></button>`;
};
function sheetFrame(title, body) {
  return `<div class="scrim" data-act="closeSheet"></div>
    <div class="sheet" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-h"><span></span><b>${esc(title)}</b><button class="link strong" data-act="closeSheet">Done</button></div>
      <div class="pick-list">${body}</div>
    </div>`;
}
const newsHtml = () => sheetFrame(`What’s new in v${APP_VERSION}`, `
  ${WHATS_NEW.map(([icon, t, d]) => `<div class="news"><span class="news-i" aria-hidden="true">${icon}</span><div><b>${esc(t)}</b><p class="muted">${esc(d)}</p></div></div>`).join('')}
  <button class="btn wide" data-act="closeSheet">Got it</button>`);
function openSheet(kind) { UI.sheet = kind; renderSheet(); }
function closeSheet() {
  if (UI.sheet === 'news') setMeta('seenVersion', APP_VERSION);
  UI.sheet = null; UI.picker = null; renderSheet();
}

function renderSheet() {
  const el = document.getElementById('sheet');
  if (UI.sheet) {
    el.classList.add('open'); document.body.classList.add('noscroll');
    el.innerHTML = newsHtml();
    return;
  }
  const p = UI.picker;
  if (!p) { el.innerHTML = ''; el.classList.remove('open'); document.body.classList.remove('noscroll'); return; }
  el.classList.add('open'); document.body.classList.add('noscroll');
  el.innerHTML = `<div class="scrim" data-act="closeSheet"></div>
    <div class="sheet" role="dialog" aria-label="${esc(p.title)}">
      <div class="sheet-h"><button class="link" data-act="closeSheet">Cancel</button><b>${esc(p.title)}</b>
        ${p.multi ? `<button class="link strong" data-act="pickDone" ${p.sel.size ? '' : 'disabled'}>Add${p.sel.size ? ' (' + p.sel.size + ')' : ''}</button>` : '<span></span>'}</div>
      ${filterBar('pk')}
      <div class="pick-list" id="pkscroll"><div id="pkcreate">${pickerCreate()}</div><div id="pklist">${pickerList()}</div></div>
    </div>`;
}

// ---------------- Export / import ----------------
async function deliver(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const file = new File([blob], filename, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}
async function exportJSON() {
  const data = {
    // 'setlog' is the internal backup marker; keep it so old and new backups restore alike.
    app: 'setlog', version: 1, exportedAt: new Date().toISOString(),
    exercises: [...S.ex.values()], routines: S.routines, sessions: S.sessions, weights: S.weights,
    settings: S.meta.settings || {}, plan: plan(),
  };
  if (await deliver(`${FILE_PREFIX}-backup-${localISO()}.json`, JSON.stringify(data), 'application/json')) {
    await setMeta('lastBackup', Date.now());
    toast('Backup created'); rerender();
  }
}
const csvCell = v => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = rows => rows.map(r => r.map(csvCell).join(',')).join('\n');
function exportSetsCSV() {
  const rows = [['session_id', 'date', 'start_time', 'end_time', 'session_name', 'routine', 'block', 'exercise', 'type', 'modality', 'per_side', 'category', 'set_no',
    'kg', 'reps', 'time_s', 'watts', 'split_s_per_500m', 'pace_s_per_km', 'cadence_rpm', 'dist_km', 'avg_hr', 'exercise_note', 'session_note', 'session_effort']];
  for (const s of sessionsDesc().reverse()) {
    const lab = labelsFor(s.items);
    const rname = S.routines.find(r => r.id === s.routineId)?.name || '';
    for (const it of s.items) {
      const ex = S.ex.get(it.exId) || {};
      it.sets.forEach((st, i) => rows.push([s.id, localISO(new Date(s.start)), fmtTime(s.start), s.end ? fmtTime(s.end) : '', s.name, rname, lab[it.uid],
        ex.name, ex.type, ex.modality || '', ex.perSide ? 1 : 0, ex.category, i + 1,
        st.kg, st.reps, st.time, st.watts, st.split, st.pace, st.cadence, st.dist, st.hr, it.note, s.note, s.effort]));
    }
  }
  deliver(`${FILE_PREFIX}-sets-${localISO()}.csv`, csv(rows), 'text/csv');
}
function exportWeightCSV() {
  const rows = [['date', 'kg'], ...[...S.weights].sort((a, b) => a.date.localeCompare(b.date)).map(w => [w.date, w.kg])];
  deliver(`${FILE_PREFIX}-bodyweight-${localISO()}.csv`, csv(rows), 'text/csv');
}
async function importFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return tell('Can’t read that file', 'It isn’t a valid backup file. Choose a .json file made with Back up (JSON).'); }
  if (data?.app !== 'setlog' || !Array.isArray(data.exercises)) return tell('Not a backup file', `That file wasn’t made by ${APP_NAME}’s Back up (JSON).`);
  const planDays = Object.keys(data.plan || {}).length;
  if (!await sure(`Restore the backup from ${data.exportedAt?.slice(0, 10) || 'an unknown date'}?`,
    `This replaces everything on this phone with:\n${data.sessions?.length || 0} sessions · ${data.routines?.length || 0} routines · ${data.weights?.length || 0} weigh-ins · ${planDays} planned day${planDays === 1 ? '' : 's'}${'plan' in data ? '' : '\n\nThis backup was made with an older version, so it has no week plan.'}`,
    'Replace with this backup', 'Keep what’s on this phone')) return;
  await db.replaceAll({
    exercises: data.exercises, routines: data.routines || [], sessions: data.sessions || [], weights: data.weights || [],
    meta: [{ key: 'settings', value: data.settings || {} }, { key: 'plan', value: data.plan || {} }, { key: 'seeded', value: true }, { key: 'seenVersion', value: APP_VERSION }, { key: 'firstUse', value: Date.now() }, { key: 'lastBackup', value: Date.now() }],
  });
  await loadAll();
  applyPrefs(); applyTheme();
  toast('Backup restored'); go('train');
}

// ---------------- Event handlers ----------------
const findItem = (sess, id) => sess.items.find(it => it.uid === id);
const ownerItems = d => d.scope === 'rt' ? S.routines.find(r => r.id === d.owner) : ctx(d.scope).sess;
const saveOwner = (d, owner) => d.scope === 'rt' ? putRoutine(owner) : ctx(d.scope).save();

const ACT = {
  start: d => startSession(d.id || null),
  newRoutine: async () => {
    const r = { id: uid(), name: 'New routine', items: [], created: Date.now() };
    await putRoutine(r); go('routine/' + r.id);
  },
  deleteRoutine: async d => {
    const r = S.routines.find(x => x.id === d.rid);
    if (!await sure(`Delete “${r.name}”?`, 'Past sessions stay in History. Any days it was planned on show it as a deleted routine.', 'Delete routine', 'Keep routine')) return;
    S.routines = S.routines.filter(x => x.id !== r.id); await db.del('routines', r.id); go('train');
  },
  pickForRoutine: d => openPicker({
    ctx: 'routine',
    onPick: ids => {
      const r = S.routines.find(x => x.id === d.rid);
      for (const id of ids) { const ex = S.ex.get(id); r.items.push({ uid: uid(), exId: id, group: null, target: defaultTarget(ex) }); }
      putRoutine(r); rerender();
    },
  }),
  pickForSession: d => openPicker({
    ctx: 'session',
    onPick: ids => {
      const c = ctx(d.mode);
      for (const id of ids) {
        const ex = S.ex.get(id); const it = newSessionItem(ex);
        if (d.mode === 'edit') it.sets.forEach(s => { s.done = true; });
        c.sess.items.push(it);
      }
      c.save(); rerender();
    },
  }),
  menu: d => { UI.menu = UI.menu === d.uid ? null : d.uid; rerender(); },
  itemUp: d => { const o = ownerItems(d); o.items = moveBlock(o.items, d.uid, -1); UI.menu = null; saveOwner(d, o); rerender(); },
  itemDown: d => { const o = ownerItems(d); o.items = moveBlock(o.items, d.uid, 1); UI.menu = null; saveOwner(d, o); rerender(); },
  itemPair: d => { const o = ownerItems(d); pairWithNext(o.items, d.uid); UI.menu = null; saveOwner(d, o); rerender(); },
  itemUnpair: d => { const o = ownerItems(d); o.items = unpair(o.items, d.uid); UI.menu = null; saveOwner(d, o); rerender(); },
  newExForRoutine: d => newExerciseFor({
    back: '#/routine/' + d.rid, note: 'It’s added to this routine when you save.', saveLabel: 'Save and add to routine',
    onCreate: id => { const r = S.routines.find(x => x.id === d.rid); if (r) { r.items.push({ uid: uid(), exId: id, group: null, target: defaultTarget(S.ex.get(id)) }); putRoutine(r); } },
  }),
  pickNew: () => {
    const p = UI.picker; const back = location.hash;
    const picked = [...p.sel];
    UI.picker = null; renderSheet();
    newExerciseFor({
      back, name: p.q.trim(), category: p.cat,
      note: p.multi ? `It’s added to this ${p.ctx || 'list'} when you save${picked.length ? `, along with the ${picked.length} you ticked` : ''}.` : 'It’s swapped in when you save.',
      saveLabel: p.multi ? `Save and add to ${p.ctx || 'list'}` : 'Save and swap in',
      onCreate: id => p.onPick(p.multi ? [...picked, id] : [id]),
    });
  },
  itemRemove: async d => {
    const o = ownerItems(d); const it = o.items.find(x => x.uid === d.uid);
    const ex = S.ex.get(it.exId);
    if (it.sets?.some(s => s.done) && d.scope === 'live' && !await sure(`Remove ${ex?.name || 'this exercise'}?`, 'Its ticked sets will be removed from this session too.', 'Remove exercise and sets', 'Keep it')) return;
    o.items = o.items.filter(x => x.uid !== d.uid);
    const g = it.group; if (g && o.items.filter(x => x.group === g).length === 1) o.items.forEach(x => { if (x.group === g) x.group = null; });
    UI.menu = null; saveOwner(d, o); rerender();
  },
  itemSwap: d => openPicker({
    multi: false, title: 'Swap exercise',
    onPick: ([id]) => {
      const o = ownerItems(d); const idx = o.items.findIndex(x => x.uid === d.uid); const old = o.items[idx];
      const ex = S.ex.get(id); const prev = S.ex.get(old.exId);
      const sameType = prev && prev.type === ex.type;
      const target = sameType ? old.target : { ...defaultTarget(ex), sets: num(old.target?.sets) || defaultTarget(ex).sets };
      if (d.scope === 'rt') o.items[idx] = { ...old, exId: id, target };
      else {
        const fresh = newSessionItem(ex, target, old.group);
        fresh.uid = old.uid; fresh.rest = old.group ? old.rest : fresh.rest;
        if (d.scope === 'edit') fresh.sets.forEach(s => { s.done = true; });
        o.items[idx] = fresh;
      }
      UI.menu = null; saveOwner(d, o); rerender();
    },
  }),
  tick: (d, el) => {
    const s = S.meta.active; const it = findItem(s, d.uid); const st = it.sets[+d.set];
    st.done = !st.done; st.touched = true;
    el.closest('.set-row').classList.toggle('done', st.done);
    el.setAttribute('aria-pressed', st.done ? 'true' : 'false');
    saveActive(); updateSessionCounters();
    if (st.done) checkLivePr(s, it, st, el.closest('.set-row'));
  },
  addSet: d => {
    const c = ctx(d.mode); const it = findItem(c.sess, d.uid);
    const ex = S.ex.get(it.exId);
    const prev = it.sets[it.sets.length - 1];
    const s = { id: uid(), done: d.mode === 'edit', touched: false };
    for (const f of fieldsFor(ex)) s[f.key] = prev ? prev[f.key] ?? null : setFromTarget(ex, it.target)[f.key] ?? null;
    it.sets.push(s); c.save(); rerender(); updateSessionCounters();
  },
  popSet: async d => {
    const it = findItem(S.meta.active, d.uid);
    const last = it.sets[it.sets.length - 1];
    if (last?.done && !await sure('The last set is ticked', 'Removing it deletes what you logged for that set.', 'Remove ticked set', 'Keep it')) return;
    it.sets.pop(); saveActive(); rerender();
  },
  delSet: d => { const c = ctx(d.mode); const it = findItem(c.sess, d.uid); it.sets.splice(+d.set, 1); rerender(); },
  finish: () => finishSession(),
  discard: () => discardSession(),
  editSession: d => { UI.draft = null; go(`history/${d.id}/edit`); },
  saveEdit: async () => {
    const d = UI.draft;
    d.items = d.items.filter(it => it.sets.length);
    tidyGroups(d.items);
    await putSession(d); UI.draft = null; toast('Session updated');
    location.replace('#/history/' + d.id);
  },
  deleteSession: async d => {
    if (!await sure('Delete this session?', 'It’s removed from History, charts and personal records. This can’t be undone.', 'Delete session', 'Keep session')) return;
    S.sessions = S.sessions.filter(s => s.id !== d.id); await db.del('sessions', d.id);
    toast('Session deleted'); location.replace('#/history');
  },
  excat: d => { UI.excat = d.v; rerender(); },
  metric: d => { UI.metric[d.id] = d.v; rerender(); },
  archive: async d => { const ex = S.ex.get(d.id); ex.archived = !ex.archived; await putEx(ex); toast(ex.archived ? 'Archived — hidden from pickers' : 'Unarchived'); rerender(); },
  deleteEx: async d => {
    const ex = S.ex.get(d.id);
    const n = usage(d.id); const nr = S.routines.filter(r => r.items.some(i => i.exId === d.id)).length;
    const c = await ask({
      title: `Delete “${ex.name}” permanently?`,
      message: `This removes it and its logged sets from ${n} session${n === 1 ? '' : 's'}${nr ? ` and from ${nr} routine${nr === 1 ? '' : 's'}` : ''}. This can’t be undone.\n\nArchiving hides it from lists but keeps its history.`,
      buttons: [
        { label: 'Archive instead', value: 'archive', style: 'primary' },
        { label: 'Delete it and its history', value: 'delete', style: 'danger' },
        { label: 'Cancel', value: null },
      ],
    });
    if (c === 'archive') { ex.archived = true; await putEx(ex); toast('Archived — hidden from pickers'); return rerender(); }
    if (c !== 'delete') return;
    for (const s of [...S.sessions]) {
      if (!s.items.some(i => i.exId === d.id)) continue;
      s.items = s.items.filter(i => i.exId !== d.id);
      if (s.items.length) await putSession(s); else { S.sessions = S.sessions.filter(x => x.id !== s.id); await db.del('sessions', s.id); }
    }
    for (const r of S.routines) if (r.items.some(i => i.exId === d.id)) { r.items = r.items.filter(i => i.exId !== d.id); await putRoutine(r); }
    S.ex.delete(d.id); await db.del('exercises', d.id);
    toast('Exercise deleted'); location.replace('#/exercises');
  },
  exMus: d => { const m = UI.exDraft.muscles; const i = m.indexOf(d.v); if (i < 0) m.push(d.v); else m.splice(i, 1); rerender(); },
  saveEx: async () => {
    const d = UI.exDraft;
    if (nameProblem(d)) return;   // the Save button is disabled in this case
    const { _for, ...ex } = d; ex.name = ex.name.trim().replace(/\s+/g, ' ');
    if (!isCardio(ex)) ex.modality = null; else ex.perSide = false;
    await putEx(ex); UI.exDraft = null;
    const nx = _for === 'new' && UI.newEx;
    if (nx) {
      UI.newEx = null;
      location.replace(nx.back);
      nx.onCreate(ex.id);
      toast(`Created “${ex.name}”`);
      return;
    }
    toast('Exercise saved');
    if (_for === 'new' && history.length > 1) history.back(); else location.replace('#/exercise/' + ex.id);
  },
  wrange: d => { UI.wrange = d.v; rerender(); },
  saveWeight: async () => {
    const el = id => document.getElementById(id);
    let kg;
    if (prefs.body === 'st') kg = el('wst').value.trim() || el('wlb').value.trim() ? kgFromStLb(el('wst').value, el('wlb').value) : null;
    else { const v = num(el('wkg').value); kg = v === null ? null : prefs.body === 'lb' ? kgFromStLb(0, v) : v; }
    const date = el('wdate').value || localISO();
    if (!kg || kg < 20 || kg > 400) return tell('Check your weight', prefs.body === 'st' ? 'Enter stone and pounds, e.g. 12 st 4 lb.' : `Enter your weight in ${prefs.body}, e.g. ${prefs.body === 'lb' ? '168.4' : '76.4'}.`);
    const existed = S.weights.some(w => w.date === date);
    S.weights = S.weights.filter(w => w.date !== date); S.weights.push({ date, kg });
    await db.put('weights', { date, kg });
    toast(existed ? 'Updated that day’s entry' : 'Logged'); rerender();
  },
  delWeight: async d => {
    if (!await sure('Delete this weigh-in?', fmtDate(new Date(d.v + 'T12:00:00'), { weekday: 'long', day: 'numeric', month: 'long' }), 'Delete weigh-in', 'Keep it')) return; S.weights = S.weights.filter(w => w.date !== d.v); await db.del('weights', d.v); rerender(); },
  // week plan
  wk: d => { const v = +d.v; UI.week = v ? addDays(curMonday(), 7 * v).getTime() : null; UI.pday = null; UI.planAdd = false; rerender(); },
  pday: d => { UI.pday = d.v; UI.planAdd = false; rerender(); },
  planAddToggle: () => { UI.planAdd = !UI.planAdd; rerender(); },
  planAdd: d => {
    const p = { ...plan() }; p[d.v] = [...(p[d.v] || []), { id: uid(), routineId: d.id }];
    UI.planAdd = false; savePlan(p); rerender();
  },
  planDel: d => {
    const p = { ...plan() }; p[d.v] = (p[d.v] || []).filter(e => e.id !== d.id);
    if (!p[d.v].length) delete p[d.v];
    savePlan(p); rerender();
  },
  planCopy: () => copyLastWeek(),
  saveRoutine: async d => {
    const r = S.routines.find(x => x.id === d.rid);
    clearTimeout(timers['rt' + r.id]);
    if (!r.name.trim()) r.name = 'Untitled routine';
    await putRoutine(r); toast('Routine saved'); go('train');
  },
  planIcs: (d, el, ev) => calExport(d, ev),
  // history calendar
  hview: d => { UI.hview = d.v; UI.hday = null; rerender(); },
  hnav: d => {
    const v = +d.v; const c = new Date(UI.hcur);
    if (!v) UI.hcur = Date.now();
    else if (UI.hview === 'week') UI.hcur = addDays(c, 7 * v).getTime();
    else if (UI.hview === 'month') UI.hcur = new Date(c.getFullYear(), c.getMonth() + v, 1).getTime();
    else UI.hcur = new Date(c.getFullYear() + v, c.getMonth(), 1).getTime();
    UI.hday = null; rerender();
  },
  hday: d => { UI.hday = UI.hday === d.v ? null : d.v; rerender(); },
  hmonth: d => { UI.hview = 'month'; UI.hcur = new Date(new Date(UI.hcur).getFullYear(), +d.v, 1).getTime(); UI.hday = null; rerender(); },
  effort: d => { const c = ctx(d.mode); const n = +d.v; c.sess.effort = c.sess.effort === n ? null : n; c.save(); rerender(); },
  theme: d => { setSettings({ theme: d.v }); applyTheme(); rerender(); },
  unit: d => {
    if (d.k === 'week') setSettings({ weekStart: d.v });
    else setSettings({ units: { ...(cfg().units || {}), [d.k]: d.v } });
    applyPrefs(); UI.week = null; rerender();
  },
  exportJSON: () => exportJSON(),
  exportSetsCSV: () => exportSetsCSV(),
  exportWeightCSV: () => exportWeightCSV(),
  // picker
  pkcat: d => { UI.picker.cat = d.v; renderSheet(); },
  pick: d => {
    const p = UI.picker;
    if (!p.multi) { const cb = p.onPick; UI.picker = null; renderSheet(); cb([d.id]); return; }
    if (p.sel.has(d.id)) p.sel.delete(d.id); else p.sel.add(d.id);
    const sc = document.getElementById('pkscroll').scrollTop;
    renderSheet(); document.getElementById('pkscroll').scrollTop = sc;
  },
  pickDone: () => { const p = UI.picker; UI.picker = null; renderSheet(); p.onPick([...p.sel]); },
  closeSheet: () => closeSheet(),
  whatsNew: () => openSheet('news'),
  checkUpdate: () => checkUpdate(),
  catReset: d => { const cc = { ...(cfg().catColors || {}) }; delete cc[d.v]; setMeta('settings', { ...(S.meta.settings || {}), catColors: cc }); rerender(); },
  addCat: () => {
    const inp = document.getElementById('newcat'); const name = inp.value.trim().replace(/\s+/g, ' ');
    if (!name) return inp.focus();
    if (name.toLowerCase() === 'all' || cats().some(c => c.toLowerCase() === name.toLowerCase())) return tell('That category already exists', `There’s already a category called “${name}”.`);
    setMeta('settings', { ...(S.meta.settings || {}), customCats: [...(cfg().customCats || []), name] });
    toast(`Added “${name}”`); rerender();
  },
  delCat: async d => {
    const n = [...S.ex.values()].filter(e => e.category === d.v).length;
    if (n) return tell(`“${d.v}” is still in use`, `${n} exercise${n === 1 ? ' uses' : 's use'} it. Move ${n === 1 ? 'it' : 'them'} to another category in the exercise editor first.`);
    if (!await sure(`Remove “${d.v}”?`, 'No exercises use it, so nothing else changes.', 'Remove category', 'Keep it')) return;
    const cc = { ...(cfg().catColors || {}) }; delete cc[d.v];
    setMeta('settings', { ...(S.meta.settings || {}), customCats: (cfg().customCats || []).filter(c => c !== d.v), catColors: cc });
    if (UI.excat === d.v) UI.excat = 'All';
    rerender();
  },
  reload: () => location.reload(),
};

const IN = {
  rtName: (d, v) => { const r = S.routines.find(x => x.id === d.rid); r.name = v; saveRoutineSoon(r); },
  rt: (d, v) => {
    const r = S.routines.find(x => x.id === d.rid); const it = r.items.find(x => x.uid === d.uid);
    it.target[d.key] = d.kind === 'dur' ? parseDur(v, d.plain) : num(v);
    saveRoutineSoon(r);
    document.getElementById('est').textContent = '~' + fmtLength(routineEst(r));
  },
  rtGroupRest: (d, v) => {
    const r = S.routines.find(x => x.id === d.rid); const sec = parseDur(v);
    r.items.filter(it => it.group === d.group).forEach(it => { it.target.rest = sec; });
    saveRoutineSoon(r); document.getElementById('est').textContent = '~' + fmtLength(routineEst(r));
  },
  sessName: (d, v) => { const c = ctx(d.mode); c.sess.name = v; c.save(); },
  sessNote: (d, v) => { const c = ctx(d.mode); c.sess.note = v; c.save(); },
  itemNote: (d, v) => { const c = ctx(d.mode); findItem(c.sess, d.uid).note = v; c.save(); },
  itemRest: (d, v) => { const c = ctx(d.mode); findItem(c.sess, d.uid).rest = parseDur(v); c.save(); updateSessionCounters(); },
  groupRest: (d, v) => { const c = ctx(d.mode); const sec = parseDur(v); c.sess.items.filter(it => it.group === d.group).forEach(it => { it.rest = sec; }); c.save(); updateSessionCounters(); },
  set: (d, v) => {
    const c = ctx(d.mode); const it = findItem(c.sess, d.uid); const i = +d.set;
    // Stored in kg / km / s per km whatever units are shown.
    const val = parseField(d.kind, v, d.plain);
    it.sets[i][d.key] = val; it.sets[i].touched = true;
    // Carry the value forward into later sets you haven't touched yet.
    for (let j = i + 1; j < it.sets.length; j++) {
      const t = it.sets[j];
      if (t.touched || t.done) continue;
      t[d.key] = val;
      const inp = document.querySelector(`[data-in="set"][data-uid="${d.uid}"][data-set="${j}"][data-key="${d.key}"]`);
      if (inp) inp.value = d.kind === 'dur' || d.kind === 'pace' ? fmtField({ kind: d.kind }, val) : v;
    }
    c.save();
  },
  exName: (d, v) => {
    UI.exDraft.name = v;
    // Live duplicate check: grey out Save and explain, without re-rendering the form.
    const problem = nameProblem(UI.exDraft);
    document.getElementById('exNameNote').textContent = problem;
    document.getElementById('saveExBtn').disabled = !!problem;
  },
  exq: (d, v) => { UI.exq = v; document.getElementById('exlist').innerHTML = exerciseRows(filteredExercises()); },
  pkq: (d, v) => {
    UI.picker.q = v;
    document.getElementById('pklist').innerHTML = pickerList();
    document.getElementById('pkcreate').innerHTML = pickerCreate();
  },
};

const CH = {
  exarch: (d, v, el) => { UI.exarch = el.checked; rerender(); },
  exmus: (d, v) => { UI.exmus = v; rerender(); },
  pkmus: (d, v) => { UI.picker.mus = v; document.getElementById('pklist').innerHTML = pickerList(); },
  exType: (d, v) => {
    const x = UI.exDraft; x.type = v;
    if (isCardio(x)) { x.modality = x.modality || 'row'; x.category = 'Cardio'; if (!x.muscles.length) x.muscles = ['Cardio']; }
    else if (v === 'stretch') x.category = 'Stretch';
    else if (v === 'bodyweight' || v === 'hold') { if (x.category === 'Cardio' || x.category === 'Stretch') x.category = 'Calisthenics'; }
    else if (x.category === 'Cardio' || x.category === 'Stretch') x.category = 'Strength';
    rerender();
  },
  exMod: (d, v) => { UI.exDraft.modality = v; },
  exSide: (d, v, el) => { UI.exDraft.perSide = el.checked; },
  exCat: (d, v) => { UI.exDraft.category = v; },
  cfg: (d, v, el) => {
    const n = num(v); if (n === null || n < 0) { el.value = cfg()[d.key]; return; }
    setMeta('settings', { ...(S.meta.settings || {}), [d.key]: n }); toast('Saved');
  },
  sessTime: (d, v) => { if (!v) return; UI.draft[d.key] = new Date(v).getTime(); },
  catColor: (d, v) => {
    if (!/^#[0-9a-f]{6}$/i.test(v)) return;
    setMeta('settings', { ...(S.meta.settings || {}), catColors: { ...(cfg().catColors || {}), [d.v]: v } }); rerender();
  },
  importFile: (d, v, el) => { const f = el.files?.[0]; el.value = ''; if (f) importFile(f); },
};

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  if (el.tagName !== 'A' || el.dataset.act === 'closeSheet') { if (el.tagName !== 'A') ev.preventDefault(); }
  fn(el.dataset, el, ev);
});
document.addEventListener('input', ev => {
  const el = ev.target; const fn = el.dataset && IN[el.dataset.in];
  if (fn) fn(el.dataset, el.value, el, ev);
});
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.dataset?.in && (el.dataset.kind === 'dur' || el.dataset.kind === 'pace')) { const v = parseDur(el.value, el.dataset.plain); el.value = v === null ? '' : fmtDur(v); }
  const fn = el.dataset && CH[el.dataset.ch];
  if (fn) fn(el.dataset, el.value, el, ev);
});
// Select-all on focus makes overwriting a pre-filled value one tap.
document.addEventListener('focusin', ev => { if (ev.target.matches?.('input.in:not([type=date]):not([type=datetime-local]):not([type=time]):not([type=search]):not([data-in=exName]):not([data-in=rtName]):not(#dlg-in)')) setTimeout(() => ev.target.select?.(), 0); });
// Flush pending writes when the app is backgrounded.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && S.meta.active) { clearTimeout(timers.active); setMeta('active', S.meta.active); }
});

// ---------------- Boot ----------------
async function boot() {
  try {
    await loadAll();
  } catch (e) {
    main().innerHTML = `<div class="empty">Couldn't open storage on this device (${esc(e.message || e)}). If you're in a private browsing tab, open it in a normal tab.</div>`;
    return;
  }
  applyPrefs(); applyTheme();
  if (!location.hash) location.replace('#/' + (S.meta.active ? 'session' : 'train'));
  render();
  // What's new: once per version for existing users; new installs skip it.
  if (S.meta.seenVersion !== APP_VERSION) {
    if (UI.freshInstall) setMeta('seenVersion', APP_VERSION); else openSheet('news');
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      swReg = reg;
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            markUpdateReady();
            toast('Update ready', { act: 'reload', label: 'Reload' });
          }
        });
      });
    }).catch(() => { });
  }
}
boot();
