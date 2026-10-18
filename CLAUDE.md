# Workout_jfp

Personal workout-logging PWA (originally called Setlog). In-app text and export file names use `Workout_jfp` / `workout_jfp` via `APP_NAME` / `FILE_PREFIX` in `js/app.js`. The internal names stay `setlog`: `DB_NAME`, and the `app: 'setlog'` marker in backup files, which import checks. The home-screen name (`manifest.webmanifest`, `apple-mobile-web-app-title`) and the repo name are deliberately unchanged.

Hosted on GitHub Pages from the repo root (public repo) and installed on an iPhone via Safari's "Add to Home Screen". Plain HTML/CSS/ES modules: no build step, no dependencies, no framework.

- `index.html`
- `css/app.css`
- `js/app.js`: all views, routing and event handling
- `js/db.js`: IndexedDB layer
- `js/util.js`: types, fields, estimates, metrics
- `js/chart.js`: SVG charts
- `js/seed.js`: starter exercise library
- `sw.js`: offline cache
- `manifest.webmanifest`
- `icons/`

All user data lives in IndexedDB on the phone (DB `setlog`; stores `exercises`, `routines`, `sessions`, `weights`, `meta`) and includes real logged sessions that must be kept. The app makes no network requests apart from loading its own files.

## Rules

- **Bump `VERSION` in `sw.js` on every change to any file.** Without this, the installed app keeps serving the old cached version. Keep `APP_VERSION` in `js/app.js` in step.
- If you add a new file, add it to the `SHELL` list in `sw.js` so it works offline.
- **The user's data is precious.**
  - Never rename IndexedDB stores, keys or record fields, and never delete stores.
  - If the data shape must change, add a migration that upgrades existing records on load. Records saved by older versions must still load and render correctly.
  - Keep `DB_NAME` as `setlog`. Only increase `DB_VERSION`, and only together with an `onupgradeneeded` migration.
- `seed.js` only runs on a fresh install. New seed exercises won't reach the existing install unless a migration adds them, checking by name to avoid duplicates.
- Use relative paths only (`./`, `js/…`), because the site is served from `/<repo-name>/`. Don't rename the repo: that changes the URL, and the phone would treat it as a new app with empty storage.
- Never commit backup or export files (`setlog-*.json`, `workout_jfp-*.json`, `*.csv`, `*.ics`). They contain personal data and the repo is public.
- No network calls, analytics or external CDNs. Everything must work offline.
- Keep the look consistent: colour tokens are on `:root` in `css/app.css`, and the theme is Auto (follows the system) / Light / Dark via `data-theme` on `<html>`, set in Settings. Design for iPhone width first.

## Testing

- Run `python3 -m http.server 8000` and check http://localhost:8000 at iPhone width (390px) in light and dark mode.
- Before finishing any change, check that a session logged before the change still shows correctly in History, in the exercise charts, and in the "Last" line when logging.
- Check that the Settings backup export/import and the CSV exports still work.

## Data model

- **Exercise:** `{ id, name, type, category, muscles[], perSide, modality, archived, custom }`
  - `type`: weight | bodyweight | hold | stretch | interval | steady
  - `modality` (cardio only): row | ski | bike | run | other
- **Routine:** `{ id, name, created, items: [{ uid, exId, group, target: { sets, reps, time, rest } }] }`
  - Consecutive items with the same `group` form a superset.
- **Session:** `{ id, routineId, name, start, end, estSec, note, effort, items: [{ uid, exId, group, target, rest, note, sets: [{ id, done, kg, reps, time, watts, split, pace, cadence, dist, hr }] }] }`
  - Times are stored in seconds.
  - `effort` (1–5, optional: 1 easy, 3 moderate, 5 all-out) was added in v1.1.0. Older sessions don't have it. It is intended as the intensity input for a future fitness/fatigue chart.
- **Weight:** `{ date: 'YYYY-MM-DD', kg }`, one per day.
- **Meta:** `{ key, value }`. Keys: `active` (in-progress session), `settings` (estimate numbers plus `theme`: auto | light | dark), `plan`, `lastBackup`, `firstUse`, `seeded`.
- **Plan** (meta `plan`, v1.1.0): `{ 'YYYY-MM-DD': [{ id, routineId }] }`. A planned entry counts as done when a session with that `routineId` starts on that date. It is included in the JSON backup as `plan`.
