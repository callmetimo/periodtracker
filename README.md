# Period Tracker

A client-only, no-backend period-tracking web app. Plain HTML/CSS/JS, no build step, no framework, no package manager — every file is served exactly as written. Deployed to GitHub Pages at [callmetimo.github.io/periodtracker](https://callmetimo.github.io/periodtracker/).

This README exists so that future bug fixes and features don't accidentally re-introduce problems that were already found and fixed once (see [What broke before](#what-broke-before-and-why-it-matters)). Read it before making non-trivial changes.

## How it's deployed

`.github/workflows/deploy.yml` uploads the repo **as-is** to GitHub Pages on every push to `main`. There is no build step, no bundler, no minification, no environment-variable substitution — whatever is in the files on `main` is what's live within about 30 seconds of pushing. This means:

- Don't leave debug code, console noise, or half-finished features on `main`.
- `config.js`'s `GOOGLE_CLIENT_ID` is committed in plain text. That's intentional — it's a public OAuth *client* ID (not a secret), and there's no build step to inject it otherwise.
- **Never commit real personal data to this repo.** It's public. See [What broke before](#what-broke-before-and-why-it-matters).

## Architecture

### Data flow (read this first)

```
PeriodModel (period-model.js)
    │  the ONLY source of truth: periodTrackerPeriods = [{startDate, periodDayCount}, ...]
    │  everything else is COMPUTED, never stored
    ▼
computeCycles() → [{startDate, periodEndDate, endDate, cycleLength,
                     ovulationDate, ovulationDayNumber, fertileWindow, predicted}, ...]
    │
    ├─→ app.js: Home calendar, log calendar, History list, Year View, Cycle Details, home stats
    └─→ data-store.js: buildRows() → Google Sheets export
```

**Everything traces back to one array.** If the Home calendar, History list, Year View, and your Google Sheet ever disagree with each other again, the bug is almost certainly that something bypassed `PeriodModel` and read/wrote data on its own. Before this was fixed (Aug 2026), the app had two independent, hand-maintained data sources (`loggedDates` and `historicalCycles`) that silently drifted apart — that's exactly the failure mode to avoid reintroducing.

### File map

| File | Role |
|---|---|
| `index.html` | Static markup for all views. JS populates content into named containers/IDs. |
| `config.js` | OAuth client ID + scope. No logic. |
| `date-utils.js` (`DateUtils`) | The **only** place that converts between `Date` objects and `"YYYY-MM-DD"` strings. |
| `period-model.js` (`PeriodModel`) | The **only** source of truth for period/cycle data, and the only place that computes cycle length / fertile window / ovulation. |
| `seed-data.js` | First-launch placeholder data only. Must never contain real dates (see below). |
| `sheets-client.js` (`SheetsClient`) | Thin fetch wrapper over the Sheets/Drive REST APIs. No business logic. |
| `data-store.js` (`DataStore`) | Bridges `PeriodModel` ↔ Google Sheets. Bootstrap, sync/reconcile, row building. |
| `auth.js` (`Auth`) | Google Identity Services sign-in, the two-phase deferred-token scheme for iOS. |
| `app.js` | Everything else: rendering views from `PeriodModel`, event handlers, navigation. |
| `style.css` | No preprocessor. Custom properties in `:root`. No `@media` queries except one (short/landscape viewports). |

`Auth`, `DataStore`, `SheetsClient`, `PeriodModel`, `DateUtils` are IIFE modules exposing a small public API (`const X = (() => { ...; return {...}; })();`). `app.js` is the one file that still uses bare global functions/variables — that's a known inconsistency, not a pattern to copy into new code. If you're adding a substantial new piece of logic, wrap it the same way the other modules are wrapped.

### Script load order matters

```html
config.js → date-utils.js → period-model.js → sheets-client.js → data-store.js → auth.js → seed-data.js → app.js
```

Each script uses globals defined by the ones before it (e.g. `period-model.js` calls `DateUtils.*`, `data-store.js` calls `PeriodModel.*`). If you add a new module, insert it in dependency order, not alphabetically or at the end.

### The two-phase auth scheme (don't "simplify" this away)

`auth.js`'s header comment explains it in detail, but the short version: **iOS Safari in a home-screen/PWA context blocks Google's silent sign-in**, so a returning user (cached `spreadsheetId`) launches straight into the app from local cache with no splash screen, and the actual Google token is only requested on the user's **first real tap anywhere** (a genuine user gesture, which iOS allows to open a popup). `app.js`'s `DOMContentLoaded` handler registers that one-shot listener. If it's ever missing again, every Sheets sync for a returning user hangs — this exact bug existed until Aug 2026 and was fixed by adding the listener and bounding `getAccessToken()`'s wait with a timeout. If you touch `auth.js`, keep both pieces: the listener registration in `app.js` *and* the timeout in `getAccessToken()`.

That same one-shot listener also calls `DataStore.syncReconcile()` (and re-renders) once the token comes back — a returning user has no other automatic trigger to actually read the sheet on open, so skipping this step means the app can go a whole session without ever reflecting an edit made in the sheet. See "What broke before" #8.

### Sync model: Google Sheets is the durable source of truth

`localStorage` (`periodTrackerPeriods`) is a fast local cache. The user's Google Sheet ("Period Tracker Data") is the durable record, meant to survive a new device, a cleared browser, or a reinstall.

- `DataStore.syncReconcile()` is the **only** correct way to push local changes to the sheet. It reads the sheet back and does a 3-way merge per cycle (keyed by `id`, falling back to `startDate` for pre-id rows) against `periodTracker_lastSyncedRows` — a snapshot of what the app itself last wrote. Whichever side (cloud or local) actually diverged from that baseline wins — **including a side's own absence**: an id missing from the sheet (deleted) or missing from local (deleted, or merged into a neighbor by `PeriodModel.normalize()`) is respected as gone, not resurrected from the other side, as long as that other side still matches the baseline. This is what lets a manual sheet edit (shrinking `periodDayCount`, adding a row for a missed period, deleting a bad row) and an in-app edit that merges two cycles together both stick instead of being reverted on the next sync. Only *then* does it write the merged result back.
- `DataStore.saveData()` blindly clears and overwrites the whole sheet with whatever `PeriodModel` currently has. It does **not** reconcile. It's only safe to call directly right after creating a brand-new spreadsheet (nothing to lose yet). **Never call `saveData()` directly from anywhere that might run against an existing populated sheet — always go through `syncReconcile()`.** Calling `saveData()` on an existing sheet from a fresh/near-empty local state is exactly the bug that used to silently destroy a user's real history on second-device sign-in.
- `DataStore.loadData()` returns `[]` for "the sheet was read successfully and is genuinely empty" and `null` for "the read failed." These are not interchangeable. Treating a failed read as "the cloud is empty" is how data gets destroyed — see `syncReconcile()`'s own guard for the pattern to follow if you touch this code.

## Do's and don'ts

**Do**

- Add new period/cycle logic to `period-model.js` and expose it through `PeriodModel`'s public API. Keep it pure where possible (see `addPeriodTo`/`removePeriodFrom`/`findPeriodIn` — array-in-array-out, no localStorage access — vs. the persisted `addPeriod`/`removePeriod`/`findPeriodContaining` wrappers). The pure variants exist so the log-calendar view can stage edits in memory and let Cancel discard them without touching localStorage.
- Add new date math to `date-utils.js`. Always parse `"YYYY-MM-DD"` strings via `DateUtils.parseISODate()`, never `new Date(isoString)` — the latter is parsed as **UTC midnight** by spec, while everything else in this app works in **local midnight**. This exact mismatch caused Google Sheets exports to be off by a day for users at negative UTC offsets; fixed once, don't reintroduce it anywhere new.
- Keep `Auth`/`DataStore`/`SheetsClient`/`PeriodModel`/`DateUtils` doing one job each. `SheetsClient` should stay a dumb fetch wrapper with zero period/cycle knowledge; `DataStore` is the only thing that should call it.
- Test logic changes to `period-model.js` / `date-utils.js` / `data-store.js` in a real browser before pushing, not just by reading the diff — this app has no test suite, and its own commit history includes several bugs that were "obviously correct" on paper but wrong in practice (a mid-block tap only clearing a 5-day slice; two CSS rules with equal specificity where the "losing" one made text invisible). A local static server (`python3 -m http.server`) + the browser devtools console is enough; you can monkey-patch `SheetsClient`'s methods to test `DataStore` without hitting the real API.
- When adding a UI element the user taps or clicks, give it a real accessible name and keyboard path (`role`, `tabindex`, `aria-label`, a `keydown` handler for Enter/Space) if it isn't already a native `<button>`. See the log-calendar day cells or history cards in `app.js` for the pattern.
- Keep new/changed color pairs at ≥4.5:1 contrast for normal-size text. `--primary-color` (`#FF5A7E`) is only ~3:1 against white — use `--primary-color-contrast` (`#D62E54`) instead for any text/icon that sits directly on a primary-colored background. `--primary-color` stays reserved for decorative-only uses (rings, dots) where no text sits on top of it.
- Follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`) and, after pushing, list what was pushed with a ✅ per commit — see `.agents/rules/github_commits.md`.

**Don't**

- Don't put real personal data anywhere in this repo — not in `seed-data.js`, not in a code comment as an "example," nowhere. This repo is **public**. In Aug 2026, `seed-data.js` had years of the user's real cycle history hardcoded and publicly exposed since the very first commit; it had to be purged from the entire git history with `git-filter-repo` and force-pushed. `seed-data.js` must only ever contain obviously-fake placeholder dates, and it must only seed `localStorage` when there's truly nothing there yet (never unconditionally overwrite on every load — that was also a real bug: it silently clobbered real history on every single app launch).
- Don't call `DataStore.saveData()` directly except right after creating a brand-new spreadsheet. Use `syncReconcile()` everywhere else.
- Don't reintroduce a second, independent copy of period/cycle data (a new Set, a new array, a new "just for this one view" cache). If a view needs different data than `PeriodModel.computeCycles()` gives you, add a parameter or a new `PeriodModel` function — don't compute it separately in `app.js`.
- Don't add a CSS rule for a class that's already styled elsewhere without checking for an existing rule first. This codebase has already had bugs from exactly that: two declarations of `.cal-day.logged-period` with conflicting values (one made text invisible), two declarations of `.cal-day.period .cal-day-ring` (harmless but dead), and a CSS `::after` checkmark that silently duplicated a JS-inserted checkmark span. Before adding a rule, `grep` the selector in `style.css` first.
- Don't assume `new Date(someString)` behaves the same way for every string shape. `new Date("2026-01-01")` (ISO date-only) is UTC midnight; `new Date("Jan 1, 2026")` (freeform) is local midnight; `new Date(2026, 0, 1)` (Y/M/D integers) is local midnight. Mixing these is exactly how the timezone bug happened. Use `DateUtils` instead of reasoning about this from scratch.
- Don't skip a manual test of the actual second-device / fresh-install scenario when touching `bootstrap()`, `syncReconcile()`, or `loadData()`. This is the code path that protects a real user's only copy of their data; the previous version of it destroyed real Google Sheet data on second-device sign-in, and that class of bug is easy to write and easy to miss in review.
- Don't add a `@media` query without checking the existing one (`max-height: 600px`, for the log-calendar bottom sheet on short/landscape viewports) — extend it rather than adding an overlapping second breakpoint.

## What broke before (and why it matters)

A full audit in Aug 2026 found and fixed the following. If you're bug-hunting and something looks similar to one of these, you may be looking at a regression rather than a new bug:

1. **Real personal data was publicly exposed** in `seed-data.js` since the first commit. Purged via `git-filter-repo`. Never let this happen again — see the "Don't" above.
2. **Second-device sign-in could silently destroy real Google Sheet history** — `bootstrap()` used to call `saveData()` unconditionally, overwriting the cloud sheet with whatever (possibly near-empty) local state existed. Fixed by `syncReconcile()`'s merge-only-add logic.
3. **Auto-sync silently hung forever** for returning users — the "first tap unlocks the OAuth token" listener the code's own comments described didn't actually exist anywhere. Fixed by registering it in `app.js` and bounding the wait with a timeout in `auth.js`.
4. **Logged period-day numbers were invisible** (white text on a white background) for any date outside the current real-world month — a CSS specificity/cascade bug from rushed incremental patches.
5. **Home calendar, History list, Year View, and the Sheets export could all show different things** for the same underlying data, because they read from two independent, hand-maintained data sources that nothing kept in sync. Fixed by `PeriodModel` being the single source of truth for everyone.
6. **Sheets-exported dates were off by one day** for users at negative UTC offsets, from mixing `new Date(isoString)` (UTC) and `new Date(y,m,d)` (local) date construction. Fixed by `DateUtils`.
7. **Tapping the middle of an already-logged period only cleared a fixed 5-day window from the tap point**, leaving orphaned partial ranges — fixed by `PeriodModel.findPeriodIn` finding the actual contiguous block regardless of which day inside it was tapped.
8. **Manual edits made directly in the Google Sheet were always reverted (or never showed up at all)** — two compounding bugs. First, `syncReconcile()` used to keep whichever side had the larger `periodDayCount`, a rule that could only add data, never accept a correction; fixed by replacing it with a 3-way merge against `periodTracker_lastSyncedRows` (a snapshot of what the app itself last wrote) — see the "Sync model" section above. Second, and more fundamentally, a **returning user's Google Sheet was never actually read on app open at all** — `Auth.start()`'s returning-user path only deferred obtaining an OAuth token to the first tap; nothing then called `DataStore.syncReconcile()` automatically. A sync only ever happened as a side effect of pressing "Sync Now," logging a period, or editing a cycle in-app — so opening the app and looking, without doing one of those, would show stale local data indefinitely, and any sync that *did* happen was subject to bug #1 above. Fixed by having the first-tap handler in `app.js` call `DataStore.syncReconcile()` (and re-render) right after the token is obtained, so opening the app and tapping anywhere now genuinely pulls fresh sheet data.
9. **Editing history was capped at a 90-day window**, enforced only in `app.js`'s UI gating (`isWithinEditWindow`/`EDIT_WINDOW_DAYS` in `period-model.js`), which made the in-app editor useless for fixing older mistakes (missed logs, wrong period lengths going back years) — the sheet-editing route from bug #8 was the only way to reach them. The guardrail's purpose (stop "edit" from becoming a backdoor for silently rewriting old history predictions depend on) turned out to be low-risk in practice: `estimateCycleLength()` only ever averages the most recent 6 cycle gaps, so editing something years old can't affect current predictions. Removed entirely — any logged cycle can now be edited in-app regardless of age.
10. **In-app edits that merged one cycle into a neighbor (e.g. moving a cycle's Start Date to match an existing one, to fix a spurious extra log) got silently un-done on the next sync.** `PeriodModel.normalize()` correctly absorbed the edited cycle's id into its neighbor locally — but `syncReconcile()`'s per-id merge only recognized a deletion when a row *disappeared from the sheet*; since the sheet still held the old, unedited row, the merge saw "sheet unchanged, local doesn't have this id" and concluded the sheet must be right, resurrecting the very row the edit had just merged away. Fixed by changing the merge rule to: whichever side (cloud or local) actually diverged from `periodTracker_lastSyncedRows` wins, *including a side's own absence* — so an id that's gone from local (because it got merged/deleted) stays gone as long as the sheet hasn't independently changed it.

## Explicitly out of scope (known gaps, not bugs)

These were identified but deliberately not built, to keep past changes reviewable and low-risk. They're reasonable candidates for a future feature, not things to "fix" as a side effect of an unrelated change:

- **Not an installable/offline PWA.** No `manifest.json`, no service worker, despite `auth.js`'s comments discussing iOS PWA behavior — those comments describe auth *workarounds* for a home-screen web app, not an actual PWA shell.
- **No automated tests.** All verification for this project has been manual, in a real browser, against mocked network calls where needed. If you add a build step or test runner, update this README.
- **Calendar accessibility is button-per-cell, not a full ARIA grid.** Day cells have `role="button"`/`tabindex`/keyboard support, but there's no `role="grid"`/roving-tabindex pattern.
- **Sheets export schema is fixed at 5 columns** (Start Date, End Date, Cycle Length, Period Days, Ovulation Day). Adding richer tracked data (symptoms, flow intensity, notes) means designing a schema migration, not just adding a column.
