// App main logic
let loggedDates = new Set();
try {
    const saved = localStorage.getItem('periodTrackerLoggedDates');
    if (saved) {
        loggedDates = new Set(JSON.parse(saved));
    }
} catch(e) {}

window.addEventListener('periodTrackerDataLoaded', () => {
    try {
        const saved = localStorage.getItem('periodTrackerLoggedDates');
        if (saved) {
            loggedDates = new Set(JSON.parse(saved));
        }
    } catch(e) {}
    
    updateWeekdaysHeaders();
    renderCalendar();
    renderLogCalendar();
    initYearView();
    document.querySelector('.history-filters .pill.active')?.click();
});
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
            // Remove active class from all items and views
            navItems.forEach(nav => nav.classList.remove('active'));
            views.forEach(view => view.classList.remove('active'));

            // Add active class to clicked item and target view
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
        // Save to local state
        localStorage.setItem('periodTrackerLoggedDates', JSON.stringify(Array.from(loggedDates)));
        
        document.getElementById('view-logging').classList.remove('active');
        
        // Re-render main calendar to reflect changes
        renderCalendar();
        
        // Sync to Google Drive
        if (typeof DataStore !== 'undefined') {
            await DataStore.saveData();
        }
    });

    document.getElementById('back-to-history').addEventListener('click', () => {
        document.getElementById('view-cycle-details').classList.remove('active');
    });

    // Close bottom sheets when clicking outside
    document.addEventListener('click', (e) => {
        const cycleDetails = document.getElementById('view-cycle-details');
        const loggingView = document.getElementById('view-logging');

        // Check Cycle Details
        if (cycleDetails.classList.contains('active')) {
            if (!cycleDetails.contains(e.target) && !e.target.closest('.history-card')) {
                cycleDetails.classList.remove('active');
            }
        }

        // Check Logging View
        if (loggingView.classList.contains('active')) {
            if (!loggingView.contains(e.target) && !e.target.closest('.nav-fab-container')) {
                loggingView.classList.remove('active');
            }
        }
    });

    initCalendar();
}

let logCurrentDate = new Date();

function generateMonthGrid(year, month, isLogMode) {
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    const monthBlock = document.createElement('div');
    monthBlock.className = 'calendar-month-block';
    
    const title = document.createElement('div');
    title.className = 'calendar-month-title';
    title.textContent = `${monthNames[month]} ${year}`;
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
        dayCell.textContent = day;
        
        const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        const ring = document.createElement('div');
        ring.className = 'cal-day-ring';
        dayCell.appendChild(ring);

        const isToday = isCurrentMonth && day === today.getDate();
        if (isToday) {
            dayCell.classList.add('today');
        }

        if (isLogMode) {
            if (loggedDates.has(dateString)) {
                dayCell.classList.add('logged-period');
            }
            dayCell.addEventListener('click', () => {
                const isAdding = !loggedDates.has(dateString);
                
                // Toggle a 5-day block forwards (day + 4)
                for (let i = 0; i < 5; i++) {
                    const d = new Date(year, month, day + i);
                    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    
                    if (isAdding) {
                        loggedDates.add(ds);
                    } else {
                        loggedDates.delete(ds);
                    }
                }
                
                // Re-render just the log calendar to reflect changes
                renderLogCalendar();
            });
        } else {
            // Mock period days for display calendar
            if (loggedDates.has(dateString)) {
                dayCell.classList.add('period', 'period-solid');
            } else if (isCurrentMonth && (day === 6 || day === 7 || day === 8)) {
                dayCell.classList.add('period', 'period-solid');
            } else if (isCurrentMonth && (day === 9 || day === 10)) {
                dayCell.classList.add('period');
            }
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
            
            card.addEventListener('click', () => {
                showCycleDetails(cycle);
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
    
    if (cycle.title.includes('Current') || cycle.year === new Date().getFullYear()) {
        periodText.textContent = `Your period lasted ${pCount} days`;
    } else {
        periodText.textContent = `Your period lasted ${pCount} days`;
    }
    
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

                // Simple mock coloring for visual pop
                if (d >= 5 && d <= 9 && m % 2 === 0) {
                    dayCell.classList.add('period');
                }
                if (d >= 21 && d <= 25 && m % 2 !== 0) {
                    dayCell.classList.add('period');
                }

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
    if (!scrollArea) return;
    
    // Save scroll position
    const scrollTop = scrollArea.scrollTop;
    
    scrollArea.innerHTML = '';
    const today = new Date();
    let currentMonthBlock = null;

    for (let i = -12; i <= 2; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const block = generateMonthGrid(d.getFullYear(), d.getMonth(), true);
        scrollArea.appendChild(block);
        if (i === 0) currentMonthBlock = block;
    }
    
    if (scrollToCurrent && currentMonthBlock && scrollArea) {
        setTimeout(() => {
            scrollArea.scrollTop = currentMonthBlock.offsetTop;
        }, 10);
    } else {
        scrollArea.scrollTop = scrollTop;
    }
}
