// App main logic
//
// All period/cycle data now flows through PeriodModel (period-model.js) — see
// that file for why. This file is purely about rendering views from it and
// handling user interaction.

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initHistoryView();
    initYearView();
    const initialCycles = PeriodModel.computeCycles();
    refreshHomeView(initialCycles);
    refreshCycleInsights(initialCycles);
    initToggles();
    if (typeof Auth !== 'undefined') {
        Auth.start();
        Auth.markAppReady();

        // The one-shot first-tap listener auth.js's deferred-auth design depends
        // on (see its header comment) — without this, a returning user's first
        // Sheets sync call would hang forever waiting for a tap that nothing
        // ever asked for. triggerFirstTapSync() itself no-ops when not in
        // deferred mode, so registering this unconditionally is safe.
        document.addEventListener('click', () => {
            Auth.triggerFirstTapSync().catch(err => console.warn('[auth] first-tap sync failed', err));
        }, { once: true });

        const btnSignOut = document.getElementById('btn-profile-signout');
        if (btnSignOut) btnSignOut.addEventListener('click', () => Auth.signOut());

        const btnSyncNow = document.getElementById('btn-sync-now');
        if (btnSyncNow) btnSyncNow.addEventListener('click', async () => {
            btnSyncNow.textContent = 'Syncing…';
            btnSyncNow.disabled = true;
            try {
                // triggerFirstTapSync gets/renews the OAuth token (works from a real tap)
                await Auth.triggerFirstTapSync();
                await DataStore.syncReconcile();
                // Reconcile may have pulled in periods that only existed in the
                // cloud (e.g. logged on another device) — refresh everything.
                const syncedCycles = PeriodModel.computeCycles();
                refreshHomeView(syncedCycles);
                refreshCycleInsights(syncedCycles);
                const activeFilterPill = document.querySelector('.history-filters .pill.active');
                if (activeFilterPill) activeFilterPill.click(); else renderHistoryList('all');
                initYearView();
                btnSyncNow.textContent = '✓ Synced to Google Drive!';
            } catch (e) {
                console.error('[Sync Now] failed:', e);
                btnSyncNow.textContent = '✗ Failed: ' + (e.message || 'unknown error');
            }
            setTimeout(() => {
                btnSyncNow.textContent = '↑ Sync to Google Drive Now';
                btnSyncNow.disabled = false;
            }, 4000);
        });
    }
});

