// Period Tracker — first-launch sample data.
// This is illustrative placeholder data only (NOT real user data) shown on a brand-new
// install before any real history has been logged or synced from Google Sheets.
const SEED_PERIODS = [
    { startDate: '2026-01-01', periodDayCount: 5 }
];

// Only seed if there's truly nothing yet — no unified periods key, and no
// legacy keys for PeriodModel to migrate from. Never overwrite real data.
if (!localStorage.getItem('periodTrackerPeriods') &&
    !localStorage.getItem('periodTrackerHistory') &&
    !localStorage.getItem('periodTrackerLoggedDates')) {
    localStorage.setItem('periodTrackerPeriods', JSON.stringify(SEED_PERIODS));
}
