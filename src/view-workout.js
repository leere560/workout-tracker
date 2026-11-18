// Workout view rendering, set interaction, swaps, warm-ups, quick history, and finish/reopen flows.
(globalThis.WorkoutAppMixins ||= []).push({
  renderDaySelector() {
    if (!this.daySelectorEl) return;
    const todayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
    const hasOneTimeToday = this.routine.some(d => d.oneTime && d.title.startsWith(todayName));
    this.daySelectorEl.innerHTML = `<label class="day-picker-label" for="workoutDayPicker">Workout day</label>
      <select id="workoutDayPicker" class="day-picker">${this.routine.map((day, idx) =>
        `<option value="${idx}" ${idx === this.activeDayIndex ? 'selected' : ''}>${this.escapeHtml(day.title)}${day.title.startsWith(todayName) && (!hasOneTimeToday || day.oneTime) ? ' · Today' : ''}</option>`).join('')}</select>`;
    document.getElementById('workoutDayPicker')?.addEventListener('change', e => {
      this.saveCurrentSession();
      this.activeDayIndex = Number(e.target.value);
      this.selectionLocalDate = this.getLocalDateKey(new Date());
      this.focusedExerciseId = null;
      this.pendingRir = null;
      this.editingCompletedSet = null;
      this.editingCompletedWarmup = null;
      this.session = this.loadSession();
      this.renderDaySelector();
      this.renderWorkout();
    });
  },

  renderWorkout() {
    const day = this.routine[this.activeDayIndex];
    if (!day) return;
    const orderedExercises = this.getOrderedExercises();
    const core = orderedExercises.filter(ex => !ex.isOptional);
    const total = core.reduce((sum, ex) => sum + (this.session.logs[ex.id] || []).length, 0);
    const complete = core.reduce((sum, ex) => sum + (this.session.logs[ex.id] || []).filter(set => set.completed).length, 0);
    const skipped = core.reduce((sum, ex) => sum + (this.session.logs[ex.id] || []).filter(set => !set.completed && set.skipped).length, 0);
    const estimate = this.getWorkoutTimeEstimate(core);
    const normalSets = core.reduce((sum, ex) => sum + ex.sets, 0);
    const reducedSets = core.reduce((sum, ex) => sum + Math.max(2, Math.floor(ex.sets * .67)), 0);
    const next = this.getNextSet();
    if (!this.pendingRir) {
      const groups = this.getExerciseGroups();
      const nextGroupIndex = groups.findIndex(group => group.some(ex => ex.id === next?.ex.id));
      const eligible = nextGroupIndex < 0 ? orderedExercises : groups.slice(0, nextGroupIndex + 1).flat();
      for (const ex of eligible) {
        const sets = this.session.logs[ex.id] || [];
        if (sets.some(set => this.isSetPending(set))) continue;
        const setIdx = sets.findLastIndex(set => set.completed && !set.rirAnswered && set.rir == null);
        if (setIdx >= 0) { this.pendingRir = { exId: ex.id, setIdx }; break; }
      }
    }
    const pending = this.pendingRir && orderedExercises.find(ex => ex.id === this.pendingRir.exId);
    const focus = orderedExercises.find(ex => ex.id === this.focusedExerciseId) || pending || (next && next.ex) || core[0];
    const visible = focus ? orderedExercises.filter(ex => ex.id === focus.id ||
      (this.isSupersetEnabled(focus) && this.isSupersetEnabled(ex) && ex.superset.id === focus.superset.id)) : [];
    const overviewOpen = this.sessionInfoEl?.querySelector?.('.workout-overview')?.open || false;
    const resume = this.getSessionResumeInfo();
    const elapsedText = this.session?.startTime ? this.formatElapsedDuration(this.session.startTime) : '';
    if (this.sessionInfoEl) {
      this.sessionInfoEl.innerHTML = `<details class="workout-overview" ${overviewOpen ? 'open' : ''}>
        <summary><span class="session-summary-line"><span class="session-completion"><strong>${complete} / ${total}</strong> sets <span id="sessionElapsed" class="session-elapsed" ${elapsedText ? '' : 'hidden'}>${this.escapeHtml(elapsedText)}</span></span><span class="session-overview-label">Overview</span></span><span class="workout-progress-track" role="progressbar" aria-label="Workout sets" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${complete}"><span class="workout-progress-fill" style="width:${total ? complete / total * 100 : 0}%"></span></span></summary>
        <div class="session-detail-summary">${day.exercises.length} exercises · ~${estimate.plannedMinutes} min planned${complete > 0 && estimate.remainingMinutes > 0 ? ` · ~${estimate.remainingMinutes} min left` : ''}</div>
        ${skipped ? `<p class="session-skip-summary">${complete} completed · ${skipped} skipped · ${total - complete - skipped} remaining</p>` : ''}
        ${resume.inProgress ? `<div class="session-resume-info">In progress${resume.date ? ` · Started ${this.escapeHtml(new Date(resume.date).toLocaleString())}` : ''}<button type="button" class="secondary-btn start-new-session-btn">Start new workout</button></div>` : ''}
        ${resume.savedDraftId ? '<button type="button" class="secondary-btn restore-draft-btn">Restore previous draft</button>' : ''}
        ${this.session.deload ? `<div class="deload-banner">Deload: ${reducedSets} of ${normalSets} planned sets (${Math.round((normalSets - reducedSets) / normalSets * 100)}% fewer), loads eased 10%.</div>` : ''}
        <div class="overview-list">${orderedExercises.map(ex => {
          const sets = this.session.logs[ex.id] || [];
          const pendingEffort = sets.filter(set => set.completed && !set.rirAnswered && set.rir == null).length;
          const skippedCount = sets.filter(set => !set.completed && set.skipped).length;
          return `<button type="button" class="overview-exercise ${visible.includes(ex) ? 'selected' : ''}" data-exid="${ex.id}"><span>${this.escapeHtml(this.getEffectiveExerciseName(ex.id, ex))}${ex.isOptional ? ' · Optional' : ''}${pendingEffort ? `<small>${pendingEffort} effort ${pendingEffort === 1 ? 'entry' : 'entries'} pending</small>` : ''}${skippedCount ? `<small>${skippedCount} skipped · Select to restore</small>` : ''}</span><span>${sets.filter(set => set.completed).length}/${sets.length}</span></button>`;
        }).join('')}</div>
      </details>`;
    }
    const pendingSet = pending && this.session.logs[pending.id]?.[this.pendingRir.setIdx];
    const effortPrompt = pending && !visible.includes(pending) && pendingSet?.completed && !pendingSet.rirAnswered ? `<aside class="pending-effort" aria-label="Last exercise effort">
      <p><strong>Last set: ${this.escapeHtml(pendingSet.exerciseName || pending.name)}</strong></p>${this.renderEffortPrompt(pending.id, this.pendingRir.setIdx, pendingSet)}
    </aside>` : '';
    const workoutCounts = this.getWorkingSetCounts();
    const coreRemaining = core.some(ex => (this.session.logs[ex.id] || []).some(set => this.isSetPending(set)) ||
      (this.session.warmups?.[ex.id] || []).some(set => this.isSetPending(set)));
    const oneTimeBanner = day.oneTime ? `<aside class="onetime-banner" aria-label="One-time workout"><span>One-time workout</span><button type="button" class="secondary-btn dismiss-onetime-btn" data-dayid="${this.escapeHtml(day.id)}">Dismiss</button></aside>` : '';
    const ready = !next ? `<aside class="workout-ready">${workoutCounts.completed ? `<strong>${workoutCounts.skipped ? 'No sets remaining' : 'All sets complete'}</strong><button type="button" class="primary-btn review-finish-btn">Review & finish</button>` : '<span>No working sets logged. Restore a skipped set to continue, or use Overview to start a new workout.</span>'}</aside>` :
      (!coreRemaining && workoutCounts.completed > 0) ? '<aside class="workout-ready"><strong>Core sets complete · Optional finishers below</strong><button type="button" class="primary-btn review-finish-btn">Review & finish</button></aside>' : '';
    this.exerciseListEl.innerHTML = `${oneTimeBanner}${ready}${effortPrompt}${this.focusedExerciseId && next && this.focusedExerciseId !== next.ex.id ? '<button type="button" class="secondary-btn return-next-btn">Return to next set</button>' : ''}
    ${visible.map(ex => this.renderExerciseCard(ex, ex.isOptional)).join('')}`;
    this.bindWorkoutCardEvents();
    this.startElapsedClock?.();
  },

  renderEffortPrompt(exId, setIdx, set) {
    return `<div class="rir-selector-row" data-exid="${exId}" data-setidx="${setIdx}" tabindex="-1" aria-label="Set ${setIdx + 1} effort">
      <span class="rir-prompt">Reps left in reserve</span>${[3, 2, 1, 0].map(rir => `<button type="button" class="rir-chip ${set.rir === rir ? 'active' : ''}" data-exid="${exId}" data-setidx="${setIdx}" data-rir="${rir}" aria-label="${rir === 3 ? '3 or more' : rir} reps left in reserve" aria-pressed="${set.rir === rir}">${rir === 3 ? '3+' : rir}</button>`).join('')}<button type="button" class="rir-chip" data-exid="${exId}" data-setidx="${setIdx}" data-rir="skip">Skip effort</button>
    </div>`;
  },

  renderExerciseCard(ex, isBonus) {
    const name = this.getEffectiveExerciseName(ex.id, ex);
    const swapped = this.session.swaps && this.session.swaps[ex.id];
    const sets = this.session.logs[ex.id] || [];
    const previous = this.getPreviousExercisePerformance(name);
    const targetReps = (swapped && swapped.targetReps) || ex.targetReps;
    const notes = (swapped && swapped.notes) || ex.notes;
    const video = (swapped && swapped.videoUrl) || ex.videoUrl;
    const rest = this.formatRest(this.getRestSeconds(ex));
    const increment = this.getExerciseIncrement(ex, name);
    const pref = (this.exercisePreferences || {})[name] || {};
    const convention = pref.loadConvention || (/smith/i.test(name) ? 'plates-only' : /dumbbell|\bdb\b/i.test(name) ? (/overhead.*extension|goblet/i.test(name) ? 'total' : 'per-hand') : 'total');
    const conventionLabel = { 'per-hand': 'per hand', 'total': 'total load', 'plates-only': 'plates only; exclude Smith bar', 'including-bar': 'including Smith bar' }[convention] || 'total load';
    const next = this.getNextSet();
    const allDone = sets.length > 0 && sets.every(set => set.completed);
    const remaining = [...sets, ...this.getWarmupSets(ex.id)].some(set => this.isSetPending(set));
    const hasSkipped = [...sets, ...this.getWarmupSets(ex.id)].some(set => !set.completed && set.skipped);
    const enabled = this.isSupersetEnabled(ex);
    const prescribedCount = this.getPrescribedSetCount(ex, name);
    const progression = this.getPreviousProgressionFlag(name, targetReps, this.deloadActive ? Math.max(2, Math.floor(prescribedCount * .67)) : prescribedCount, ex);
    const ordered = this.getOrderedExercises();
    const position = ordered.findIndex(item => item.id === ex.id) + 1;
    const exerciseCount = this.routine[this.activeDayIndex].exercises.length;
    const groups = this.getExerciseGroups();
    const groupIndex = groups.findIndex(group => group.some(item => item.id === ex.id));
    const isGroupLead = groupIndex >= 0 && groups[groupIndex][0].id === ex.id;
    const canDefer = this.canDeferExercise(ex.id);
    const deferHelp = this.isExerciseGroupUnfinished(groups[groupIndex] || [])
      ? 'No other unfinished exercise to switch to.' : hasSkipped ? 'No sets remaining for this exercise.' : 'This exercise is complete.';
    const seat = this.getEquipmentSetting(name);
    const legacySeat = this.getLegacyMachineSetting(ex.id);
    const note = this.exerciseNotes[name] || '';
    const firstPending = sets.find(set => this.isSetPending(set));
    const isBumped = progression.unlocked && firstPending && Number(firstPending.weight) > progression.topWeight;
    const canRemovePending = sets.length > 1 && !sets[sets.length - 1]?.completed;
    return `<article class="exercise-card focused-card ${allDone ? 'completed' : ''}" id="card_${ex.id}" data-exid="${ex.id}">
      <div class="card-header">
        ${isGroupLead && groups.length > 1 ? `<div class="card-nav-row"><button type="button" class="secondary-btn card-nav-btn" data-navdir="-1" data-groupidx="${groupIndex}" ${groupIndex <= 0 ? 'disabled' : ''}>← Prev</button><span class="focus-card-eyebrow">Exercise ${position} of ${exerciseCount} · ${this.escapeHtml(ex.muscle)}${isBonus ? ' · Optional' : ''}${enabled ? ` · Superset ${this.escapeHtml(ex.superset.tag)}` : ''}</span><button type="button" class="secondary-btn card-nav-btn" data-navdir="1" data-groupidx="${groupIndex}" ${groupIndex >= groups.length - 1 ? 'disabled' : ''}>Next →</button></div>` : `<div class="focus-card-eyebrow">Exercise ${position} of ${exerciseCount} · ${this.escapeHtml(ex.muscle)}${isBonus ? ' · Optional' : ''}${enabled ? ` · Superset ${this.escapeHtml(ex.superset.tag)}` : ''}</div>`}
        <h3 class="exercise-name">${this.escapeHtml(name)}</h3>
        ${swapped && name !== ex.name ? `<div class="muted-text">Alternative for ${this.escapeHtml(ex.name)}</div>` : ''}
        <div class="focus-prescription">${sets.length} sets × ${this.escapeHtml(targetReps)} reps · Rest ${rest}</div>
        <div class="load-convention">Weight in lbs · ${conventionLabel}</div>
        <div class="exercise-heading-tools">${this.renderWarmupButton(ex)}<button type="button" class="swap-btn secondary-btn" aria-label="Swap equipment" data-exid="${ex.id}" data-exname="${this.escapeHtml(ex.name)}">Swap</button><button type="button" class="machine-taken-btn secondary-btn" data-exid="${ex.id}" ${canDefer ? '' : `disabled aria-describedby="machineTakenHelp_${ex.id}"`}>Machine taken</button></div>
        ${canDefer ? '' : `<small id="machineTakenHelp_${ex.id}" class="machine-availability-help muted-text">${deferHelp}</small>`}
        <div class="saved-setup-cue" ${!seat && !note ? 'hidden' : ''}><span class="saved-seat-cue">${seat ? `Seat / pin: ${this.escapeHtml(seat)}` : ''}</span><span class="saved-note-cue">${this.escapeHtml(note)}</span></div>
        ${progression.unlocked ? `<div class="progression-callout"><span><strong>+${progression.increment} lb progression</strong> — all ${progression.setsCount} sets hit ${progression.maxReps} reps last session.</span>${firstPending ? `<button type="button" class="bump-weight-btn ${isBumped ? 'revert' : ''}" data-exid="${ex.id}" data-bump="${isBumped ? -progression.increment : progression.increment}">${isBumped ? 'Revert' : 'Apply'} ${progression.increment} lb</button>` : ''}</div>` : ''}
        <div class="exercise-skip-actions"><button type="button" class="start-rest-btn" data-exid="${ex.id}">Start ${rest} rest</button>${remaining ? `<button type="button" class="skip-exercise-btn" data-exid="${ex.id}" aria-label="Skip remaining sets for ${this.escapeHtml(name)} today">Skip remaining exercise</button>` : ''}${hasSkipped ? `<button type="button" class="restore-skipped-exercise-btn" data-exid="${ex.id}" aria-label="Restore skipped sets for ${this.escapeHtml(name)}">Restore skipped sets</button>` : ''}</div>
      </div>
      ${this.renderWarmupSets(ex)}
      <div class="set-blocks">
      ${sets.map((set, idx) => {
        if (set.skipped && !set.completed) return this.renderSkippedSet(ex.id, set, idx);
        const prev = this.getPreviousSetAt(previous?.sets, idx);
        const target = this.getSetTarget(ex, idx, name);
        const needsBaseline = set.needsBaseline || set.weight === null;
        const editing = this.editingCompletedSet?.exId === ex.id && this.editingCompletedSet?.setIdx === idx;
        if (set.completed && !editing) {
          const effortText = set.rir != null ? `${set.rir === 3 ? '3+' : set.rir} RIR` : set.rirAnswered ? 'Effort skipped' : '';
          return `<section class="set-row completed completed-set-row" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Completed set ${idx + 1}">
            <div class="completed-set-summary"><span><strong>✓ Set ${idx + 1}</strong> · ${set.weight === 0 ? 'BW' : set.weight + ' lb'} × ${set.reps}${effortText ? `<small>${effortText}</small>` : ''}${set.exerciseName && set.exerciseName !== name ? `<small>${this.escapeHtml(set.exerciseName)}</small>` : ''}</span><button type="button" class="edit-set-btn" data-exid="${ex.id}" data-setidx="${idx}">Edit<span class="sr-only"> set ${idx + 1}</span></button></div>
            ${!set.rirAnswered && set.rir == null ? this.renderEffortPrompt(ex.id, idx, set) : ''}
          </section>`;
        }
        return `<section class="set-row set-block ${set.completed ? 'completed' : ''} ${next && next.type !== 'warmup' && next.ex.id === ex.id && next.setIdx === idx ? 'active-next-set' : ''}" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Set ${idx + 1}">
          <div class="set-heading" tabindex="-1"><strong>Set ${idx + 1}${next && next.type !== 'warmup' && next.ex.id === ex.id && next.setIdx === idx ? ' · Up next' : ''}</strong><span>Target ${this.escapeHtml(target.targetRepsDisplay)} reps${!needsBaseline && target.targetWeight > 0 ? ` · ${target.targetWeightDisplay} lb` : ''}</span></div>
          <div class="previous-set">Last: ${prev ? `${prev.weight === 0 ? 'BW' : prev.weight + ' lb'} × ${prev.reps}` : 'No previous set'}${set.completed && set.exerciseName && set.exerciseName !== name ? ` · Logged as ${this.escapeHtml(set.exerciseName)}` : ''}</div>
          ${needsBaseline ? '<p class="baseline-prompt">Enter a baseline weight for this equipment (0 for bodyweight).</p>' : ''}
          <div class="set-entry-grid">
            <label for="weight_${ex.id}_${idx}">Weight (lb)<span class="stepper-wrap weight-stepper"><button type="button" class="stepper-btn" data-type="weight" data-delta="-${increment}" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Decrease set ${idx + 1} weight by ${increment} pounds">−</button><input type="number" id="weight_${ex.id}_${idx}" class="set-input set-weight-input" value="${this.escapeHtml(set.weight === null ? '' : String(set.weight))}" data-exid="${ex.id}" data-setidx="${idx}" min="0" step="${increment}" inputmode="decimal" placeholder="Enter" aria-label="Set ${idx + 1} weight in pounds"><button type="button" class="stepper-btn" data-type="weight" data-delta="${increment}" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Increase set ${idx + 1} weight by ${increment} pounds">+</button></span></label>
            <label for="reps_${ex.id}_${idx}">Reps<span class="stepper-wrap reps-stepper"><button type="button" class="stepper-btn" data-type="reps" data-delta="-1" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Decrease set ${idx + 1} reps">−</button><input type="number" id="reps_${ex.id}_${idx}" class="set-input set-reps-input" value="${this.escapeHtml(String(set.reps ?? ''))}" data-exid="${ex.id}" data-setidx="${idx}" min="1" step="1" inputmode="numeric" aria-label="Set ${idx + 1} reps"><button type="button" class="stepper-btn" data-type="reps" data-delta="1" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Increase set ${idx + 1} reps">+</button></span></label>
          </div>
          <button type="button" class="set-check-btn" data-exid="${ex.id}" data-setidx="${idx}" data-rest="${rest}" ${needsBaseline && !set.completed ? 'disabled' : ''} aria-pressed="${set.completed}">${set.completed ? '✓ Completed · Undo' : 'Complete set'}</button>
          ${set.completed ? `${this.renderEffortPrompt(ex.id, idx, set)}<button type="button" class="done-editing-set-btn secondary-btn" data-exid="${ex.id}" data-setidx="${idx}">Done editing</button>` : `<button type="button" class="skip-set-btn" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Skip set ${idx + 1} for today">Skip this set</button>`}
        </section>`;
      }).join('')}</div>
      <details class="exercise-details"><summary>Setup, notes & exercise options</summary>
        <div class="exercise-detail-content">
          <p>${this.escapeHtml(notes || '')}</p>
          ${video ? `<a class="video-link-btn" href="${this.escapeHtml(video)}" target="_blank" rel="noopener noreferrer">Watch form guide ↗</a>` : ''}
          <div class="exercise-option-buttons"><button type="button" class="prev-weight-pill-btn" data-exname="${this.escapeHtml(name)}">Performance history</button></div>
          ${ex.superset ? `<label class="superset-mode" for="supersetToggle_${ex.id}"><input type="checkbox" id="supersetToggle_${ex.id}" class="superset-enabled-input" data-group="${ex.superset.id}" ${enabled ? 'checked' : ''}> Alternate this superset</label><p class="muted-text">When off, use straight sets with at least 2 minutes of rest.</p>` : ''}
          <label for="increment_${ex.id}">Weight increment<select id="increment_${ex.id}" class="exercise-increment-input" data-exname="${this.escapeHtml(name)}">${[1, 2.5, 5, 10].map(value => `<option value="${value}" ${increment === value ? 'selected' : ''}>${value} lb</option>`).join('')}</select></label>
          <label for="convention_${ex.id}">Weight convention<select id="convention_${ex.id}" class="exercise-convention-input" data-exname="${this.escapeHtml(name)}">${[['total', 'Total load'], ['per-hand', 'Dumbbell weight per hand'], ['plates-only', 'Smith plates only (exclude bar)'], ['including-bar', 'Smith total including bar']].map(([value, label]) => `<option value="${value}" ${convention === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
          <p class="muted-text">Changing the label keeps your recorded numbers unchanged.</p>
          <label for="seat_${ex.id}">Pin / seat for this equipment<input type="text" id="seat_${ex.id}" class="machine-settings-input" value="${this.escapeHtml(seat)}" data-exid="${ex.id}" data-exname="${this.escapeHtml(name)}" placeholder="Seat #4, pin #8"></label>
          ${legacySeat ? `<div class="legacy-machine-setting" ${this.hasEquipmentSetting(name) ? 'hidden' : ''}><p><strong>Previous setup:</strong> ${this.escapeHtml(legacySeat)}</p><p>This old setting was saved for the exercise slot. Check that it matches this equipment before using it.</p><button type="button" class="secondary-btn use-legacy-machine-setting-btn" data-exid="${ex.id}" data-exname="${this.escapeHtml(name)}">Use for this equipment</button></div>` : ''}
          <label for="note_${ex.id}">Note to self<input type="text" id="note_${ex.id}" class="exercise-note-input" value="${this.escapeHtml(this.exerciseNotes[name] || '')}" data-exname="${this.escapeHtml(name)}" data-exid="${ex.id}" placeholder="Setup or technique reminders"></label>
          <div class="card-footer"><button type="button" class="add-set-btn" data-exid="${ex.id}">+ Add set</button>${canRemovePending ? `<button type="button" class="remove-set-btn icon-btn" data-exid="${ex.id}">− Remove set</button>` : ''}</div>
        </div>
      </details>
    </article>`;
  },

  renderSkippedSet(exId, set, index, type = 'working') {
    const warmup = type === 'warmup';
    const label = warmup ? `Warm-up ${this.getWarmupNumber(set, index)}` : `Set ${index + 1}`;
    return `<section class="${warmup ? 'warmup-row' : 'set-row'} skipped-set-row" data-exid="${exId}" ${warmup ? 'data-warmupidx' : 'data-setidx'}="${index}" aria-label="${label}, skipped for today"><div class="completed-set-summary"><span><strong>${label} · Skipped for today</strong><small>${this.escapeHtml(set.exerciseName || '')}</small></span><button type="button" class="restore-skipped-set-btn" data-exid="${exId}" data-setidx="${index}" data-type="${type}" aria-label="Restore ${label.toLowerCase()}">Restore</button></div></section>`;
  },

  renderWarmupButton(ex) {
    const added = this.hasWarmupRamp(ex.id);
    const disabled = added || !this.getWarmupWorkingSet(ex.id);
    const title = added ? 'Warm-up sets are already on this card' : 'Enter a working load greater than 0 lb first';
    return `<button type="button" class="warmup-btn secondary-btn" aria-label="${added ? 'Warm-ups added' : 'Add warm-up sets'}" data-exid="${ex.id}" ${disabled ? `disabled title="${title}"` : ''}>${added ? 'Warm-ups ✓' : 'Warm-ups'}</button>`;
  },

  renderWarmupSets(ex) {
    const rows = this.getWarmupSets(ex.id);
    if (!rows.length) return '';
    const name = this.getEffectiveExerciseName(ex.id, ex);
    const next = this.getNextSet();
    const remaining = rows.filter(set => this.isSetPending(set)).length;
    return `<section class="warmup-sets" aria-label="Warm-up sets for ${this.escapeHtml(name)}"><div class="warmup-section-heading"><strong>Warm-up sets</strong><span>This workout only</span></div>${rows.map((set, idx) => {
      if (set.skipped && !set.completed) return this.renderSkippedSet(ex.id, set, idx, 'warmup');
      const label = `Warm-up ${this.getWarmupNumber(set, idx)}`;
      const editing = this.editingCompletedWarmup?.exId === ex.id && this.editingCompletedWarmup.setIdx === idx;
      const active = next?.type === 'warmup' && next.ex.id === ex.id && next.setIdx === idx;
      const equipment = set.exerciseName && set.exerciseName !== name ? `<small>${this.escapeHtml(set.exerciseName)}</small>` : '';
      if (set.completed && !editing) return `<section class="warmup-row completed-warmup-row" data-exid="${ex.id}" data-warmupidx="${idx}" aria-label="Completed ${label.toLowerCase()}"><div class="completed-set-summary"><span><strong>✓ ${label}</strong> · ${this.escapeHtml(String(set.weight))} lb × ${this.escapeHtml(String(set.reps))}${equipment}</span><span class="warmup-summary-actions"><button type="button" class="warmup-edit-btn" data-exid="${ex.id}" data-warmupidx="${idx}" aria-label="Edit ${label.toLowerCase()}">Edit</button><button type="button" class="warmup-complete-btn warmup-undo-btn" data-exid="${ex.id}" data-warmupidx="${idx}" aria-label="Undo ${label.toLowerCase()}" aria-pressed="true">Undo</button></span></div></section>`;
      const increment = Number(this.getExerciseIncrement(ex, set.exerciseName || name)) || 5;
      return `<section class="warmup-row set-block ${active ? 'active-next-set' : ''}" data-exid="${ex.id}" data-warmupidx="${idx}" aria-label="${label}"><div class="set-heading warmup-heading" tabindex="-1"><strong>${label}${active ? ' · Up next' : ''}</strong><span>${set.completed ? 'Completed' : remaining === 1 ? `Rest ${this.formatRest(this.getRestSeconds(ex))} before working sets` : 'Rest 90 sec'}</span></div>${equipment}<div class="set-entry-grid">${[['weight', 'Weight (lb)', increment, 'decimal'], ['reps', 'Reps', 1, 'numeric']].map(([field, fieldLabel, step, mode]) => `<label for="warmup_${field}_${ex.id}_${idx}">${fieldLabel}<span class="stepper-wrap"><button type="button" class="warmup-stepper-btn" data-exid="${ex.id}" data-warmupidx="${idx}" data-field="${field}" data-delta="-${step}" aria-label="Decrease ${label.toLowerCase()} ${field}">−</button><input type="number" id="warmup_${field}_${ex.id}_${idx}" class="warmup-input" data-exid="${ex.id}" data-warmupidx="${idx}" data-field="${field}" value="${this.escapeHtml(String(set[field] ?? ''))}" min="${field === 'weight' ? 0 : 1}" step="${step}" inputmode="${mode}" aria-label="${label} ${field === 'weight' ? 'weight in pounds' : 'reps'}"><button type="button" class="warmup-stepper-btn" data-exid="${ex.id}" data-warmupidx="${idx}" data-field="${field}" data-delta="${step}" aria-label="Increase ${label.toLowerCase()} ${field}">+</button></span></label>`).join('')}</div><button type="button" class="warmup-complete-btn primary-btn" data-exid="${ex.id}" data-warmupidx="${idx}" aria-pressed="${set.completed}">${set.completed ? 'Completed · Undo' : 'Complete warm-up'}</button>${set.completed ? `<button type="button" class="warmup-done-editing-btn secondary-btn" data-exid="${ex.id}" data-warmupidx="${idx}">Done editing</button>` : `<button type="button" class="warmup-remove-btn" data-exid="${ex.id}" data-warmupidx="${idx}" aria-label="Remove ${label.toLowerCase()}">Remove warm-up</button>`}</section>`;
    }).join('')}</section>`;
  },

  bindWorkoutCardEvents() {
    this.exerciseListEl.querySelectorAll?.('.skip-set-btn').forEach(button => button.addEventListener('click', () => this.setSetSkipped(button.dataset.exid, Number(button.dataset.setidx), true)));
    this.exerciseListEl.querySelectorAll?.('.restore-skipped-set-btn').forEach(button => button.addEventListener('click', () => this.setSetSkipped(button.dataset.exid, Number(button.dataset.setidx), false, button.dataset.type)));
    this.exerciseListEl.querySelectorAll?.('.skip-exercise-btn').forEach(button => button.addEventListener('click', () => this.setExerciseSkipped(button.dataset.exid, true)));
    this.exerciseListEl.querySelectorAll?.('.restore-skipped-exercise-btn').forEach(button => button.addEventListener('click', () => this.setExerciseSkipped(button.dataset.exid, false)));
    this.exerciseListEl.querySelectorAll?.('.machine-taken-btn').forEach(button => {
      button.addEventListener('click', () => this.deferExercise(button.dataset.exid));
    });
    this.exerciseListEl.querySelectorAll?.('.start-rest-btn').forEach(button => {
      button.addEventListener('click', () => {
        const ex = this.findExerciseById(button.dataset.exid);
        if (ex) {
          this._pendingTimerSource = { type: 'manual', exId: ex.id };
          this.startTimer(this.getRestSeconds(ex), 0);
        }
      });
    });
    this.exerciseListEl.querySelectorAll?.('.card-nav-btn').forEach(button => {
      button.addEventListener('click', () => {
        const groups = this.getExerciseGroups();
        const target = groups[Number(button.dataset.groupidx) + Number(button.dataset.navdir)];
        if (!target) return;
        this.focusedExerciseId = target[0].id;
        this.renderWorkout();
        const card = this.exerciseListEl.querySelector?.(`#card_${target[0].id}`);
        card?.scrollIntoView?.({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      });
    });
    this.exerciseListEl.querySelector?.('.dismiss-onetime-btn')?.addEventListener('click', buttonEvent => {
      const dayId = buttonEvent.currentTarget.dataset.dayid;
      this.dismissOneTimeWorkout(dayId);
    });
    this.exerciseListEl.querySelector?.('.review-finish-btn')?.addEventListener('click', () => this.showWorkoutSummary());
    this.sessionInfoEl?.querySelector?.('.start-new-session-btn')?.addEventListener('click', () => this.startNewSession());
    this.sessionInfoEl?.querySelector?.('.restore-draft-btn')?.addEventListener('click', () => this.restoreSavedDraft(this.getSessionResumeInfo().savedDraftId));
    this.sessionInfoEl?.querySelectorAll?.('.overview-exercise').forEach(button => {
      button.addEventListener('click', () => {
        this.focusedExerciseId = button.dataset.exid;
        this.renderWorkout();
        const overview = this.sessionInfoEl.querySelector('.workout-overview');
        if (overview) overview.open = false;
        const first = (this.session.logs[button.dataset.exid] || []).findIndex(set => this.isSetPending(set));
        const warmup = this.getNextWarmup(button.dataset.exid);
        this.revealWorkoutSet(button.dataset.exid, warmup ? warmup.setIdx : first >= 0 ? first : 0, true, false, warmup ? 'warmup' : 'working');
      });
    });
    this.exerciseListEl.querySelector?.('.return-next-btn')?.addEventListener('click', () => {
      this.jumpToActiveExercise();
    });
    this.exerciseListEl.querySelectorAll?.('.superset-enabled-input').forEach(input => {
      input.addEventListener('input', () => {
        if (Boolean(this.session.disabledSupersets?.[input.dataset.group]) === !input.checked) return;
        if (!this.saveSessionFlowChange(() => {
          this.session.disabledSupersets ||= {};
          this.session.disabledSupersets[input.dataset.group] = !input.checked;
        }, false)) return;
        this.renderWorkout();
      });
    });
    this.exerciseListEl.querySelectorAll?.('.exercise-increment-input, .exercise-convention-input').forEach(input => {
      input.addEventListener('input', () => {
        const name = input.dataset.exname;
        this.exercisePreferences = this.exercisePreferences || {};
        const preference = this.exercisePreferences[name] || {};
        if (input.classList.contains('exercise-increment-input')) preference.increment = Number(input.value);
        else preference.loadConvention = input.value;
        this.exercisePreferences[name] = preference;
        this.saveExercisePreferences();
        const details = input.closest('details');
        const exId = details.closest('.exercise-card').dataset.exid;
        this.renderWorkout();
        const replacement = this.exerciseListEl.querySelector(`#card_${exId} details`);
        if (replacement) replacement.open = true;
      });
    });
    this.exerciseListEl.querySelectorAll?.('.edit-set-btn').forEach(button => {
      button.addEventListener('click', () => {
        const exId = button.dataset.exid;
        const setIdx = Number(button.dataset.setidx);
        this.editingCompletedSet = { exId, setIdx };
        this.focusedExerciseId = exId;
        this.renderWorkout();
        this.revealWorkoutSet(exId, setIdx, true);
      });
    });
    this.exerciseListEl.querySelectorAll?.('.done-editing-set-btn').forEach(button => {
      button.addEventListener('click', () => {
        const exId = button.dataset.exid;
        const setIdx = Number(button.dataset.setidx);
        const error = this.getSetValidationError(this.session.logs[exId][setIdx]);
        if (error) { this.showToast(error); return; }
        this.editingCompletedSet = null;
        this.editingCompletedWarmup = null;
        this.renderWorkout();
        this.revealWorkoutSet(exId, setIdx, true);
      });
    });

    this.bindWarmupEvents();

    this.exerciseListEl.querySelectorAll?.('.swap-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.openSwapModal(btn.dataset.exid, btn.dataset.exname);
      });
    });

    this.exerciseListEl.querySelectorAll?.('.prev-weight-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.openQuickHistoryModal(btn.dataset.exname);
      });
    });

    this.exerciseListEl.querySelectorAll?.('.stepper-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const exId = btn.dataset.exid;
        const setIdx = parseInt(btn.dataset.setidx, 10);
        const type = btn.dataset.type;
        const delta = parseFloat(btn.dataset.delta);
        const list = this.session.logs[exId];
        if (!list || !list[setIdx]) return;

        if (type === 'weight') {
          const cur = parseFloat(list[setIdx].weight) || 0;
          const nextVal = Math.max(0, cur + delta);
          this.updateSetWeight(exId, setIdx, nextVal);
        } else if (type === 'reps') {
          const cur = parseInt(list[setIdx].reps, 10) || 1;
          const nextVal = Math.max(1, cur + delta);
          this.updateSetReps(exId, setIdx, nextVal);
        }
      });
    });

    this.exerciseListEl.querySelectorAll?.('.set-check-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const exId = btn.dataset.exid;
        const setIdx = parseInt(btn.dataset.setidx, 10);
        const rest = btn.dataset.rest;
        this.focusedExerciseId = null;
        this.editingCompletedSet = null;
        this.editingCompletedWarmup = null;
        this.toggleSetCompletion(exId, setIdx, rest);
        if (this.session.logs[exId]?.[setIdx]?.completed) this.jumpToActiveExercise({ automatic: true });
      });
    });

    this.exerciseListEl.querySelectorAll?.('.bump-weight-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const exId = btn.dataset.exid;
        const bump = parseFloat(btn.dataset.bump) || 5;
        this.bumpExerciseWeight(exId, bump);
      });
    });

    this.exerciseListEl.querySelectorAll?.('.set-weight-input').forEach(input => {
      input.addEventListener('input', () => {
        this.updateSetWeight(input.dataset.exid, parseInt(input.dataset.setidx, 10), input.value);
      });
    });

    this.exerciseListEl.querySelectorAll?.('.set-reps-input').forEach(input => {
      input.addEventListener('input', () => {
        this.updateSetReps(input.dataset.exid, parseInt(input.dataset.setidx, 10), input.value);
      });
    });

    this.bindEquipmentSetupEvents();

    this.exerciseListEl.querySelectorAll?.('.exercise-note-input').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.dataset.exname || input.dataset.exid;
        this.exerciseNotes[key] = input.value.trim();
        this.saveExerciseNotes();
        const cue = input.closest('.exercise-card').querySelector('.saved-note-cue');
        if (cue) { cue.textContent = input.value.trim(); cue.parentElement.hidden = !cue.parentElement.textContent.trim(); }
      });
    });

    this.exerciseListEl.querySelectorAll?.('.rir-chip').forEach(chip => {
      chip.addEventListener('click', e => {
        e.stopPropagation();
        const exId = chip.dataset.exid;
        const setIdx = parseInt(chip.dataset.setidx, 10);
        const rir = chip.dataset.rir === 'skip' ? null : parseInt(chip.dataset.rir, 10);
        this.setSetRIR(exId, setIdx, rir);
        if (!this.editingCompletedSet) this.jumpToActiveExercise({ automatic: true });
      });
    });

    this.exerciseListEl.querySelectorAll?.('.add-set-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.addSetToExercise(btn.dataset.exid);
      });
    });

    this.exerciseListEl.querySelectorAll?.('.remove-set-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.removeLastSetFromExercise(btn.dataset.exid);
      });
    });

    this.updateNowLiftingHUD();
  },

  bindWarmupEvents() {
    this.exerciseListEl.querySelectorAll?.('.warmup-btn').forEach(button => button.addEventListener('click', () => this.addWarmupSets(button.dataset.exid)));
    this.exerciseListEl.querySelectorAll?.('.warmup-input').forEach(input => input.addEventListener('input', () => this.updateWarmupSet(input.dataset.exid, Number(input.dataset.warmupidx), input.dataset.field, input.value)));
    this.exerciseListEl.querySelectorAll?.('.warmup-stepper-btn').forEach(button => button.addEventListener('click', () => {
      const { exid, warmupidx, field, delta } = button.dataset;
      const set = this.getWarmupSets(exid)[Number(warmupidx)];
      if (!set) return;
      this.updateWarmupSet(exid, Number(warmupidx), field, Math.max(field === 'weight' ? 0 : 1, (Number(set[field]) || 0) + Number(delta)));
    }));
    this.exerciseListEl.querySelectorAll?.('.warmup-complete-btn').forEach(button => button.addEventListener('click', () => this.toggleWarmupCompletion(button.dataset.exid, Number(button.dataset.warmupidx))));
    this.exerciseListEl.querySelectorAll?.('.warmup-remove-btn').forEach(button => button.addEventListener('click', () => this.removeWarmupSet(button.dataset.exid, Number(button.dataset.warmupidx))));
    this.exerciseListEl.querySelectorAll?.('.warmup-edit-btn').forEach(button => button.addEventListener('click', () => {
      this.editingCompletedWarmup = { exId: button.dataset.exid, setIdx: Number(button.dataset.warmupidx) };
      this.focusedExerciseId = button.dataset.exid;
      this.renderWorkout();
      this.revealWorkoutSet(button.dataset.exid, Number(button.dataset.warmupidx), true, false, 'warmup');
    }));
    this.exerciseListEl.querySelectorAll?.('.warmup-done-editing-btn').forEach(button => button.addEventListener('click', () => {
      const set = this.getWarmupSets(button.dataset.exid)[Number(button.dataset.warmupidx)];
      if (!set) return;
      const error = this.getSetValidationError(set);
      if (error) { this.showToast(error); return; }
      this.editingCompletedWarmup = null;
      this.renderWorkout();
      this.revealWorkoutSet(button.dataset.exid, Number(button.dataset.warmupidx), true, false, 'warmup');
    }));
  },

  refreshEquipmentSetupInputs(name) {
    this.exerciseListEl.querySelectorAll('.machine-settings-input').forEach(input => {
      if (input.dataset.exname !== name) return;
      input.value = this.getEquipmentSetting(name);
      const card = input.closest('.exercise-card');
      const cue = card.querySelector('.saved-seat-cue');
      if (cue) {
        cue.textContent = input.value ? 'Seat / pin: ' + input.value : '';
        cue.parentElement.hidden = !cue.parentElement.textContent.trim();
      }
      const legacy = card.querySelector('.legacy-machine-setting');
      if (legacy) legacy.hidden = this.hasEquipmentSetting(name);
    });
  },

  bindEquipmentSetupEvents() {
    this.exerciseListEl.querySelectorAll?.('.machine-settings-input').forEach(input => {
      input.addEventListener('input', () => {
        this.updateEquipmentSetting(input.dataset.exname, input.value);
        this.refreshEquipmentSetupInputs(input.dataset.exname);
      });
    });
    this.exerciseListEl.querySelectorAll?.('.use-legacy-machine-setting-btn').forEach(button => {
      button.addEventListener('click', () => {
        const name = button.dataset.exname;
        const value = this.getLegacyMachineSetting(button.dataset.exid);
        if (!value || !this.updateEquipmentSetting(name, value)) return;
        this.refreshEquipmentSetupInputs(name);
        button.closest('.exercise-card').querySelector('.machine-settings-input')?.focus();
        this.showToast('Previous setup saved for this equipment.');
      });
    });
  },

  updateNowLiftingHUD() {
    const dock = typeof document !== 'undefined' ? document.getElementById('nowLiftingDock') : null;
    if (!dock) return;
    const next = this.activeView === 'workout' && this.session ? this.getNextSet() : null;
    if (!next) {
      dock.hidden = true;
      this._activeSetObserver?.disconnect();
      return;
    }
    const set = (next.type === 'warmup' ? this.session.warmups : this.session.logs)[next.ex.id][next.setIdx];
    const name = this.getEffectiveExerciseName(next.ex.id, next.ex);
    const swap = this.session.swaps && this.session.swaps[next.ex.id];
    const targetReps = (swap && swap.targetReps) || next.ex.targetReps;
    const titleEl = document.getElementById('nowLiftingTitle');
    const metaEl = document.getElementById('nowLiftingMeta');
    const number = next.type === 'warmup' ? this.getWarmupNumber(set, next.setIdx) : next.setIdx + 1;
    if (titleEl) titleEl.textContent = name;
    if (metaEl) metaEl.textContent = `Next: ${next.type === 'warmup' ? 'warm-up' : 'set'} ${number} · ${next.type === 'warmup' ? set.reps : targetReps} reps · ${set.weight === null || set.weight === '' ? 'Enter load' : set.weight + ' lb'}`;
    dock.dataset.activeExid = next.ex.id;
    dock.hidden = false;
    this.observeActiveSetVisibility(dock, next);
  },

  observeActiveSetVisibility(dock, next) {
    this._activeSetObserver?.disconnect();
    if (!dock || !next || typeof IntersectionObserver !== 'function') return;
    const activeEl = this.exerciseListEl?.querySelector?.('.active-next-set');
    if (!activeEl) {
      dock.hidden = false;
      return;
    }
    const rect = activeEl.getBoundingClientRect?.();
    if (rect && typeof window !== 'undefined') {
      const vh = window.visualViewport?.height || window.innerHeight;
      dock.hidden = rect.top >= 56 && rect.bottom <= vh - 80;
    }
    this._activeSetObserver = new IntersectionObserver(entries => {
      const entry = entries[0];
      if (!entry || this.activeView !== 'workout' || !this.getNextSet()) return;
      dock.hidden = entry.isIntersecting;
    }, { threshold: 0.35, rootMargin: '-56px 0px -80px 0px' });
    this._activeSetObserver.observe(activeEl);
  },

  revealWorkoutSet(exId, setIdx, focus = false, automatic = false, type = 'working') {
    // Value-entry handlers preserve their input nodes; navigation must not steal their keyboard.
    if (document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
    const row = this.exerciseListEl.querySelector?.(type === 'warmup'
      ? `.warmup-row[data-exid="${exId}"][data-warmupidx="${setIdx}"]`
      : `.set-row[data-exid="${exId}"][data-setidx="${setIdx}"]`);
    if (!row) return;
    const dock = document.querySelector('.workout-dock');
    const dockRect = dock?.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const bottom = dockRect && dockRect.height > 0 ? Math.min(viewportHeight, dockRect.top) - 12 : viewportHeight - 12;
    const header = document.querySelector('.app-header');
    const sticky = header && ['sticky', 'fixed'].includes(window.getComputedStyle(header).position);
    const top = sticky ? Math.max(12, header.getBoundingClientRect().bottom + 12) : 12;
    const rect = row.getBoundingClientRect();
    if (rect.top < top || rect.bottom > bottom) {
      const targetTop = Math.max(0, window.scrollY + rect.top - top);
      window.scrollTo({ top: targetTop, behavior: automatic || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
    if (focus) (row.querySelector('.rir-selector-row') || row.querySelector('.set-heading, .edit-set-btn, .warmup-edit-btn, .restore-skipped-set-btn') || row).focus({ preventScroll: true });
  },

  jumpToActiveExercise({ automatic = false } = {}) {
    if (document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
    if (automatic && this.pendingRir) {
      const { exId, setIdx } = this.pendingRir;
      const set = this.session.logs[exId]?.[setIdx];
      if (set?.completed && !set.rirAnswered && set.rir == null) {
        this.focusedExerciseId = exId;
        this.renderWorkout();
        this.revealWorkoutSet(exId, setIdx, true, true);
        return;
      }
    }
    const next = this.getNextSet();
    if (!next) {
      const effort = this.pendingRir && this.exerciseListEl.querySelector?.(`.rir-selector-row[data-exid="${this.pendingRir.exId}"][data-setidx="${this.pendingRir.setIdx}"]`);
      if (effort) { effort.scrollIntoView({ block: 'center', behavior: 'instant' }); effort.focus({ preventScroll: true }); }
      else {
        const finish = this.exerciseListEl.querySelector?.('.review-finish-btn') || this.exerciseListEl.querySelector?.('.restore-skipped-set-btn');
        if (finish) { finish.scrollIntoView({ block: 'center', behavior: 'instant' }); finish.focus({ preventScroll: true }); }
      }
      return;
    }
    const selector = next.type === 'warmup'
      ? `.warmup-row[data-exid="${next.ex.id}"][data-warmupidx="${next.setIdx}"]`
      : `.set-row[data-exid="${next.ex.id}"][data-setidx="${next.setIdx}"]`;
    this.focusedExerciseId = next.ex.id;
    if (!this.exerciseListEl.querySelector?.(selector)) this.renderWorkout();
    this.revealWorkoutSet(next.ex.id, next.setIdx, true, automatic, next.type);
  },

  openSwapModal(exId, exName) {
    const ex = this.findExerciseById(exId);
    const subs = this.getSubstitutionsForExercise(exName, ex);
    const currentName = ex ? this.getEffectiveExerciseName(exId, ex) : exName;
    const original = this.getOriginalExercise(ex);
    const canRestoreDefault = Boolean(ex && original.name && original.name !== ex.name);

    if (this.swapModalTitleEl) {
      this.swapModalTitleEl.textContent = 'Equipment swap';
    }

    if (this.swapContentEl) {
      const isCurrentlySwapped = Boolean(this.session && this.session.swaps && this.session.swaps[exId]);
      this.swapContentEl.innerHTML = `
        <div class="swap-current-card">
          <div class="swap-current-eyebrow">This workout</div>
          <div class="swap-current-name">${this.escapeHtml(currentName)}</div>
          <div class="swap-default-label">Routine default: ${this.escapeHtml(ex ? ex.name : exName)}</div>
          <div class="swap-scope-note">Equipment swaps apply to this workout. Your next workout uses the routine default.</div>
        </div>

        ${isCurrentlySwapped ? `
          <div class="swap-restore-wrap">
            <button type="button" id="restoreSwapBtn" class="swap-restore-session-btn">
              Use routine default for this workout (${this.escapeHtml(ex ? ex.name : exName)})
            </button>
          </div>
        ` : ''}

        <div class="swap-list-heading">
          Select alternative (${subs.length} available):
        </div>

        <div class="swap-options-list">
          ${subs.map((sub, sIdx) => `
            <div class="swap-option-card">
              <div class="swap-option-header">
                <div>
                  <span class="swap-type-badge ${this.escapeHtml(sub.type.toLowerCase().replace(/\s+/g, '-'))}">${this.escapeHtml(sub.type)}</span>
                  <div class="swap-option-name">${this.escapeHtml(sub.name)}</div>
                </div>
                ${/^https?:\/\//i.test(sub.videoUrl || '') ? `
                  <a href="${this.escapeHtml(sub.videoUrl)}" target="_blank" rel="noopener noreferrer" class="video-link-btn swap-form-link">
                    Form guide ↗
                  </a>
                ` : ''}
              </div>
              <div class="swap-option-notes">${this.escapeHtml(sub.notes || 'Target: ' + sub.targetReps + ' reps.')}</div>
              <div class="swap-actions">
                <button type="button" class="swap-btn-today" data-exid="${exId}" data-subidx="${sIdx}">
                  Use for this workout
                </button>
              </div>
            </div>
          `).join('')}
        </div>
        <details class="swap-default-controls">
          <summary>Change routine default</summary>
          <p>This changes the equipment used by future workouts. Review the change before saving.</p>
          ${canRestoreDefault ? `<button type="button" class="swap-restore-default" id="restoreRoutineDefaultBtn">Restore routine default: ${this.escapeHtml(original.name)}</button>` : ''}
          ${subs.filter(sub => sub.name !== ex?.name && !(canRestoreDefault && sub.name === original.name)).map(sub => `<button type="button" class="swap-btn-perm" data-subidx="${subs.indexOf(sub)}">Set default: ${this.escapeHtml(sub.name)}</button>`).join('')}
          ${ex && currentName !== ex.name ? `<button type="button" class="swap-btn-perm" data-current="true">Set default: ${this.escapeHtml(currentName)}</button>` : ''}
        </details>
      `;

      document.getElementById('restoreSwapBtn')?.addEventListener('click', () => {
        if (!this.session.swaps?.[exId]) return;
        if (!this.saveSessionFlowChange(() => {
          if (this.session.warmups?.[exId]) this.session.warmups[exId] = this.session.warmups[exId].filter(set => set.completed || set.skipped);
          delete this.session.swaps[exId];
          const sets = this.session.logs?.[exId] || [];
          sets.forEach((s, sIdx) => {
            if (!s.completed && ex) {
              const target = this.getSetTarget(ex, sIdx, ex.name);
              s.weight = target.targetWeight;
              s.reps = target.targetReps;
              s.needsBaseline = Boolean(target.needsBaseline);
              s.exerciseName = ex.name;
              s.muscle = ex.muscle;
              s.targetReps = ex.targetReps;
              s.rir = null;
              delete s.programSets;
              delete s.rirAnswered;
            }
          });
        }, false)) return;
        this.editingCompletedWarmup = null;
        this.closeModal(this.swapModalEl);
        this.showToast(`Using routine default "${ex ? ex.name : exName}" for this workout.`);
        this.renderWorkout();
      });

      this.swapContentEl.querySelectorAll('.swap-btn-today').forEach(btn => {
        btn.addEventListener('click', () => {
          const sIdx = parseInt(btn.dataset.subidx, 10);
          this.applyExerciseSwap(exId, subs[sIdx], 'today');
        });
      });

      this.swapContentEl.querySelectorAll('.swap-btn-perm').forEach(btn => {
        btn.addEventListener('click', () => {
          const sub = btn.dataset.current ? this.session.swaps?.[exId] : subs[parseInt(btn.dataset.subidx, 10)];
          this.reviewRoutineDefaultChange(exId, sub);
        });
      });
      document.getElementById('restoreRoutineDefaultBtn')?.addEventListener('click', () => {
        if (canRestoreDefault) this.reviewRoutineDefaultChange(exId, original, true);
      });
    }

    this.openModal(this.swapModalEl);
  },

  reviewRoutineDefaultChange(exId, sub, restoring = false) {
    const ex = this.findExerciseById(exId);
    if (!ex || !sub || !this.swapContentEl) return;
    if (this.swapModalTitleEl) this.swapModalTitleEl.textContent = restoring ? 'Restore routine default?' : 'Change routine default?';
    this.swapContentEl.innerHTML = `
      <div class="swap-default-review">
        <p>Routine default</p>
        <div class="swap-review-name">${this.escapeHtml(ex.name)}</div>
        <div aria-hidden="true">↓</div>
        <div class="swap-review-name">${this.escapeHtml(sub.name)}</div>
        <p>This equipment will be used for this workout and future workouts. Completed sets keep their original equipment and recorded weights.</p>
        <p>Weights come from this equipment's own history. Enter a starting weight if you have not used it before.</p>
        <button type="button" id="cancelRoutineDefaultBtn" class="swap-btn-perm" autofocus>Back to alternatives</button>
        <button type="button" id="confirmRoutineDefaultBtn" class="swap-btn-today">${restoring ? 'Restore routine default' : 'Save routine default'}</button>
      </div>`;
    document.getElementById('cancelRoutineDefaultBtn')?.addEventListener('click', () => this.openSwapModal(exId, ex.name));
    document.getElementById('confirmRoutineDefaultBtn')?.addEventListener('click', () => this.applyExerciseSwap(exId, sub, 'permanent'));
  },

  applyExerciseSwap(exId, sub, mode) {
    const ex = this.findExerciseById(exId);
    if (!ex || !sub) return;
    const changed = this.getEffectiveExerciseName(exId, ex) !== sub.name ||
      (mode === 'permanent' && Boolean(this.session.swaps?.[exId]));
    if (!changed) return;
    const oldName = ex.name;
    if (!this.saveSessionFlowChange(() => {
      const previousName = this.getEffectiveExerciseName(exId, ex);
      const previousSwap = this.session?.swaps?.[exId];
      const changingEquipment = previousName !== sub.name;
      if (changingEquipment && this.session.warmups?.[exId]) this.session.warmups[exId] = this.session.warmups[exId].filter(set => set.completed || set.skipped);
      const sets = this.session?.logs?.[exId] || [];
      sets.filter(s => s.completed).forEach(s => {
        s.exerciseName = s.exerciseName || previousName;
        s.muscle = s.muscle || previousSwap?.muscle || ex.muscle;
        s.targetReps = s.targetReps || previousSwap?.targetReps || ex.targetReps;
      });
      const hasHistory = Boolean(this.getPreviousExercisePerformance(sub.name));

      if (mode === 'permanent') {
        if (!ex.originalExercise?.name) ex.originalExercise = this.getOriginalExercise(ex);
        const savedAlternatives = Array.isArray(ex.equipmentAlternatives) ? ex.equipmentAlternatives : [];
        if (!savedAlternatives.some(alternative => alternative.name === ex.name)) {
          ex.equipmentAlternatives = [...savedAlternatives, this.getExerciseSnapshot(ex)];
        }
        ex.name = sub.name;
        if (sub.muscle) ex.muscle = sub.muscle;
        if (sub.targetReps) ex.targetReps = sub.targetReps;
        if (sub.notes) ex.notes = sub.notes;
        if (sub.videoUrl) ex.videoUrl = sub.videoUrl;
        ex.increment = this.getExerciseIncrement(sub, sub.name);
        ex.startingWeight = '';
        ex.needsBaseline = !hasHistory;
        if (this.session && this.session.swaps) {
          delete this.session.swaps[exId];
        }
      } else {
        if (!this.session.swaps) this.session.swaps = {};
        this.session.swaps[exId] = sub;
      }

      const effectiveName = sub.name;
      sets.forEach((s, sIdx) => {
        if (!s.completed && changingEquipment) {
          const target = this.getSetTarget(ex, sIdx, effectiveName);
          s.weight = hasHistory ? target.targetWeight : null;
          s.reps = target.targetReps;
          s.needsBaseline = !hasHistory;
          s.exerciseName = effectiveName;
          s.muscle = sub.muscle || ex.muscle;
          s.targetReps = target.targetRepsDisplay;
          delete s.programSets;
          if (Number.isInteger(sub.programSets) && sub.programSets > 0) s.programSets = sub.programSets;
          s.rir = null;
        }
      });
    }, false, mode === 'permanent')) return;
    this.editingCompletedWarmup = null;
    this.showToast(mode === 'permanent'
      ? `Replaced "${oldName}" with "${sub.name}" in your routine.`
      : `Swapped to "${sub.name}" for this workout.`);

    this.closeModal(this.swapModalEl);
    this.renderWorkout();
  },

  openQuickHistoryModal(exerciseName) {
    if (this.quickHistoryTitleEl) {
      this.quickHistoryTitleEl.textContent = exerciseName;
    }

    const pr = this.getPersonalRecord(exerciseName);
    const historyList = this.getExerciseHistoryOverTime(exerciseName);

    if (this.quickHistoryContentEl) {
      this.quickHistoryContentEl.innerHTML = `
        <div class="quick-pr-card">
          <div>
            <div class="quick-pr-eyebrow">All-Time Records</div>
            <div class="quick-pr-value">
              ${pr.maxWeight > 0 ? `${pr.maxWeight} lb` : '—'}
              <span class="quick-pr-sub">(Est 1RM: ${pr.max1RM > 0 ? pr.max1RM + ' lb' : '—'})</span>
            </div>
          </div>
          <div class="quick-pr-reps-col">
            <div class="quick-pr-reps-label">Best Reps</div>
            <div class="quick-pr-reps-val">${pr.bestReps > 0 ? pr.bestReps : '—'}</div>
          </div>
        </div>

        <div class="quick-history-heading">
          Session history (${historyList.length} recorded):
        </div>

        <div class="quick-history-list">
          ${historyList.length === 0 ? `
            <p class="insight-empty">No completed sessions recorded for this exercise yet. Your sets today will be saved when you finish.</p>
          ` : historyList.slice(-8).reverse().map(item => {
            const dateStr = new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            return `
              <div class="quick-history-session-card">
                <div class="quick-history-session-header">
                  <div class="quick-history-date">${this.escapeHtml(dateStr)}${item.deload ? ' · Deload' : ''}</div>
                  <div class="quick-history-day">${this.escapeHtml(item.dayTitle || '')}</div>
                </div>
                <div class="quick-history-sets">
                  ${item.sets ? item.sets.filter(Boolean).map(s => `${s.weight === 0 ? 'BW' : `${s.weight} lb`} × ${s.reps}${typeof s.rir === 'number' ? ` (${s.rir === 3 ? '3+' : s.rir} RIR)` : ''}`).join(' • ') : '—'}
                </div>
                <div class="quick-history-meta">
                  Top weight: ${item.maxWeight} lb · Volume: ${item.totalVolume.toLocaleString()} lb
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    this.openModal(this.quickHistoryModalEl);
  },

  showSessionResumePrompt() {
    const info = this.getSessionResumeInfo();
    if (!info.inProgress || !info.stale || !this.summaryContentEl) return;
    const sessionId = this.session.id;
    const title = document.getElementById('summaryModalTitle');
    if (title) title.textContent = 'Saved workout';
    this.summaryContentEl.innerHTML = `<p>${this.escapeHtml(this.session.dayTitle)} · Started ${this.escapeHtml(new Date(info.date).toLocaleString())}</p><p>Resume keeps every saved set. Start new keeps this draft available for recovery.</p><button type="button" class="primary-btn" id="resumeDraftBtn" autofocus>Resume workout</button><button type="button" class="secondary-btn" id="startNewDraftBtn">Start new workout</button>`;
    this.openModal(this.summaryModalEl);
    document.getElementById('resumeDraftBtn')?.addEventListener('click', () => {
      this.selectionLocalDate = this.getLocalDateKey(new Date());
      this.closeModal(this.summaryModalEl);
      this.jumpToActiveExercise?.();
    });
    document.getElementById('startNewDraftBtn')?.addEventListener('click', () => this.startNewSession(sessionId));
  },

  showWorkoutSummary() {
    const { completed, skipped, remaining } = this.getWorkingSetCounts();
    if (!completed) { this.showToast('Complete at least one set before finishing.'); return; }
    const sessionId = this.session.id;
    const title = document.getElementById('summaryModalTitle');
    if (title) title.textContent = 'Review workout';
    this.summaryContentEl.innerHTML = `<p>${this.escapeHtml(this.session.dayTitle)}</p><p><strong>${completed} sets completed · ${skipped} skipped · ${remaining} remaining</strong></p><p>Your workout stays open until you confirm.</p><button type="button" class="primary-btn" id="keepTrainingBtn" autofocus>Keep training</button><button type="button" class="secondary-btn" id="confirmFinishBtn">${remaining ? 'Finish early' : 'Finish workout'}</button>`;
    this.openModal(this.summaryModalEl);
    document.getElementById('keepTrainingBtn')?.addEventListener('click', () => {
      this.selectionLocalDate = this.getLocalDateKey(new Date());
      this.closeModal(this.summaryModalEl);
    });
    document.getElementById('confirmFinishBtn')?.addEventListener('click', () => this.finishSession(sessionId));
  },

  finishSession(expectedId = this.session?.id) {
    if (!this.session || expectedId !== this.session.id || this.history.some(w => w.sessionId === expectedId)) return false;
    const invalid = [...Object.values(this.session.logs || {}), ...Object.values(this.session.warmups || {})].flat().find(set => set.completed && this.getSetValidationError(set));
    if (invalid) { this.showToast(this.getSetValidationError(invalid)); return false; }
    const currentDay = this.routine[this.activeDayIndex];
    if (!currentDay) return;

    // Completed sets from the retired Monday slot remain part of this workout.
    const retiredMonEx = typeof RETIRED_MONDAY_ABDUCTION !== 'undefined' ? RETIRED_MONDAY_ABDUCTION : null;
    const historical = retiredMonEx && currentDay.id === 'mon__lower_b' && !currentDay.exercises.some(ex => ex.id === retiredMonEx.id) && (this.session.logs?.[retiredMonEx.id] || []).some(set => set.completed)
      ? [retiredMonEx] : [];
    const workoutExercises = [...currentDay.exercises, ...historical];
    let totalCompletedSets = 0;
    workoutExercises.forEach(ex => {
      const sets = (this.session && this.session.logs && this.session.logs[ex.id]) || [];
      totalCompletedSets += sets.filter(s => s.completed).length;
    });

    if (totalCompletedSets === 0) {
      this.showToast('No completed sets to finish. Complete at least one set first.');
      return;
    }

    const startMs = Date.parse(this.session.startTime);
    const durationSeconds = Number.isFinite(startMs) ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : null;
    const durationMins = durationSeconds === null ? null : Math.floor(durationSeconds / 60);
    const durationLabel = durationSeconds === null ? 'Not recorded' : durationSeconds < 60 ? '<1 min' : `${durationMins} min`;
    const previousWeights = JSON.parse(JSON.stringify(this.lastWeights || {}));

    let totalVolume = 0;
    const newPRs = [];
    const weightIncreaseUnlocked = [];
    const recordedExercises = {};

    workoutExercises.forEach(ex => {
      const sets = this.session.logs[ex.id] || [];
      const groups = new Map();
      sets.filter(s => s.completed).forEach(set => {
        const name = set.exerciseName || this.getEffectiveExerciseName(ex.id, ex);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(set);
      });
      groups.forEach((completedSets, effectiveName) => {
        const isSwapped = effectiveName !== ex.name;
        const currentSwap = this.session.swaps?.[ex.id];
        const effectiveTargetReps = completedSets[0].targetReps || (currentSwap?.name === effectiveName ? currentSwap.targetReps : null) || ex.targetReps;
        const maxTarget = this.getMaxTargetReps(effectiveTargetReps);
        const prescribedCount = completedSets[0].programSets || this.getPrescribedSetCount(ex, effectiveName);
        const targetSetsCount = this.session.deload ? Math.max(2, Math.floor(prescribedCount * 0.67)) : prescribedCount;
        const topW = Math.max(...completedSets.map(s => s.weight || 0));
        if (!this.session.deload && topW > 0 && completedSets.length >= targetSetsCount && completedSets.every(s => (s.reps || 0) >= maxTarget && (s.weight || 0) >= topW)) {
          weightIncreaseUnlocked.push({ name: effectiveName, reps: maxTarget, setsCount: completedSets.length, topWeight: topW, increment: this.getExerciseIncrement(ex, effectiveName) });
        }
        const priorPR = this.getPersonalRecord(effectiveName);
        completedSets.forEach(s => {
          totalVolume += (s.weight || 0) * (s.reps || 0);
          let description = '';
          if (s.weight > priorPR.maxWeight && priorPR.maxWeight > 0) description = `${effectiveName}: New Weight Record (${s.weight} lb)`;
          else if (s.weight === 0 && s.reps > priorPR.bestReps && priorPR.bestReps > 0) description = `${effectiveName}: New Rep Record (BW × ${s.reps})`;
          if (description && !newPRs.includes(description)) newPRs.push(description);
        });
        const entry = recordedExercises[effectiveName] ||= { swappedFrom: isSwapped ? ex.name : null, sets: [] };
        completedSets.forEach(s => entry.sets.push({ ...s, setNum: sets.indexOf(s) + 1, exerciseName: effectiveName, muscle: s.muscle || (currentSwap?.name === effectiveName ? currentSwap.muscle : ex.muscle), completed: true, rir: typeof s.rir === 'number' ? s.rir : null, type: s.type || 'working', ...(currentDay.oneTime ? { programSets: prescribedCount } : {}) }));
        if (!this.session.deload) {
          this.lastWeights ||= {};
          this.lastWeights[effectiveName] = { date: new Date().toISOString(), deload: false, sets: entry.sets.map(s => ({ ...s })) };
        }
      });
    });

    const sessionSnapshot = JSON.parse(JSON.stringify(this.session));
    delete sessionSnapshot.initialLogs;
    const isOneTime = Boolean(currentDay.oneTime);
    const workoutRecord = {
      id: 'w_' + this.session.id,
      sessionId: this.session.id,
      dayId: currentDay.id,
      date: new Date().toISOString(),
      dayTitle: currentDay.title,
      deload: Boolean(this.session.deload),
      ...(isOneTime ? {
        oneTime: true,
        replacesDayIds: Array.isArray(currentDay.replacesDayIds) ? [...currentDay.replacesDayIds] : [],
        oneTimeDay: JSON.parse(JSON.stringify(currentDay))
      } : {}),
      totalVolume,
      totalCompletedSets,
      durationMins,
      durationSeconds,
      durationLabel,
      sessionSnapshot,
      exercises: recordedExercises
    };

    const previousHistory = this.history;
    const previousSession = this.session;
    const previousRoutine = this.routine;
    const previousActiveDayIndex = this.activeDayIndex;
    this.history = [...this.history, workoutRecord];
    if (isOneTime) {
      this.routine = this.routine.filter(day => day.id !== currentDay.id);
      this.activeDayIndex = this.getResumeDayIndex();
    }
    const nextSession = isOneTime ? this.loadSession(this.activeDayIndex) : this.initNewSession(this.activeDayIndex);
    try {
      const writes = new Map([
        [this.storageKeys.history, JSON.stringify(this.history)],
        [this.storageKeys.lastWeights, JSON.stringify(this.lastWeights)],
        [this.getSessionKey(nextSession.dayId), JSON.stringify(nextSession)],
        ['gym_last_active_day_v1', nextSession.dayId]
      ]);
      if (isOneTime) {
        writes.set(this.storageKeys.routine, JSON.stringify(this.routine));
        writes.set(`gym_onetime_done_${currentDay.id}`, '1');
        writes.set(this.getSessionKey(currentDay.id), null);
      }
      this.writeStorageTransaction(writes);
    } catch (_) {
      this.history = previousHistory;
      this.session = previousSession;
      this.lastWeights = previousWeights;
      this.routine = previousRoutine;
      this.activeDayIndex = previousActiveDayIndex;
      this.showToast('Could not save the workout. Your workout is still open; try again or download a backup.');
      return false;
    }
    this.stopTimer();
    this.stopElapsedClock?.();
    this.pendingRir = null;
    this.editingCompletedSet = null;
    this.editingCompletedWarmup = null;
    this.focusedExerciseId = null;
    this.session = nextSession;

    this.summaryContentEl.innerHTML = `
      <div class="summary-hero">
        <h2>Workout Complete</h2>
        <p>${this.escapeHtml(currentDay.title)}</p>
      </div>

      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-val">${totalVolume.toLocaleString()}</div>
          <div class="stat-label">Total Volume (lb)</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${totalCompletedSets}</div>
          <div class="stat-label">Sets Finished</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${this.escapeHtml(durationLabel)}</div>
          <div class="stat-label">Duration</div>
        </div>
      </div>

      ${this.getWorkingSetCounts(sessionSnapshot).skipped ? `<p>${this.getWorkingSetCounts(sessionSnapshot).skipped} working sets skipped for this workout. Skipped sets do not count toward volume or progression.</p>` : ''}

      ${weightIncreaseUnlocked.length > 0 ? `
        <div class="summary-progression-box">
          <h4>Weight increases unlocked for next workout</h4>
          <ul>
            ${weightIncreaseUnlocked.map(item => `
              <li><strong>${this.escapeHtml(item.name)}</strong>: Hit ${item.reps} reps across all ${item.setsCount} sets (${item.topWeight} lb) — ready for +${item.increment} lb next workout.</li>
            `).join('')}
          </ul>
        </div>
      ` : ''}

      ${newPRs.length > 0 ? `
        <div class="summary-pr-box">
          <h4>New records</h4>
          <ul>
            ${newPRs.map(pr => `<li>${this.escapeHtml(pr)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <button type="button" class="primary-btn" id="finishSummaryBtn" autofocus>Done & View Progress</button>
      <button type="button" class="secondary-btn" id="reopenSummaryBtn">Reopen this workout</button>
    `;

    const title = document.getElementById('summaryModalTitle');
    if (title) title.textContent = 'Workout saved';
    this.openModal(this.summaryModalEl);

    document.getElementById('reopenSummaryBtn')?.addEventListener('click', () => this.reopenWorkout(workoutRecord.id));
    document.getElementById('finishSummaryBtn')?.addEventListener('click', () => {
      this.closeModal(this.summaryModalEl);
      document.querySelector('[data-view="analytics"]')?.click();
    });

    this.selectDefaultWorkout();
    return true;
  },

  reopenWorkout(recordId) {
    const record = this.history.find(workout => workout.id === recordId);
    if (!record?.sessionSnapshot) { this.showToast('This older workout has no recoverable session draft.'); return false; }
    let nextRoutine = this.routine;
    let dayIndex = nextRoutine.findIndex(day => day.id === record.dayId);
    const restoredOneTimeDay = dayIndex < 0
      ? (record.oneTimeDay || (typeof ONE_TIME_SUNDAY_UPPER_B_ARMS_COMBO !== 'undefined' && record.dayId === ONE_TIME_SUNDAY_UPPER_B_ARMS_COMBO.id ? ONE_TIME_SUNDAY_UPPER_B_ARMS_COMBO : null))
      : null;
    if (dayIndex < 0 && !restoredOneTimeDay) { this.showToast('Restore this workout’s routine day before reopening.'); return false; }
    if (restoredOneTimeDay) {
      nextRoutine = [...this.routine, JSON.parse(JSON.stringify(restoredOneTimeDay))];
      dayIndex = nextRoutine.length - 1;
    }
    const saved = restoredOneTimeDay ? null : this.loadSession(dayIndex);
    if (this.hasSessionProgress(saved) && saved.id !== record.sessionId) {
      this.showToast('A newer workout is in progress for this day. Finish it or start a new draft before reopening.');
      return false;
    }
    const targetDay = nextRoutine[dayIndex];
    const snapshot = JSON.parse(JSON.stringify(record.sessionSnapshot));
    this.reconcileMondaySession(snapshot, targetDay, { preserve: true, recordedExercises: record.exercises });
    targetDay.exercises.forEach(exercise =>
      this.reconcileSessionEquipmentIdentity(snapshot, exercise, exercise, record.exercises));
    snapshot.lastInteractionAt = new Date().toISOString();
    const history = this.history.filter(workout => workout.id !== recordId);
    const weights = this.buildLastWeightsFromHistory(history);
    try {
      const writes = new Map([
        [this.storageKeys.history, JSON.stringify(history)],
        [this.storageKeys.lastWeights, JSON.stringify(weights)],
        [this.getSessionKey(snapshot.dayId), JSON.stringify(snapshot)],
        ['gym_last_active_day_v1', snapshot.dayId]
      ]);
      if (this.session.dayId !== snapshot.dayId) writes.set(this.getSessionKey(this.session.dayId), JSON.stringify(this.session));
      if (restoredOneTimeDay) {
        writes.set(this.storageKeys.routine, JSON.stringify(nextRoutine));
        writes.set(`gym_onetime_done_${record.dayId}`, null);
      }
      this.writeStorageTransaction(writes);
    } catch (_) { this.showToast('Could not reopen this workout. The saved workout is still in history.'); return false; }
    this.stopTimer();
    if (restoredOneTimeDay) this.routine = nextRoutine;
    this.activeDayIndex = dayIndex;
    this.selectionLocalDate = this.getLocalDateKey(new Date());
    this.session = this.normalizeSessionFlow(snapshot);
    this.history = history;
    this.lastWeights = weights;
    this.pendingRir = null;
    this.editingCompletedSet = null;
    this.editingCompletedWarmup = null;
    this.focusedExerciseId = null;
    this.closeModal(this.summaryModalEl);
    this.activeView = 'workout';
    document.querySelector('[data-view="workout"]')?.click();
    this.render();
    this.jumpToActiveExercise?.();
    return true;
  }
});
