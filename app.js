// Core controller & bootstrap for Machine Master Workout Tracker.
const APP_BUILD_VERSION = 'Build v41';

class WorkoutApp {
  constructor() {
    this.storageKeys = {
      routine: 'gym_routine_v4',
      history: 'gym_history_v1',
      machineSettings: 'gym_machine_settings_v1',
      equipmentSettings: 'gym_equipment_settings_v1',
      exerciseNotes: 'gym_exercise_notes_v1',
      deloadActive: 'gym_deload_active',
      deloadStartDate: 'gym_deload_start_date',
      lastBackupTime: 'gym_last_backup_time',
      currentSessionPrefix: 'gym_session_',
      legacyCurrentSession: 'gym_current_session_v4',
      lastWeights: 'gym_last_weights_v1',
      timerTargetEnd: 'gym_timer_target_end_v1',
      timerTotalDuration: 'gym_timer_total_duration_v1',
      wakeLockEnabled: 'gym_wake_lock_enabled',
      routineRev: 'gym_routine_rev',
      exercisePreferences: 'gym_exercise_preferences_v1'
    };

    this.history = this.loadHistory();
    this.lastWeights = this.loadLastWeights();
    this.machineSettings = this.loadMachineSettings();
    this.equipmentSettings = this.loadEquipmentSettings();
    this.exerciseNotes = this.loadExerciseNotes();
    this.exercisePreferences = this.loadExercisePreferences();
    this.deloadActive = localStorage.getItem(this.storageKeys.deloadActive) === 'true';
    this.deloadStartDate = parseInt(localStorage.getItem(this.storageKeys.deloadStartDate) || '0', 10);
    this.checkDeloadExpiry();
    this.initStoragePersistence();

    this.routine = this.loadRoutine();
    this.activeDayIndex = this.getResumeDayIndex();
    this.selectionLocalDate = this.getLocalDateKey(new Date());

    this.audioCtx = null;
    this.wakeLock = null;
    this.wakeLockEnabled = localStorage.getItem(this.storageKeys.wakeLockEnabled) !== 'false';
    this.activeView = 'workout';

    this.timer = {
      totalDuration: 120,
      remaining: 0,
      targetEndTime: 0,
      intervalId: null,
      active: false,
      source: null
    };

    this.session = this.loadSession();
    this.selectedProgressExercise = null;
    this.earlierWorkoutsLimit = 15;

    this.initElements();
    this.bindEvents();

    document.addEventListener('visibilitychange', () => {
      this.syncTimerFromBackground();
      if (document.visibilityState === 'visible') this.refreshWorkoutSelectionForDate();
      if (document.visibilityState === 'visible' && this.wakeLockEnabled && this.activeView === 'workout') {
        this.requestWakeLock();
      }
    });
    window.addEventListener('pageshow', () => {
      this.syncTimerFromBackground();
      this.refreshWorkoutSelectionForDate();
      if (this.wakeLockEnabled && this.activeView === 'workout') {
        this.requestWakeLock();
      }
    });
    window.addEventListener('focus', () => {
      this.syncTimerFromBackground();
      this.refreshWorkoutSelectionForDate();
      if (this.wakeLockEnabled && this.activeView === 'workout') {
        this.requestWakeLock();
      }
    });

    this.restoreActiveTimer();
    this.render();
    this.showSessionResumePrompt();
    if (this.equipmentRepairFailed) {
      this.showToast('Could not update the routine defaults. Your saved workouts are unchanged; free some device storage and check for an update again.');
    }
    this.requestWakeLock();
  }

  initElements() {
    this.daySelectorEl = document.getElementById('daySelector');
    this.sessionInfoEl = document.getElementById('sessionInfo');
    this.exerciseListEl = document.getElementById('exerciseList');
    this.timerDockEl = document.getElementById('timerDock');
    this.timerDisplayEl = document.getElementById('timerDisplay');
    this.timerProgressBarEl = document.getElementById('timerProgressBar');

    this.summaryModalEl = document.getElementById('summaryModal');
    this.summaryContentEl = document.getElementById('summaryContent');
    this.analyticsContentEl = document.getElementById('analyticsContent');
    this.routineEditorEl = document.getElementById('routineEditor');

    this.swapModalEl = document.getElementById('swapModal');
    this.swapContentEl = document.getElementById('swapContent');
    this.swapModalTitleEl = document.getElementById('swapModalTitle');
    this.quickHistoryModalEl = document.getElementById('quickHistoryModal');
    this.quickHistoryContentEl = document.getElementById('quickHistoryContent');
    this.quickHistoryTitleEl = document.getElementById('quickHistoryTitle');
  }

