// Period Tracker — single source of truth for period/cycle data.
//
// Replaces the old split between `loggedDates` (a Set of individual ISO days)
// and `historicalCycles` (a static, hand-authored array of {title, subtitle,
// dots} per year — designed as a one-time mock, never updated when a real
// period was logged). Every view (Home calendar, log calendar, History list,
// Year View, Cycle Details, Google Sheets export) now derives everything it
// shows from this one module, so they can no longer disagree with each other.
//
// Only one fact is ever persisted: `periodTrackerPeriods`, an array of
// { id: string, startDate: "YYYY-MM-DD", periodDayCount: number }. Cycle
// length, fertile window, and ovulation day are always *computed*, never
// stored — so there is only one place that can get them wrong, and nothing
// to keep in sync. `id` is a stable per-cycle identity (independent of
// startDate) that lets a cycle be *edited* in place — locally and in the
// synced Google Sheet — rather than only ever added/removed wholesale. Any
// period object read from storage without one (pre-existing data from before
// `id` existed) is backfilled the first time it's read; see getPeriods().
const PeriodModel = (() => {
  const LS_PERIODS = 'periodTrackerPeriods';
  const LS_HISTORY_LEGACY = 'periodTrackerHistory';
  const LS_LOGGED_LEGACY = 'periodTrackerLoggedDates';

  // Days immediately before a period's start date flagged as "premenstrual"
  // in classifyDate(). Exported so callers deriving the same window for a
  // *predicted* (not-yet-logged) period reuse this value instead of a second
  // hardcoded copy.
  const PREMENSTRUAL_WINDOW_DAYS = 3;

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function periodEnd(period) {
    return DateUtils.toISODate(DateUtils.addDays(DateUtils.parseISODate(period.startDate), period.periodDayCount - 1));
  }

  // Sorts by start date and merges any periods that overlap or are adjacent
  // (gap-free) into one, so addPeriod() can never create two overlapping
  // entries for the same days. Also the single place that guarantees every
  // period carries an `id` — one is generated for any period missing one.
  // When two periods merge, the earlier-starting one's id wins (periods are
  // sorted ascending, so that's always `last`, already untouched below).
  function normalize(periods) {
    const sorted = periods.slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
    const merged = [];
    for (const p of sorted) {
      if (merged.length === 0) {
        merged.push({ id: p.id || generateId(), startDate: p.startDate, periodDayCount: p.periodDayCount });
        continue;
      }
      const last = merged[merged.length - 1];
      const lastEndDate = DateUtils.parseISODate(periodEnd(last));
      const dayAfterLastEnd = DateUtils.toISODate(DateUtils.addDays(lastEndDate, 1));
      if (p.startDate <= dayAfterLastEnd) {
        const pEndDate = DateUtils.parseISODate(periodEnd(p));
        const newEndDate = pEndDate > lastEndDate ? pEndDate : lastEndDate;
        last.periodDayCount = DateUtils.daysBetween(last.startDate, DateUtils.toISODate(newEndDate)) + 1;
      } else {
        merged.push({ id: p.id || generateId(), startDate: p.startDate, periodDayCount: p.periodDayCount });
      }
    }
    return merged;
  }

  // Runs once, only when periodTrackerPeriods doesn't exist yet. Legacy keys
  // are read but never deleted — if anything here is wrong, deleting this
  // module's own commit is a full rollback.
  function migrateLegacy() {
    const periods = [];

    try {
      const hist = localStorage.getItem(LS_HISTORY_LEGACY);
      if (hist) {
        const historicalCycles = JSON.parse(hist);
        for (const yearGroup of historicalCycles) {
          for (const cycle of yearGroup.cycles) {
            const sep = cycle.subtitle.includes('–') ? '–' : '-';
            const parts = cycle.subtitle.split(sep).map(s => s.trim());
            let d = new Date(parts[0] + ', ' + yearGroup.year);
            if (isNaN(d)) d = new Date(parts[0]);
            if (!isNaN(d)) {
              const periodDayCount = cycle.dots ? cycle.dots.filter(x => x === 'p').length : 5;
              periods.push({ startDate: DateUtils.toISODate(d), periodDayCount });
            }
          }
        }
      }
    } catch (e) {}

    try {
      const rawLogged = localStorage.getItem(LS_LOGGED_LEGACY);
      if (rawLogged) {
        const loggedDays = JSON.parse(rawLogged).slice().sort();
        let run = null;
        for (const ds of loggedDays) {
          if (run && DateUtils.daysBetween(run.lastDate, ds) === 1) {
            run.count++;
            run.lastDate = ds;
          } else {
            if (run) periods.push({ startDate: run.startDate, periodDayCount: run.count });
            run = { startDate: ds, lastDate: ds, count: 1 };
          }
        }
        if (run) periods.push({ startDate: run.startDate, periodDayCount: run.count });
      }
    } catch (e) {}

    return normalize(periods);
  }

  // ── Pure variants (operate on a given array, never touch localStorage) ──
  // The log-calendar view uses these against an in-memory staged copy so
  // "Cancel" can discard taps without persisting them — only "Save" commits
  // via the persisted wrappers below, matching the original Save/Cancel UX.
  function addPeriodTo(periods, startDate, dayCount = 5, id) {
    return normalize([...periods, { id, startDate, periodDayCount: dayCount }]);
  }

  function removePeriodFrom(periods, startDate) {
    return normalize(periods.filter(p => p.startDate !== startDate));
  }

  // Edits a period *in place*, preserving its id (unlike remove+add, which
  // would hand it a new one) — this is what lets the same cycle be matched
  // and patched in the synced Google Sheet rather than treated as a new row.
  // No-ops (returns `periods` unchanged) if `id` isn't found.
  function updatePeriodTo(periods, id, { startDate, periodDayCount } = {}) {
    const existing = periods.find(p => p.id === id);
    if (!existing) return periods;
    const rest = periods.filter(p => p.id !== id);
    return normalize([...rest, {
      id,
      startDate: startDate !== undefined ? startDate : existing.startDate,
      periodDayCount: periodDayCount !== undefined ? periodDayCount : existing.periodDayCount,
    }]);
  }

  // Returns the raw logged period (start date + day count) covering dateStr,
  // or null. Used by the log calendar to know what a tap should toggle —
  // clearing the period this returns clears the whole real block, not a
  // fixed-size slice from the tapped date.
  function findPeriodIn(periods, dateStr) {
    for (const p of periods) {
      if (dateStr >= p.startDate && dateStr <= periodEnd(p)) return p;
    }
    return null;
  }

  // ── Persisted wrappers ───────────────────────────────────────────
  // Reads stored periods, backfilling an `id` onto any that predate the
  // field existing (and persisting that backfill) so every caller can rely
  // on `id` always being present.
  function getPeriods() {
    try {
      const raw = localStorage.getItem(LS_PERIODS);
      if (raw) {
        const parsed = JSON.parse(raw);
        let changed = false;
        const withIds = parsed.map(p => {
          if (p.id) return p;
          changed = true;
          return { ...p, id: generateId() };
        });
        if (changed) localStorage.setItem(LS_PERIODS, JSON.stringify(withIds));
        return withIds;
      }
    } catch (e) {}
    const migrated = migrateLegacy();
    localStorage.setItem(LS_PERIODS, JSON.stringify(migrated));
    return migrated;
  }

  function setPeriods(periods) {
    const normalized = normalize(periods);
    localStorage.setItem(LS_PERIODS, JSON.stringify(normalized));
    return normalized;
  }

  function addPeriod(startDate, dayCount = 5) {
    return setPeriods(addPeriodTo(getPeriods(), startDate, dayCount));
  }

  function removePeriod(startDate) {
    return setPeriods(removePeriodFrom(getPeriods(), startDate));
  }

  // Persisted edit-in-place. Any logged cycle can be edited, regardless of
  // age — see README's "What broke before" #8 for why the old 90-day window
  // was removed.
  function updatePeriod(id, changes) {
    return setPeriods(updatePeriodTo(getPeriods(), id, changes));
  }

  function findPeriodContaining(dateStr) {
    return findPeriodIn(getPeriods(), dateStr);
  }

  // Weighted moving average of the last up to 6 known cycle lengths, most
  // recent weighted highest ([1,2,...,k]). Falls back to 28 with no history.
  // Exposed publicly so it's independently testable and so any future caller
  // (e.g. a dev-console backtest) has exactly one formula to call, not two
  // copies that could quietly drift apart.
  function estimateCycleLength(knownLengths) {
    if (!knownLengths.length) return 28;
    const k = Math.min(knownLengths.length, 6);
    const recent = knownLengths.slice(-k);
    const weights = Array.from({ length: k }, (_, i) => i + 1);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const weighted = recent.reduce((sum, len, i) => sum + len * weights[i], 0);
    return Math.round(weighted / weightSum);
  }

  // Computed cycle records, one per period, sorted chronologically. Every
  // field beyond startDate/periodDayCount is derived, never stored:
  //  - periodEndDate: last day of actual bleeding (startDate + periodDayCount - 1)
  //  - endDate: last day of the whole cycle (day before the next period starts)
  //  - cycleLength / ovulationDate / fertileWindow: known for every period
  //    except the most recent one, which is estimated via a recency-weighted
  //    average of the last up to 6 prior cycles (28 days if there's no prior
  //    data) and flagged predicted:true so callers can label it differently
  //    and the Sheets export can leave it blank rather than writing a guess
  //    as fact.
  function computeCycles(periods = getPeriods()) {
    const sorted = periods.slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
    const knownLengths = [];
    for (let i = 1; i < sorted.length; i++) {
      knownLengths.push(DateUtils.daysBetween(sorted[i - 1].startDate, sorted[i].startDate));
    }
    const avgLength = estimateCycleLength(knownLengths);

    return sorted.map((p, i) => {
      const isLatest = i === sorted.length - 1;
      const cycleLength = isLatest ? avgLength : DateUtils.daysBetween(p.startDate, sorted[i + 1].startDate);
      const startD = DateUtils.parseISODate(p.startDate);
      const periodEndDate = DateUtils.toISODate(DateUtils.addDays(startD, p.periodDayCount - 1));
      const endDate = DateUtils.toISODate(DateUtils.addDays(startD, cycleLength - 1));

      // Standard luteal-phase estimate: ovulation ~14 days before the next period.
      const ovulationOffset = cycleLength - 14;
      let ovulationDate = null;
      let fertileWindow = null;
      let ovulationDayNumber = '';
      if (ovulationOffset >= 1) {
        ovulationDayNumber = ovulationOffset;
        ovulationDate = DateUtils.toISODate(DateUtils.addDays(startD, ovulationOffset));
        const fertileStartOffset = Math.max(p.periodDayCount, ovulationOffset - 4);
        fertileWindow = {
          start: DateUtils.toISODate(DateUtils.addDays(startD, fertileStartOffset)),
          end: DateUtils.toISODate(DateUtils.addDays(startD, ovulationOffset + 1)),
        };
      }

      return {
        id: p.id,
        startDate: p.startDate,
        periodDayCount: p.periodDayCount,
        periodEndDate,
        endDate,
        cycleLength,
        ovulationDate,
        ovulationDayNumber,
        fertileWindow,
        predicted: isLatest,
      };
    });
  }

  // 'period' | 'fertile' | 'ovulation' | 'premenstrual' | null for one date.
  // Pass a precomputed `cycles` array when classifying many dates in a loop
  // (e.g. rendering a whole calendar month) to avoid recomputing on every
  // call.
  function classifyDate(dateStr, cycles = computeCycles()) {
    for (const c of cycles) {
      if (dateStr >= c.startDate && dateStr <= c.periodEndDate) return 'period';
      if (c.fertileWindow && dateStr >= c.fertileWindow.start && dateStr <= c.fertileWindow.end) {
        return dateStr === c.ovulationDate ? 'ovulation' : 'fertile';
      }
    }
    // Second pass so 'period'/'fertile'/'ovulation' always take priority
    // over a premenstrual window that happens to overlap them on a short
    // cycle (a date is only ever "premenstrual" once every actual period
    // has had first claim on it).
    for (const c of cycles) {
      const premenstrualStart = DateUtils.toISODate(
        DateUtils.addDays(DateUtils.parseISODate(c.startDate), -PREMENSTRUAL_WINDOW_DAYS)
      );
      if (dateStr >= premenstrualStart && dateStr < c.startDate) return 'premenstrual';
    }
    return null;
  }

  return {
    getPeriods, setPeriods, addPeriod, removePeriod, updatePeriod, findPeriodContaining,
    addPeriodTo, removePeriodFrom, updatePeriodTo, findPeriodIn,
    computeCycles, classifyDate, estimateCycleLength,
    PREMENSTRUAL_WINDOW_DAYS,
  };
})();
