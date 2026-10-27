# Workout_jfp

A personal workout log that runs as a home-screen app on iPhone and Android. It covers strength, calisthenics, stretching, cardio intervals, zone 2 sessions and bodyweight. It works offline, and all data stays on your phone. Nothing is ever uploaded.

## Install it as an app

Use the app's web address, e.g. `https://jakefp.github.io/Workout/`.

### iPhone / iPad

1. Open the address in **Safari**. Other browsers on iPhone can't install web apps reliably.
2. Tap the **Share** button (the square with an arrow pointing up) at the bottom of the screen.
3. Scroll down and tap **Add to Home Screen**. You can rename it if you like, then tap **Add**.
4. From now on, always open it from the **home-screen icon**:
   - It opens full screen and works offline.
   - The icon version has its own storage, separate from Safari. Workouts logged in a Safari tab don't appear in the icon version, and vice versa. If you started in Safari, use **Settings → Back up** there, then **Restore from backup** in the icon version.

### Android

1. Open the address in **Chrome**.
2. Tap **⋮** (top right), then **Install app**. On some phones this is called **Add to Home screen**.
3. Confirm with **Install**. The app appears in your app drawer and on the home screen.
4. Open it from that icon. It runs full screen and works offline.

Other Android browsers (Samsung Internet, Edge, Firefox) have a similar **Add to Home screen** option in their menu.

## Back up

All your data lives only on the phone.

- Use **Settings → Back up (JSON)** and save the file somewhere safe, such as iCloud Drive or Google Drive. The app reminds you if you go 14 days without a backup.
- **Restore from backup** replaces everything on the phone with the backup: exercises, routines, workout history, weigh-ins, settings and the week plan. Use it after getting a new phone, reinstalling, or moving from a browser tab to the installed app.
- **Sets CSV** gives one row per set. Times are in seconds (`time_s`, `split_s_per_500m`, `pace_s_per_km`), so it loads cleanly into a spreadsheet or pandas.

## Using it

- **Week plan (Train tab):**
  - Step through weeks with ‹ ›.
  - Tap a day, then **+ Plan a routine**. Today's planned routines have a **Start** button, and they're ticked off once you've done them.
  - **Copy last week** repeats last week's plan.
  - **Add week to Calendar** opens your Calendar app with the week's plan as all-day events. Set a time in your calendar if you want one.
- **Times:** type `1.30` or `1:30` for 1 minute 30 seconds. The iPhone number pad has no colon, so `.` works as the separator. A bare number means seconds (`45` → 0:45). The exception is steady-cardio duration, where a bare number means minutes (`45` → 45:00).
- **Logging sets:**
  - Each set is pre-filled from the last time you did that exercise, in any routine.
  - Editing a set carries the value into later sets you haven't touched yet.
  - Tick a set to complete it. Unticked sets are dropped when you finish.
- **Effort:** optionally rate each session from 1 (easy) to 5 (all-out). It feeds the History shading.
- **Personal records:** once an exercise has been logged in two or more sessions, your best-ever set gets a gold highlight and 🥇, and the set flashes gold live when you beat it. "Best" means:
  - **Weights:** kg × reps, so 20 kg × 10 beats 40 kg × 4.
  - **Intervals:** watts × minutes, so 400 W for 1 min beats 199 W for 2 min.
  - **Holds and stretches:** the longest time.
  - **Bodyweight:** reps with your bodyweight plus any added kg.
  - **Steady cardio:** the longest distance.
- **History:**
  - Week, month and year calendars.
  - Each day is shaded from pale to deep orange by how hard it was (minutes × effort). Coloured dots show which categories you trained.
  - Tap a day to see its sessions.
- **Units:** in **Settings → Units**, choose kg or lb for lifting, kg, lb or stone for bodyweight, km or miles for distance, and whether weeks start on Monday or Sunday. Your logged data converts automatically.
- **Categories and colours:** Strength, Calisthenics, Stretch, Cardio and Rehab (red, for rehab isometrics). Change colours, or add your own categories (e.g. CrossFit), in **Settings → Categories**.
- **New exercises:** use **Exercises → + New**, or **+ New exercise** while building a routine. You can also search in the Add exercises list and tap **+ Create**. Each exercise needs a unique name.
- **Bodyweight exercises:** use **± kg** for added load (`+10`) or band/machine assistance (`-15`). Leave it blank for pure bodyweight.
- **Supersets:**
  - In a routine or session, tap **⋯ → Superset with next**. Paired exercises show as A1/A2, and the rest applies after each round.
  - **⋯ → Unpair** splits them again.
- **Routine changes mid-session:** add, remove, swap or reorder freely. When you finish, the app asks whether to save the changes back to the routine.
- **Estimates:** a set lasts reps × 3 s (minimum 20 s), or its hold time, which counts twice for per-side exercises. On top of that come rest between sets and 60 s changeover between exercises. You can change all of these in Settings.

## Updates

New versions install themselves in the background. When one is ready, the app shows **Update ready → Reload**. You can also go to **Settings → Updates → Check for updates**. After an update, a **What's new** list appears once, and you can reopen it from Settings. Your data isn't affected by updates.

## Hosting your own copy

1. Create a **public** GitHub repository. GitHub Pages on the free plan needs this. Only the code is public; your data never leaves the phone.
2. Upload `index.html`, `sw.js`, `manifest.webmanifest` and the `css`, `js` and `icons` folders.
3. Go to **Settings → Pages**, set Source to **Deploy from a branch**, Branch to **main** and folder to **/ (root)**, then click **Save**.
4. After a minute, your address appears there: `https://<your-username>.github.io/<repo-name>/`.

When you change any file, bump `VERSION` in `sw.js` (and `APP_VERSION` in `js/app.js`). Without this, installed apps keep serving the old cached version.

To test on a computer first, run `python3 -m http.server 8000` in the folder and open http://localhost:8000.
