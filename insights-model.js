// Period Tracker — cycle statistics, forecasting, anomaly detection & insights.
//
// This module is a pure *interpretation* layer on top of PeriodModel's ground
// truth: every function takes the `cycles` array exactly as
// PeriodModel.computeCycles() returns it (plus, where relevant, a `todayDate`
// supplied by the caller) and returns a plain object. Nothing here is stored
// — no localStorage key, no module-level state, no calls to PeriodModel or
// `new Date()` — so it stays fully decoupled and deterministic. It slots into
// the exact "compute cycles once, pass the array to whatever needs it"
// pattern app.js's refreshHomeView() already established, and follows
// PeriodModel.classifyDate(dateStr, cycles = computeCycles())'s precedent for
// accepting a precomputed cycles array rather than reaching for its own copy.
//
// Ovulation is always estimated the same way PeriodModel.computeCycles()
// already estimates it (ovulationOffset = cycleLength - 14) — this module
// never introduces a second, independent ovulation formula that could
// disagree with the one every other view already shows.
const CycleInsights = (() => {
  const THRESHOLDS = Object.freeze({
    MIN_CYCLE_LENGTH: 15,
    MAX_CYCLE_LENGTH: 45,
    GAP_THRESHOLD_DAYS: 60,
    MIN_PERIOD_DAYS: 2,
    MAX_PERIOD_DAYS: 8,
    MIN_KNOWN_LENGTHS_FOR_ZSCORE: 3,
    MIN_KNOWN_LENGTHS_FOR_TREND: 4,
    CONFIDENCE_BASE: 0.85,
    CONFIDENCE_MIN: 0.60,
    CONFIDENCE_MAX: 0.95,
    DEFAULT_PERIOD_DAYS: 5,
    DEFAULT_RANGE_DAYS: 7,
  });

  function clamp(x, min, max) { return Math.max(min, Math.min(max, x)); }
  function clamp01(x) { return clamp(x, 0, 1); }
  function round(x) { return Math.round(x); }

  function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

  // Sample standard deviation (n-1 denominator) — needs at least 2 points.
  function stdDev(arr) {
    if (arr.length < 2) return null;
    const m = mean(arr);
    const variance = arr.reduce((sum, x) => sum + (x - m) * (x - m), 0) / (arr.length - 1);
    return Math.sqrt(variance);
  }

  // ── Shared derived arrays ──────────────────────────────────────────
  // The latest cycle is always excluded from *length* statistics — its
  // cycleLength is itself an estimate (see PeriodModel.estimateCycleLength),
  // not a fact, so treating it as a data point would be circular.
  function knownLengthsOf(cycles) {
    return cycles.slice(0, -1).map(c => c.cycleLength);
  }

  // periodDayCount is always real logged input, even for the latest/open
  // cycle — PeriodModel never estimates it — so period-day stats use every
  // cycle, not just the known/completed ones.
  function periodDaysOf(cycles) {
    return cycles.map(c => c.periodDayCount);
  }

  // ── 1. Statistics ───────────────────────────────────────────────────
  function getStatistics(cycles) {
    const knownLengths = knownLengthsOf(cycles);
    const allPeriodDays = periodDaysOf(cycles);
    const knownCycleCount = knownLengths.length;
    const cycleCount = cycles.length;

    const allTimeMean = knownCycleCount ? mean(knownLengths) : null;
    const allTimeStdDev = stdDev(knownLengths);
    const allTime = {
      meanLength: allTimeMean === null ? null : round(allTimeMean),
      stdDevLength: allTimeStdDev === null ? null : round(allTimeStdDev * 100) / 100,
      minLength: knownCycleCount ? Math.min(...knownLengths) : null,
      maxLength: knownCycleCount ? Math.max(...knownLengths) : null,
    };

    const recentWindow = knownLengths.slice(-6);
    const recentMean = recentWindow.length ? mean(recentWindow) : null;
    const recentStdDev = stdDev(recentWindow);
    const recent = {
      windowSize: recentWindow.length,
      meanLength: recentMean === null ? null : round(recentMean),
      stdDevLength: recentStdDev === null ? null : round(recentStdDev * 100) / 100,
    };

    const periodMean = allPeriodDays.length ? mean(allPeriodDays) : null;
    const periodStdDev = stdDev(allPeriodDays);
    const periodDays = {
      meanDays: periodMean === null ? null : round(periodMean * 10) / 10,
      stdDevDays: periodStdDev === null ? null : round(periodStdDev * 100) / 100,
      minDays: allPeriodDays.length ? Math.min(...allPeriodDays) : null,
      maxDays: allPeriodDays.length ? Math.max(...allPeriodDays) : null,
    };

    let trend = 'insufficient_data';
    let trendSlopeDaysPerCycle = null;
    if (knownCycleCount >= THRESHOLDS.MIN_KNOWN_LENGTHS_FOR_TREND) {
      const k = recentWindow.length;
      const xs = Array.from({ length: k }, (_, i) => i);
      const sumX = xs.reduce((a, b) => a + b, 0);
      const sumY = recentWindow.reduce((a, b) => a + b, 0);
      const sumXY = xs.reduce((sum, x, i) => sum + x * recentWindow[i], 0);
      const sumXX = xs.reduce((sum, x) => sum + x * x, 0);
      const denom = k * sumXX - sumX * sumX;
      const slope = denom === 0 ? 0 : (k * sumXY - sumX * sumY) / denom;
      trendSlopeDaysPerCycle = round(slope * 100) / 100;
      trend = slope > 1 ? 'lengthening' : slope < -1 ? 'shortening' : 'stable';
    }

    const coefficientOfVariation = (allTimeStdDev !== null && allTimeMean)
      ? round((allTimeStdDev / allTimeMean) * 1000) / 1000
      : null;

    const countScore = clamp01(knownCycleCount / 6);
    const consistencyScore = knownCycleCount < 2
      ? 0.5
      : clamp01(1 - (allTimeStdDev / allTimeMean) / 0.35);
    const dataQuality = cycleCount === 0 ? 0 : round(clamp01(0.6 * countScore + 0.4 * consistencyScore) * 100) / 100;

    return {
      cycleCount, knownCycleCount,
      allTime, recent, periodDays,
      trend, trendSlopeDaysPerCycle,
      coefficientOfVariation,
      dataQuality,
    };
  }

  // ── 2. Anomaly detection ────────────────────────────────────────────
  function detectAnomalies(cycles) {
    const known = cycles.slice(0, -1); // exclude the predicted/open cycle
    const knownLengths = known.map(c => c.cycleLength);
    const knownCycleCount = knownLengths.length;
    const allTimeMean = knownCycleCount ? mean(knownLengths) : null;
    const allTimeStdDev = stdDev(knownLengths);

    const cycleAnomalies = [];
    known.forEach(c => {
      const reasons = [];
      let classification = null;

      if (knownCycleCount >= THRESHOLDS.MIN_KNOWN_LENGTHS_FOR_ZSCORE && allTimeStdDev) {
        const z = (c.cycleLength - allTimeMean) / allTimeStdDev;
        if (Math.abs(z) > 3) { reasons.push('z_score_high'); classification = 'outlier'; }
        else if (Math.abs(z) > 2) { reasons.push('z_score_high'); classification = 'flagged'; }
      }

      const zScore = (knownCycleCount >= THRESHOLDS.MIN_KNOWN_LENGTHS_FOR_ZSCORE && allTimeStdDev)
        ? round(((c.cycleLength - allTimeMean) / allTimeStdDev) * 100) / 100
        : null;

      if (c.cycleLength < THRESHOLDS.MIN_CYCLE_LENGTH) {
        reasons.push('range_too_short');
        classification = 'outlier';
      } else if (c.cycleLength > THRESHOLDS.GAP_THRESHOLD_DAYS) {
        reasons.push('range_too_long_possible_gap');
        classification = 'outlier';
      } else if (c.cycleLength > THRESHOLDS.MAX_CYCLE_LENGTH) {
        reasons.push('range_long');
        if (classification !== 'outlier') classification = 'flagged';
      }

      if (classification) {
        cycleAnomalies.push({
          startDate: c.startDate,
          cycleLength: c.cycleLength,
          zScore,
          classification,
          reasons,
        });
      }
    });

    const periodLengthAnomalies = [];
    cycles.forEach(c => {
      if (c.periodDayCount < THRESHOLDS.MIN_PERIOD_DAYS) {
        periodLengthAnomalies.push({ startDate: c.startDate, periodDayCount: c.periodDayCount, reason: 'too_short' });
      } else if (c.periodDayCount > THRESHOLDS.MAX_PERIOD_DAYS) {
        periodLengthAnomalies.push({ startDate: c.startDate, periodDayCount: c.periodDayCount, reason: 'too_long' });
      }
    });

    return {
      cycleAnomalies,
      periodLengthAnomalies,
      hasAnomalies: cycleAnomalies.length > 0 || periodLengthAnomalies.length > 0,
    };
  }

  // ── Shared phase-boundary math (cycleLength-scaled, single ovulation
  // anchor) — used by both getCurrentPhase() and getForecast() so there is
  // exactly one implementation of "what phase is day N of an L-day cycle."
  function phaseBoundaries(L, P) {
    const ovulationOffset = L - 14;
    if (ovulationOffset < 1) {
      // Degenerate/very short cycle — defensive fallback, not expected in
      // real data (a cycle this short would already be flagged as an
      // outlier by detectAnomalies()).
      return {
        menstruation: { start: 1, end: P },
        follicular: null,
        ovulation: null,
        luteal: { start: P + 1, end: L },
        ovulationDayNumber: null,
      };
    }
    const ovulationDay = ovulationOffset + 1;
    const ovulationStart = ovulationDay - 1;
    const ovulationEnd = ovulationDay + 1;
    const follicularEnd = ovulationStart - 1;
    return {
      menstruation: { start: 1, end: P },
      follicular: (P + 1 <= follicularEnd) ? { start: P + 1, end: follicularEnd } : null,
      ovulation: { start: ovulationStart, end: ovulationEnd },
      luteal: { start: ovulationEnd + 1, end: L },
      ovulationDayNumber: ovulationDay,
    };
  }

  function phaseForDay(day, L, P) {
    const b = phaseBoundaries(L, P);
    if (day <= b.menstruation.end) return { phase: 'menstruation', ...b.menstruation, boundaries: b };
    if (b.follicular && day <= b.follicular.end) return { phase: 'follicular', ...b.follicular, boundaries: b };
    // b.ovulation is null on a degenerate/very-short cycle (see
    // phaseBoundaries) — fall straight through to luteal in that case rather
    // than dereferencing a null range.
    if (b.ovulation && day <= b.ovulation.end) return { phase: 'ovulation', ...b.ovulation, boundaries: b };
    // Anything at/after luteal start, INCLUDING overdue days beyond L — see
    // getCurrentPhase()'s isLate handling, which clamps the visible end date.
    return { phase: 'luteal', ...b.luteal, boundaries: b };
  }

  function ovulationAndFertileWindow(startD, cycleLength, periodDayCount) {
    const ovulationOffset = cycleLength - 14;
    if (ovulationOffset < 1) return { ovulationDate: null, fertileWindow: null };
    const ovulationDate = DateUtils.toISODate(DateUtils.addDays(startD, ovulationOffset));
    const fertileStartOffset = Math.max(periodDayCount, ovulationOffset - 4);
    return {
      ovulationDate,
      fertileWindow: {
        start: DateUtils.toISODate(DateUtils.addDays(startD, fertileStartOffset)),
        end: DateUtils.toISODate(DateUtils.addDays(startD, ovulationOffset + 1)),
      },
    };
  }

  // ── 3. Current phase ────────────────────────────────────────────────
  function getCurrentPhase(cycles, todayDate) {
    if (!cycles.length) return null;
    const latest = cycles[cycles.length - 1];
    const knownCycleCount = cycles.length - 1;
    const todayIso = DateUtils.toISODate(todayDate);
    const L = latest.cycleLength;
    const P = latest.periodDayCount;

    let dayOfCycle = DateUtils.daysBetween(latest.startDate, todayIso) + 1;
    if (dayOfCycle < 1) dayOfCycle = 1; // defensive — shouldn't happen with real data

    const isLate = dayOfCycle > L;
    const daysLate = isLate ? dayOfCycle - L : 0;
    const effectiveDay = isLate ? L : dayOfCycle; // clamp so phase math never looks past the end of the assumed cycle
    const p = phaseForDay(effectiveDay, L, P);

    const startD = DateUtils.parseISODate(latest.startDate);
    const phaseStartDate = DateUtils.toISODate(DateUtils.addDays(startD, p.start - 1));
    const phaseEndDate = isLate
      ? DateUtils.toISODate(DateUtils.addDays(startD, L - 1))
      : DateUtils.toISODate(DateUtils.addDays(startD, p.end - 1));
    const phaseLengthDays = p.end - p.start + 1;
    const phaseDayNumber = effectiveDay - p.start + 1;
    const phaseProgressPercent = isLate ? 100 : clamp(round((phaseDayNumber / phaseLengthDays) * 100), 0, 100);
    const cycleProgressPercent = clamp(round((dayOfCycle / L) * 100), 0, 100);

    const confidence = knownCycleCount === 0
      ? 0.5
      : clamp(0.5 + 0.08 * Math.min(knownCycleCount, 5), 0.5, 0.9);

    return {
      todayDate: todayIso,
      cycleStartDate: latest.startDate,
      dayOfCycle,
      cycleLength: L,
      phase: p.phase,
      phaseStartDate,
      phaseEndDate,
      phaseDayNumber,
      phaseLengthDays,
      phaseProgressPercent,
      cycleProgressPercent,
      isLate,
      daysLate,
      confidence: round(confidence * 100) / 100,
    };
  }

  // ── 4. Forecast ─────────────────────────────────────────────────────
  function getForecast(cycles, todayDate, count = 3) {
    if (!cycles.length) return null;
    const latest = cycles[cycles.length - 1];
    const stats = getStatistics(cycles);
    const knownCycleCount = stats.knownCycleCount;
    const stdDevRecent = stats.recent.stdDevLength;
    const slope = stats.trend === 'insufficient_data' ? 0 : (stats.trendSlopeDaysPerCycle || 0);
    const predictedPeriodDayCount = stats.periodDays.meanDays
      ? Math.max(1, round(stats.periodDays.meanDays))
      : THRESHOLDS.DEFAULT_PERIOD_DAYS;

    const forecasts = [];
    let cursorStart = DateUtils.parseISODate(latest.startDate);

    for (let i = 0; i < count; i++) {
      // Cycle 1 (i === 0) is the *already-unified* estimate PeriodModel put
      // on the latest/open cycle — not recomputed here — so the status
      // card's "period likely in N days" and this forecast's first entry
      // are guaranteed to describe the exact same date.
      const predictedLength = i === 0
        ? latest.cycleLength
        : clamp(round(latest.cycleLength + slope * i), THRESHOLDS.MIN_CYCLE_LENGTH, THRESHOLDS.MAX_CYCLE_LENGTH);

      cursorStart = i === 0
        ? DateUtils.addDays(DateUtils.parseISODate(latest.startDate), latest.cycleLength)
        : DateUtils.addDays(cursorStart, forecasts[i - 1].predictedLength);

      const predictedStartDate = DateUtils.toISODate(cursorStart);
      const predictedEndDate = DateUtils.toISODate(DateUtils.addDays(cursorStart, predictedLength - 1));
      const predictedPeriodStartDate = predictedStartDate;
      const predictedPeriodEndDate = DateUtils.toISODate(DateUtils.addDays(cursorStart, predictedPeriodDayCount - 1));

      const { ovulationDate, fertileWindow } = ovulationAndFertileWindow(cursorStart, predictedLength, predictedPeriodDayCount);
      const b = phaseBoundaries(predictedLength, predictedPeriodDayCount);
      const rangeOf = (r) => r ? {
        start: DateUtils.toISODate(DateUtils.addDays(cursorStart, r.start - 1)),
        end: DateUtils.toISODate(DateUtils.addDays(cursorStart, r.end - 1)),
      } : null;

      let confidence = THRESHOLDS.CONFIDENCE_BASE;
      if (stdDevRecent != null) {
        if (stdDevRecent < 2) confidence += 0.08;
        else if (stdDevRecent < 3) confidence += 0.05;
        if (stdDevRecent > 4) confidence -= 0.10;
      }
      confidence -= (knownCycleCount < 3 ? 0.20 : knownCycleCount < 6 ? 0.08 : 0);
      confidence -= 0.03 * i;
      confidence = clamp(confidence, THRESHOLDS.CONFIDENCE_MIN, THRESHOLDS.CONFIDENCE_MAX);
      const confidenceLabel = confidence >= 0.85 ? 'high' : confidence >= 0.70 ? 'medium' : 'low';

      const rangeDays = stdDevRecent != null ? round(stdDevRecent) : THRESHOLDS.DEFAULT_RANGE_DAYS;

      forecasts.push({
        cycleNumber: i + 1,
        predictedStartDate,
        predictedEndDate,
        predictedLength,
        // Bounded by the estimate itself (floor of 1 day), not by the global
        // [15,45] "plausible cycle" band — predictedLength can legitimately
        // sit outside that band on an already-anomalous cycle (see
        // detectAnomalies()), and the range must always bracket its own
        // point estimate rather than being clamped independently of it.
        predictedLengthRange: {
          min: Math.max(1, predictedLength - rangeDays),
          max: predictedLength + rangeDays,
        },
        predictedPeriodStartDate,
        predictedPeriodEndDate,
        predictedPeriodDayCount,
        ovulationDate,
        fertileWindow,
        phases: {
          menstruation: rangeOf(b.menstruation),
          follicular: rangeOf(b.follicular),
          ovulation: rangeOf(b.ovulation),
          luteal: rangeOf(b.luteal),
        },
        confidence: round(confidence * 100) / 100,
        confidenceLabel,
      });
    }

    return forecasts;
  }

  // ── 5. Insights ─────────────────────────────────────────────────────
  function getInsights(cycles, todayDate, precomputed) {
    const stats = (precomputed && precomputed.stats) || getStatistics(cycles);
    const forecast = precomputed && 'forecast' in precomputed ? precomputed.forecast : getForecast(cycles, todayDate);

    const insights = [];
    let idCounter = 0;
    const nextId = (prefix) => `${prefix}-${idCounter++}`;

    if (cycles.length <= 1) {
      insights.push({
        id: nextId('info'),
        type: 'info',
        severity: 'info',
        message: cycles.length === 0
          ? 'Log your first period to start getting personalized predictions.'
          : 'Log one more period to unlock cycle forecasting.',
        relatedDate: null,
      });
    }

    if (stats.knownCycleCount >= 6 && stats.recent.stdDevLength != null && stats.recent.stdDevLength < 2) {
      insights.push({
        id: nextId('positive'),
        type: 'positive',
        severity: 'positive',
        message: `Your cycles are very regular (σ = ${stats.recent.stdDevLength} days) — predictions are highly accurate.`,
        relatedDate: null,
      });
    }

    if (stats.trend === 'lengthening' || stats.trend === 'shortening') {
      insights.push({
        id: nextId('trend'),
        type: 'trend',
        severity: 'info',
        message: `Your cycles have been ${stats.trend === 'lengthening' ? 'getting longer' : 'getting shorter'} recently (about ${Math.abs(stats.trendSlopeDaysPerCycle)} day${Math.abs(stats.trendSlopeDaysPerCycle) === 1 ? '' : 's'} per cycle).`,
        relatedDate: null,
      });
    }

    // Anomalies themselves are NOT turned into insight entries here — they're
    // already a first-class part of analyze()'s return value
    // (`analysis.anomalies`), and the UI renders them directly (with
    // formatted dates and a "you can fix this in your log" hint) alongside
    // this insights list. Duplicating them into `insights` too would show
    // every anomaly twice.

    if (forecast && forecast[0] && forecast[0].confidenceLabel === 'low') {
      insights.push({
        id: nextId('data_quality'),
        type: 'data_quality',
        severity: 'warning',
        message: 'Predictions are based on limited cycle history, so they may be less accurate — keep tracking to improve them.',
        relatedDate: null,
      });
    }

    return insights;
  }

  // ── 6. Orchestrator ─────────────────────────────────────────────────
  function analyze(cycles, todayDate, options = {}) {
    const forecastCount = options.forecastCount || 3;
    const stats = getStatistics(cycles);
    const anomalies = detectAnomalies(cycles);
    const phase = getCurrentPhase(cycles, todayDate);
    const forecast = getForecast(cycles, todayDate, forecastCount);
    const insights = getInsights(cycles, todayDate, { stats, anomalies, forecast });

    return {
      asOfDate: DateUtils.toISODate(todayDate),
      stats,
      anomalies,
      phase,
      forecast,
      insights,
    };
  }

  // ── 7. Backtest (optional, dev-console only — never called from UI) ──
  // Manually run from devtools: CycleInsights.backtest(PeriodModel.getPeriods())
  function backtest(periods, maxFolds = 5) {
    const sorted = periods.slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
    const foldCount = Math.max(0, Math.min(maxFolds, sorted.length - 3));
    const folds = [];

    for (let i = 0; i < foldCount; i++) {
      const holdoutIndex = sorted.length - foldCount + i;
      const priorPeriods = sorted.slice(0, holdoutIndex);
      const actual = sorted[holdoutIndex];
      if (priorPeriods.length < 3) continue;

      const priorCycles = PeriodModel.computeCycles(priorPeriods);
      const forecast = getForecast(priorCycles, DateUtils.parseISODate(priorPeriods[priorPeriods.length - 1].startDate), 1);
      if (!forecast) continue;

      const predicted = forecast[0];
      const absErrorDays = Math.abs(DateUtils.daysBetween(predicted.predictedStartDate, actual.startDate));
      folds.push({
        actualStartDate: actual.startDate,
        predictedStartDate: predicted.predictedStartDate,
        absErrorDays,
        confidenceAtPredictionTime: predicted.confidence,
      });
    }

    return {
      foldCount: folds.length,
      meanAbsoluteErrorDays: folds.length ? round(mean(folds.map(f => f.absErrorDays)) * 100) / 100 : null,
      folds,
    };
  }

  return {
    THRESHOLDS,
    getStatistics,
    detectAnomalies,
    getCurrentPhase,
    getForecast,
    getInsights,
    analyze,
    backtest,
  };
})();
