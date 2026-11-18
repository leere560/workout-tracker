// Routine overview, in-app routine editor, one-time workout builder, settings, and reset flow.
(globalThis.WorkoutAppMixins ||= []).push({
  renderRoutineEditor() {
    const openDays = new Set(
      Array.from(this.routineEditorEl.querySelectorAll?.('.program-day[open]') || [], el => el.dataset.dayid)
    );
    const permanentDays = this.routine.filter(day => !day.oneTime);
    const exercises = permanentDays.flatMap(day => day.exercises).filter(ex => !ex.isOptional);
    const normalSets = exercises.reduce((sum, ex) => sum + ex.sets, 0);
    const deloadSets = exercises.reduce((sum, ex) => sum + Math.max(2, Math.floor(ex.sets * .67)), 0);
    const buildLabel = typeof APP_BUILD_VERSION !== 'undefined' ? APP_BUILD_VERSION : 'Build v40';
    const reminder = typeof this.getBackupReminderInfo === 'function' ? this.getBackupReminderInfo() : { shouldRemind: false };

    this.routineEditorEl.innerHTML = `<div class="insights-page">
      <section class="program-overview" aria-labelledby="programOverviewHeading"><div class="insight-section-heading"><h2 id="programOverviewHeading">Your program</h2><a class="insight-jump" href="#settingsBackupHeading">Settings & backup</a></div><p class="insight-meta">${permanentDays.length} training days · ${normalSets} planned sets per week</p>
        ${this.routine.map(day => `<details class="program-day insight-details" data-dayid="${this.escapeHtml(day.id)}" ${openDays.has(day.id) ? 'open' : ''}><summary><span>${this.escapeHtml(day.title)}${day.oneTime ? ' · One-time' : ''}</span><small>${day.exercises.length} lifts · ${day.exercises.reduce((sum, ex) => sum + ex.sets, 0)} sets</small></summary>
          ${day.oneTime ? `<div class="routine-day-banner"><button type="button" class="secondary-btn dismiss-onetime-btn" data-dayid="${this.escapeHtml(day.id)}">Dismiss one-time workout</button></div>` : ''}
          <ul class="routine-exercise-list">${day.exercises.map((ex, idx) => `<li class="routine-exercise-row">
            <div class="routine-exercise-info"><strong>${this.escapeHtml(ex.name)}</strong><small>${ex.sets} × ${this.escapeHtml(ex.targetReps)} · Rest ${this.escapeHtml(ex.rest || this.formatRest(ex.restSeconds || 120))}${ex.superset ? ` · Superset ${this.escapeHtml(ex.superset.tag || '')}` : ''}${ex.isOptional ? ' · Optional' : ''}</small></div>
            <div class="routine-exercise-actions">
              <button type="button" class="secondary-btn move-routine-ex-btn" data-dayid="${this.escapeHtml(day.id)}" data-exid="${this.escapeHtml(ex.id)}" data-dir="-1" aria-label="Move ${this.escapeHtml(ex.name)} up" ${idx === 0 ? 'disabled' : ''}>↑</button>
              <button type="button" class="secondary-btn move-routine-ex-btn" data-dayid="${this.escapeHtml(day.id)}" data-exid="${this.escapeHtml(ex.id)}" data-dir="1" aria-label="Move ${this.escapeHtml(ex.name)} down" ${idx === day.exercises.length - 1 ? 'disabled' : ''}>↓</button>
              <button type="button" class="secondary-btn edit-routine-ex-btn" data-dayid="${this.escapeHtml(day.id)}" data-exid="${this.escapeHtml(ex.id)}" aria-label="Edit ${this.escapeHtml(ex.name)}">Edit</button>
              <button type="button" class="secondary-btn insight-danger delete-routine-ex-btn" data-dayid="${this.escapeHtml(day.id)}" data-exid="${this.escapeHtml(ex.id)}" aria-label="Remove ${this.escapeHtml(ex.name)}" ${day.exercises.length <= 1 ? 'disabled' : ''}>Remove</button>
            </div>
          </li>`).join('')}</ul>
          <div class="routine-day-footer"><button type="button" class="secondary-btn add-routine-ex-btn" data-dayid="${this.escapeHtml(day.id)}">+ Add exercise</button></div>
        </details>`).join('')}
        <div class="routine-onetime-create"><button type="button" class="secondary-btn" id="createOneTimeWorkoutBtn">+ Create one-time workout</button></div>
      </section>
      <section aria-labelledby="settingsBackupHeading"><h2 id="settingsBackupHeading">Settings & backup</h2>
        ${reminder.shouldRemind ? `<aside class="backup-reminder-banner insight-panel" aria-label="Backup reminder"><p><strong>Backup reminder:</strong> ${reminder.daysSinceBackup === null ? `${reminder.workoutsSinceBackup} workouts saved without a backup export.` : `${reminder.workoutsSinceBackup} new workouts since your export ${reminder.daysSinceBackup} days ago.`}</p></aside>` : ''}
        <div class="insight-panel"><div class="insight-section-heading"><h3>Backup</h3><span class="insight-meta">${this.escapeHtml(this.getBackupStatusText())}</span></div><p>Save a copy of your history, active workouts, program and preferences before changing phones.</p><div class="insight-actions"><button type="button" class="secondary-btn" id="exportDataBtn">Download backup</button><button type="button" class="secondary-btn" id="importBackupBtn">Restore backup</button><button type="button" class="secondary-btn" id="exportCsvBtn">Export CSV</button></div></div>
        <details class="insight-details"><summary>Recovery drafts</summary>${this.renderRecoveryDrafts()}</details>
        <div class="insight-panel"><div class="insight-section-heading"><h3>App updates</h3><span class="insight-meta">${this.escapeHtml(buildLabel)}</span></div><p>Update the app while keeping your saved workouts and settings.</p><button type="button" class="secondary-btn" id="forceUpdateBtn">Check for update</button></div>
        <div class="setting-row insight-panel"><div><label id="deloadSettingLabel" for="deloadSettingToggle">7-day deload</label><p id="deloadSettingDescription">${normalSets} → ${deloadSets} planned sets (${normalSets ? Math.round((normalSets - deloadSets) / normalSets * 100) : 0}% fewer) and 10% lighter loads. Ends automatically after 7 days.${this.deloadActive ? ` ${this.getDeloadDaysLeft()} days remaining.` : ''}</p></div><label class="switch"><input type="checkbox" id="deloadSettingToggle" aria-labelledby="deloadSettingLabel" aria-describedby="deloadSettingDescription" ${this.deloadActive ? 'checked' : ''}><span class="slider"></span></label></div>
        <div class="setting-row insight-panel"><div><label id="wakeLockSettingLabel" for="wakeLockSettingToggle">Keep screen awake</label><p id="wakeLockSettingDescription">Keep the display on while logging a workout, when supported by your browser.</p></div><label class="switch"><input type="checkbox" id="wakeLockSettingToggle" aria-labelledby="wakeLockSettingLabel" aria-describedby="wakeLockSettingDescription" ${this.wakeLockEnabled ? 'checked' : ''}><span class="slider"></span></label></div>
        <details class="insight-panel insight-details"><summary>Rest sound & vibration</summary><p>Test alerts with the page open. Background and locked-screen alerts may not fire on iPhone; reopening restores the countdown.</p><button type="button" class="secondary-btn" id="testChimeBtn">Test sound & vibration</button></details>
        <details class="insight-panel insight-details"><summary>Reset program</summary><p>Restore the original exercises, sets and rep ranges. Any active unfinished workout is saved under Recovery drafts; saved history is retained.</p><button type="button" class="secondary-btn insight-danger" id="resetRoutineBtn">Reset to original program</button></details>
      </section>
    </div>`;

    document.getElementById('deloadSettingToggle')?.addEventListener('change', e => {
      this.deloadActive = e.target.checked;
      localStorage.setItem(this.storageKeys.deloadActive, String(this.deloadActive));
      if (this.deloadActive) {
        this.deloadStartDate = Date.now();
        localStorage.setItem(this.storageKeys.deloadStartDate, String(this.deloadStartDate));
        this.showToast('7-day deload week activated. Sets scaled and loads eased.');
      } else {
        this.deloadStartDate = 0;
        localStorage.removeItem(this.storageKeys.deloadStartDate);
        this.showToast('Deload week deactivated. Full training intensity restored.');
      }
      this.session = this.loadSession();
      this.saveCurrentSession();
      this.render();
    });

    document.getElementById('wakeLockSettingToggle')?.addEventListener('change', e => {
      this.wakeLockEnabled = e.target.checked;
      localStorage.setItem(this.storageKeys.wakeLockEnabled, String(this.wakeLockEnabled));
      if (this.wakeLockEnabled && this.activeView === 'workout') {
        this.requestWakeLock();
      } else {
        this.releaseWakeLock();
      }
      this.showToast(this.wakeLockEnabled ? 'Screen wake lock enabled.' : 'Screen wake lock disabled.');
    });

    document.getElementById('testChimeBtn')?.addEventListener('click', () => {
      this.primeAudioContext();
      this.triggerHaptic([150, 80, 250]);
      this.playTimerAlarm();
    });

    document.getElementById('forceUpdateBtn')?.addEventListener('click', () => this.forceAppUpdate());
    document.getElementById('exportDataBtn')?.addEventListener('click', () => this.exportData());
    document.getElementById('exportCsvBtn')?.addEventListener('click', () => this.exportHistoryCsv());
    document.getElementById('importBackupBtn')?.addEventListener('click', () => {
      document.getElementById('importFileInput')?.click();
    });
    document.getElementById('createOneTimeWorkoutBtn')?.addEventListener('click', () => this.openOneTimeBuilderModal());
    this.routineEditorEl.querySelectorAll?.('.recovery-restore-btn').forEach(button => button.addEventListener('click', () => this.restoreSavedDraft(button.dataset.recoveryid)));
    this.routineEditorEl.querySelectorAll?.('.dismiss-onetime-btn').forEach(button => button.addEventListener('click', () => this.dismissOneTimeWorkout(button.dataset.dayid)));
    this.routineEditorEl.querySelectorAll?.('.move-routine-ex-btn').forEach(button => button.addEventListener('click', () => this.moveRoutineExercise(button.dataset.dayid, button.dataset.exid, Number(button.dataset.dir))));
    this.routineEditorEl.querySelectorAll?.('.edit-routine-ex-btn').forEach(button => button.addEventListener('click', () => this.openExerciseEditorModal(button.dataset.dayid, button.dataset.exid)));
    this.routineEditorEl.querySelectorAll?.('.add-routine-ex-btn').forEach(button => button.addEventListener('click', () => this.openExerciseEditorModal(button.dataset.dayid, null)));
    this.routineEditorEl.querySelectorAll?.('.delete-routine-ex-btn').forEach(button => button.addEventListener('click', () => this.deleteRoutineExercise(button.dataset.dayid, button.dataset.exid)));
    document.getElementById('resetRoutineBtn')?.addEventListener('click', () => this.resetRoutine());
  },

  syncRoutineSessionForDay(routine, dayId, writes, overlayStorage) {
    const dayIndex = routine.findIndex(d => d.id === dayId);
    if (dayIndex < 0) return;
    const day = routine[dayIndex];
    const key = this.getSessionKey(dayId);
    let session = null;
    if (this.session?.dayId === dayId) {
      session = JSON.parse(JSON.stringify(this.session));
    } else {
      try {
        const raw = overlayStorage.getItem(key);
        if (raw) session = JSON.parse(raw);
      } catch (_) {}
    }
    if (!session || !session.logs) return;
    const staged = Object.assign(Object.create(this), { routine, session, deloadActive: Boolean(session.deload) });
    if (session.initialLogs && !staged.hasSessionProgress(session)) {
      const fresh = staged.initNewSession(dayIndex);
      writes.set(key, JSON.stringify(fresh));
      return fresh;
    }
    day.exercises.forEach(ex => {
      const existing = session.logs[ex.id];
      const targetCount = session.deload ? Math.max(2, Math.floor(ex.sets * 0.67)) : ex.sets;
      if (!Array.isArray(existing)) {
        session.logs[ex.id] = Array.from({ length: targetCount }, (_, i) => {
          const target = staged.getSetTarget(ex, i, ex.name);
          return {
            setNum: i + 1, weight: target.targetWeight, reps: target.targetReps, completed: false, rir: null,
            exerciseName: ex.name, muscle: ex.muscle, targetReps: ex.targetReps, needsBaseline: Boolean(target.needsBaseline)
          };
        });
      } else {
        existing.forEach(set => {
          if (!set.completed && !session.swaps?.[ex.id]) {
            set.exerciseName = ex.name;
            set.muscle = ex.muscle;
            set.targetReps = ex.targetReps;
          }
        });
        while (existing.length < targetCount) {
          const idx = existing.length;
          const target = staged.getSetTarget(ex, idx, ex.name);
          existing.push({
            setNum: idx + 1, weight: target.targetWeight, reps: target.targetReps, completed: false, rir: null,
            exerciseName: ex.name, muscle: ex.muscle, targetReps: ex.targetReps, needsBaseline: Boolean(target.needsBaseline)
          });
        }
        while (existing.length > targetCount && !existing[existing.length - 1].completed && !existing[existing.length - 1].skipped) {
          existing.pop();
        }
      }
    });
    const validIds = new Set(day.exercises.map(ex => ex.id));
    Object.keys(session.logs).forEach(exId => {
      if (!validIds.has(exId) && !(session.logs[exId] || []).some(s => s.completed)) {
        delete session.logs[exId];
      }
    });
    session.exerciseOrder = [...new Set([...(session.exerciseOrder || []).filter(id => validIds.has(id)), ...day.exercises.map(ex => ex.id)])];
    writes.set(key, JSON.stringify(session));
    return session;
  },

  openExerciseEditorModal(dayId, exId = null) {
    const day = this.routine.find(d => d.id === dayId);
    if (!day || !this.summaryContentEl) return;
    const existing = exId ? day.exercises.find(e => e.id === exId) : null;
    const isNew = !existing;
    const muscles = ['Chest', 'Back / Lats', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Quads', 'Hamstrings / Glutes', 'Glutes', 'Adductors', 'Calves', 'Abs / Core'];
    const currentMuscle = existing?.muscle || muscles[0];
    const muscleOptions = muscles.includes(currentMuscle) ? muscles : [currentMuscle, ...muscles];
    const otherExercises = day.exercises.filter(e => e.id !== exId);
    const currentPartner = existing?.superset
      ? otherExercises.find(e => e.superset?.id === existing.superset.id)?.id || ''
      : '';
    const currentSsRest = existing?.superset?.restSeconds || 60;
    const currentRest = Math.max(120, existing?.restSeconds || 120);
    const currentIncrement = existing?.increment || 5;

    const titleEl = document.getElementById('summaryModalTitle');
    if (titleEl) titleEl.textContent = isNew ? `Add exercise · ${day.title}` : `Edit exercise · ${day.title}`;
    this.summaryContentEl.innerHTML = `
      <form id="routineExerciseForm" class="routine-editor-form">
        <div class="form-group">
          <label for="editExName">Exercise name</label>
          <input type="text" id="editExName" class="form-control" value="${this.escapeHtml(existing?.name || '')}" required placeholder="e.g., Machine Chest Press" autofocus>
        </div>
        <div class="form-row-two">
          <div class="form-group">
            <label for="editExMuscle">Muscle group</label>
            <select id="editExMuscle" class="form-control">${muscleOptions.map(m => `<option value="${this.escapeHtml(m)}" ${m === currentMuscle ? 'selected' : ''}>${this.escapeHtml(m)}</option>`).join('')}</select>
          </div>
          <div class="form-group">
            <label for="editExSets">Working sets</label>
            <input type="number" id="editExSets" class="form-control" min="1" max="10" step="1" value="${existing?.sets || 3}" required>
          </div>
        </div>
        <div class="form-row-two">
          <div class="form-group">
            <label for="editExReps">Target rep range</label>
            <input type="text" id="editExReps" class="form-control" value="${this.escapeHtml(existing?.targetReps || '8–12')}" required placeholder="8–12">
          </div>
          <div class="form-group">
            <label for="editExRest">Straight rest</label>
            <select id="editExRest" class="form-control">${[[120, '2 min'], [150, '2.5 min'], [180, '3 min'], [240, '4 min']].map(([sec, label]) => `<option value="${sec}" ${currentRest === sec ? 'selected' : ''}>${label}</option>`).join('')}</select>
          </div>
        </div>
        <div class="form-row-two">
          <div class="form-group">
            <label for="editExIncrement">Weight step</label>
            <select id="editExIncrement" class="form-control">${[1, 2.5, 5, 10].map(inc => `<option value="${inc}" ${currentIncrement === inc ? 'selected' : ''}>${inc} lb</option>`).join('')}</select>
          </div>
          <div class="form-group">
            <label for="editExPartner">Superset partner</label>
            <select id="editExPartner" class="form-control">
              <option value="">None (straight sets)</option>
              ${otherExercises.map(other => `<option value="${this.escapeHtml(other.id)}" ${other.id === currentPartner ? 'selected' : ''}>${this.escapeHtml(other.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group" id="editExSupersetRestWrap" ${currentPartner ? '' : 'hidden'}>
          <label for="editExSupersetRest">Superset rest</label>
          <select id="editExSupersetRest" class="form-control">${[60, 75, 90].map(sec => `<option value="${sec}" ${currentSsRest === sec ? 'selected' : ''}>${sec} sec</option>`).join('')}</select>
        </div>
        <label class="restore-settings-choice"><input type="checkbox" id="editExOptional" ${existing?.isOptional ? 'checked' : ''}> Mark as optional finisher</label>
        <div class="form-group">
          <label for="editExNotes">Setup & form notes</label>
          <textarea id="editExNotes" class="form-control" rows="2" placeholder="Optional technique cues">${this.escapeHtml(existing?.notes || '')}</textarea>
        </div>
        <div class="insight-actions">
          <button type="button" class="secondary-btn" id="cancelRoutineEditBtn">Cancel</button>
          <button type="submit" class="primary-btn">${isNew ? 'Add exercise' : 'Save changes'}</button>
        </div>
      </form>`;
    this.openModal(this.summaryModalEl);
    const partnerSelect = document.getElementById('editExPartner');
    const ssWrap = document.getElementById('editExSupersetRestWrap');
    partnerSelect?.addEventListener('change', () => {
      if (ssWrap) ssWrap.hidden = !partnerSelect.value;
    });
    document.getElementById('cancelRoutineEditBtn')?.addEventListener('click', () => this.closeModal(this.summaryModalEl));
    document.getElementById('routineExerciseForm')?.addEventListener('submit', e => {
      e.preventDefault();
      const saved = this.saveRoutineExercise(dayId, exId, {
        name: document.getElementById('editExName').value,
        muscle: document.getElementById('editExMuscle').value,
        sets: Number(document.getElementById('editExSets').value),
        targetReps: document.getElementById('editExReps').value,
        restSeconds: Number(document.getElementById('editExRest').value),
        increment: Number(document.getElementById('editExIncrement').value),
        isOptional: Boolean(document.getElementById('editExOptional').checked),
        partnerId: partnerSelect?.value || '',
        supersetRestSeconds: Number(document.getElementById('editExSupersetRest')?.value || 60),
        notes: document.getElementById('editExNotes').value
      });
      if (saved) this.closeModal(this.summaryModalEl);
    });
  },

  saveRoutineExercise(dayId, exId, fields) {
    const name = String(fields?.name || '').trim();
    const sets = Number(fields?.sets);
    const targetReps = String(fields?.targetReps || '').trim();
    const restSeconds = Math.max(120, Number(fields?.restSeconds) || 120);
    const increment = [1, 2.5, 5, 10].includes(Number(fields?.increment)) ? Number(fields.increment) : 5;
    if (!name || !Number.isInteger(sets) || sets < 1 || sets > 10 || !targetReps) {
      this.showToast('Enter a valid name, 1–10 sets, and a target rep range.');
      return false;
    }

    const nextRoutine = JSON.parse(JSON.stringify(this.routine));
    const day = nextRoutine.find(d => d.id === dayId);
    if (!day) return false;
    let ex = exId ? day.exercises.find(e => e.id === exId) : null;
    const isNew = !ex;
    if (!ex) {
      ex = {
        id: `${dayId}_custom_${Date.now().toString(36)}`,
        name,
        muscle: fields.muscle || 'Chest',
        sets,
        targetReps,
        startingWeight: '',
        rest: this.formatRest(restSeconds),
        restSeconds,
        notes: String(fields.notes || '').trim(),
        videoUrl: '',
        isOptional: Boolean(fields.isOptional),
        superset: null,
        increment,
        needsBaseline: !this.getPreviousExercisePerformance(name)
      };
      day.exercises.push(ex);
    } else {
      const oldName = ex.name;
      Object.assign(ex, {
        name,
        muscle: fields.muscle || ex.muscle,
        sets,
        targetReps,
        restSeconds,
        rest: this.formatRest(restSeconds),
        increment,
        isOptional: Boolean(fields.isOptional),
        notes: String(fields.notes || '').trim()
      });
      if (oldName !== name) {
        ex.needsBaseline = !this.getPreviousExercisePerformance(name);
      }
    }

    // Update superset pairing if changed
    const oldSupersetId = ex.superset?.id;
    const partnerId = fields.partnerId || '';
    if (oldSupersetId) {
      const remainingSame = day.exercises.filter(e => e.id !== ex.id && e.superset?.id === oldSupersetId);
      if (remainingSame.length === 1 && partnerId !== remainingSame[0].id) {
        remainingSame[0].superset = null;
      }
    }
    if (partnerId && partnerId !== ex.id) {
      const partner = day.exercises.find(e => e.id === partnerId);
      if (partner) {
        if (partner.superset?.id && partner.superset.id !== oldSupersetId) {
          day.exercises.forEach(e => {
            if (e.id !== partner.id && e.superset?.id === partner.superset.id) e.superset = null;
          });
        }
        const ssId = oldSupersetId || `ss_${dayId}_${Date.now().toString(36)}`;
        const ssRest = Number(fields.supersetRestSeconds) || 60;
        const pos = day.exercises.findIndex(e => e.id === ex.id) + 1;
        const tip = `Alternate ${ex.name} and ${partner.name}. Rest ${ssRest} seconds after each set.`;
        ex.superset = { id: ssId, tag: `${pos}A`, name: `${ex.name} + ${partner.name}`, tip, rest: `${ssRest} sec`, restSeconds: ssRest };
        partner.superset = { id: ssId, tag: `${pos}B`, name: `${ex.name} + ${partner.name}`, tip, rest: `${ssRest} sec`, restSeconds: ssRest };
      }
    } else {
      ex.superset = null;
    }

    const writes = new Map([
      [this.storageKeys.routine, JSON.stringify(nextRoutine)],
      [this.storageKeys.routineRev, this.CURRENT_ROUTINE_REV]
    ]);
    const syncedSession = this.syncRoutineSessionForDay(nextRoutine, dayId, writes, localStorage);
    try {
      this.writeStorageTransaction(writes);
    } catch (_) {
      this.showToast('Could not save routine changes. Device storage may be full.');
      return false;
    }
    this.routine = nextRoutine;
    if (syncedSession && this.session?.dayId === dayId) this.session = syncedSession;
    this.showToast(isNew ? `Added "${name}" to ${day.title}.` : `Updated "${name}".`);
    if (this.activeView === 'routine') this.renderRoutineEditor();
    if (this.activeView === 'workout') this.render();
    return true;
  },

  moveRoutineExercise(dayId, exId, direction) {
    const nextRoutine = JSON.parse(JSON.stringify(this.routine));
    const day = nextRoutine.find(d => d.id === dayId);
    if (!day) return false;
    const idx = day.exercises.findIndex(e => e.id === exId);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= day.exercises.length) return false;
    const [moved] = day.exercises.splice(idx, 1);
    day.exercises.splice(targetIdx, 0, moved);

    const writes = new Map([
      [this.storageKeys.routine, JSON.stringify(nextRoutine)],
      [this.storageKeys.routineRev, this.CURRENT_ROUTINE_REV]
    ]);
    let updatedSession = null;
    if (this.session?.dayId === dayId && this.session.initialLogs && !this.hasSessionProgress(this.session)) {
      const staged = Object.assign(Object.create(this), { routine: nextRoutine });
      updatedSession = staged.initNewSession(nextRoutine.findIndex(d => d.id === dayId));
      writes.set(this.getSessionKey(dayId), JSON.stringify(updatedSession));
    }
    try {
      this.writeStorageTransaction(writes);
    } catch (_) {
      this.showToast('Could not reorder exercise.');
      return false;
    }
    this.routine = nextRoutine;
    if (updatedSession) this.session = updatedSession;
    if (this.activeView === 'routine') this.renderRoutineEditor();
    return true;
  },

  deleteRoutineExercise(dayId, exId, { skipConfirm = false } = {}) {
    const day = this.routine.find(d => d.id === dayId);
    const target = day?.exercises.find(e => e.id === exId);
    if (!day || !target || day.exercises.length <= 1) {
      this.showToast('Each workout day needs at least one exercise.');
      return false;
    }
    if (!skipConfirm && typeof this.showConfirmDialog === 'function') {
      this.showConfirmDialog({
        title: 'Remove exercise?',
        message: `Remove "${target.name}" from ${day.title}? Completed history is preserved.`,
        confirmLabel: 'Remove exercise',
        cancelLabel: 'Keep exercise',
        danger: true,
        onConfirm: () => this.deleteRoutineExercise(dayId, exId, { skipConfirm: true })
      });
      return false;
    }

    const nextRoutine = JSON.parse(JSON.stringify(this.routine));
    const nextDay = nextRoutine.find(d => d.id === dayId);
    const removed = nextDay.exercises.find(e => e.id === exId);
    nextDay.exercises = nextDay.exercises.filter(e => e.id !== exId);
    if (removed?.superset?.id) {
      const peers = nextDay.exercises.filter(e => e.superset?.id === removed.superset.id);
      if (peers.length === 1) peers[0].superset = null;
    }
    const writes = new Map([
      [this.storageKeys.routine, JSON.stringify(nextRoutine)],
      [this.storageKeys.routineRev, this.CURRENT_ROUTINE_REV]
    ]);
    const syncedSession = this.syncRoutineSessionForDay(nextRoutine, dayId, writes, localStorage);
    try {
      this.writeStorageTransaction(writes);
    } catch (_) {
      this.showToast('Could not remove exercise.');
      return false;
    }
    this.routine = nextRoutine;
    if (syncedSession && this.session?.dayId === dayId) this.session = syncedSession;
    this.showToast(`Removed "${target.name}".`);
    if (this.activeView === 'routine') this.renderRoutineEditor();
    if (this.activeView === 'workout') this.render();
    return true;
  },

  openOneTimeBuilderModal() {
    if (!this.summaryContentEl) return;
    const todayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
    const permanentDays = this.routine.filter(day => !day.oneTime);
    const titleEl = document.getElementById('summaryModalTitle');
    if (titleEl) titleEl.textContent = 'Create one-time workout';
    this.summaryContentEl.innerHTML = `
      <form id="oneTimeBuilderForm" class="routine-editor-form">
        <div class="form-group">
          <label for="oneTimeTitleInput">Workout title</label>
          <input type="text" id="oneTimeTitleInput" class="form-control" value="${this.escapeHtml(`${todayName} - Custom Workout (One-Time)`)}" required autofocus>
        </div>
        <div class="form-group">
          <span class="insight-field-label">Replaces scheduled days this week (optional)</span>
          <div class="onetime-check-grid">
            ${permanentDays.map(day => `<label class="restore-settings-choice"><input type="checkbox" name="replaceDay" value="${this.escapeHtml(day.id)}"> ${this.escapeHtml(day.title)}</label>`).join('')}
          </div>
        </div>
        <div class="form-group">
          <span class="insight-field-label">Select exercises</span>
          <div class="onetime-exercise-picker">
            ${permanentDays.map(day => `<fieldset class="onetime-day-group"><legend>${this.escapeHtml(day.title)}</legend>
              ${day.exercises.map(ex => `<label class="restore-settings-choice"><input type="checkbox" name="pickExercise" value="${this.escapeHtml(ex.id)}"> <span>${this.escapeHtml(ex.name)} <small>(${ex.sets} × ${this.escapeHtml(ex.targetReps)})</small></span></label>`).join('')}
            </fieldset>`).join('')}
          </div>
        </div>
        <div class="insight-actions">
          <button type="button" class="secondary-btn" id="cancelOneTimeBtn">Cancel</button>
          <button type="submit" class="primary-btn">Create workout</button>
        </div>
      </form>`;
    this.openModal(this.summaryModalEl);
    document.getElementById('cancelOneTimeBtn')?.addEventListener('click', () => this.closeModal(this.summaryModalEl));
    document.getElementById('oneTimeBuilderForm')?.addEventListener('submit', e => {
      e.preventDefault();
      const title = document.getElementById('oneTimeTitleInput').value.trim();
      const replacesDayIds = Array.from(this.summaryContentEl.querySelectorAll('input[name="replaceDay"]:checked'), el => el.value);
      const pickedIds = Array.from(this.summaryContentEl.querySelectorAll('input[name="pickExercise"]:checked'), el => el.value);
      const exercises = pickedIds.map(id => this.findExerciseById(id)).filter(Boolean);
      if (!title || !exercises.length) {
        this.showToast('Enter a title and choose at least one exercise.');
        return;
      }
      if (this.createCustomOneTimeWorkout({ title, replacesDayIds, exercises })) {
        this.closeModal(this.summaryModalEl);
        document.querySelector('[data-view="workout"]')?.click();
      }
    });
  },

  createCustomOneTimeWorkout({ title, replacesDayIds = [], exercises = [] }) {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle || !Array.isArray(exercises) || !exercises.length) return false;
    const oneTimeId = `onetime_${Date.now().toString(36)}`;
    const dayExercises = exercises.map((source, idx) => {
      const copy = JSON.parse(JSON.stringify(source));
      copy.sourceExerciseId = source.id;
      copy.id = `${oneTimeId}_ex${idx + 1}`;
      copy.superset = null;
      copy.isOptional = Boolean(source.isOptional);
      return copy;
    });
    const oneTimeDay = {
      id: oneTimeId,
      title: cleanTitle,
      tag: 'One-Time',
      oneTime: true,
      replacesDayIds: [...replacesDayIds],
      exercises: dayExercises
    };
    const nextRoutine = [...JSON.parse(JSON.stringify(this.routine)), oneTimeDay];
    const nextDayIndex = nextRoutine.length - 1;
    const staged = Object.assign(Object.create(this), { routine: nextRoutine });
    const nextSession = staged.initNewSession(nextDayIndex);
    const writes = new Map([
      [this.storageKeys.routine, JSON.stringify(nextRoutine)],
      [this.storageKeys.routineRev, this.CURRENT_ROUTINE_REV],
      [this.getSessionKey(oneTimeId), JSON.stringify(nextSession)],
      ['gym_last_active_day_v1', oneTimeId]
    ]);
    try {
      this.writeStorageTransaction(writes);
    } catch (_) {
      this.showToast('Could not create one-time workout.');
      return false;
    }
    this.routine = nextRoutine;
    this.activeDayIndex = nextDayIndex;
    this.session = nextSession;
    this.selectionLocalDate = this.getLocalDateKey(new Date());
    this.focusedExerciseId = null;
    this.pendingRir = null;
    this.editingCompletedSet = null;
    this.editingCompletedWarmup = null;
    this.render();
    if (this.activeView === 'routine') this.renderRoutineEditor();
    this.showToast(`Created "${cleanTitle}".`);
    return true;
  },

  dismissOneTimeWorkout(dayId) {
    const day = this.routine.find(d => d.id === dayId);
    if (!day?.oneTime) return false;
    const nextRoutine = this.routine.filter(d => d.id !== dayId);
    if (!nextRoutine.length) return false;

    const writes = new Map([
      [this.storageKeys.routine, JSON.stringify(nextRoutine)],
      [this.storageKeys.routineRev, this.CURRENT_ROUTINE_REV],
      [`gym_onetime_done_${dayId}`, '1'],
      [this.getSessionKey(dayId), null]
    ]);
    let activeOneTimeSession = this.session?.dayId === dayId ? this.session : null;
    if (!activeOneTimeSession) {
      try {
        const raw = localStorage.getItem(this.getSessionKey(dayId));
        if (raw) activeOneTimeSession = JSON.parse(raw);
      } catch (_) {}
    }
    if (activeOneTimeSession && this.hasSessionProgress(activeOneTimeSession)) {
      this.retainSavedDraft(activeOneTimeSession, writes);
    }
    const staged = Object.assign(Object.create(this), { routine: nextRoutine });
    const nextDayIndex = staged.getResumeDayIndex();
    const nextDay = nextRoutine[nextDayIndex] || nextRoutine[0];
    writes.set('gym_last_active_day_v1', nextDay.id);
    try {
      this.writeStorageTransaction(writes);
    } catch (_) {
      this.showToast('Could not dismiss one-time workout. Storage unchanged.');
      return false;
    }
    if (this.session?.dayId === dayId) this.stopTimer();
    this.routine = nextRoutine;
    this.activeDayIndex = nextDayIndex;
    this.session = this.loadSession(nextDayIndex);
    this.selectionLocalDate = this.getLocalDateKey(new Date());
    this.focusedExerciseId = null;
    this.pendingRir = null;
    this.editingCompletedSet = null;
    this.editingCompletedWarmup = null;
    this.render();
    if (this.activeView === 'routine') this.renderRoutineEditor();
    this.showToast(`Dismissed "${day.title}".`);
    return true;
  },

  async forceAppUpdate() {
    this.saveCurrentSession();
    try {
      if (window.workoutUpdates) {
        await window.workoutUpdates.check();
        if (await window.workoutUpdates.apply()) return;
      }
      this.showToast('App is up to date');
    } catch (e) {
      console.error(e);
      this.showToast('Could not check for updates. Your workout is saved.');
    }
  },

  resetRoutine({ skipConfirm = false } = {}) {
    if (!skipConfirm && typeof this.showConfirmDialog === 'function') {
      this.showConfirmDialog({
        title: 'Reset to original program?',
        message: 'Restore the original 5-day exercises, sets, and rep ranges. Any active unfinished workout will be saved under Recovery drafts, and your history is kept.',
        confirmLabel: 'Reset program',
        cancelLabel: 'Keep current program',
        danger: true,
        onConfirm: () => this.resetRoutine({ skipConfirm: true })
      });
      return false;
    }

    const nextRoutine = JSON.parse(JSON.stringify(DEFAULT_ROUTINE));
    const writes = new Map([
      [this.storageKeys.routine, JSON.stringify(nextRoutine)],
      [this.storageKeys.routineRev, this.CURRENT_ROUTINE_REV]
    ]);
    if (this.session && this.hasSessionProgress(this.session)) {
      this.retainSavedDraft(this.session, writes);
    }
    const nextDayIndex = Math.min(Math.max(0, this.activeDayIndex || 0), nextRoutine.length - 1);
    const staged = Object.assign(Object.create(this), { routine: nextRoutine });
    const nextSession = staged.initNewSession(nextDayIndex);
    writes.set(this.getSessionKey(nextSession.dayId), JSON.stringify(nextSession));
    writes.set('gym_last_active_day_v1', nextSession.dayId);
    try {
      this.writeStorageTransaction(writes);
    } catch (_) {
      this.showToast('Could not reset the program. Your current program and workouts are unchanged.');
      return false;
    }
    this.stopTimer();
    this.routine = nextRoutine;
    this.activeDayIndex = nextDayIndex;
    this.session = nextSession;
    this.selectionLocalDate = this.getLocalDateKey(new Date());
    this.pendingRir = null;
    this.editingCompletedSet = null;
    this.editingCompletedWarmup = null;
    this.focusedExerciseId = null;
    this.render();
    if (this.activeView === 'routine') this.renderRoutineEditor();
    this.showToast('Program restored to defaults.');
    return true;
  }
});
