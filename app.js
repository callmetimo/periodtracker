// App main logic
let loggedDates = new Set();
let allHistoryPeriodDates = new Set();

function loadAllPeriodDates() {
    loggedDates = new Set();
    allHistoryPeriodDates = new Set();

    // Load loggedDates
    try {
        const saved = localStorage.getItem('periodTrackerLoggedDates');
        if (saved) {
            loggedDates = new Set(JSON.parse(saved));
            loggedDates.forEach(d => allHistoryPeriodDates.add(d));
        }
    } catch(e) {}

    // Load historical dates
    try {
        const hist = localStorage.getItem('periodTrackerHistory');
        if (hist) {
            const historicalCycles = JSON.parse(hist);
            for (const yearGroup of historicalCycles) {
                for (const cycle of yearGroup.cycles) {
                    const sep = cycle.subtitle.includes('–') ? '–' : '-';
                    const parts = cycle.subtitle.split(sep).map(s => s.trim());
                    let d = new Date(parts[0] + ', ' + yearGroup.year);
                    if (isNaN(d)) d = new Date(parts[0]);

                    if (!isNaN(d)) {
                        const periodDays = cycle.dots ? cycle.dots.filter(dot => dot === 'p').length : 5;
                        for (let i = 0; i < periodDays; i++) {
                            const pDate = new Date(d);
                            pDate.setDate(pDate.getDate() + i);
                            const ds = `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}-${String(pDate.getDate()).padStart(2, '0')}`;
                            allHistoryPeriodDates.add(ds);
                        }
                    }
                }
            }
        }
    } catch(e) {}
}

