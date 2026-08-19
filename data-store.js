// Period Tracker — structured Google Sheets data layer.
// Writes one row per cycle with labeled columns instead of raw JSON blobs.

const DataStore = (() => {
  const LS_SS_ID = 'periodTracker_spreadsheetId';
  let spreadsheetId = localStorage.getItem(LS_SS_ID) || null;

  // Snapshot of {startDate, periodDayCount} per id, keyed by id, as of the
  // last successful saveData() write. This is the 3-way-merge baseline:
  // syncReconcile() compares the cloud sheet against *this*, not against
  // local, to tell "the user edited the sheet" (cloud differs from what we
  // last wrote there) apart from "this is just our own value echoed back."
  // Without this, a value the app itself computed and wrote would look
  // indistinguishable from a real edit on every subsequent sync.
  const LS_LAST_SYNCED = 'periodTracker_lastSyncedRows';

  function getLastSynced() {
    try {
      return JSON.parse(localStorage.getItem(LS_LAST_SYNCED)) || {};
    } catch (e) {
      return {};
    }
  }

  function setLastSynced(snapshot) {
    localStorage.setItem(LS_LAST_SYNCED, JSON.stringify(snapshot));
  }

  // ── ROW BUILDER ───────────────────────────────────────────────
  // Builds structured sheet rows straight from PeriodModel — the single
  // source of truth also used by every in-app view. cycleLength/endDate/
  // ovulationDay are left blank for the most recent (still-open) cycle
  // rather than writing PeriodModel's average-based *estimate* as if it
  // were a fact in the user's permanent record.
  function buildRows() {
    const cycles = PeriodModel.computeCycles();
    if (!cycles.length) return null;

    const header = [
      'Start Date',
      'End Date',
      'Cycle Length (days)',
      'Period Days',
      'Ovulation Day (day # in cycle)',
      'ID',
    ];

    const dataRows = cycles.map(c => [
      c.startDate,
      c.predicted ? '' : c.endDate,
      c.predicted ? '' : c.cycleLength,
      c.periodDayCount,
      c.predicted ? '' : c.ovulationDayNumber,
      c.id,
    ]);

    return [header, ...dataRows];
  }

  // ── BOOTSTRAP ─────────────────────────────────────────────────
  // Tag on the Drive file itself so re-discovery doesn't depend solely on the
  // exact display name (which the appProperties-tagged query below still
  // falls back to, for sheets created before this tag existed).
  const APP_PROPERTY = { key: 'periodTrackerApp', value: 'true' };

  // Returns:
  //   a file object  — a matching sheet was found (if several, the oldest —
  //                     most likely the user's real long-lived data).
  //   null           — the search genuinely succeeded and found nothing.
  // Throws if the search itself could not be completed (after retries) —
  // callers must NOT treat that the same as "found nothing", since doing so
  // is exactly what causes duplicate spreadsheets to get created.
  async function findExistingSpreadsheet() {
    const res = await SheetsClient.findFiles(
      "trashed=false and mimeType='application/vnd.google-apps.spreadsheet' and " +
      `(appProperties has { key='${APP_PROPERTY.key}' and value='${APP_PROPERTY.value}' } or name='Period Tracker Data')`
    );
    const files = (res.files || []).filter(f => !f.trashed);
    if (!files.length) return null;
    if (files.length > 1) {
      console.warn(
        '[DataStore] Multiple "Period Tracker Data" sheets found in Drive — using the oldest and ignoring the rest:',
        files.map(f => ({ id: f.id, createdTime: f.createdTime }))
      );
    }
    files.sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));
    return files[0];
  }

  async function bootstrap() {
    if (spreadsheetId) {
      // Already have a cached sheet — reconcile instead of blindly overwriting
      // it with whatever's local (which could be a freshly-seeded, near-empty
      // state on a second device — see syncReconcile).
      await syncReconcile();
      return;
    }

    // First ever sign-in (or localStorage was wiped, e.g. by iOS re-adding the
    // home-screen app): search before creating. If the search itself fails,
    // do NOT fall through to creating a new spreadsheet — that's how
    // duplicates happen. Surface a retryable error instead.
    let existing;
    try {
      existing = await findExistingSpreadsheet();
    } catch (e) {
      console.warn('[DataStore] Drive search failed', e);
      throw new Error('Could not verify whether a Period Tracker sheet already exists — please check your connection and try signing in again.');
    }

    if (existing) {
      spreadsheetId = existing.id;
      localStorage.setItem(LS_SS_ID, spreadsheetId);
      await syncReconcile();
      return;
    }

    // Genuinely brand new: create the spreadsheet, tag it so future searches
    // can find it reliably, then write data. Nothing to reconcile — it's
    // empty by construction.
    const created = await SheetsClient.create({
      properties: { title: 'Period Tracker Data' },
      sheets: [{ properties: { title: 'Data', sheetId: 0 } }],
    });
    spreadsheetId = created.spreadsheetId;
    localStorage.setItem(LS_SS_ID, spreadsheetId);
    try {
      await SheetsClient.setAppProperties(spreadsheetId, { [APP_PROPERTY.key]: APP_PROPERTY.value });
    } catch (e) {
      console.warn('[DataStore] Failed to tag new spreadsheet with appProperties — name-based matching will still find it', e);
    }
    await saveData();
  }

  // ── DATA SYNC ─────────────────────────────────────────────────
  async function saveData() {
    if (!spreadsheetId) throw new Error('No spreadsheet connected');

    const rows = buildRows();
    if (!rows) throw new Error('No history data found in local storage');

    // Clear old content then write fresh structured rows
    await SheetsClient.clearValues(spreadsheetId, 'Data!A1:Z1000');
    await SheetsClient.updateValues(
      spreadsheetId,
      `Data!A1:F${rows.length}`,
      rows,
      'RAW'
    );

    // Record exactly what we just wrote, keyed by id, as the new merge
    // baseline for the next syncReconcile() — see LS_LAST_SYNCED above.
    const snapshot = {};
    for (const row of rows.slice(1)) {
      const [startDate, , , periodDayCount, , id] = row;
      if (id) snapshot[id] = { startDate, periodDayCount };
    }
    setLastSynced(snapshot);

    console.log(`[DataStore] Synced ${rows.length - 1} cycles to Google Sheets ✓`);
  }

  // Reads the sheet back into {id, startDate, periodDayCount} triples —
  // those are the only trusted columns; End Date/Cycle Length/Ovulation Day
  // are always recomputed locally by PeriodModel so two derivations of the
  // same value can never drift apart. `id` (column F) may be absent on rows
  // written before that column existed — those come back with id undefined,
  // and syncReconcile() is responsible for reconciling them by startDate
  // instead so pre-existing cycles aren't mistaken for new ones.
  //
  // Returns:
  //   [] if the sheet was read successfully and genuinely has no data rows —
  //      a confirmed "cloud is empty" state, safe to treat as such.
  //   null if the read itself failed — an *unknown* state. Callers must never
  //      treat null as "cloud is empty" (that's exactly how a second-device
  //      sign-in could silently erase real history — see syncReconcile).
  async function loadData() {
    if (!spreadsheetId) return null;
    try {
      const res = await SheetsClient.getValues(spreadsheetId, 'Data!A1:F1000');
      const values = (res && res.values) || [];
      const dataRows = values.slice(1); // skip header row
      const periods = [];
      for (const row of dataRows) {
        const startDate = row[0];
        const periodDayCount = parseInt(row[3], 10);
        const id = row[5] || undefined;
        if (/^\d{4}-\d{2}-\d{2}$/.test(startDate) && periodDayCount > 0) {
          periods.push({ id, startDate, periodDayCount });
        }
      }
      return periods;
    } catch (e) {
      console.warn('[DataStore] loadData failed — treating as unknown, not empty', e);
      return null;
    }
  }

  // The single sync entrypoint for anything that isn't brand-new-spreadsheet
  // creation: reads the cloud sheet, merges it with local using a 3-way diff
  // against the last-synced baseline (LS_LAST_SYNCED — what the app itself
  // last wrote), persists the merged result locally, then writes that back.
  // If the cloud read fails, this aborts without touching anything rather
  // than risking a blind overwrite.
  //
  // Matching by id (rather than startDate, as before) is what makes an
  // *edit* — including one that changes the startDate itself — reconcile as
  // an update to the same cycle instead of coexisting alongside the old one.
  // Cloud rows written before the ID column existed (or added directly in
  // the sheet by hand, with the ID column left blank) come back from
  // loadData() with no id; those are paired up with the local period at the
  // same startDate (if any) so upgrading doesn't duplicate every pre-existing
  // cycle, and so a real edit isn't mistaken for a brand-new row.
  //
  // Per id, the merge rule is: whichever side (cloud or local) actually
  // diverged from the last-synced baseline wins — including a side's own
  // *absence*. If the sheet still holds exactly what we last wrote for an
  // id, local is authoritative even if local no longer has that id at all
  // (e.g. PeriodModel.normalize() absorbed it into a neighboring cycle as
  // part of an in-app edit) — that absence must NOT be treated as "nothing
  // changed, resurrect it from the cloud." Conversely if the sheet did
  // change (including going away — a deleted row), the sheet wins. This is
  // what lets a manual sheet edit (shrinking periodDayCount, adding a row
  // for a previously-missed period, deleting a bad row) stick, an in-app
  // edit/deletion/merge stick, and an in-app addition not yet synced
  // survive — all without any of them clobbering each other.
  async function syncReconcile() {
    const cloudPeriods = await loadData();
    if (cloudPeriods === null) {
      throw new Error('Could not read the existing Google Sheet — sync aborted rather than risk overwriting it');
    }

    const localPeriods = PeriodModel.getPeriods();
    const localByStart = new Map(localPeriods.map(p => [p.startDate, p]));
    const normalizedCloud = cloudPeriods.map(p => {
      if (p.id) return p;
      const match = localByStart.get(p.startDate);
      return match ? { ...p, id: match.id } : p;
    });

    const lastSynced = getLastSynced();
    const cloudById = new Map(normalizedCloud.filter(p => p.id).map(p => [p.id, p]));
    const localById = new Map(localPeriods.map(p => [p.id, p]));
    const sameRow = (a, b) => !!a && !!b && a.startDate === b.startDate && a.periodDayCount === b.periodDayCount;

    const allIds = new Set([...cloudById.keys(), ...localById.keys(), ...Object.keys(lastSynced)]);
    const merged = [];
    for (const id of allIds) {
      const cloud = cloudById.get(id);
      const local = localById.get(id);
      const baseline = lastSynced[id];

      if (baseline) {
        // !sameRow(cloud, baseline) is also true when cloud is undefined —
        // i.e. "changed" covers both an edit and a deletion.
        if (sameRow(cloud, baseline)) {
          // Sheet is exactly what we last synced — local is authoritative,
          // including its absence (a local deletion/merge-away).
          if (local) merged.push(local);
        } else if (cloud) {
          // Sheet genuinely changed — sheet wins, regardless of local.
          merged.push(cloud);
        }
        // else: cloud is gone — deleted from the sheet — drop it either way.
      } else if (cloud && local) {
        // No baseline recorded for this id yet (e.g. the very first sync
        // since this reconciliation logic shipped) but cloud and local
        // disagree — assume the sheet holds a real edit that predates any
        // baseline ever being taken, and prefer it.
        merged.push(sameRow(cloud, local) ? local : cloud);
      } else if (cloud) {
        // Brand-new row typed directly into the sheet (no id column, no
        // local match by startDate either), or a fresh device adopting real
        // cloud history for the first time — adopt it.
        merged.push(cloud);
      } else if (local) {
        // Brand-new local addition not yet synced (e.g. logged in-app).
        merged.push(local);
      }
    }

    // Rows without an id at all (new sheet additions that never matched a
    // local startDate) still need to be included — allIds is keyed by id so
    // idless cloud rows would otherwise be dropped entirely.
    for (const p of normalizedCloud) {
      if (!p.id) merged.push(p);
    }

    PeriodModel.setPeriods(merged);

    await saveData();
  }

  return { bootstrap, loadData, saveData, syncReconcile };
})();