function initToggles() {
    // History View Toggles
    const historyPills = document.querySelectorAll('.history-filters .pill');
    historyPills.forEach(pill => {
        pill.addEventListener('click', () => {
            historyPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');

            const text = pill.textContent.toLowerCase();
            if (text.includes('3')) {
                renderHistoryList('3');
            } else if (text.includes('6')) {
                renderHistoryList('6');
            } else {
                renderHistoryList('all');
            }
        });
    });

    // Week Start Toggles
    const weekStartPills = document.querySelectorAll('#week-start-toggle .pill');
    const currentWeekStart = getWeekStartSetting();
    weekStartPills.forEach(p => p.classList.remove('active'));
    const activePill = document.querySelector(`#week-start-toggle .pill[data-val="${currentWeekStart}"]`);
    if(activePill) activePill.classList.add('active');

    weekStartPills.forEach(pill => {
        pill.addEventListener('click', () => {
            weekStartPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            localStorage.setItem('periodTrackerWeekStart', pill.getAttribute('data-val'));

            updateWeekdaysHeaders();
            refreshHomeView();
            renderLogCalendar();
            initYearView();
        });
    });

    // Year View Toggles
    const yearToggles = document.querySelectorAll('.view-toggle .toggle-btn');
    yearToggles.forEach(btn => {
        btn.addEventListener('click', () => {
            yearToggles.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

function getWeekStartSetting() {
    return parseInt(localStorage.getItem('periodTrackerWeekStart') || '0', 10);
}

function showToast(message) {
    const existing = document.getElementById('app-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed; bottom: 88px; right: 16px; z-index: 9999;
        background: #1a1a2e; color: #fff; padding: 10px 18px;
        border-radius: 20px; font-size: 13px; font-weight: 600;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        opacity: 0; transition: opacity 0.25s ease;
        pointer-events: none;
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function updateWeekdaysHeaders() {
    const weekStart = getWeekStartSetting();
    const headers = weekStart === 1 ? ['M','T','W','T','F','S','S'] : ['S','M','T','W','T','F','S'];
    document.querySelectorAll('.calendar-weekdays').forEach(el => {
        el.innerHTML = headers.map(d => `<span>${d}</span>`).join('');
    });
}

function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');

    updateWeekdaysHeaders();

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(nav => nav.classList.remove('active'));
            // Skip view-logging — it has its own open/close logic via the FAB
            views.forEach(view => {
                if (view.id !== 'view-logging') view.classList.remove('active');
            });

            item.classList.add('active');
            const targetId = item.getAttribute('data-target');
            if (targetId) {
                document.getElementById(targetId).classList.add('active');
            }
        });
    });

    const fab = document.getElementById('fab-button');
    fab.addEventListener('click', () => {
        document.getElementById('view-logging').classList.add('active');
        initLogCalendar();
    });

    document.getElementById('log-cancel').addEventListener('click', () => {
        // Discard whatever was staged in this session — nothing was persisted.
        stagedPeriods = null;
        document.getElementById('view-logging').classList.remove('active');
    });

    document.getElementById('log-save').addEventListener('click', async () => {
        if (stagedPeriods) {
            PeriodModel.setPeriods(stagedPeriods);
            stagedPeriods = null;
        }
        document.getElementById('view-logging').classList.remove('active');
        let saveCycles = PeriodModel.computeCycles();
        refreshHomeView(saveCycles);
        refreshCycleInsights(saveCycles);
        const activeFilterPill = document.querySelector('.history-filters .pill.active');
        if (activeFilterPill) activeFilterPill.click(); else renderHistoryList('all');
        initYearView();

        // Sync to Google Drive and show toast
        if (typeof DataStore !== 'undefined') {
            try {
                await DataStore.syncReconcile();
                // Reconcile may have merged in cloud-only periods (e.g. logged on
                // another device) — refresh once more to reflect the true merged state.
                saveCycles = PeriodModel.computeCycles();
                refreshHomeView(saveCycles);
                refreshCycleInsights(saveCycles);
                const filterPill = document.querySelector('.history-filters .pill.active');
                if (filterPill) filterPill.click(); else renderHistoryList('all');
                initYearView();
                showToast('✓ Synced to Google Drive!');
            } catch(e) {
                showToast('Saved locally (sync failed)');
            }
        } else {
            showToast('Saved!');
        }
    });

    const closeCycleDetails = () => document.getElementById('view-cycle-details').classList.remove('active');
    document.getElementById('back-to-history').addEventListener('click', closeCycleDetails);
    document.getElementById('back-to-history').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            closeCycleDetails();
        }
    });

    // Cycle Details — Edit form. The edit icon is only ever shown (see
    // showCycleDetails) when the open cycle has an id and is still within
    // PeriodModel's edit window, but the Save handler re-checks both anyway
    // since currentDetailCycle/the window boundary could be stale by the
    // time Save is actually pressed.
    const detailEditBtn = document.getElementById('detail-edit-btn');
    const detailViewMode = document.getElementById('detail-view-mode');
    const detailEditMode = document.getElementById('detail-edit-mode');
    const detailEditStart = document.getElementById('detail-edit-startdate');
    const detailEditDayCount = document.getElementById('detail-edit-daycount');
    const detailEditError = document.getElementById('detail-edit-error');

    const openEditForm = () => {
        if (!currentDetailCycle) return;
        detailEditStart.value = currentDetailCycle.startDate;
        detailEditDayCount.value = currentDetailCycle.periodDayCount;
        detailEditError.style.display = 'none';
        detailViewMode.style.display = 'none';
        detailEditMode.style.display = '';
    };
    if (detailEditBtn) {
        detailEditBtn.addEventListener('click', openEditForm);
        detailEditBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                openEditForm();
            }
        });
    }

    document.getElementById('detail-edit-cancel').addEventListener('click', () => {
        detailEditMode.style.display = 'none';
        detailViewMode.style.display = '';
    });

    document.getElementById('detail-edit-save').addEventListener('click', async () => {
        if (!currentDetailCycle) return;

        const newStart = detailEditStart.value;
        const newDayCount = parseInt(detailEditDayCount.value, 10);
        const showError = (msg) => {
            detailEditError.textContent = msg;
            detailEditError.style.display = '';
        };

        if (!/^\d{4}-\d{2}-\d{2}$/.test(newStart) || !(newDayCount > 0)) {
            showError('Please enter a valid date and period length.');
            return;
        }
        // Re-check the window here (not just when the Edit button was shown) —
        // both the original cycle and the date it's being moved to must fall
        // inside it, so editing can't be used to sneak in changes to (or
        // relocate a cycle into) history the guardrail is meant to protect.
        if (!PeriodModel.isWithinEditWindow(currentDetailCycle.startDate) || !PeriodModel.isWithinEditWindow(newStart)) {
            showError(`Cycles can only be edited within ${PeriodModel.EDIT_WINDOW_DAYS} days of their start date.`);
            return;
        }

        PeriodModel.updatePeriod(currentDetailCycle.id, { startDate: newStart, periodDayCount: newDayCount });

        document.getElementById('view-cycle-details').classList.remove('active');
        currentDetailCycle = null;

        let editedCycles = PeriodModel.computeCycles();
        refreshHomeView(editedCycles);
        refreshCycleInsights(editedCycles);
        const activeFilterPill = document.querySelector('.history-filters .pill.active');
        if (activeFilterPill) activeFilterPill.click(); else renderHistoryList('all');
        initYearView();

        if (typeof DataStore !== 'undefined') {
            try {
                await DataStore.syncReconcile();
                editedCycles = PeriodModel.computeCycles();
                refreshHomeView(editedCycles);
                refreshCycleInsights(editedCycles);
                const filterPill = document.querySelector('.history-filters .pill.active');
                if (filterPill) filterPill.click(); else renderHistoryList('all');
                initYearView();
                showToast('✓ Synced to Google Drive!');
            } catch (e) {
                showToast('Saved locally (sync failed)');
            }
        } else {
            showToast('Saved!');
        }
    });

    // Close cycle details sheet when clicking outside
    document.addEventListener('click', (e) => {
        const cycleDetails = document.getElementById('view-cycle-details');
        if (cycleDetails.classList.contains('active')) {
            if (!cycleDetails.contains(e.target) && !e.target.closest('.history-card')) {
                cycleDetails.classList.remove('active');
            }
        }
    });
    // NOTE: The logging view (#view-logging) is intentionally NOT dismissed on outside-click.
    // It only closes via the Cancel or Save buttons to prevent accidental dismissal when
    // tapping date cells inside the scrollable calendar.

    initCalendar();
}

let logCurrentDate = new Date();

// In-memory working copy of PeriodModel.getPeriods() while the log-calendar
// sheet is open. Taps mutate this, not localStorage, so Cancel can discard
// them — only Save commits via PeriodModel.setPeriods(). null when the sheet
// isn't open (renderCalendar/initYearView/renderHistoryList always read the
// persisted PeriodModel state directly).
let stagedPeriods = null;

// The Home calendar's currently "selected" date (ISO string), whose status
// the card below the calendar shows. null = no tap yet this session — the
// status card is driven entirely by updateHomeStats()/updateCyclePhaseStatus()
// exactly as before this feature existed, so initial load has zero behavior
// change. Once set (by tapping ANY Home-view day cell, including today's own
// cell), every subsequent status-card render uses updateStatusCardForDate()
// instead — this is a deliberate, one-way transition for the rest of the
// session (see updateStatusCardForDate's own handling of "today" for why
// re-tapping today still reads identically to the untouched default).
let selectedDateIso = null;

// Shared by both the click and keydown (Enter/Space) handlers on a log-mode
// calendar day cell, so keyboard users get the identical toggle behavior.
// Clears/adds the whole real contiguous period the tapped date belongs to
// (via PeriodModel.findPeriodIn), not a fixed-size slice from the tap point.
function handleLogDayActivate(dateString) {
    const existing = PeriodModel.findPeriodIn(stagedPeriods, dateString);

    if (existing) {
        const start = DateUtils.parseISODate(existing.startDate);
        for (let i = 0; i < existing.periodDayCount; i++) {
            setLogCellState(DateUtils.toISODate(DateUtils.addDays(start, i)), null);
        }
        stagedPeriods = PeriodModel.removePeriodFrom(stagedPeriods, existing.startDate);
    } else {
        stagedPeriods = PeriodModel.addPeriodTo(stagedPeriods, dateString, 5);
        // Re-fetch: addPeriodTo may have merged the new 5-day block with an
        // adjacent existing period into a longer single period.
        const finalPeriod = PeriodModel.findPeriodIn(stagedPeriods, dateString);
        const start = DateUtils.parseISODate(finalPeriod.startDate);
        for (let i = 0; i < finalPeriod.periodDayCount; i++) {
            setLogCellState(DateUtils.toISODate(DateUtils.addDays(start, i)), i === 0 ? 'start' : 'continuation');
        }
    }
}

