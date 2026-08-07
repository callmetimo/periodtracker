// Nota — thin wrapper over the Google Sheets/Drive REST APIs.
// Every call is authorized with the signed-in user's own OAuth access token
// (see auth.js) and only ever touches the one spreadsheet this app created
// for that user (drive.file scope).

const SheetsClient = (() => {
  const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
  const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files';

  // A stalled connection to the Sheets/Drive API otherwise hangs this fetch forever —
  // no response, no error — which in turn hangs every await chain built on top of it
  // (loadHistData, requireReady, etc.) with nothing left to catch or retry.
  async function authedFetch(url, opts = {}, timeoutMs = 15000) {
    const token = await Auth.getAccessToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        ...opts,
        headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Sheets API request timed out');
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Sheets API ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.status === 204 ? null : res.json();
  }

  function create(spreadsheetBody) {
    return authedFetch(SHEETS_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(spreadsheetBody),
    });
  }

  function batchUpdate(spreadsheetId, requests) {
    return authedFetch(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });
  }

  function getValues(spreadsheetId, range) {
    return authedFetch(`${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`);
  }

  function updateValues(spreadsheetId, range, values, valueInputOption = 'USER_ENTERED') {
    return authedFetch(
      `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) }
    );
  }

  function appendValues(spreadsheetId, range, values, valueInputOption = 'USER_ENTERED') {
    return authedFetch(
      `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append` +
        `?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) }
    );
  }

  function clearValues(spreadsheetId, range) {
    return authedFetch(`${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`, {
      method: 'POST',
    });
  }

  function getSpreadsheetMeta(spreadsheetId) {
    return authedFetch(`${SHEETS_BASE}/${spreadsheetId}?fields=sheets.properties`);
  }

  function trashFile(fileId) {
    return authedFetch(`${DRIVE_BASE}/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  }

  function getFileMeta(fileId) {
    return authedFetch(`${DRIVE_BASE}/${fileId}?fields=size,modifiedTime`);
  }

  function findFiles(query) {
    const params = new URLSearchParams({ q: query, fields: 'files(id,name,createdTime,trashed)', spaces: 'drive' });
    return authedFetch(`${DRIVE_BASE}?${params.toString()}`);
  }

  return {
    create, batchUpdate, getValues, updateValues, appendValues, clearValues,
    getSpreadsheetMeta, trashFile, getFileMeta, findFiles,
  };
})();
