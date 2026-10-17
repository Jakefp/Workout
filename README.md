# Setlog

A personal workout log that runs as a home-screen web app on iPhone. It covers strength, calisthenics, stretching, cardio intervals, zone 2 sessions and bodyweight. It works offline, and all data stays on your phone.

## 1. Put it on GitHub Pages (one-off, ~5 minutes)

1. Sign in at github.com and click **New repository**.
   - Name it `setlog`, or anything else (the name becomes part of the URL).
   - Set it to **Public**. GitHub Pages on the free plan needs this, and only the code is public. Your data never leaves the phone.
   - Create the repository.
2. On the empty repo page, click **uploading an existing file**.
   - Unzip `setlog.zip` on your Mac.
   - Drag in **everything inside** the `setlog` folder: `index.html`, `sw.js`, `manifest.webmanifest`, and the `css`, `js` and `icons` folders.
   - Click **Commit changes**.
3. Go to **Settings → Pages**.
   - Under *Build and deployment*, set Source to **Deploy from a branch**, Branch to **main** and folder to **/ (root)**.
   - Click **Save**.
4. After a minute or so, the page shows your URL: `https://<your-username>.github.io/setlog/`.

## 2. Install on your iPhone

1. Open that URL in **Safari**. It has to be Safari, not Chrome.
2. Tap **Share → Add to Home Screen → Add**.
3. Always open it from the home-screen icon. That copy has its own storage, which iOS won't clear for inactivity. The Safari tab version keeps separate data.

## 3. Back up

All your data lives only on the phone.

- Use **Settings → Back up (JSON)** and save the file to iCloud Drive. The app nags you if you go 14 days without a backup.
- **Restore from backup** replaces everything on the phone with the backup file. Use it after a new phone or a reinstall.
- **Sets CSV** gives one row per set. Times are stored in seconds (`time_s`, `split_s_per_500m`, `pace_s_per_km`), so it loads cleanly into pandas.

## Using it

- **Times:** type `1.30` or `1:30` for 1 minute 30 seconds. The iPhone number pad has no colon, so `.` works as the separator. A bare number means seconds (`45` → 0:45). The one exception is steady-cardio duration, where a bare number means minutes (`45` → 45:00).
- **Logging sets:**
  - Each set is pre-filled from the last time you did that exercise, in any routine.
  - Editing a set carries the value into later sets you haven't touched yet.
  - Tick a set to complete it. Unticked sets are dropped when you finish.
- **Bodyweight exercises:** use **± kg** for added load (`+10`) or band/machine assistance (`-15`). Leave it blank for pure bodyweight.
- **Supersets:**
  - In a routine or session, tap **⋯ → Superset with next**. Paired exercises show as A1/A2, and the rest applies after each round.
  - **⋯ → Unpair** splits them again.
- **Routine changes mid-session:** add, remove, swap or reorder freely. When you finish, the app asks whether to save the changes back to the routine. Cancel keeps the routine as it was.
- **Estimates:** a set lasts reps × 3 s (minimum 20 s), or its hold time, which counts twice for per-side exercises. On top of that come rest between sets and 60 s changeover between exercises. You can change all of these in Settings.

## Updating the app later

1. Edit or replace files in the GitHub repo.
2. **Bump `VERSION` in `sw.js`**, for example `setlog-v1.0.1`. Without this step, phones keep the cached old version.
3. Next time you open the app, an **Update ready → Reload** prompt appears.

Your data isn't affected by updates.

## Test it on your Mac first (optional)

In Terminal, run:

```
cd path/to/setlog
python3 -m http.server 8000
```

Then open http://localhost:8000 in a browser.
