// Period Tracker — structured Google Sheets data layer.
// Writes one row per cycle with labeled columns instead of raw JSON blobs.

const DataStore = (() => {
  const LS_SS_ID = 'periodTracker_spreadsheetId';
  let spreadsheetId = localStorage.getItem(LS_SS_ID) || null;

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
    ];

    const dataRows = cycles.map(c => [
      c.startDate,
      c.predicted ? '' : c.endDate,
      c.predicted ? '' : c.cycleLength,
      c.periodDayCount,
      c.predicted ? '' : c.ovulationDayNumber,
    ]);

    return [header, ...dataRows];
  }

  // ── BOOTSTRAP ─────────────────────────────────────────────────
  async function findExistingSpreadsheet() {
    try {
      const res = await SheetsClient.findFiles(
        "trashed=false and mimeType='application/vnd.google-apps.spreadsheet' and name='Period Tracker Data'"
      );
      const files = (res.files || []).filter(f => !f.trashed);
      if (files.length) {
        files.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
        return files[0];
      }
      return null;
    } catch (e) {
      console.warn('[DataStore] Drive search failed', e);
      return null;
    }
  }

  async function bootstrap() {
    if (spreadsheetId) {
      // Already have a cached sheet — reconcile instead of blindly overwriting
      // it with whatever's local (which could be a freshly-seeded, near-empty
      // state on a second device — see syncReconcile).
      await syncReconcile();
      return;
    }

    // First ever sign-in: search before creating.
    const existing = await findExistingSpreadsheet();
    if (existing) {
      spreadsheetId = existing.id;
      localStorage.setItem(LS_SS_ID, spreadsheetId);
      await syncReconcile();
      return;
    }

    // Brand new: create the spreadsheet then write data. Nothing to reconcile —
    // it's empty by construction.
    const created = await SheetsClient.create({
      properties: { title: 'Period Tracker Data' },
      sheets: [{ properties: { title: 'Data', sheetId: 0 } }],
    });
    spreadsheetId = created.spreadsheetId;
    localStorage.setItem(LS_SS_ID, spreadsheetId);
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
      `Data!A1:E${rows.length}`,
      rows,
      'RAW'
    );
    console.log(`[DataStore] Synced ${rows.length - 1} cycles to Google Sheets ✓`);
  }

  // Reads the sheet back into {startDate, periodDayCount} pairs — only those
  // two columns are trusted; End Date/Cycle Length/Ovulation Day are always
  // recomputed locally by PeriodModel so two derivations of the same value
  // can never drift apart.
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
      const res = await SheetsClient.getValues(spreadsheetId, 'Data!A1:E1000');
      const values = (res && res.values) || [];
      const dataRows = values.slice(1); // skip header row
      const periods = [];
      for (const row of dataRows) {
        const startDate = row[0];
        const periodDayCount = parseInt(row[3], 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(startDate) && periodDayCount > 0) {
          periods.push({ startDate, periodDayCount });
        }
      }
      return periods;
    } catch (e) {
      console.warn('[DataStore] loadData failed — treating as unknown, not empty', e);
      return null;
    }
  }

  // The single sync entrypoint for anything that isn't brand-new-spreadsheet
  // creation: reads the cloud sheet, merges it with local as a union keyed by
  // startDate (keeping the larger period-day-count on conflict — a rule that
  // can only ever add data, never remove it), persists the merged result
  // locally, then writes that superset back. If the cloud read fails, this
  // aborts without touching anything rather than risking a blind overwrite.
  async function syncReconcile() {
    const cloudPeriods = await loadData();
    if (cloudPeriods === null) {
      throw new Error('Could not read the existing Google Sheet — sync aborted rather than risk overwriting it');
    }

    const localPeriods = PeriodModel.getPeriods();
    const byStartDate = new Map();
    for (const p of [...cloudPeriods, ...localPeriods]) {
      const existing = byStartDate.get(p.startDate);
      if (!existing || p.periodDayCount > existing.periodDayCount) {
        byStartDate.set(p.startDate, p);
      }
    }
    PeriodModel.setPeriods(Array.from(byStartDate.values()));

    await saveData();
  }

  return { bootstrap, loadData, saveData, syncReconcile };
})();
