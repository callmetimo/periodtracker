// Period Tracker — data layer using Google Sheets as a simple Key-Value store.

const DataStore = (() => {
  const LS_SS_ID = 'periodTracker_spreadsheetId';

  let spreadsheetId = localStorage.getItem(LS_SS_ID) || null;

  // ── BOOTSTRAP ────────────────────────────────────────────────
  // Finds or creates a spreadsheet in Google Drive for the signed-in user.
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
      console.warn('[findExistingSpreadsheet] search failed', e);
      return null;
    }
  }

  async function bootstrap() {
    if (spreadsheetId) return;

    const existing = await findExistingSpreadsheet();
    if (existing) {
      spreadsheetId = existing.id;
      localStorage.setItem(LS_SS_ID, spreadsheetId);
      await loadData();
      return;
    }

    const created = await SheetsClient.create({
      properties: { title: 'Period Tracker Data' },
      sheets: [
        { properties: { title: 'Data', sheetId: 0 } }
      ],
    });
    spreadsheetId = created.spreadsheetId;
    localStorage.setItem(LS_SS_ID, spreadsheetId);

    await SheetsClient.updateValues(spreadsheetId, 'Data!A1:B1', [['Key', 'Value']]);
    await saveData(); // Push local seeded data up immediately
  }

  // ── DATA SYNC ────────────────────────────────────────────────
  
  async function loadData() {
    if (!spreadsheetId) return;
    try {
      const res = await SheetsClient.getValues(spreadsheetId, 'Data!A2:B');
      const rows = res.values || [];
      let updated = false;
      rows.forEach(([key, val]) => {
        if (key && val) {
          localStorage.setItem(key, val);
          updated = true;
        }
      });
      // Optionally fire an event so the UI knows to refresh
      if (updated) {
          window.dispatchEvent(new CustomEvent('periodTrackerDataLoaded'));
      }
    } catch (e) {
      console.error('[DataStore.loadData] failed', e);
    }
  }

  async function saveData() {
    if (!spreadsheetId) return;
    try {
      // Gather data from localStorage
      // We must make sure app.js is storing loggedDates! Currently app.js holds it in memory
      // I'll update app.js to save it to localStorage.
      const loggedDates = localStorage.getItem('periodTrackerLoggedDates') || '[]';
      const historyData = localStorage.getItem('periodTrackerHistory') || '[]';
      
      const rows = [
        ['periodTrackerLoggedDates', loggedDates],
        ['periodTrackerHistory', historyData]
      ];
      
      // We assume they fit in A2:B3
      await SheetsClient.updateValues(spreadsheetId, 'Data!A2:B3', rows);
      console.log('[DataStore.saveData] successfully synced to Google Sheets.');
    } catch (e) {
      console.error('[DataStore.saveData] failed', e);
    }
  }

  return { bootstrap, loadData, saveData };
})();