// Initial load
loadAllPeriodDates();

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initHistoryView();
    initYearView();
    initToggles();
    if (typeof Auth !== 'undefined') {
        Auth.start();
        Auth.markAppReady();
        const btnSignOut = document.getElementById('btn-profile-signout');
        if (btnSignOut) btnSignOut.addEventListener('click', () => Auth.signOut());

        const btnSyncNow = document.getElementById('btn-sync-now');
        if (btnSyncNow) btnSyncNow.addEventListener('click', async () => {
            btnSyncNow.textContent = 'Syncing…';
            btnSyncNow.disabled = true;
            try {
                // triggerFirstTapSync gets/renews the OAuth token (works from a real tap)
                await Auth.triggerFirstTapSync();
                await DataStore.saveData();
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
            renderCalendar();
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
        document.getElementById('view-logging').classList.remove('active');
    });

    document.getElementById('log-save').addEventListener('click', async () => {
        localStorage.setItem('periodTrackerLoggedDates', JSON.stringify(Array.from(loggedDates)));
        document.getElementById('view-logging').classList.remove('active');
        renderCalendar();

        // Sync to Google Drive and show toast
        if (typeof DataStore !== 'undefined') {
            try {
                await DataStore.saveData();
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

// Shared by both the click and keydown (Enter/Space) handlers on a log-mode
// calendar day cell, so keyboard users get the identical toggle behavior.
function handleLogDayActivate(dateString, year, month, day) {
    // If it's already logged, we remove the whole block.
    // For simplicity, we just toggle 5 days forward from the tapped date.
    const isAdding = !loggedDates.has(dateString);

    for (let i = 0; i < 5; i++) {
        const d = new Date(year, month, day + i);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        if (isAdding) {
            loggedDates.add(ds);
        } else {
            loggedDates.delete(ds);
        }

        const cellToUpdate = document.querySelector(`#view-logging .cal-day[data-date="${ds}"]`);
        if (cellToUpdate) {
            if (isAdding) {
                cellToUpdate.classList.add('logged-period');
                // First day is solid, rest are dotted
                if (i === 0) {
                    cellToUpdate.classList.add('logged-period-start');
                    cellToUpdate.classList.remove('logged-period-predicted');
                } else {
                    cellToUpdate.classList.add('logged-period-predicted');
                    cellToUpdate.classList.remove('logged-period-start');
                }
            } else {
                cellToUpdate.classList.remove('logged-period', 'logged-period-start', 'logged-period-predicted');
            }
            cellToUpdate.setAttribute('aria-label',
                cellToUpdate.getAttribute('aria-label').replace(/, logged as period day$/, '') +
                (isAdding ? ', logged as period day' : ''));
        }
    }
}

function generateMonthGrid(year, month, isLogMode) {
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
        
        const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
            dayCell.textContent = day;
            
            const ring = document.createElement('div');
            ring.className = 'cal-day-ring';
            dayCell.appendChild(ring);

            const isToday = isCurrentMonth && day === today.getDate();
            if (isToday) {
                dayCell.classList.add('today');
            }

            // Real period days from combined history + logged dates
            if (allHistoryPeriodDates.has(dateString)) {
                dayCell.classList.add('period', 'period-solid');
            }
        }

        if (isLogMode) {
            if (loggedDates.has(dateString)) {
                dayCell.classList.add('logged-period');
                // Determine if this is the start of a block
                const prevDate = new Date(year, month, day - 1);
                const prevDateStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`;

                if (!loggedDates.has(prevDateStr)) {
                    dayCell.classList.add('logged-period-start');
                } else {
                    dayCell.classList.add('logged-period-predicted');
                }
            }

            // Keyboard/screen-reader operability: this cell is a real toggle
            // control, not just a clickable div.
            dayCell.setAttribute('role', 'button');
            dayCell.setAttribute('tabindex', '0');
            dayCell.setAttribute('aria-label',
                `${monthNames[month]} ${day}, ${year}` + (loggedDates.has(dateString) ? ', logged as period day' : ''));

            const activateLogDay = () => handleLogDayActivate(dateString, year, month, day);

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

function renderHistoryList(limit) {
    const container = document.getElementById('history-list-container');
    if (!container) return;

    let historyData = [];
    try {
        const stored = localStorage.getItem('periodTrackerHistory');
        if (stored) {
            historyData = JSON.parse(stored);
        }
    } catch(e) {
        console.error("Failed to load history data", e);
    }

    // Flatten cycles to apply limit across years
    let allCycles = [];
    historyData.forEach(yearGroup => {
        yearGroup.cycles.forEach(cycle => {
            allCycles.push({ year: yearGroup.year, cycle: cycle });
        });
    });

    if (limit !== 'all') {
        const num = parseInt(limit, 10);
        allCycles = allCycles.slice(0, num);
    }

    // Re-group by year
    const grouped = [];
    allCycles.forEach(item => {
        let group = grouped.find(g => g.year === item.year);
        if (!group) {
            group = { year: item.year, cycles: [] };
            grouped.push(group);
        }
        group.cycles.push(item.cycle);
    });

    container.innerHTML = '';
    
    grouped.forEach(yearGroup => {
        // Add Year Header
        const yearHeader = document.createElement('h3');
        yearHeader.className = 'history-year-header';
        yearHeader.textContent = yearGroup.year;
        container.appendChild(yearHeader);

        yearGroup.cycles.forEach(cycle => {
            const card = document.createElement('div');
            card.className = 'history-card';

            const title = document.createElement('h4');
            title.textContent = cycle.title;
            const subtitle = document.createElement('p');
            subtitle.textContent = cycle.subtitle;

            const dotsContainer = document.createElement('div');
            dotsContainer.className = 'cycle-dots';

            cycle.dots.forEach(d => {
                const dot = document.createElement('div');
                dot.className = `cycle-dot ${d}`;
                dotsContainer.appendChild(dot);
            });

            card.appendChild(title);
            card.appendChild(subtitle);
            card.appendChild(dotsContainer);

            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.setAttribute('aria-label', `Cycle ${cycle.title}, ${cycle.subtitle}. View details.`);

            card.addEventListener('click', () => {
                showCycleDetails(cycle);
            });
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

function showCycleDetails(cycle) {
    // Populate header
    document.getElementById('detail-cycle-title').textContent = `Cycle length: ${cycle.title}`;
    
    // Parse start date from subtitle (e.g. "Jan 1 – Jan 28")
    const parts = cycle.subtitle.split('–');
    const startText = parts[0] ? parts[0].trim() : cycle.subtitle;
    document.getElementById('detail-cycle-start').textContent = `Started ${startText}`;

    // Populate dots
    const dotsContainer = document.getElementById('detail-cycle-dots');
    dotsContainer.innerHTML = '';
    
    let pCount = 0;
    let fCount = 0;
    
    cycle.dots.forEach(d => {
        const dot = document.createElement('div');
        dot.className = `cycle-dot ${d}`;
        dotsContainer.appendChild(dot);
        
        if (d === 'p') pCount++;
        if (d === 'f') fCount++;
    });
    
    // Insights text
    const fertileText = document.getElementById('detail-fertile-text');
    const ovulationText = document.getElementById('detail-ovulation-text');
    const periodText = document.getElementById('detail-period-text');
    
    fertileText.textContent = `It's likely that your fertile window lasted ${fCount} days`;
    ovulationText.textContent = `It's likely that you ovulated near the end of your fertile window`;
    periodText.textContent = `Your period lasted ${pCount} days`;

    // Show view
    document.getElementById('view-cycle-details').classList.add('active');
}

function initYearView() {
    const wrapper = document.getElementById('year-grids-wrapper');
    if (!wrapper) return;

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    wrapper.innerHTML = '';
    
    let years = [2024, 2025, 2026];
    try {
        const stored = localStorage.getItem('periodTrackerHistory');
        if (stored) {
            const historyData = JSON.parse(stored);
            years = historyData.map(group => group.year);
            // Sort ascending to have oldest on top (2020 down to 2026).
            years.sort((a, b) => a - b);
        }
    } catch(e) {
        console.error("Failed to load years from history data", e);
    }
    
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

                // NOTE: real period/fertile/ovulation classification is wired up in a
                // later refactor step once a single canonical data model exists; this
                // view intentionally shows no highlighting until then rather than fake data.

                grid.appendChild(dayCell);
            }

            monthDiv.appendChild(grid);
            container.appendChild(monthDiv);
        }
        wrapper.appendChild(container);
    });
}

function initCalendar() {
    renderCalendar();
}

function renderCalendar() {
    const scrollArea = document.getElementById('calendar-scroll-area');
    if (!scrollArea) return;
    scrollArea.innerHTML = '';
    
    const today = new Date();
    // Render past 6 months to future 6 months
    let currentMonthBlock = null;

    for (let i = -6; i <= 6; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const block = generateMonthGrid(d.getFullYear(), d.getMonth(), false);
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
    renderLogCalendar(true); // pass true to center it on first load
}

function renderLogCalendar(scrollToCurrent = false) {
    const scrollArea = document.getElementById('log-calendar-scroll-area');
    const scrollContainer = document.querySelector('#view-logging .home-scroll-content');
    if (!scrollArea || !scrollContainer) return;
    
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