// Fires on click/keydown activation of a Home-view (non-log-mode) day cell —
// mirrors handleLogDayActivate's role, but drives the selected-date status
// card instead of toggling a logged period. Recomputes cycles fresh (cheap;
// avoids any staleness if periods changed since the calendar was rendered).
function handleHomeDayActivate(dateString) {
    setSelectedDate(dateString, PeriodModel.computeCycles());
}

// Moves the "selected" marker and refreshes the status card WITHOUT calling
// renderCalendar() — renderCalendar() resets #calendar-scroll-area's
// scrollTop to the current month on every call (see its own comment), which
// would jar the user's scroll position on every single tap. Scoped to
// #calendar-scroll-area specifically so this never touches the log-calendar
// sheet's cells (which live under #view-logging and reuse the same
// data-date attribute convention).
function setSelectedDate(dateString, cycles = PeriodModel.computeCycles()) {
    const previousIso = selectedDateIso;
    selectedDateIso = dateString;

    if (previousIso && previousIso !== dateString) {
        const prevCell = document.querySelector(`#calendar-scroll-area .cal-day[data-date="${previousIso}"]`);
        if (prevCell) {
            prevCell.classList.remove('selected');
            prevCell.setAttribute('aria-pressed', 'false');
        }
    }
    const nextCell = document.querySelector(`#calendar-scroll-area .cal-day[data-date="${dateString}"]`);
    if (nextCell) {
        nextCell.classList.add('selected');
        nextCell.setAttribute('aria-pressed', 'true');
    }

    updateStatusCardForDate(dateString, cycles);
}

// state: 'start' | 'continuation' | null (cleared). Only touches cells
// currently rendered in the log calendar's ±12/+2 month window — a date
// outside that window updates in stagedPeriods but its DOM cell (if any)
// picks up the change on the next full renderLogCalendar() call.
function setLogCellState(dateString, state) {
    const cell = document.querySelector(`#view-logging .cal-day[data-date="${dateString}"]`);
    if (!cell) return;
    const baseLabel = cell.getAttribute('aria-label').replace(/, logged as period day$/, '');
    if (state === null) {
        cell.classList.remove('logged-period', 'logged-period-start', 'logged-period-predicted');
        cell.setAttribute('aria-label', baseLabel);
    } else {
        cell.classList.add('logged-period');
        cell.classList.toggle('logged-period-start', state === 'start');
        cell.classList.toggle('logged-period-predicted', state === 'continuation');
        cell.setAttribute('aria-label', baseLabel + ', logged as period day');
    }
}

function generateMonthGrid(year, month, isLogMode, cycles, predictedPeriods = [], predictedPremenstruals = [], predictedOvulationDates = [], predictedFertileWindows = []) {
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    const monthBlock = document.createElement('div');
    monthBlock.className = 'calendar-month-block';

    const title = document.createElement('div');
    title.className = 'calendar-month-title';
    title.textContent = isLogMode ? monthNames[month] : `${monthNames[month]} ${year}`;
    monthBlock.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weekStart = getWeekStartSetting();
    const adjustedFirstDay = (firstDay - weekStart + 7) % 7;

    for (let i = 0; i < adjustedFirstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'cal-day cal-day-empty';
        grid.appendChild(emptyCell);
    }

    const today = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    for (let day = 1; day <= daysInMonth; day++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'cal-day';

        const dateString = DateUtils.toISODate(new Date(year, month, day));
        dayCell.setAttribute('data-date', dateString);

        if (isLogMode) {
            // Logging View (Flo Style)
            dayCell.classList.add('log-mode-cell');
            if (isCurrentMonth) {
                dayCell.classList.add('current-month');
            }

            const numWrapper = document.createElement('div');
            numWrapper.className = 'cal-day-num-wrapper';
            numWrapper.textContent = day;
            numWrapper.style.pointerEvents = 'none'; // prevent swallowing clicks

            const ring = document.createElement('div');
            ring.className = 'cal-day-ring';
            ring.style.pointerEvents = 'none';

            const check = document.createElement('span');
            check.className = 'material-icons-outlined cal-day-check';
            check.textContent = 'check';
            check.style.pointerEvents = 'none';

            numWrapper.appendChild(ring);
            numWrapper.appendChild(check);

            const isToday = isCurrentMonth && day === today.getDate();
            if (isToday) {
                dayCell.classList.add('today');
                const todayLabel = document.createElement('div');
                todayLabel.className = 'cal-day-today-label';
                todayLabel.textContent = 'TODAY';
                todayLabel.style.pointerEvents = 'none';
                dayCell.appendChild(todayLabel);
            }

            dayCell.appendChild(numWrapper);
        } else {
            // Home View (Original Style)

            // A fixed-size box for the ring + number. The "TODAY" label (see
            // below) is appended INSIDE this box, absolutely positioned above
            // it, so it never adds flex-flow height that would push the
            // circle itself down relative to every other (label-less) cell
            // in the same calendar row.
            const circle = document.createElement('div');
            circle.className = 'cal-day-circle';

            const numSpan = document.createElement('span');
            numSpan.className = 'cal-day-num';
            numSpan.textContent = day;

            const ring = document.createElement('div');
            ring.className = 'cal-day-ring';

            circle.appendChild(ring);
            circle.appendChild(numSpan);

            const isToday = isCurrentMonth && day === today.getDate();
            if (isToday) {
                dayCell.classList.add('today');
                const todayLabel = document.createElement('div');
                todayLabel.className = 'cal-day-today-label';
                todayLabel.textContent = 'TODAY';
                circle.appendChild(todayLabel);
            }

            dayCell.appendChild(circle);

            if (selectedDateIso === dateString) {
                dayCell.classList.add('selected');
            }

            // 'period'/'premenstrual'/'fertile'/'ovulation' here always come
            // from an actual logged cycle (classifyDate also covers the
            // latest cycle's own fertile/ovulation estimate, since that IS
            // forecast cycle 1 — see renderCalendar()'s comment). The
            // predicted-* branches below cover forecast cycles that have no
            // logged period of their own yet (typically cycles 2 and 3).
            const classification = PeriodModel.classifyDate(dateString, cycles);
            if (classification === 'period') {
                dayCell.classList.add('period', 'period-solid');
            } else if (classification === 'premenstrual') {
                dayCell.classList.add('premenstrual');
            } else if (classification === 'ovulation') {
                dayCell.classList.add('ovulation');
            } else if (classification === 'fertile') {
                dayCell.classList.add('fertile');
            } else if (predictedPeriods.some(p => dateString >= p.start && dateString <= p.end)) {
                dayCell.classList.add('period-predicted');
            } else if (predictedPremenstruals.some(p => dateString >= p.start && dateString <= p.end)) {
                dayCell.classList.add('premenstrual-predicted');
            } else if (predictedOvulationDates.includes(dateString)) {
                dayCell.classList.add('ovulation-predicted');
            } else if (predictedFertileWindows.some(w => dateString >= w.start && dateString <= w.end)) {
                dayCell.classList.add('fertile-predicted');
            }

            // Tappable so any date (past or future) can drive the status
            // card below the calendar — mirrors the log-mode cell's own
            // role="button"/keydown pattern, but activates
            // handleHomeDayActivate() instead of the period-logging toggle.
            dayCell.setAttribute('role', 'button');
            dayCell.setAttribute('tabindex', '0');
            dayCell.setAttribute('aria-label', `${monthNames[month]} ${day}, ${year}`);
            dayCell.setAttribute('aria-pressed', selectedDateIso === dateString ? 'true' : 'false');

            const activateHomeDay = () => handleHomeDayActivate(dateString);
            dayCell.addEventListener('click', () => activateHomeDay());
            dayCell.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                    e.preventDefault();
                    activateHomeDay();
                }
            });
        }

        if (isLogMode) {
            const period = PeriodModel.findPeriodIn(stagedPeriods, dateString);
            let labelSuffix = '';
            if (period) {
                dayCell.classList.add('logged-period');
                if (dateString === period.startDate) {
                    dayCell.classList.add('logged-period-start');
                } else {
                    dayCell.classList.add('logged-period-predicted');
                }
                labelSuffix = ', logged as period day';
            }

            // Keyboard/screen-reader operability: this cell is a real toggle
            // control, not just a clickable div.
            dayCell.setAttribute('role', 'button');
            dayCell.setAttribute('tabindex', '0');
            dayCell.setAttribute('aria-label', `${monthNames[month]} ${day}, ${year}${labelSuffix}`);

            const activateLogDay = () => handleLogDayActivate(dateString);

            // Bind click event (pointer-events: none on children ensures it reliably hits the cell)
            dayCell.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                activateLogDay();
            });
            dayCell.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                    e.preventDefault();
                    e.stopPropagation();
                    activateLogDay();
                }
            });
        }

        grid.appendChild(dayCell);
    }

    monthBlock.appendChild(grid);
    return monthBlock;
}

