// Period Tracker — first-launch sample data.
// This is illustrative placeholder data only (NOT real user data) shown on a brand-new
// install before any real history has been logged or synced from Google Sheets.
const historicalCycles = [
    { year: 2026, cycles: [
        { title: "28 days", subtitle: "Jan 1 – Jan 28", dots: ['p','p','p','p','p','','','f','f','f','f','o','f','f','','','','','','','','','','','','','',''] }
    ]}
];

// Only seed localStorage if there's no history there yet. Never overwrite real
// logged/synced data on subsequent loads (a previous version of this file did that
// unconditionally on every launch, which clobbered real history each time the app opened).
if (!localStorage.getItem('periodTrackerHistory')) {
    localStorage.setItem('periodTrackerHistory', JSON.stringify(historicalCycles));
}
