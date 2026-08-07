// Period Tracker — shared date utilities.
//
// Root cause this exists to fix: data-store.js used to build dates from
// "YYYY-MM-DD" strings via `new Date(isoString)`, which the ECMAScript spec
// parses as UTC midnight. app.js built dates from explicit year/month/day
// integers (`new Date(year, month, day)`), which is always local midnight.
// For anyone at a negative UTC offset (all of the Americas), those two
// disagreed by one calendar day for the exact same date. Every date in this
// app should flow through parseISODate()/toISODate() below so there is only
// one interpretation of "what day is this" anywhere in the codebase.
const DateUtils = (() => {
  // Local-midnight Date -> "YYYY-MM-DD". Never uses toISOString() (UTC-based).
  function toISODate(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // "YYYY-MM-DD" -> local-midnight Date. Deliberately never `new Date(isoStr)`
  // (spec-mandated UTC parsing) — always construct from the split integers.
  function parseISODate(isoStr) {
    const [y, m, d] = isoStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(dateObj, n) {
    const d = new Date(dateObj);
    d.setDate(d.getDate() + n);
    return d;
  }

  // Whole calendar days between two ISO date strings (b - a), both parsed as
  // local midnight so DST transitions can't shift the result by an hour.
  function daysBetween(isoA, isoB) {
    const a = parseISODate(isoA);
    const b = parseISODate(isoB);
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
  }

  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // e.g. "Jan 1" for the current year, "Jan 1, 2025" otherwise.
  function formatDisplayDate(dateObj, referenceYear = new Date().getFullYear()) {
    const label = `${MONTH_NAMES[dateObj.getMonth()]} ${dateObj.getDate()}`;
    return dateObj.getFullYear() === referenceYear ? label : `${label}, ${dateObj.getFullYear()}`;
  }

  return { toISODate, parseISODate, addDays, daysBetween, formatDisplayDate };
})();