function initHistoryView() {
    renderHistoryList('all');
}

// e.g. "28 days" / "28 days (predicted)" for the still-open latest cycle.
function formatCycleTitle(cycle) {
    return cycle.predicted ? `${cycle.cycleLength} days (predicted)` : `${cycle.cycleLength} days`;
}

// e.g. "Jan 1 – Jan 28" (or "Jan 1, 2025 – Jan 28, 2025" across a year boundary).
function formatCycleSubtitle(cycle) {
    const start = DateUtils.parseISODate(cycle.startDate);
    const end = DateUtils.parseISODate(cycle.endDate);
    return `${DateUtils.formatDisplayDate(start)} – ${DateUtils.formatDisplayDate(end)}`;
}

// Builds a dot-per-day visualization (period/fertile/ovulation/blank) for one
// computed cycle, on the fly — replaces the old hand-authored `dots` arrays.
function cycleToDots(cycle) {
    const dots = [];
    const start = DateUtils.parseISODate(cycle.startDate);
    for (let i = 0; i < cycle.cycleLength; i++) {
        const ds = DateUtils.toISODate(DateUtils.addDays(start, i));
        if (i < cycle.periodDayCount) {
            dots.push('p');
        } else if (ds === cycle.ovulationDate) {
            dots.push('o');
        } else if (cycle.fertileWindow && ds >= cycle.fertileWindow.start && ds <= cycle.fertileWindow.end) {
            dots.push('f');
        } else {
            dots.push('');
        }
    }
    return dots;
}

function renderHistoryList(limit) {
    const container = document.getElementById('history-list-container');
    if (!container) return;

    // Most recent first.
    let cycles = PeriodModel.computeCycles().slice().sort((a, b) => b.startDate.localeCompare(a.startDate));

    if (limit !== 'all') {
        const num = parseInt(limit, 10);
        cycles = cycles.slice(0, num);
    }

    // Group by the year of each cycle's start date.
    const grouped = [];
    cycles.forEach(cycle => {
        const year = DateUtils.parseISODate(cycle.startDate).getFullYear();
        let group = grouped.find(g => g.year === year);
        if (!group) {
            group = { year, cycles: [] };
            grouped.push(group);
        }
        group.cycles.push(cycle);
    });

    container.innerHTML = '';

    if (!cycles.length) {
        const empty = document.createElement('p');
        empty.style.cssText = 'text-align:center; color: var(--text-muted); margin-top: 24px;';
        empty.textContent = 'No cycles logged yet — tap + to log your first period.';
        container.appendChild(empty);
        return;
    }

    grouped.forEach(yearGroup => {
        const yearHeader = document.createElement('h3');
        yearHeader.className = 'history-year-header';
        yearHeader.textContent = yearGroup.year;
        container.appendChild(yearHeader);

        yearGroup.cycles.forEach(cycle => {
            const card = document.createElement('div');
            card.className = 'history-card';

            const title = document.createElement('h4');
            title.textContent = formatCycleTitle(cycle);
            const subtitle = document.createElement('p');
            subtitle.textContent = formatCycleSubtitle(cycle);

            const dotsContainer = document.createElement('div');
            dotsContainer.className = 'cycle-dots';
            cycleToDots(cycle).forEach(d => {
                const dot = document.createElement('div');
                dot.className = `cycle-dot ${d}`;
                dotsContainer.appendChild(dot);
            });

            card.appendChild(title);
            card.appendChild(subtitle);
            card.appendChild(dotsContainer);

            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.setAttribute('aria-label', `Cycle ${title.textContent}, ${subtitle.textContent}. View details.`);

            card.addEventListener('click', () => showCycleDetails(cycle));
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                    e.preventDefault();
                    showCycleDetails(cycle);
                }
            });

            container.appendChild(card);
        });
    });
}

