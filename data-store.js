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
    // Freeform "Mon D[, Year]" text, not an ISO string — local-midnight parsing
    // here is correct and matches app.js. It's only the ISO string this
    // produces that must never be re-parsed with `new Date(isoString)`
    // downstream (see DateUtils.parseISODate for why).
    const d = new Date(hasYear ? trimmed : `${trimmed} ${fallbackYear}`);
    if (isNaN(d)) return trimmed; // keep raw string if parse fails
    return DateUtils.toISODate(d);
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
    const rawHist = localStorage.getItem('periodTrackerHistory');
    const rawLogged = localStorage.getItem('periodTrackerLoggedDates');
    
    // 1. Gather all period days into a Set
    const allPeriodDays = new Set();
    
    // Add historical period days
    if (rawHist) {
      try {
        const historicalCycles = JSON.parse(rawHist);
        for (const yearGroup of historicalCycles) {
          for (const cycle of yearGroup.cycles) {
            const { startDate } = parseCycleDates(cycle.subtitle, yearGroup.year);
            const periodDays = cycle.dots ? cycle.dots.filter(d => d === 'p').length : 5;
            const start = DateUtils.parseISODate(startDate);
            for (let i = 0; i < periodDays; i++) {
              allPeriodDays.add(DateUtils.toISODate(DateUtils.addDays(start, i)));
            }
          }
        }
      } catch (e) {}
    }
    
    // Add newly logged period days
    if (rawLogged) {
      try {
        const logged = JSON.parse(rawLogged);
        logged.forEach(ds => allPeriodDays.add(ds));
      } catch (e) {}
    }
    
    if (allPeriodDays.size === 0) return null;

    // 2. Sort all days chronologically
    const sortedDays = Array.from(allPeriodDays).sort();
    
    // 3. Group into periods (gaps > 14 days mean a new period)
    const periods = [];
    let currentPeriod = [sortedDays[0]];
    for (let i = 1; i < sortedDays.length; i++) {
      const diffDays = DateUtils.daysBetween(sortedDays[i-1], sortedDays[i]);
      if (diffDays <= 14) {
        currentPeriod.push(sortedDays[i]);
      } else {
        periods.push(currentPeriod);
        currentPeriod = [sortedDays[i]];
      }
    }
    periods.push(currentPeriod);
    
    // 4. Build Rows
    const header = [
      'Start Date',
      'End Date',
      'Cycle Length (days)',
      'Period Days',
      'Ovulation Day (day # in cycle)',
    ];
    
    const dataRows = [];
    for (let i = 0; i < periods.length; i++) {
      const period = periods[i];
      const startDate = period[0];
      const periodDays = period.length;
      
      let cycleLength = "";
      let endDate = "";
      let ovulationDay = "";
      
      if (i + 1 < periods.length) {
        const nextStartIso = periods[i+1][0];
        cycleLength = DateUtils.daysBetween(startDate, nextStartIso);

        const endD = DateUtils.addDays(DateUtils.parseISODate(nextStartIso), -1);
        endDate = DateUtils.toISODate(endD);

        ovulationDay = cycleLength - 14;
        if (ovulationDay < 1) ovulationDay = "";
      }
      
      dataRows.push([startDate, endDate, cycleLength, periodDays, ovulationDay]);
    }
    
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
