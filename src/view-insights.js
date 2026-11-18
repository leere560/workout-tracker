// Progress, workout history, lift comparison, progression charts, and weekly muscle volume.
(globalThis.WorkoutAppMixins ||= []).push({
  generateSVGProgressionChart(exHistory, exerciseName) {
    if (!exHistory || exHistory.length === 0) {
      return `
        <div class="chart-empty-state">
          <span>Complete sets for this lift to view your progress chart.</span>
        </div>
      `;
    }

    const hasAnyWeighted = exHistory.some(session => (session.sets || []).some(s => s && s.weight > 0));
    const isBodyweight = !hasAnyWeighted;

    const points = [];
    exHistory.forEach((session, sIdx) => {
      let metricVal = 0;
      let topWeight = 0;
      let topReps = 0;
      (session.sets || []).forEach(s => {
        if (!s) return;
        if (!isBodyweight && s.weight > 0) {
          const reps = s.reps || 1;
          const e1rm = reps <= 1 ? Math.round(s.weight) : Math.round(s.weight * (1 + reps / 30));
          if (e1rm > metricVal) {
            metricVal = e1rm;
            topWeight = s.weight;
            topReps = reps;
          }
        } else if (isBodyweight && s.reps > 0) {
          if (s.reps > metricVal) {
            metricVal = s.reps;
            topWeight = 0;
            topReps = s.reps;
          }
        }
      });
      if (metricVal > 0) {
        const d = new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        points.push({
          idx: sIdx,
          date: d,
          fullDate: new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          dayTitle: session.dayTitle || 'Workout',
          e1rm: metricVal,
          weight: topWeight,
          reps: topReps,
          isBodyweight
        });
      }
    });

    if (points.length === 0) {
      return `
        <div class="chart-empty-state">
          <span>Complete sets for this lift to view your progress chart.</span>
        </div>
      `;
    }

    const firstPoint = points[0];
    const latestPoint = points[points.length - 1];
    const diff = latestPoint.e1rm - firstPoint.e1rm;
    const diffSign = diff > 0 ? `+${diff}` : `${diff}`;
    const diffPct = firstPoint.e1rm > 0 ? Math.round((diff / firstPoint.e1rm) * 100) : 0;
    const allTimeBest = Math.max(...points.map(p => p.e1rm));
    const chartTitle = isBodyweight ? 'Rep Progression Trend (Bodyweight)' : 'Estimated 1-Rep Max Trend';
    const unitLabel = isBodyweight ? 'reps' : 'lb';
    const trendClass = diff > 0 ? 'trend-up' : diff < 0 ? 'trend-down' : 'trend-flat';

    const svgW = 340;
    const svgH = 150;
    const padLeft = 38;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 30;
    const plotW = svgW - padLeft - padRight;
    const plotH = svgH - padTop - padBottom;

    let minVal = Math.min(...points.map(p => p.e1rm));
    let maxVal = Math.max(...points.map(p => p.e1rm));
    if (minVal === maxVal) {
      minVal = Math.max(0, minVal - 10);
      maxVal = maxVal + 10;
    } else {
      const pad = Math.max(5, (maxVal - minVal) * 0.15);
      minVal = Math.max(0, Math.floor((minVal - pad) / 5) * 5);
      maxVal = Math.ceil((maxVal + pad) / 5) * 5;
    }

    const midVal = Math.round((minVal + maxVal) / 2);
    const getX = i => padLeft + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const getY = val => padTop + (1 - (val - minVal) / (maxVal - minVal)) * plotH;

    const coords = points.map((p, i) => ({ x: getX(i), y: getY(p.e1rm), ...p }));
    const polylinePts = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const areaPath = `M ${coords[0].x.toFixed(1)},${(padTop + plotH).toFixed(1)} ` +
      coords.map(c => `L ${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ') +
      ` L ${coords[coords.length - 1].x.toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;

    const midY = getY(midVal);
    const maxY = getY(maxVal);
    const minY = getY(minVal);
    const labelStep = coords.length > 6 ? Math.ceil((coords.length - 1) / 4) : 1;
    const showLabelAt = i => coords.length <= 6 || i === 0 || i === coords.length - 1 ||
      (i % labelStep === 0 && (coords.length - 1 - i) >= Math.ceil(labelStep / 2));
    const chartSummary = `${chartTitle} for ${exerciseName || 'selected lift'}: ${points.length} sessions, peak ${allTimeBest} ${unitLabel}, overall change ${diffSign} ${unitLabel}.`;

    return `
      <div class="svg-chart-wrapper">
        <div class="chart-headline-banner">
          <div>
            <div class="chart-headline-title">${chartTitle}</div>
            <div class="chart-headline-sub">${points.length} session${points.length > 1 ? 's' : ''} logged · Peak: <strong class="chart-peak-val">${allTimeBest} ${unitLabel}</strong></div>
          </div>
          <div class="chart-trend-col">
            ${points.length > 1 ? `
              <span class="trend-badge ${trendClass}">
                ${diffSign} ${unitLabel} (${diffPct > 0 ? '+' : ''}${diffPct}%)
              </span>
            ` : '<span class="trend-badge trend-flat">Baseline session</span>'}
          </div>
        </div>

        <svg class="svg-chart-stage" viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${this.escapeHtml(chartSummary)}">
          <defs>
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.35" />
              <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.0" />
            </linearGradient>
          </defs>

          <line x1="${padLeft}" y1="${maxY.toFixed(1)}" x2="${svgW - padRight}" y2="${maxY.toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3,3" />
          <line x1="${padLeft}" y1="${midY.toFixed(1)}" x2="${svgW - padRight}" y2="${midY.toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3,3" />
          <line x1="${padLeft}" y1="${minY.toFixed(1)}" x2="${svgW - padRight}" y2="${minY.toFixed(1)}" stroke="rgba(255,255,255,0.12)" />

          <text x="${padLeft - 6}" y="${(maxY + 4).toFixed(1)}" text-anchor="end" fill="#94a3b8" font-size="9" font-weight="600">${maxVal}</text>
          <text x="${padLeft - 6}" y="${(midY + 3).toFixed(1)}" text-anchor="end" fill="#94a3b8" font-size="9">${midVal}</text>
          <text x="${padLeft - 6}" y="${(minY + 3).toFixed(1)}" text-anchor="end" fill="#94a3b8" font-size="9">${minVal}</text>

          <path d="${areaPath}" fill="url(#chartGradient)" />
          <polyline points="${polylinePts}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

          ${coords.map((c, i) => {
            const desc = this.escapeHtml(`${c.fullDate}, ${c.dayTitle}: ${c.isBodyweight ? 'Bodyweight' : `${c.weight} lb`} × ${c.reps}; estimated maximum ${c.e1rm} ${unitLabel}`);
            return `
            <g class="chart-point-group" tabindex="0" role="button" aria-label="${desc}" data-description="${desc}">
              <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="14" fill="transparent" />
              <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5" fill="#1e293b" stroke="#38bdf8" stroke-width="2.2" class="chart-data-dot" />
            </g>
            ${showLabelAt(i) ? `<text x="${c.x.toFixed(1)}" y="${(padTop + plotH + 18).toFixed(1)}" text-anchor="${i === 0 && coords.length > 2 ? 'start' : i === coords.length - 1 && coords.length > 2 ? 'end' : 'middle'}" fill="#94a3b8" font-size="8.5">${this.escapeHtml(c.date)}</text>` : ''}
          `;
          }).join('')}
        </svg>

        <div class="chart-tooltip-box" id="chartTooltipBox" aria-live="polite">
          Tap or select any point on the chart to inspect that session.
        </div>
      </div>
    `;
  },

  generateWeeklyVolumeLandmarksHTML() {
    const volume = this.calculateWeeklyVolume();
    const format = value => Math.round(value * 10) / 10;
    const rows = Object.keys(volume.planned).map(muscle => `<tr><th scope="row">${muscle}</th><td>${format(volume.planned[muscle].direct)} <small>+ ${format(volume.planned[muscle].indirect)} indirect</small></td><td>${format(volume.completed[muscle].direct)} <small>+ ${format(volume.completed[muscle].indirect)} indirect</small></td></tr>`).join('');
    return `<section class="volume-landmarks-box"><h3>Weekly training volume</h3><p class="volume-explanation">Planned sets for your current week${this.deloadActive ? ' (deload)' : ''} and completed sets over the last 7 days, including workouts in progress. Indirect contributions are estimates; useful volume varies with effort and recovery.</p><table class="volume-comparison"><caption class="sr-only">Weekly planned and completed sets by muscle group</caption><thead><tr><th scope="col">Muscle</th><th scope="col">Planned</th><th scope="col">Completed</th></tr></thead><tbody>${rows}</tbody></table>${volume.unmapped.length ? `<p class="volume-unmapped">Unmapped exercises (excluded): ${volume.unmapped.map(n => this.escapeHtml(n)).join(', ')}</p>` : ''}</section>`;
  },

  renderHistoryCard(workout) {
    const title = this.escapeHtml(workout.dayTitle || 'Workout');
    const date = new Date(workout.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const id = this.escapeHtml(workout.id);
    const duration = workout.durationLabel || (Number.isFinite(workout.durationMins) ? `${workout.durationMins} min` : 'Duration unavailable');
    const skipped = this.getWorkingSetCounts(workout.sessionSnapshot || null).skipped;
    return `<article class="history-item insight-history">
      <div class="insight-history-heading"><h3>${title}</h3><time datetime="${this.escapeHtml(workout.date)}">${date}</time></div>
      <p class="insight-meta">${workout.totalCompletedSets || 0} sets${skipped ? ` · ${skipped} skipped` : ''} · ${this.escapeHtml(duration)}${workout.deload ? ' · Deload' : ''}</p>
      <details class="insight-details"><summary>Exercise sets</summary>
        ${Object.entries(workout.exercises || {}).map(([name, entry]) => `<div class="insight-set-list"><h4>${this.escapeHtml(name)}</h4><ul>${(entry.sets || []).filter(Boolean).map(set => `<li>Set ${set.setNum}: ${set.weight === 0 ? 'Bodyweight' : `${set.weight} lb`} × ${set.reps}${typeof set.rir === 'number' ? ` · ${set.rir === 3 ? '3+' : set.rir} RIR` : ''}</li>`).join('')}</ul></div>`).join('')}
        ${skipped ? `<div class="insight-set-list"><h4>Skipped for this workout</h4><ul>${Object.entries(workout.sessionSnapshot.logs).flatMap(([exId, sets]) => sets.flatMap((set, index) => set.skipped && !set.completed ? `<li>${this.escapeHtml(set.exerciseName || this.findExerciseById(exId)?.name || 'Exercise')} · Set ${index + 1}</li>` : [])).join('')}</ul></div>` : ''}
        <p class="insight-meta">Recorded volume: ${(workout.totalVolume || 0).toLocaleString()} lb</p>
      </details>
      <div class="insight-actions">${workout.sessionSnapshot ? `<button type="button" class="secondary-btn history-reopen-btn" data-wid="${id}" aria-label="Reopen ${title}, ${date}">Reopen workout</button>` : ''}<button type="button" class="history-delete-btn" data-wid="${id}" aria-label="Delete ${title}, ${date}">Delete</button></div>
    </article>`;
  },

  getLiftComparisonHTML(exHistory) {
    if (!exHistory.length) return '<p class="insight-empty">No saved sets for this lift yet. Finish a workout to start comparing sessions.</p>';
    const best = session => session.sets.filter(s => s && s.completed !== false).slice().sort((a, b) => (b.weight || 0) - (a.weight || 0) || (b.reps || 0) - (a.reps || 0))[0];
    const latest = exHistory[exHistory.length - 1];
    const previous = exHistory.length > 1 ? exHistory[exHistory.length - 2] : null;
    const formatDate = date => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const format = set => set ? `${set.weight === 0 ? 'Bodyweight' : `${set.weight} lb`} × ${set.reps}` : 'No completed sets';
    const lastBest = best(latest);
    const priorBest = previous ? best(previous) : null;
    const signed = value => value > 0 ? `+${value}` : String(value);
    const delta = priorBest && lastBest ? `${signed(Math.round(((lastBest.weight || 0) - (priorBest.weight || 0)) * 100) / 100)} lb and ${signed((lastBest.reps || 0) - (priorBest.reps || 0))} reps at the heaviest set` : '';
    return `<div class="lift-comparison"><div><span class="insight-meta">Latest · ${formatDate(latest.date)}${latest.deload ? ' · Deload' : ''}</span><strong>${format(lastBest)}</strong><span class="insight-meta">${latest.sets.filter(Boolean).length} sets recorded</span></div><div><span class="insight-meta">${previous ? `Previous · ${formatDate(previous.date)}${previous.deload ? ' · Deload' : ''}` : 'Previous session'}</span><strong>${previous ? format(priorBest) : 'First session'}</strong><span class="insight-meta">${previous ? `${previous.sets.filter(Boolean).length} sets recorded` : 'Your starting point'}</span></div></div>${delta ? `<p class="lift-comparison-note">${delta}. Compare reps and load together.</p>` : ''}`;
  },

  renderAnalytics() {
    const openState = {
      liftTrend: Boolean(this.analyticsContentEl.querySelector?.('#liftTrendDetails')?.open),
      earlier: Boolean(this.analyticsContentEl.querySelector?.('#earlierWorkoutsDetails')?.open),
      volume: Boolean(this.analyticsContentEl.querySelector?.('#weeklyVolumeDetails')?.open),
      totals: Boolean(this.analyticsContentEl.querySelector?.('#volumeTotalsDetails')?.open)
    };
    const sortedHistory = [...this.history].sort((a, b) => new Date(b.date) - new Date(a.date));
    const names = [...new Set([...this.getAllUniqueExercises().map(ex => ex.name), ...sortedHistory.flatMap(h => Object.keys(h.exercises || {}))])];
    if (!this.selectedProgressExercise || !names.includes(this.selectedProgressExercise)) this.selectedProgressExercise = Object.keys(sortedHistory[0]?.exercises || {})[0] || names[0] || null;
    const exHistory = this.selectedProgressExercise ? this.getExerciseHistoryOverTime(this.selectedProgressExercise) : [];
    const pr = this.selectedProgressExercise ? this.getPersonalRecord(this.selectedProgressExercise) : { maxWeight: 0, max1RM: 0 };
    const recent = sortedHistory.slice(0, 7).reverse();
    const maxVolume = Math.max(1, ...recent.map(w => w.totalVolume || 0));
    const limit = this.earlierWorkoutsLimit || 15;
    const earlierSlice = sortedHistory.slice(1, 1 + limit);
    const hasMoreEarlier = sortedHistory.length - 1 > limit;
    const reminder = typeof this.getBackupReminderInfo === 'function' ? this.getBackupReminderInfo() : { shouldRemind: false };
    const reminderBanner = reminder.shouldRemind ? `<aside class="backup-reminder-banner insight-panel" aria-label="Backup reminder"><p><strong>Backup reminder:</strong> ${reminder.daysSinceBackup === null ? `${reminder.workoutsSinceBackup} workouts saved without a backup export.` : `${reminder.workoutsSinceBackup} new workouts since your export ${reminder.daysSinceBackup} days ago.`}</p><button type="button" class="secondary-btn analytics-backup-btn">Download backup</button></aside>` : '';

    this.analyticsContentEl.innerHTML = `<div class="insights-page">
      ${reminderBanner}
      <section aria-labelledby="recentWorkoutsHeading"><div class="insight-section-heading"><h2 id="recentWorkoutsHeading">Recent workouts</h2><span class="insight-meta">${this.history.length} saved</span></div>
        ${sortedHistory.length ? this.renderHistoryCard(sortedHistory[0]) : '<p class="insight-empty">No saved workouts yet. Your completed workouts will appear here.</p>'}
      </section>
      <section class="insight-panel" aria-labelledby="liftProgressHeading"><h2 id="liftProgressHeading">Lift progress</h2>
        <label class="insight-field-label" for="progressExerciseSelect">Compare a lift</label><select class="exercise-select" id="progressExerciseSelect">${names.map(name => `<option value="${this.escapeHtml(name)}" ${name === this.selectedProgressExercise ? 'selected' : ''}>${this.escapeHtml(name)}</option>`).join('')}</select>
        ${this.getLiftComparisonHTML(exHistory)}
        <details id="liftTrendDetails" class="insight-details" ${openState.liftTrend ? 'open' : ''}><summary>Lift trend & recorded sets</summary><p class="insight-meta">Best recorded weight: ${pr.maxWeight || 0} lb · Estimated 1-rep max: ${pr.max1RM || 0} lb</p>${this.generateSVGProgressionChart(exHistory, this.selectedProgressExercise)}
          <div class="progress-session-list">${[...exHistory].reverse().map(session => `<article class="insight-set-list"><h3>${new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${this.escapeHtml(session.dayTitle || 'Saved session')}${session.deload ? ' · Deload' : ''}</h3><ul>${session.sets.filter(Boolean).map(set => `<li>Set ${set.setNum}: ${set.weight === 0 ? 'Bodyweight' : `${set.weight} lb`} × ${set.reps}${typeof set.rir === 'number' ? ` · ${set.rir === 3 ? '3+' : set.rir} RIR` : ''}</li>`).join('')}</ul></article>`).join('')}</div>
        </details>
      </section>
      ${sortedHistory.length > 1 ? `<details id="earlierWorkoutsDetails" class="insight-panel insight-details" ${openState.earlier ? 'open' : ''}><summary>Earlier workouts (${sortedHistory.length - 1})</summary>${earlierSlice.map(workout => this.renderHistoryCard(workout)).join('')}${hasMoreEarlier ? `<button type="button" class="secondary-btn show-more-workouts-btn">Show more workouts (${sortedHistory.length - 1 - limit} remaining)</button>` : ''}</details>` : ''}
      <details id="weeklyVolumeDetails" class="insight-panel insight-details" ${openState.volume ? 'open' : ''}><summary>Weekly muscle volume</summary>${this.generateWeeklyVolumeLandmarksHTML()}</details>
      <details id="volumeTotalsDetails" class="insight-panel insight-details" ${openState.totals ? 'open' : ''}><summary>Workout totals & volume trend</summary><p>${this.history.length} saved workouts · ${this.history.reduce((sum, h) => sum + (h.totalVolume || 0), 0).toLocaleString()} lb recorded total volume</p>
        <p class="insight-meta">Volume varies with exercise selection and set count. Compare the same lift for a clearer view of progress.</p>
        ${recent.length ? `<div class="volume-chart-container"><h3>Last ${recent.length} workouts</h3><div class="chart-bars">${recent.map(workout => `<div class="chart-bar-wrap"><div class="chart-bar" style="height:${Math.max(2, Math.round((workout.totalVolume || 0) / maxVolume * 100))}%"><span class="chart-bar-val">${Math.round(workout.totalVolume || 0).toLocaleString()}</span></div><span class="chart-bar-label">${new Date(workout.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</span></div>`).join('')}</div></div>` : '<p class="insight-empty">Finish a workout to see volume history.</p>'}
      </details>
    </div>`;

    document.getElementById('progressExerciseSelect')?.addEventListener('change', event => {
      this.selectedProgressExercise = event.target.value;
      this.renderAnalytics();
      document.getElementById('progressExerciseSelect')?.focus({ preventScroll: true });
    });
    this.analyticsContentEl.querySelector?.('.analytics-backup-btn')?.addEventListener('click', () => this.exportData());
    this.analyticsContentEl.querySelector?.('.show-more-workouts-btn')?.addEventListener('click', () => {
      this.earlierWorkoutsLimit = (this.earlierWorkoutsLimit || 15) + 15;
      this.renderAnalytics();
    });
    this.analyticsContentEl.querySelectorAll('.history-delete-btn').forEach(button => button.addEventListener('click', () => this.deleteWorkoutFromHistory(button.dataset.wid)));
    this.analyticsContentEl.querySelectorAll('.history-reopen-btn').forEach(button => button.addEventListener('click', () => this.reopenWorkout(button.dataset.wid)));
    this.analyticsContentEl.querySelectorAll('.chart-point-group').forEach(point => {
      const description = point.dataset.description || '';
      const showTip = () => {
        const tip = document.getElementById('chartTooltipBox');
        if (tip) tip.textContent = description;
      };
      point.addEventListener('click', showTip);
      point.addEventListener('mouseenter', showTip);
      point.addEventListener('focus', showTip);
      point.addEventListener('keydown', e => {
        if (e.key === 'Enter') showTip();
        if (e.key === ' ') e.preventDefault();
      });
      point.addEventListener('keyup', e => {
        if (e.key === ' ') showTip();
      });
    });
  },

  deleteWorkoutFromHistory(workoutId, { skipConfirm = false } = {}) {
    const target = this.history.find(h => h.id === workoutId);
    if (!target) return false;
    if (!skipConfirm && typeof this.showConfirmDialog === 'function') {
      const dateStr = new Date(target.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      this.showConfirmDialog({
        title: 'Delete workout?',
        message: `Remove "${target.dayTitle || 'Workout'}" from ${dateStr}? This updates your exercise baselines and cannot be undone.`,
        confirmLabel: 'Delete workout',
        cancelLabel: 'Keep workout',
        danger: true,
        onConfirm: () => this.deleteWorkoutFromHistory(workoutId, { skipConfirm: true })
      });
      return false;
    }

    const previousHistory = this.history;
    const previousWeights = this.lastWeights;
    const nextHistory = this.history.filter(h => h.id !== workoutId);
    const nextWeights = this.buildLastWeightsFromHistory(nextHistory);
    try {
      this.writeStorageTransaction(new Map([
        [this.storageKeys.history, JSON.stringify(nextHistory)],
        [this.storageKeys.lastWeights, JSON.stringify(nextWeights)]
      ]));
    } catch (_) {
      this.history = previousHistory;
      this.lastWeights = previousWeights;
      this.showToast('Could not delete this workout. Storage is unchanged.');
      return false;
    }
    this.history = nextHistory;
    this.lastWeights = nextWeights;
    if (this.session?.initialLogs && !this.hasSessionProgress(this.session) && Number.isInteger(this.activeDayIndex) && this.routine?.[this.activeDayIndex]) {
      try {
        this.session = this.initNewSession(this.activeDayIndex);
        this.saveCurrentSession();
      } catch (_) {}
    }
    this.showToast('Workout deleted from history.');
    if (this.activeView === 'analytics') this.renderAnalytics();
    return true;
  }
});