// The cycle currently open in the Cycle Details sheet — set by
// showCycleDetails(), read by the edit form's Save handler so it knows which
// id to patch. null whenever that sheet isn't open.
let currentDetailCycle = null;

function showCycleDetails(cycle) {
    currentDetailCycle = cycle;

    document.getElementById('detail-view-mode').style.display = '';
    document.getElementById('detail-edit-mode').style.display = 'none';
    const editBtn = document.getElementById('detail-edit-btn');
    if (editBtn) {
        const canEdit = !!cycle.id && PeriodModel.isWithinEditWindow(cycle.startDate);
        editBtn.style.display = canEdit ? '' : 'none';
    }

    document.getElementById('detail-cycle-title').textContent = `Cycle length: ${formatCycleTitle(cycle)}`;
    document.getElementById('detail-cycle-start').textContent =
        `Started ${DateUtils.formatDisplayDate(DateUtils.parseISODate(cycle.startDate))}`;

    const dotsContainer = document.getElementById('detail-cycle-dots');
    dotsContainer.innerHTML = '';
    cycleToDots(cycle).forEach(d => {
        const dot = document.createElement('div');
        dot.className = `cycle-dot ${d}`;
        dotsContainer.appendChild(dot);
    });

    const fertileText = document.getElementById('detail-fertile-text');
    const ovulationText = document.getElementById('detail-ovulation-text');
    const periodText = document.getElementById('detail-period-text');

    if (cycle.fertileWindow) {
        const fStart = DateUtils.formatDisplayDate(DateUtils.parseISODate(cycle.fertileWindow.start));
        const fEnd = DateUtils.formatDisplayDate(DateUtils.parseISODate(cycle.fertileWindow.end));
        fertileText.textContent = `It's likely that your fertile window lasted from ${fStart} to ${fEnd}`;
        ovulationText.textContent = `It's likely that you ovulated on ${DateUtils.formatDisplayDate(DateUtils.parseISODate(cycle.ovulationDate))}`;
    } else {
        fertileText.textContent = 'Not enough data yet to estimate a fertile window';
        ovulationText.textContent = 'Not enough data yet to estimate ovulation';
    }
    periodText.textContent = `Your period lasted ${cycle.periodDayCount} days`;

    document.getElementById('view-cycle-details').classList.add('active');
}

function initYearView() {
    const wrapper = document.getElementById('year-grids-wrapper');
    if (!wrapper) return;

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    wrapper.innerHTML = '';

    const cycles = PeriodModel.computeCycles();
    const currentYear = new Date().getFullYear();
    let years = cycles.length
        ? Array.from(new Set(cycles.map(c => DateUtils.parseISODate(c.startDate).getFullYear())))
        : [currentYear];
    if (!years.includes(currentYear)) years.push(currentYear);
    years.sort((a, b) => a - b);

    years.forEach(year => {
        const yearTitle = document.createElement('h2');
        yearTitle.className = 'year-title';
        yearTitle.textContent = year;
        wrapper.appendChild(yearTitle);

        const container = document.createElement('div');
        container.className = 'year-grid';

        for (let m = 0; m < 12; m++) {
            const monthDiv = document.createElement('div');
            monthDiv.className = 'mini-month';

            const title = document.createElement('h4');
            title.textContent = monthNames[m];
            monthDiv.appendChild(title);

            const grid = document.createElement('div');
            grid.className = 'mini-grid';

            const firstDay = new Date(year, m, 1).getDay();
            const daysInMonth = new Date(year, m + 1, 0).getDate();
            const weekStart = getWeekStartSetting();
            const adjustedFirstDay = (firstDay - weekStart + 7) % 7;

            for (let i = 0; i < adjustedFirstDay; i++) {
                const empty = document.createElement('div');
                grid.appendChild(empty);
            }

            for (let d = 1; d <= daysInMonth; d++) {
                const dayCell = document.createElement('div');
                dayCell.className = 'mini-day';
                dayCell.textContent = d;

                const dateString = DateUtils.toISODate(new Date(year, m, d));
                const cls = PeriodModel.classifyDate(dateString, cycles);
                if (cls) dayCell.classList.add(cls);

                grid.appendChild(dayCell);
            }

            monthDiv.appendChild(grid);
            container.appendChild(monthDiv);
        }
        wrapper.appendChild(container);
    });
}

