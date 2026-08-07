// Period Tracker — structured Google Sheets data layer.
// Writes one row per cycle with labeled columns instead of raw JSON blobs.

const DataStore = (() => {
  const LS_SS_ID = 'periodTracker_spreadsheetId';
  let spreadsheetId = localStorage.getItem(LS_SS_ID) || null;

  // ── DATE PARSING ─────────────────────────────────────────────
  // Converts subtitle strings like "Jan 1 – Jan 28" or "Dec 1, 2025 – Dec 28, 2025"
  // into ISO date strings (YYYY-MM-DD), using the year group's year as fallback.
  function toISO(str, fallbackYear) {
    const trimmed = str.trim();
    const hasYear = /\d{4}/.test(trimmed);
    const d = new Date(hasYear ? trimmed : `${trimmed} ${fallbackYear}`);
    if (isNaN(d)) return trimmed; // keep raw string if parse fails
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function parseCycleDates(subtitle, year) {
    // Handle en-dash (–) and hyphen (-) as separators
    const sep = subtitle.includes('–') ? '–' : '-';
    const parts = subtitle.split(sep).map(s => s.trim());
    return {
      startDate: toISO(parts[0], year),
      endDate:   toISO(parts[1] || '', year),
    };
  }

  // ── ROW BUILDER ───────────────────────────────────────────────
  // Parses historicalCycles from localStorage into structured sheet rows.
  function buildRows() {
    const raw = localStorage.getItem('periodTrackerHistory');
    if (!raw) return null;

    let historicalCycles;
    try { historicalCycles = JSON.parse(raw); } catch { return null; }

    const header = [
      'Start Date',
      'End Date',
      'Cycle Length (days)',
      'Period Days',
      'Ovulation Day (day # in cycle)',
    ];

    const dataRows = [];
    for (const yearGroup of historicalCycles) {
      for (const cycle of yearGroup.cycles) {
        const { startDate, endDate } = parseCycleDates(cycle.subtitle, yearGroup.year);
        const dots = cycle.dots || [];
        const periodDays    = dots.filter(d => d === 'p').length;
        const ovIdx         = dots.indexOf('o');
        const ovulationDay  = ovIdx >= 0 ? ovIdx + 1 : ''; // 1-indexed
        const cycleLength   = parseInt(cycle.title) || dots.length;

        dataRows.push([startDate, endDate, cycleLength, periodDays, ovulationDay]);
      }
    }

    // Sort oldest → newest by start date
    dataRows.sort((a, b) => (a[0] < b[0] ? -1 : 1));

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
