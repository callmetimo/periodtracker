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
      // Already have a cached sheet — push latest local data up.
      await saveData();
      return;
    }

    // First ever sign-in: search before creating.
    const existing = await findExistingSpreadsheet();
    if (existing) {
      spreadsheetId = existing.id;
      localStorage.setItem(LS_SS_ID, spreadsheetId);
      await saveData();
      return;
    }

    // Brand new: create the spreadsheet then write data.
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

  // loadData is a no-op now — the app uses localStorage (seed-data.js) as source of truth.
  // In a future version, this could reconstruct localStorage from the sheet on a new device.
  async function loadData() {
    // no-op
  }

  return { bootstrap, loadData, saveData };
})();