// Populates the Home view's "My Cycles" stat cards and the daily status
// card from real computed cycles — both used to be static placeholder text.
function updateHomeStats(cycles) {
    const cycleLengthEl = document.getElementById('stat-cycle-length');
    const periodLengthEl = document.getElementById('stat-period-length');
    const statusTitleEl = document.getElementById('daily-status-title');
    const statusDescEl = document.getElementById('daily-status-desc');
    if (!cycleLengthEl || !periodLengthEl || !statusTitleEl || !statusDescEl) return;

    if (!cycles.length) {
        cycleLengthEl.textContent = '—';
        periodLengthEl.textContent = '—';
        statusTitleEl.textContent = 'Log your first period';
        statusDescEl.textContent = 'Tap + to get started';
        return;
    }

    // "Previous" = the most recently *completed* cycle if one exists,
    // otherwise fall back to the only (still-open) cycle there is.
    const completed = cycles.filter(c => !c.predicted);
    const reference = completed.length ? completed[completed.length - 1] : cycles[cycles.length - 1];
    cycleLengthEl.textContent = `${reference.cycleLength} days`;
    periodLengthEl.textContent = `${reference.periodDayCount} days`;

    const latest = cycles[cycles.length - 1];
    const todayIso = DateUtils.toISODate(new Date());

    if (todayIso >= latest.startDate && todayIso <= latest.periodEndDate) {
        const dayNum = DateUtils.daysBetween(latest.startDate, todayIso) + 1;
        statusTitleEl.textContent = 'Period in progress';
        statusDescEl.textContent = `Day ${dayNum} of your period`;
    } else if (latest.predicted) {
        const nextStart = DateUtils.toISODate(DateUtils.addDays(DateUtils.parseISODate(latest.startDate), latest.cycleLength));
        const daysUntil = DateUtils.daysBetween(todayIso, nextStart);
        if (daysUntil >= 0) {
            statusTitleEl.textContent = daysUntil === 0 ? 'Period likely to start today' : `Period likely in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
        } else {
            statusTitleEl.textContent = 'Period may be late';
        }
        statusDescEl.textContent = 'Based on your past cycles';
    } else {
        statusTitleEl.textContent = 'Tracking your cycle';
        statusDescEl.textContent = 'Based on your past cycles';
    }
}

function initCalendar() {
    refreshHomeView();
}

// Recomputes cycles once and re-renders every Home-view piece that depends
// on them (calendar + stat cards + status), so they can never drift apart.
// Accepts an optional precomputed `cycles` array so call sites that already
// have one (e.g. because they also call refreshCycleInsights with it) don't
// recompute it a second time.
function refreshHomeView(cycles = PeriodModel.computeCycles()) {
    renderCalendar(cycles);
    // renderCalendar() re-reads selectedDateIso while building each cell, so
    // the .selected marker survives this call unconditionally. The status
    // card itself, though, must NOT be stomped back to "today" once a date
    // has been tapped — updateStatusCardForDate() (driven from
    // refreshCycleInsights, called alongside this at every shared call site)
    // owns the status card from that point on.
    if (selectedDateIso === null) {
        updateHomeStats(cycles);
    }
}

// ── Cycle Insights (phase / forecast / anomalies / insights) ────────────
// Sibling to refreshHomeView() — takes the SAME precomputed `cycles` array
// so the two can never show mismatched data, and is wired into the exact
// same call sites (see app.js's DOMContentLoaded, Sync Now, and log-save
// handlers). CycleInsights.analyze() is stateless/pure; nothing here is
// cached beyond the current render pass.
function refreshCycleInsights(cycles) {
    if (typeof CycleInsights === 'undefined') return; // defensive — module not loaded
    const analysis = CycleInsights.analyze(cycles, new Date());
    if (selectedDateIso === null) {
        updateCyclePhaseStatus(analysis);
    } else {
        updateStatusCardForDate(selectedDateIso, cycles);
    }
    renderForecastSection(analysis, cycles);
    renderInsightsList(analysis);
}

const PHASE_LABELS = { follicular: 'Follicular phase', ovulation: 'Ovulation window', luteal: 'Luteal phase' };
const PHASE_ICONS = { follicular: 'eco', ovulation: 'bubble_chart', luteal: 'brightness_2' };

// Sibling to updateHomeStats(cycles) — never touches its own baseline copy
// except by deliberately overriding it for the three non-bleeding phases.
// Must run AFTER updateHomeStats() so its fallback text is in place first,
// and always resets its own DOM state (icon class, progress bar hidden-ness)
// since it runs repeatedly on the same page across re-renders.
function updateCyclePhaseStatus(analysis) {
    const wrap = document.getElementById('status-phase-progress');
    const track = document.getElementById('status-phase-progress-track');
    const fill = document.getElementById('status-phase-progress-fill');
    const iconCircle = document.getElementById('status-icon-circle');
    const iconGlyph = document.getElementById('status-icon-glyph');
    if (!wrap || !track || !fill || !iconCircle || !iconGlyph || !analysis) return;

    const phase = analysis.phase;

    // No usable phase data, OR currently bleeding: leave updateHomeStats()'s
    // "Period in progress / Day N" copy completely alone — just reset our
    // own bits back to their default state.
    if (!phase || phase.phase === 'menstruation') {
        wrap.hidden = true;
        iconCircle.className = 'status-icon';
        iconGlyph.textContent = 'water_drop';
        return;
    }

    const label = PHASE_LABELS[phase.phase];
    if (!label) { wrap.hidden = true; return; } // unknown phase name — fail safe, don't guess

    document.getElementById('daily-status-title').textContent = label;

    let desc = `Day ${phase.dayOfCycle} of your cycle`;
    if (phase.phase === 'luteal' && analysis.forecast && analysis.forecast[0]) {
        const daysUntil = DateUtils.daysBetween(analysis.asOfDate, analysis.forecast[0].predictedStartDate);
        if (daysUntil >= 0) {
            desc += daysUntil === 0 ? ' · period likely today' : ` · period likely in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
        }
    }
    document.getElementById('daily-status-desc').textContent = desc;

    wrap.hidden = false;
    const pct = Math.max(0, Math.min(100, phase.phaseProgressPercent));
    fill.style.width = pct + '%';
    track.setAttribute('aria-valuenow', String(Math.round(pct)));
    track.setAttribute('aria-label', `${label} progress`);

    iconCircle.className = `status-icon phase-${phase.phase}`;
    iconGlyph.textContent = PHASE_ICONS[phase.phase] || 'water_drop';
}

const PREGNANCY_CHANCE_TEXT = {
    higher: 'Higher chance of getting pregnant',
    lower: 'Lower chance of getting pregnant',
};