  bindEvents() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => {
          b.classList.remove('active');
          b.removeAttribute('aria-current');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
        this.switchMainView(btn.dataset.view);
      });
    });

    document.getElementById('finishWorkoutBtn')?.addEventListener('click', () => this.showWorkoutSummary());
    document.getElementById('timerSkipBtn')?.addEventListener('click', () => this.skipTimer());
    document.getElementById('timerPlus30Btn')?.addEventListener('click', () => this.adjustTimer(30));
    document.getElementById('timerMinus30Btn')?.addEventListener('click', () => this.adjustTimer(-30));

    document.querySelectorAll('.close-modal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('dialog, .modal-backdrop');
        if (modal) this.closeModal(modal);
        this.refreshWorkoutSelectionForDate();
      });
    });

    const fileInput = document.getElementById('importFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', e => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = event => {
          this.previewBackupImport(event.target.result);
          fileInput.value = '';
        };
        reader.readAsText(file);
      });
    }

    document.getElementById('nowLiftingJumpBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      this.jumpToActiveExercise();
    });
    document.getElementById('nowLiftingDock')?.addEventListener('click', () => {
      this.jumpToActiveExercise();
    });
  }

  openModal(modalEl) {
    if (!modalEl) return;
    if (typeof modalEl.showModal === 'function') {
      if (!modalEl.open) modalEl.showModal();
    } else {
      modalEl.classList?.add('open');
    }
  }

  closeModal(modalEl) {
    if (!modalEl) return;
    if (typeof modalEl.close === 'function') {
      if (modalEl.open) modalEl.close();
    } else {
      modalEl.classList?.remove('open');
    }
  }

  hasOpenModal() {
    return Boolean(document.querySelector?.('dialog[open], .modal-backdrop.open'));
  }

  showConfirmDialog({ title = 'Confirm action', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, onConfirm } = {}) {
    if (!this.summaryContentEl || !this.summaryModalEl) return false;
    const titleEl = document.getElementById('summaryModalTitle');
    if (titleEl) titleEl.textContent = title;
    this.summaryContentEl.innerHTML = `
      <p>${this.escapeHtml(message)}</p>
      <div class="insight-actions">
        <button type="button" class="secondary-btn" id="confirmDialogCancelBtn" autofocus>${this.escapeHtml(cancelLabel)}</button>
        <button type="button" class="${danger ? 'secondary-btn insight-danger' : 'primary-btn'}" id="confirmDialogAcceptBtn">${this.escapeHtml(confirmLabel)}</button>
      </div>`;
    this.openModal(this.summaryModalEl);
    document.getElementById('confirmDialogCancelBtn')?.addEventListener('click', () => this.closeModal(this.summaryModalEl));
    document.getElementById('confirmDialogAcceptBtn')?.addEventListener('click', () => {
      this.closeModal(this.summaryModalEl);
      if (typeof onConfirm === 'function') onConfirm();
    });
    return true;
  }

  switchMainView(view) {
    this.activeView = view;
    const workoutView = document.getElementById('workoutView');
    const analyticsView = document.getElementById('analyticsView');
    const routineView = document.getElementById('routineView');
    const hud = document.getElementById('nowLiftingDock');

    const titles = {
      workout: 'Workout | Machine Master',
      analytics: 'Progress | Machine Master',
      routine: 'Routine | Machine Master'
    };
    if (typeof document !== 'undefined' && titles[view]) document.title = titles[view];

    if (view === 'workout') {
      if (workoutView) workoutView.style.display = 'block';
      if (analyticsView) analyticsView.style.display = 'none';
      if (routineView) routineView.style.display = 'none';
      if (this.wakeLockEnabled) this.requestWakeLock();
      this.renderWorkout();
      this.updateNowLiftingHUD();
    } else {
      if (hud) hud.hidden = true;
      this.stopElapsedClock?.();
      this._activeSetObserver?.disconnect();
      if (view === 'analytics') {
        if (workoutView) workoutView.style.display = 'none';
        if (analyticsView) analyticsView.style.display = 'block';
        if (routineView) routineView.style.display = 'none';
        this.releaseWakeLock();
        this.renderAnalytics();
      } else if (view === 'routine') {
        if (workoutView) workoutView.style.display = 'none';
        if (analyticsView) analyticsView.style.display = 'none';
        if (routineView) routineView.style.display = 'block';
        this.releaseWakeLock();
        this.renderRoutineEditor();
      }
    }
  }

  render() {
    this.renderDaySelector();
    this.renderWorkout();
  }

  selectDefaultWorkout(now = new Date()) {
    this.activeDayIndex = this.getResumeDayIndex(now);
    this.session = this.loadSession();
    this.selectionLocalDate = this.getLocalDateKey(now);
    this.focusedExerciseId = null;
    this.pendingRir = null;
    this.editingCompletedSet = null;
    this.editingCompletedWarmup = null;
    this.render();
  }

  refreshWorkoutSelectionForDate(now = new Date()) {
    if (document.visibilityState === 'hidden' || this.selectionLocalDate === this.getLocalDateKey(now)) return false;
    if (this.hasOpenModal()) return false;
    try { this.saveCurrentSession(); }
    catch (_) { this.showToast('Could not save your current workout. Try again before changing days.'); return false; }
    this.selectDefaultWorkout(now);
    this.showSessionResumePrompt();
    return true;
  }

  checkDeloadExpiry() {
    if (this.deloadActive && this.deloadStartDate > 0) {
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - this.deloadStartDate > oneWeekMs) {
        this.deloadActive = false;
        localStorage.setItem(this.storageKeys.deloadActive, 'false');
      }
    }
  }

  getDeloadDaysLeft() {
    if (!this.deloadActive || !this.deloadStartDate) return 7;
    const elapsedDays = Math.floor((Date.now() - this.deloadStartDate) / (24 * 60 * 60 * 1000));
    return Math.max(1, 7 - elapsedDays);
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  announceStatus(message, priority = 'polite') {
    const text = String(message ?? '').trim();
    if (!text || typeof document === 'undefined') return;
    if (typeof document.ariaNotify === 'function') {
      try {
        document.ariaNotify(text, { priority: priority === 'assertive' ? 'high' : 'normal' });
        return;
      } catch (_) {}
    }
    const el = document.getElementById?.(priority === 'assertive' ? 'alertAnnouncer' : 'statusAnnouncer');
    if (el) {
      el.textContent = '';
      el.textContent = text;
    }
  }

  showToast(message) {
    const text = String(message ?? '');
    this.announceStatus(text, 'polite');
    if (typeof document === 'undefined' || typeof document.createElement !== 'function' || !document.body) return;
    const existing = document.querySelector?.('.app-toast');
    if (existing) existing.remove?.();

    const toast = document.createElement('div');
    toast.className = 'app-toast show';
    const supportsPopover = typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover');
    if (supportsPopover) toast.setAttribute('popover', 'manual');

    const msgSpan = document.createElement('span');
    msgSpan.className = 'app-toast-text';
    msgSpan.textContent = text;
    toast.appendChild(msgSpan);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'app-toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.textContent = '×';
    toast.appendChild(closeBtn);

    document.body.appendChild(toast);
    if (supportsPopover) {
      try { toast.showPopover?.(); } catch (_) {}
    }

    let timerId = null;
    const dismiss = () => {
      if (timerId) clearTimeout(timerId);
      toast.classList.remove('show');
      setTimeout(() => {
        try { toast.hidePopover?.(); } catch (_) {}
        toast.remove?.();
      }, 300);
    };
    closeBtn.addEventListener('click', dismiss);
    const scheduleDismiss = () => {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(() => {
        if (toast.contains(document.activeElement)) return;
        dismiss();
      }, 3200);
    };
    toast.addEventListener('focusout', () => {
      if (!toast.contains(document.activeElement)) scheduleDismiss();
    });
    scheduleDismiss();
  }

  markSessionInteraction() {
    if (this.session) this.session.lastInteractionAt = new Date().toISOString();
  }

  initNewSession(dayIndex) {
    const day = this.routine[dayIndex] || this.routine[0];
    const session = {
      id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      dayId: day.id,
      dayTitle: day.title,
      startTime: null,
      lastInteractionAt: null,
      createdAt: new Date().toISOString(),
      logs: {},
      warmups: {},
      exerciseOrder: day.exercises.map(ex => ex.id),
      swaps: {},
      disabledSupersets: {},
      deload: Boolean(this.deloadActive)
    };

    const targets = Object.assign(Object.create(this), { session });
    day.exercises.forEach(ex => {
      const effectiveName = ex.name;
      const targetSetsCount = this.deloadActive ? Math.max(2, Math.floor(ex.sets * 0.67)) : ex.sets;
      session.logs[ex.id] = [];
      for (let i = 1; i <= targetSetsCount; i++) {
        const target = targets.getSetTarget(ex, i - 1, effectiveName);
        session.logs[ex.id].push({
          setNum: i,
          weight: target.targetWeight,
          reps: target.targetReps,
          completed: false,
          rir: null,
          exerciseName: effectiveName,
          muscle: ex.muscle,
          targetReps: ex.targetReps,
          needsBaseline: Boolean(target.needsBaseline)
        });
      }
    });

    session.initialLogs = JSON.parse(JSON.stringify(session.logs));
    if (day.id === 'mon__lower_b') session.mondayRevision = 1;
    return session;
  }

  saveSessionFlowChange(change, startWorkout = true, saveRoutine = false) {
    const before = JSON.parse(JSON.stringify(this.session));
    const beforeRoutine = saveRoutine ? JSON.parse(JSON.stringify(this.routine)) : null;
    try {
      change();
      if (startWorkout) this.session.startTime ||= new Date().toISOString();
      this.markSessionInteraction();
      if (this.session.dayId) {
        this.session.id ||= `s_${this.session.dayId}_${Date.now()}`;
        this.session.updatedAt = new Date().toISOString();
        const writes = new Map([
          [this.getSessionKey(this.session.dayId), JSON.stringify(this.session)],
          ['gym_last_active_day_v1', this.session.dayId]
        ]);
        if (saveRoutine) writes.set(this.storageKeys.routine, JSON.stringify(this.routine));
        this.writeStorageTransaction(writes);
      } else this.saveCurrentSession();
      return true;
    } catch (_) {
      this.session = before;
      if (beforeRoutine) this.routine = beforeRoutine;
      this.showToast('Could not save this change. Your saved workout is unchanged. Free some device storage and try again.');
      return false;
    }
  }

  startNewSession(expectedId = this.session?.id) {
    if (expectedId !== this.session?.id) return false;
    const writes = new Map();
    if (this.hasSessionProgress(this.session)) {
      this.retainSavedDraft(this.session, writes);
    }
    const next = this.initNewSession(this.activeDayIndex);
    writes.set(this.getSessionKey(next.dayId), JSON.stringify(next));
    writes.set('gym_last_active_day_v1', next.dayId);
    try { this.writeStorageTransaction(writes); }
    catch (_) { this.showToast('Could not save a new workout. Your current workout is still open.'); return false; }
    this.stopTimer();
    this.stopElapsedClock?.();
    this.session = next;
    this.pendingRir = null;
    this.editingCompletedSet = null;
    this.editingCompletedWarmup = null;
    this.focusedExerciseId = null;
    this.selectionLocalDate = this.getLocalDateKey(new Date());
    this.closeModal(this.summaryModalEl);
    this.renderWorkout();
    return true;
  }

  restoreSavedDraft(draftId) {
    const entry = this.getSavedDrafts().find(item => item.recoveryId === draftId);
    if (!entry) return false;
    const draft = JSON.parse(JSON.stringify(entry.session));
    const dayIndex = this.routine.findIndex(day => day.id === draft.dayId);
    if (dayIndex < 0) { this.showToast('Restore this draft’s program before resuming it.'); return false; }
    if (this.history.some(record => (record.sessionId || record.sessionSnapshot?.id) === draft.id)) {
      this.showToast('This workout is already saved. Reopen it from Progress.'); return false;
    }
    const writes = new Map();
    const current = this.session?.dayId === draft.dayId ? this.session : this.loadSession(dayIndex);
    if (this.hasSessionProgress(current) && this.draftFingerprint(current) !== this.draftFingerprint(draft)) this.retainSavedDraft(current, writes);
    draft.lastInteractionAt = new Date().toISOString();
    this.reconcileMondaySession(draft, this.routine[dayIndex], { preserve: true });
    this.normalizeSessionFlow(draft, this.routine[dayIndex]);
    writes.set(this.getSessionKey(draft.dayId), JSON.stringify(draft));
    writes.set('gym_last_active_day_v1', draft.dayId);
    writes.set(`gym_saved_draft_${draftId}`, null);
    if (this.session && this.session.dayId !== draft.dayId) writes.set(this.getSessionKey(this.session.dayId), JSON.stringify(this.session));
    const remaining = this.getSavedDrafts(draft.dayId, this.storageOverlay(writes));
    writes.set(`gym_saved_draft_for_${draft.dayId}`, remaining[0]?.recoveryId || null);
    try { this.writeStorageTransaction(writes); }
    catch (_) { this.showToast('Could not restore the draft. Both workouts are still saved.'); return false; }
    this.stopTimer();
    this.activeDayIndex = dayIndex;
    this.session = draft;
    this.selectionLocalDate = this.getLocalDateKey(new Date());
    this.pendingRir = null; this.editingCompletedSet = null; this.editingCompletedWarmup = null;
    this.focusedExerciseId = null;
    this.closeModal(this.summaryModalEl);
    this.render();
    return true;
  }

  deferExercise(exId) {
    const target = this.getDeferTargetGroup(exId);
    if (!target) return false;
    const groups = this.getExerciseGroups();
    const current = groups.find(group => group.some(ex => ex.id === exId));
    const firstUnfinished = groups.findIndex(group => this.isExerciseGroupUnfinished(group));
    const targetIds = new Set(target.map(ex => ex.id));
    const currentIds = new Set(current.map(ex => ex.id));
    const remaining = groups.slice(firstUnfinished).filter(group =>
      !group.some(ex => targetIds.has(ex.id) || currentIds.has(ex.id)));
    if (!this.saveSessionFlowChange(() => {
      this.session.exerciseOrder = [...groups.slice(0, firstUnfinished), target, current, ...remaining].flat().map(ex => ex.id);
    }, false)) return false;
    this.pendingRir = null;
    this.editingCompletedSet = null;
    this.editingCompletedWarmup = null;
    this.focusedExerciseId = target[0].id;
    this.renderWorkout();
    this.updateNowLiftingHUD();
    this.jumpToActiveExercise();
    this.showToast(`Switch to ${target.map(ex => this.getEffectiveExerciseName(ex.id, ex)).join(' + ')}. This exercise is next afterward.`);
    return true;
  }

  setSetRIR(exId, setIdx, rirVal) {
    const list = this.session && this.session.logs && this.session.logs[exId];
    if (!list || !list[setIdx]) return;
    const nextRir = (list[setIdx].rir === rirVal) ? null : rirVal;
    if (nextRir === list[setIdx].rir && list[setIdx].rirAnswered) return;
    if (!this.saveSessionFlowChange(() => {
      list[setIdx].rir = nextRir;
      list[setIdx].rirAnswered = true;
    }, false)) return;
    if (this.pendingRir?.exId === exId && this.pendingRir?.setIdx === setIdx) {
      this.pendingRir = null;
    }
    this.renderWorkout();
  }

  setSetSkipped(exId, setIdx, skipped, type = 'working') {
    const set = (type === 'warmup' ? this.session?.warmups : this.session?.logs)?.[exId]?.[setIdx];
    if (!set || set.completed || Boolean(set.skipped) === skipped) return false;
    if (!this.saveSessionFlowChange(() => {
      if (skipped) set.skipped = true;
      else delete set.skipped;
    }, false)) return false;
    this.afterSkipChange(skipped ? null : { exId, setIdx, type });
    return true;
  }

  setExerciseSkipped(exId, skipped) {
    const sets = [...(this.session?.logs?.[exId] || []), ...this.getWarmupSets(exId)];
    const affected = sets.filter(set => !set.completed && Boolean(set.skipped) !== skipped);
    if (!affected.length) return false;
    if (!this.saveSessionFlowChange(() => affected.forEach(set => {
      if (skipped) set.skipped = true;
      else delete set.skipped;
    }), false)) return false;
    this.afterSkipChange();
    return true;
  }

  afterSkipChange(restored = null) {
    this.editingCompletedSet = null;
    this.editingCompletedWarmup = null;
    this.focusedExerciseId = restored?.exId || null;
    this.renderWorkout();
    this.updateNowLiftingHUD();
    if (restored) this.revealWorkoutSet(restored.exId, restored.setIdx, true, false, restored.type);
    else this.jumpToActiveExercise({ automatic: true });
  }

  bumpExerciseWeight(exId, delta = 5) {
    const list = this.session && this.session.logs && this.session.logs[exId];
    if (!list) return false;
    const pendingIndices = list.map((set, idx) => this.isSetPending(set) ? idx : -1).filter(idx => idx >= 0);
    if (!pendingIndices.length) return false;
    const nextWeights = new Map(pendingIndices.map(idx => [idx, Math.max(0, (parseFloat(list[idx].weight) || 0) + delta)]));
    if (!pendingIndices.some(idx => list[idx].weight !== nextWeights.get(idx))) return false;
    if (!this.saveSessionFlowChange(() => {
      pendingIndices.forEach(idx => {
        list[idx].weight = nextWeights.get(idx);
        list[idx].needsBaseline = false;
      });
    })) return false;
    this.renderWorkout();
    return true;
  }

  updateSetWeight(exId, setIdx, newWeight) {
    const list = this.session && this.session.logs && this.session.logs[exId];
    if (!list || !list[setIdx]) return;
    const blank = newWeight === null || String(newWeight).trim() === '';
    const parsed = blank ? NaN : Number(newWeight);
    const value = blank ? null : Number.isFinite(parsed) ? parsed : String(newWeight);
    const valid = Number.isFinite(value) && value >= 0;
    const affected = [setIdx];
    if (setIdx === 0 && valid) list.forEach((set, idx) => {
      if (idx > 0 && this.isSetPending(set) && (!set.exerciseName || !list[0].exerciseName || set.exerciseName === list[0].exerciseName)) affected.push(idx);
    });
    if (!affected.some(idx => list[idx].weight !== value || Boolean(list[idx].needsBaseline) !== !valid)) return;
    if (!this.saveSessionFlowChange(() => affected.forEach(idx => {
      list[idx].weight = value;
      list[idx].needsBaseline = !valid;
    }))) return;
    affected.forEach(idx => {
      const row = this.exerciseListEl?.querySelector?.(`.set-row[data-exid="${exId}"][data-setidx="${idx}"]`);
      if (!row) return;
      const input = row.querySelector('.set-weight-input');
      if (input && document.activeElement !== input) input.value = value === null ? '' : value;
      const button = row.querySelector('.set-check-btn');
      if (button) button.disabled = value === null && !list[idx].completed;
      const prompt = row.querySelector('.baseline-prompt');
      if (prompt) prompt.hidden = value !== null;
    });
    const warmup = this.exerciseListEl?.querySelector?.(`#card_${exId} .warmup-btn`);
    if (warmup) warmup.disabled = this.hasWarmupRamp(exId) || !this.getWarmupWorkingSet(exId);
    this.updateNowLiftingHUD();
  }

  updateSetReps(exId, setIdx, newReps) {
    const list = this.session && this.session.logs && this.session.logs[exId];
    if (!list || !list[setIdx]) return;
    const blank = newReps === null || String(newReps).trim() === '';
    const parsed = blank ? NaN : Number(newReps);
    const value = blank ? '' : Number.isFinite(parsed) ? parsed : String(newReps);
    if (list[setIdx].reps === value) return;
    if (!this.saveSessionFlowChange(() => { list[setIdx].reps = value; })) return;
    const input = this.exerciseListEl?.querySelector?.(`.set-reps-input[data-exid="${exId}"][data-setidx="${setIdx}"]`);
    if (input && document.activeElement !== input) input.value = list[setIdx].reps;
    this.updateNowLiftingHUD();
  }

  toggleSetCompletion(exId, setIdx, restStr) {
    const setObj = this.session.logs[exId] && this.session.logs[exId][setIdx];
    if (!setObj || setObj.skipped) return;
    const ex = this.findExerciseById(exId);
    const validationError = this.getSetValidationError(setObj);
    if (!setObj.completed && validationError) {
      this.showToast(validationError);
      return;
    }

    if (!this.saveSessionFlowChange(() => {
      setObj.completed = !setObj.completed;
      delete setObj.rirAnswered;
      if (setObj.completed) {
        const activeSwap = this.session.swaps?.[exId];
        setObj.exerciseName = setObj.exerciseName || this.getEffectiveExerciseName(exId, ex);
        setObj.muscle = setObj.muscle || activeSwap?.muscle || ex?.muscle;
        setObj.targetReps = setObj.targetReps || activeSwap?.targetReps || ex?.targetReps;
        setObj.completedAt = new Date().toISOString();
      } else {
        delete setObj.completedAt;
      }
    })) return;

    this.triggerHaptic([40]);

    if (setObj.completed) {
      this.primeAudioContext();

      // Keep effort visible when completing an exercise OR handing off in a superset.
      const list = this.session.logs[exId] || [];
      const nextAfter = this.getNextSet();
      const supersetHandoff = this.isSupersetEnabled(ex) && nextAfter?.ex?.id !== exId;
      if (list.length > 0 && (!list.some(s => this.isSetPending(s)) || supersetHandoff)) {
        this.pendingRir = { exId, setIdx };
      }

      const restSeconds = this.getRestSeconds(ex);
      this._pendingTimerSource = { exId, setIdx, type: 'working' };
      this.startTimer(restSeconds, this.isSupersetEnabled(ex) ? 0 : 120);
    } else {
      if (this.pendingRir?.exId === exId) this.pendingRir = null;
      if (this.timer?.active && this.timer.source?.type === 'working' && this.timer.source.exId === exId && this.timer.source.setIdx === setIdx) {
        this.stopTimer();
      }
    }

    this.renderWorkout();
    this.updateNowLiftingHUD();
  }

  addSetToExercise(exId) {
    const list = this.session.logs[exId];
    const ex = this.findExerciseById(exId);
    if (!list || !ex) return false;
    const activeSwap = this.session.swaps?.[exId];
    const effectiveName = this.getEffectiveExerciseName(exId, ex);
    const currentSets = list.filter(set => set.exerciseName === effectiveName ||
      (!set.exerciseName && !activeSwap && !ex.needsBaseline));
    const lastSet = currentSets[currentSets.length - 1];
    const lastLoadedSet = [...currentSets].reverse().find(set => !set.needsBaseline && Number.isFinite(set.weight));
    const target = this.getSetTarget(ex, currentSets.length, effectiveName);
    const weight = lastLoadedSet ? lastLoadedSet.weight : target.targetWeight;
    if (!this.saveSessionFlowChange(() => list.push({
      setNum: list.length + 1,
      weight,
      reps: lastSet ? lastSet.reps : target.targetReps,
      completed: false,
      rir: null,
      exerciseName: effectiveName,
      muscle: activeSwap?.muscle || ex.muscle,
      targetReps: activeSwap?.targetReps || ex.targetReps,
      needsBaseline: !Number.isFinite(weight)
    }), false)) return false;
    const detailsOpen = Boolean(this.exerciseListEl?.querySelector?.(`#card_${exId} details`)?.open);
    this.renderWorkout();
    if (detailsOpen) {
      const replacement = this.exerciseListEl?.querySelector?.(`#card_${exId} details`);
      if (replacement) replacement.open = true;
    }
    this.updateNowLiftingHUD();
    return true;
  }

  removeLastSetFromExercise(exId) {
    const list = this.session.logs[exId];
    if (!list || list.length <= 1) return false;
    const lastIdx = list.length - 1;
    if (list[lastIdx].completed) {
      this.showToast('Undo the last set before removing it.');
      return false;
    }
    if (!this.saveSessionFlowChange(() => list.pop(), false)) return false;
    if (this.pendingRir?.exId === exId && this.pendingRir.setIdx >= list.length) this.pendingRir = null;
    if (this.editingCompletedSet?.exId === exId && this.editingCompletedSet.setIdx >= list.length) this.editingCompletedSet = null;
    const detailsOpen = Boolean(this.exerciseListEl?.querySelector?.(`#card_${exId} details`)?.open);
    this.renderWorkout();
    if (detailsOpen) {
      const replacement = this.exerciseListEl?.querySelector?.(`#card_${exId} details`);
      if (replacement) replacement.open = true;
    }
    this.updateNowLiftingHUD();
    return true;
  }

  addWarmupSets(exId) {
    const ex = this.findExerciseById(exId);
    if (!ex || this.hasWarmupRamp(exId)) return false;
    const workingSet = this.getWarmupWorkingSet(exId);
    if (!workingSet) {
      this.showToast('Enter a working load greater than 0 lb for this equipment before adding warm-ups.');
      return false;
    }
    const name = this.getEffectiveExerciseName(exId, ex);
    const increment = Number(this.getExerciseIncrement(ex, name)) || 5;
    const weight = Number(workingSet.weight);
    const ramp = [[0.5, 10], [0.7, 5], [0.85, 2]].map(([portion, reps], index) => ({
      setNum: index + 1,
      type: 'warmup',
      weight: Number(Math.min(weight, Math.max(0, Math.round(weight * portion / increment) * increment)).toFixed(4)),
      reps,
      completed: false,
      exerciseName: name
    }));
    if (!this.saveSessionFlowChange(() => {
      this.session.warmups ||= {};
      this.session.warmups[exId] = [...this.getWarmupSets(exId), ...ramp];
    })) return false;
    this.focusedExerciseId = exId;
    this.renderWorkout();
    this.updateNowLiftingHUD();
    const firstWarmup = this.getNextWarmup(exId);
    this.revealWorkoutSet(exId, firstWarmup.setIdx, true, true, 'warmup');
    return true;
  }

  updateWarmupSet(exId, setIdx, field, rawValue) {
    const set = this.getWarmupSets(exId)[setIdx];
    if (!set || !['weight', 'reps'].includes(field)) return false;
    const blank = rawValue === null || String(rawValue).trim() === '';
    const parsed = blank ? NaN : Number(rawValue);
    const value = blank ? (field === 'weight' ? null : '') : Number.isFinite(parsed) ? parsed : String(rawValue);
    if (set[field] === value) return true;
    if (!this.saveSessionFlowChange(() => { set[field] = value; })) return false;
    const input = this.exerciseListEl?.querySelector?.(`.warmup-input[data-exid="${exId}"][data-warmupidx="${setIdx}"][data-field="${field}"]`);
    if (input && document.activeElement !== input) input.value = value ?? '';
    this.updateNowLiftingHUD();
    return true;
  }

  toggleWarmupCompletion(exId, setIdx) {
    const set = this.getWarmupSets(exId)[setIdx];
    const ex = this.findExerciseById(exId);
    if (!set || !ex || set.skipped) return false;
    const validationError = this.getSetValidationError(set);
    if (!set.completed && validationError) { this.showToast(validationError); return false; }
    const completed = !set.completed;
    if (!this.saveSessionFlowChange(() => {
      set.completed = completed;
      if (completed) {
        set.weight = Number(set.weight);
        set.reps = Number(set.reps);
        set.completedAt = new Date().toISOString();
      } else delete set.completedAt;
    })) return false;
    this.editingCompletedWarmup = null;
    if (completed) {
      const finalWarmup = !this.getWarmupSets(exId).some(row => this.isSetPending(row));
      const seconds = finalWarmup ? this.getRestSeconds(ex) : 90;
      this.triggerHaptic([40]);
      this._pendingTimerSource = { exId, setIdx, type: 'warmup' };
      this.startTimer(seconds, finalWarmup ? (this.isSupersetEnabled(ex) ? 0 : 120) : 90);
      this.focusedExerciseId = null;
    } else if (this.timer?.active && this.timer.source?.type === 'warmup' && this.timer.source.exId === exId && this.timer.source.setIdx === setIdx) {
      this.stopTimer();
    }
    this.renderWorkout();
    this.updateNowLiftingHUD();
    if (completed) this.jumpToActiveExercise({ automatic: true });
    else this.revealWorkoutSet(exId, setIdx, true, true, 'warmup');
    return true;
  }

  removeWarmupSet(exId, setIdx) {
    const set = this.getWarmupSets(exId)[setIdx];
    if (!set || set.completed) return false;
    if (!this.saveSessionFlowChange(() => { this.session.warmups[exId].splice(setIdx, 1); })) return false;
    this.editingCompletedWarmup = null;
    this.renderWorkout();
    this.updateNowLiftingHUD();
    return true;
  }
}

if (Array.isArray(globalThis.WorkoutAppMixins)) {
  globalThis.WorkoutAppMixins.forEach(mixin => Object.assign(WorkoutApp.prototype, mixin));
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new WorkoutApp();
});