// Sibling to updateHomeStats()+updateCyclePhaseStatus() combined, generalized
// to an arbitrary date via CycleInsights.getStatusForDate(). Used ONLY once
// selectedDateIso is non-null (see refreshHomeView/refreshCycleInsights) —
// the null/"no tap yet" path never calls this, so it carries zero regression
// risk for the existing today-only behavior.
//
// Two cases are deliberately special-cased below to read IDENTICALLY to the
// untouched updateHomeStats()/updateCyclePhaseStatus() pair when the tapped
// date happens to be today: the zero-cycles empty state, and "today,
// currently bleeding" (which would otherwise read "Period day N" instead of
// "Period in progress"). Every other today-phase case (follicular/ovulation/
// luteal) already naturally matches, since both paths share the same
// PHASE_LABELS/desc-format/luteal-suffix logic.
function updateStatusCardForDate(dateString, cycles) {
    const titleEl = document.getElementById('daily-status-title');
    const descEl = document.getElementById('daily-status-desc');
    const eyebrowEl = document.getElementById('status-prediction-eyebrow');
    const pregnancyEl = document.getElementById('status-pregnancy-chance');
    const pregnancyTextEl = document.getElementById('status-pregnancy-chance-text');
    const wrap = document.getElementById('status-phase-progress');
    const track = document.getElementById('status-phase-progress-track');
    const fill = document.getElementById('status-phase-progress-fill');
    const iconCircle = document.getElementById('status-icon-circle');
    const iconGlyph = document.getElementById('status-icon-glyph');
    if (!titleEl || !descEl) return;

    const info = CycleInsights.getStatusForDate(cycles, DateUtils.parseISODate(dateString), new Date());

    if (info.kind === 'no-data') {
        if (info.reason === 'no-cycles') {
            // Matches updateHomeStats()'s own empty state exactly.
            titleEl.textContent = 'Log your first period';
            descEl.textContent = 'Tap + to get started';
        } else {
            titleEl.textContent = 'No data yet';
            descEl.textContent = 'This is before your first logged period';
        }
        if (eyebrowEl) eyebrowEl.hidden = true;
        if (pregnancyEl) pregnancyEl.hidden = true;
        if (wrap) wrap.hidden = true;
        if (iconCircle) iconCircle.className = 'status-icon';
        if (iconGlyph) iconGlyph.textContent = 'help_outline';
        return;
    }

    if (eyebrowEl) eyebrowEl.hidden = !info.isPredicted;

    if (info.phase === 'menstruation') {
        const isViewingToday = dateString === DateUtils.toISODate(new Date());
        titleEl.textContent = isViewingToday ? 'Period in progress' : `Period day ${info.dayOfCycle}`;
        descEl.textContent = `Day ${info.dayOfCycle} of your period`;
        if (pregnancyEl) pregnancyEl.hidden = true; // never applies to period days
        if (wrap) wrap.hidden = true;
        if (iconCircle) iconCircle.className = 'status-icon';
        if (iconGlyph) iconGlyph.textContent = 'water_drop';
        return;
    }

    const label = PHASE_LABELS[info.phase];
    titleEl.textContent = label;

    let desc = `Day ${info.dayOfCycle} of your cycle`;
    if (info.phase === 'luteal') {
        const nextPeriodStart = DateUtils.toISODate(DateUtils.addDays(DateUtils.parseISODate(info.cycleEndDate), 1));
        const daysUntil = DateUtils.daysBetween(dateString, nextPeriodStart);
        if (daysUntil >= 0) {
            desc += daysUntil === 0 ? ' · period likely today' : ` · period likely in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
        }
    }
    descEl.textContent = desc;

    if (pregnancyEl) {
        if (info.isPredicted) {
            const inFertileWindow = !!info.fertileWindow && dateString >= info.fertileWindow.start && dateString <= info.fertileWindow.end;
            pregnancyEl.hidden = false;
            pregnancyTextEl.textContent = PREGNANCY_CHANCE_TEXT[inFertileWindow ? 'higher' : 'lower'];
        } else {
            pregnancyEl.hidden = true;
        }
    }

    if (wrap && track && fill) {
        wrap.hidden = false;
        const pct = Math.max(0, Math.min(100, info.phaseProgressPercent));
        fill.style.width = pct + '%';
        track.setAttribute('aria-valuenow', String(Math.round(pct)));
        track.setAttribute('aria-label', `${label} progress`);
    }

    if (iconCircle && iconGlyph) {
        iconCircle.className = `status-icon phase-${info.phase}`;
        iconGlyph.textContent = PHASE_ICONS[info.phase] || 'water_drop';
    }
}

function renderForecastSection(analysis, cycles) {
    const scroll = document.getElementById('forecast-scroll');
    if (!scroll || !analysis) return;
    scroll.innerHTML = '';

    if (!analysis.forecast) {
        const p = document.createElement('p');
        p.className = 'forecast-empty-message';
        p.textContent = cycles.length === 0
            ? 'Log your first period to unlock forecasting.'
            : 'Not enough cycle history yet to forecast — keep tracking.';
        scroll.appendChild(p);
        return;
    }

    analysis.forecast.forEach(f => {
        const card = document.createElement('div');
        card.className = 'forecast-card';
        card.setAttribute('role', 'listitem');

        const label = document.createElement('span');
        label.className = 'forecast-card-label';
        label.textContent = `Cycle ${f.cycleNumber}`;

        const date = document.createElement('span');
        date.className = 'forecast-card-date';
        date.textContent = `${DateUtils.formatDisplayDate(DateUtils.parseISODate(f.predictedStartDate))} – ${DateUtils.formatDisplayDate(DateUtils.parseISODate(f.predictedEndDate))}`;

        const length = document.createElement('span');
        length.className = 'forecast-card-length';
        length.textContent = `~${f.predictedLength} days`;

        const badge = document.createElement('span');
        const badgeClass = f.confidenceLabel === 'high' ? 'normal' : f.confidenceLabel === 'medium' ? 'confidence-medium' : 'confidence-low';
        badge.className = `stat-badge ${badgeClass}`;
        badge.textContent = `${f.confidenceLabel.toUpperCase()} CONFIDENCE`;

        card.append(label, date, length, badge);
        scroll.appendChild(card);
    });
}

const INSIGHT_ICON = {
    positive: { cls: 'icon-positive', glyph: 'check_circle' },
    info: { cls: 'icon-neutral', glyph: 'info' },
    warning: { cls: 'icon-anomaly', glyph: 'error_outline' },
    critical: { cls: 'icon-anomaly severity-high', glyph: 'priority_high' },
};

function buildInsightRow(iconClass, glyph, message, hint) {
    const row = document.createElement('div');
    row.className = 'insight-row';

    const icon = document.createElement('div');
    icon.className = `insight-icon ${iconClass}`;
    const span = document.createElement('span');
    span.className = 'material-icons-outlined';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = glyph;
    icon.appendChild(span);

    const group = document.createElement('div');
    group.className = 'insight-text-group';
    const text = document.createElement('div');
    text.className = 'insight-text';
    text.textContent = message;
    group.appendChild(text);
    if (hint) {
        const hintEl = document.createElement('div');
        hintEl.className = 'insight-hint';
        hintEl.textContent = hint;
        group.appendChild(hintEl);
    }

    row.append(icon, group);
    return row;
}

function cycleAnomalyMessage(a) {
    const date = DateUtils.formatDisplayDate(DateUtils.parseISODate(a.startDate));
    if (a.reasons.includes('range_too_long_possible_gap')) return `Your cycle starting ${date} lasted ${a.cycleLength} days — did you miss logging a period in between?`;
    if (a.reasons.includes('range_too_short')) return `Your cycle starting ${date} was unusually short (${a.cycleLength} days).`;
    if (a.reasons.includes('range_long')) return `Your cycle starting ${date} was longer than usual (${a.cycleLength} days).`;
    return `Your cycle starting ${date} was unusual for you (${a.cycleLength} days).`;
}

function periodAnomalyMessage(a) {
    const date = DateUtils.formatDisplayDate(DateUtils.parseISODate(a.startDate));
    return a.reason === 'too_short'
        ? `The period logged on ${date} was only ${a.periodDayCount} day(s) — worth double-checking.`
        : `The period logged on ${date} lasted ${a.periodDayCount} days, longer than typical — worth double-checking.`;
}

// Anomaly rows are deliberately non-interactive (no role="button", no click
// handler) — there's no verify/dismiss/edit workflow to hang a tap on. The
// static hint just points at the existing log-calendar entry point, which
// is honest about what the app can actually do today.
function renderInsightsList(analysis) {
    const section = document.getElementById('insights-section');
    const list = document.getElementById('insights-list');
    if (!section || !list || !analysis) return;
    list.innerHTML = '';

    const rows = [];
    analysis.insights.forEach(ins => {
        const meta = INSIGHT_ICON[ins.severity] || INSIGHT_ICON.info;
        rows.push(buildInsightRow(meta.cls, meta.glyph, ins.message));
    });
    analysis.anomalies.cycleAnomalies.forEach(a => {
        const meta = a.classification === 'outlier' ? INSIGHT_ICON.critical : INSIGHT_ICON.warning;
        rows.push(buildInsightRow(meta.cls, meta.glyph, cycleAnomalyMessage(a), 'You can review or correct this in your period log if it looks wrong.'));
    });
    analysis.anomalies.periodLengthAnomalies.forEach(a => {
        rows.push(buildInsightRow(INSIGHT_ICON.warning.cls, INSIGHT_ICON.warning.glyph, periodAnomalyMessage(a), 'You can review or correct this in your period log if it looks wrong.'));
    });

    section.hidden = rows.length === 0;
    rows.forEach(r => list.appendChild(r));
}

function renderCalendar(cycles = PeriodModel.computeCycles()) {
    const scrollArea = document.getElementById('calendar-scroll-area');
    if (!scrollArea) return;
    scrollArea.innerHTML = '';

    const today = new Date();

    // Same forecast used by the "Next 3 cycles" section (CycleInsights
    // .getForecast's own default count) — reused here, not recomputed, so
    // the calendar's predicted ranges always match what's shown there.
    // All 3 forecasted cycles are marked on the calendar, not just the
    // immediate next one, so the Home view shows the same forecast depth
    // as the bottom-of-page forecast cards.
    const forecast = cycles.length ? CycleInsights.getForecast(cycles, today, 3) : null;
    const predictedPeriods = forecast
        ? forecast.map(f => ({ start: f.predictedPeriodStartDate, end: f.predictedPeriodEndDate }))
        : [];

    // Each predicted period's own premenstrual lead-in, using the same
    // window length as PeriodModel.classifyDate() uses for actual logged
    // periods — kept in one place (PeriodModel.PREMENSTRUAL_WINDOW_DAYS) so
    // this never drifts out of sync with a second hardcoded value.
    const predictedPremenstruals = predictedPeriods.map(p => ({
        start: DateUtils.toISODate(DateUtils.addDays(DateUtils.parseISODate(p.start), -PeriodModel.PREMENSTRUAL_WINDOW_DAYS)),
        end: DateUtils.toISODate(DateUtils.addDays(DateUtils.parseISODate(p.start), -1)),
    }));

    // Forecast cycle 1's ovulation/fertile window is already covered by
    // classifyDate() (it's computed as part of the latest logged cycle in
    // computeCycles(), using the exact same estimate getForecast() reuses
    // for cycle 1 — see getForecast()'s own comment). These arrays exist so
    // cycles 2 and 3 (which have no logged period yet) get the same
    // markers; harmless overlap with cycle 1 is fine since classifyDate's
    // result always takes priority in generateMonthGrid().
    const predictedOvulationDates = forecast
        ? forecast.map(f => f.ovulationDate).filter(Boolean)
        : [];
    const predictedFertileWindows = forecast
        ? forecast.map(f => f.fertileWindow).filter(Boolean)
        : [];

    // Render past 6 months to future 6 months
    let currentMonthBlock = null;

    for (let i = -6; i <= 6; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const block = generateMonthGrid(d.getFullYear(), d.getMonth(), false, cycles, predictedPeriods, predictedPremenstruals, predictedOvulationDates, predictedFertileWindows);
        scrollArea.appendChild(block);

        if (i === 0) currentMonthBlock = block;
    }

    // Scroll to current month without scrolling parent containers
    setTimeout(() => {
        if (currentMonthBlock && scrollArea) {
            scrollArea.scrollTop = currentMonthBlock.offsetTop;
        }
    }, 10);
}

function initLogCalendar() {
    stagedPeriods = PeriodModel.getPeriods().map(p => ({ ...p }));
    renderLogCalendar(true); // pass true to center it on first load
}

function renderLogCalendar(scrollToCurrent = false) {
    const scrollArea = document.getElementById('log-calendar-scroll-area');
    const scrollContainer = document.querySelector('#view-logging .home-scroll-content');
    if (!scrollArea || !scrollContainer) return;
    if (!stagedPeriods) stagedPeriods = PeriodModel.getPeriods().map(p => ({ ...p }));

    // Save scroll position relative to the actual scroll container
    const scrollTop = scrollContainer.scrollTop;

    scrollArea.innerHTML = '';
    const today = new Date();
    let currentMonthBlock = null;

    for (let i = -12; i <= 2; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const block = generateMonthGrid(d.getFullYear(), d.getMonth(), true);
        scrollArea.appendChild(block);
        if (i === 0) currentMonthBlock = block;
    }

    if (scrollToCurrent && currentMonthBlock) {
        // Wait for the popup transition to finish before calculating offset
        setTimeout(() => {
            let offset = currentMonthBlock.offsetTop;
            let parent = currentMonthBlock.offsetParent;
            while (parent && parent !== scrollContainer) {
                offset += parent.offsetTop;
                parent = parent.offsetParent;
            }
            // Subtract a little padding so the month title isn't glued to the top
            scrollContainer.scrollTop = Math.max(0, offset - 20);
        }, 150);
    } else {
        scrollContainer.scrollTop = scrollTop;
    }
}
