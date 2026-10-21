// State Management & Controller for Hypertrophy Routine Tracker (5-Day Split)

class WorkoutApp {
  constructor() {
    this.storageKeys = {
      routine: 'gym_routine_v4',
      history: 'gym_history_v1',
      machineSettings: 'gym_machine_settings_v1',
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

    // Load History, Notes, & Last Recorded Weights
    this.history = this.loadHistory();
    this.lastWeights = this.loadLastWeights();
    this.machineSettings = this.loadMachineSettings();
    this.exerciseNotes = this.loadExerciseNotes();
    this.exercisePreferences = this.loadExercisePreferences();
    this.deloadActive = localStorage.getItem(this.storageKeys.deloadActive) === 'true';
    this.deloadStartDate = parseInt(localStorage.getItem(this.storageKeys.deloadStartDate) || '0', 10);
    this.checkDeloadExpiry();
    this.initStoragePersistence();

    // Load Routine
    this.routine = this.loadRoutine();

    // Active Day: determine suggested day based on current weekday
    this.activeDayIndex = this.getResumeDayIndex();

    // Audio & WakeLock state
    this.audioCtx = null;
    this.wakeLock = null;
    this.wakeLockEnabled = localStorage.getItem(this.storageKeys.wakeLockEnabled) !== 'false';
    this.activeView = 'workout';

    // Timer State
    this.timer = {
      totalDuration: 120,
      remaining: 0,
      targetEndTime: 0,
      intervalId: null,
      active: false
    };

    // Active session logs in memory
    this.session = this.loadSession();
    this.selectedProgressExercise = null;
    this.collapsedCards = new Set();
    this.expandedOptionalDays = new Set();

    // Init UI
    this.initElements();
    this.bindEvents();

    // Background App-Swap & Visibility Listeners for Rest Timer & Wake Lock
    document.addEventListener('visibilitychange', () => {
      this.syncTimerFromBackground();
      if (document.visibilityState === 'visible' && this.wakeLockEnabled && this.activeView === 'workout') {
        this.requestWakeLock();
      }
    });
    window.addEventListener('pageshow', () => {
      this.syncTimerFromBackground();
      if (this.wakeLockEnabled && this.activeView === 'workout') {
        this.requestWakeLock();
      }
    });
    window.addEventListener('focus', () => {
      this.syncTimerFromBackground();
      if (this.wakeLockEnabled && this.activeView === 'workout') {
        this.requestWakeLock();
      }
    });

    // Check if a rest countdown was running in background
    this.restoreActiveTimer();

    this.render();
    this.showSessionResumePrompt();
    this.requestWakeLock();
  }

  loadRoutine() {
    const saved = localStorage.getItem(this.storageKeys.routine);
    let routine;
    try {
      const parsed = saved ? JSON.parse(saved) : null;
      if (Array.isArray(parsed) && parsed.length && parsed.every(d => Array.isArray(d.exercises))) routine = parsed;
    } catch (e) { console.error(e); }
    routine ||= JSON.parse(JSON.stringify(DEFAULT_ROUTINE));
    // Add only the new fields. User exercises, order, sets, reps and notes are authoritative.
    routine.forEach(day => day.exercises.forEach(ex => {
      const defaults = DEFAULT_ROUTINE.flatMap(d => d.exercises).find(e => e.id === ex.id || e.name === ex.name);
      const restText = String(ex.rest || '');
      const legacyRest = /min/i.test(restText) ? parseFloat(restText) * 60 : parseFloat(restText);
      if (!Number.isFinite(ex.restSeconds)) ex.restSeconds = Math.max(120, legacyRest || defaults?.restSeconds || 120);
      ex.restSeconds = Math.max(120, ex.restSeconds);
      ex.rest = ex.restSeconds % 60 === 0 ? `${ex.restSeconds / 60} min` : `${ex.restSeconds} sec`;
      if (ex.superset) {
        if (!Number.isFinite(ex.superset.restSeconds)) ex.superset.restSeconds = defaults?.superset?.restSeconds || (/seated leg curl/i.test(ex.name) ? 75 : 60);
        ex.superset.rest = `${ex.superset.restSeconds} sec`;
      }
      if (!Number.isFinite(ex.increment)) ex.increment = defaults?.increment || this.getExerciseIncrement(ex, ex.name);
    }));
    localStorage.setItem(this.storageKeys.routineRev, '15');
    localStorage.setItem(this.storageKeys.routine, JSON.stringify(routine));
    return routine;
  }

  loadExercisePreferences() {
    try {
      const data = JSON.parse(localStorage.getItem(this.storageKeys.exercisePreferences) || '{}');
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (_) { return {}; }
  }

  saveExercisePreferences() {
    localStorage.setItem(this.storageKeys.exercisePreferences, JSON.stringify(this.exercisePreferences || {}));
  }

  saveRoutine() {
    localStorage.setItem(this.storageKeys.routine, JSON.stringify(this.routine));
  }

  loadHistory() {
    const saved = localStorage.getItem(this.storageKeys.history);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { console.error(e); }
    }
    return [];
  }

  saveHistory() {
    localStorage.setItem(this.storageKeys.history, JSON.stringify(this.history));
  }

  loadLastWeights() {
    const saved = localStorage.getItem(this.storageKeys.lastWeights);
    let data = {};
    if (saved) {
      try { data = JSON.parse(saved); } catch (e) { console.error(e); }
    }
    // Bootstrap from history if empty
    if (Object.keys(data).length === 0 && this.history && this.history.length > 0) {
      this.history.forEach(h => {
        if (h.deload || h.isDeload || h.deloadActive) return;
        if (h.exercises) {
          Object.keys(h.exercises).forEach(name => {
            const entry = h.exercises[name];
            if (entry && entry.sets) {
              data[name] = {
                date: h.date,
                sets: entry.sets.map(s => ({ setNum: s.setNum, weight: s.weight, reps: s.reps, completed: s.completed }))
              };
            }
          });
        }
      });
    }
    // Older builds saved recovery loads without identifying them as a deload.
    Object.entries(data).forEach(([name, entry]) => {
      if (!entry || typeof entry !== 'object') return;
      const matching = (this.history || []).filter(h => h.exercises?.[name]).sort((a, b) => new Date(b.date) - new Date(a.date));
      const latest = matching[0];
      if (latest && (latest.deload || latest.isDeload || latest.deloadActive) && new Date(entry.date).getTime() <= new Date(latest.date).getTime()) {
        const baseline = matching.find(h => !h.deload && !h.isDeload && !h.deloadActive);
        if (baseline) data[name] = { date: baseline.date, deload: false, sets: baseline.exercises[name].sets };
        else entry.deload = true;
      }
    });
    return data;
  }

  saveLastWeights() {
    localStorage.setItem(this.storageKeys.lastWeights, JSON.stringify(this.lastWeights));
  }

  recordExerciseWeight(exerciseName, setNum, weight, reps, completed = false) {
    if (!this.lastWeights) this.lastWeights = {};
    if (!this.lastWeights[exerciseName]) {
      this.lastWeights[exerciseName] = {
        date: new Date().toISOString(),
        sets: []
      };
    }
    this.lastWeights[exerciseName].date = new Date().toISOString();
    while (this.lastWeights[exerciseName].sets.length < setNum) {
      this.lastWeights[exerciseName].sets.push(null);
    }
    this.lastWeights[exerciseName].sets[setNum - 1] = {
      setNum,
      weight: parseFloat(weight) || 0,
      reps: parseInt(reps, 10) || 0,
      completed
    };
    this.saveLastWeights();
  }

  loadMachineSettings() {
    const saved = localStorage.getItem(this.storageKeys.machineSettings);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { console.error(e); }
    }
    return {};
  }

  saveMachineSettings() {
    localStorage.setItem(this.storageKeys.machineSettings, JSON.stringify(this.machineSettings));
  }

  loadExerciseNotes() {
    const saved = localStorage.getItem(this.storageKeys.exerciseNotes);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { console.error(e); }
    }
    return {};
  }

  saveExerciseNotes() {
    localStorage.setItem(this.storageKeys.exerciseNotes, JSON.stringify(this.exerciseNotes || {}));
  }

  initStoragePersistence() {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(persistent => {
        if (persistent) {
          console.log('MachineMaster storage marked persistent by browser');
        }
      }).catch(e => console.log('Storage persist check:', e));
    }
  }

  checkDeloadExpiry() {
    if (this.deloadActive && this.deloadStartDate > 0) {
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - this.deloadStartDate > oneWeekMs) {
        this.deloadActive = false;
        localStorage.setItem(this.storageKeys.deloadActive, 'false');
        console.log('Deload week auto-expired');
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

  getBackupStatusText() {
    const raw = localStorage.getItem(this.storageKeys.lastBackupTime);
    if (!raw) return 'No backup yet (Export recommended)';
    const ts = parseInt(raw, 10);
    const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
    if (days === 0) return 'Backed up today';
    if (days === 1) return 'Backed up yesterday';
    return `Last backed up ${days} days ago`;
  }

  getEffectiveExerciseName(exId, ex) {
    if (this.session && this.session.swaps && this.session.swaps[exId]) {
      return this.session.swaps[exId].name;
    }
    if (ex && ex.name) return ex.name;
    const found = this.findExerciseById(exId);
    return found ? found.name : '';
  }

  getExerciseIncrement(ex, effectiveName) {
    const preference = this.exercisePreferences?.[effectiveName || ex?.name];
    if ([1, 2.5, 5, 10].includes(Number(preference?.increment))) return Number(preference.increment);
    if ((!effectiveName || effectiveName === ex?.name) && [1, 2.5, 5, 10].includes(Number(ex?.increment))) return Number(ex.increment);
    const rawName = (effectiveName || (ex ? ex.name : '') || '').toLowerCase();
    
    // 1. Isolation, dumbbell, bodyweight, or unilateral movement (+5 lbs)
    const isolationKeywords = [
      'dumbbell', 'db ', 'single-arm', 'single-leg', 'one-arm', 'lateral raise', 
      'rear delt', 'face pull', 'pec deck', 'fly', 'crossover', 'leg extension', 
      'leg curl', 'sissy squat', 'goblet squat', 'split squat', 'curl', 'tricep', 
      'pushdown', 'skull crusher', 'extension', 'crunch', 'knee raise', 'sit-up', 
      'pull-through', 'pullover', 'adduction', 'abduction'
    ];
    if (isolationKeywords.some(kw => rawName.includes(kw))) {
      return 5;
    }

    // 2. Bigger bilateral machine / barbell / cable compounds (+10 lbs)
    const compoundKeywords = [
      'hack squat', 'leg press', 'smith machine squat', 'hip thrust', 'glute drive', 
      'barbell romanian', 'smith machine romanian', 'calf raise', 'calf press', 
      'machine chest press', 'machine incline press', 'smith machine incline press', 
      'smith machine chest press', 'machine overhead', 'machine shoulder press', 
      'smith machine overhead', 'smith machine shoulder', 'lat pulldown', 
      'machine row', 'seated cable row', 't-bar row'
    ];
    if (compoundKeywords.some(kw => rawName.includes(kw))) {
      return 10;
    }

    if (ex && typeof ex.increment === 'number') return ex.increment;
    return 5;
  }

  getMinTargetReps(targetRepsStr) {
    if (!targetRepsStr) return 8;
    const matches = String(targetRepsStr).match(/\d+/g);
    if (!matches || matches.length === 0) return 8;
    return Math.min(...matches.map(n => parseInt(n, 10)));
  }

  getMaxTargetReps(targetRepsStr) {
    if (!targetRepsStr) return 12;
    const matches = String(targetRepsStr).match(/\d+/g);
    if (!matches || matches.length === 0) return 12;
    return Math.max(...matches.map(n => parseInt(n, 10)));
  }

  getSetTarget(ex, setIdx, effectiveName) {
    const activeSubName = effectiveName || this.getEffectiveExerciseName(ex.id, ex);
    const activeSwap = this.session?.swaps?.[ex.id];
    const effectiveTargetReps = (activeSwap?.name === activeSubName && activeSwap.targetReps) || ex.targetReps;
    const minTarget = this.getMinTargetReps(effectiveTargetReps);
    const maxTarget = this.getMaxTargetReps(effectiveTargetReps);
    const increment = this.getExerciseIncrement(ex, activeSubName);
    const prev = this.getPreviousExercisePerformance(activeSubName);

    // Loads from a different machine are not a baseline for this exercise.
    if (!prev && (activeSubName !== ex.name || ex.needsBaseline)) {
      return { targetWeight: null, targetReps: minTarget, targetRepsDisplay: effectiveTargetReps,
        targetWeightDisplay: 'Enter load', isProgressionIncrease: false, needsBaseline: true, note: 'Set an equipment baseline' };
    }

    if (!prev || !prev.sets || prev.sets.length === 0) {
      const parsedStart = this.parseInitialWeight(ex.startingWeight);
      const targetWeight = this.deloadActive ? Math.max(0, Math.round((parsedStart * 0.9) / 5) * 5) : parsedStart;
      return {
        targetWeight,
        targetReps: minTarget,
        targetRepsDisplay: effectiveTargetReps,
        targetWeightDisplay: targetWeight > 0 ? `${targetWeight}` : '—',
        isProgressionIncrease: false,
        note: 'Baseline set'
      };
    }

    const validPrevSets = prev.sets.filter(s => s && s.completed !== false && (s.reps > 0 || s.weight > 0));
    if (validPrevSets.length === 0) {
      const parsedStart = this.parseInitialWeight(ex.startingWeight);
      const targetWeight = this.deloadActive ? Math.max(0, Math.round((parsedStart * 0.9) / 5) * 5) : parsedStart;
      return {
        targetWeight,
        targetReps: minTarget,
        targetRepsDisplay: effectiveTargetReps,
        targetWeightDisplay: targetWeight > 0 ? `${targetWeight}` : '—',
        isProgressionIncrease: false,
        note: 'Baseline set'
      };
    }

    const targetSetsCount = ex.sets || 3;
    const exactPrevSet = validPrevSets[setIdx];
    const fallbackWeightSet = validPrevSets[validPrevSets.length - 1] || validPrevSets[0] || {};
    let baseWeight = exactPrevSet ? (exactPrevSet.weight || 0) : (fallbackWeightSet.weight || 0);
    const topPrevWeight = Math.max(...validPrevSets.map(s => s.weight || 0));

    // Only unlock weight increase if ALL required sets were completed AND every set hit maxTarget at the working weight
    const allSetsHitMax = !this.deloadActive &&
      validPrevSets.length >= targetSetsCount &&
      validPrevSets.every(s => (s.reps || 0) >= maxTarget && (topPrevWeight === 0 || (s.weight || 0) >= topPrevWeight));

    let targetWeight = baseWeight;
    let targetReps = minTarget;
    let isProgressionIncrease = false;

    if (allSetsHitMax && topPrevWeight > 0) {
      targetWeight = topPrevWeight + increment;
      targetReps = minTarget;
      isProgressionIncrease = true;
    } else if (exactPrevSet) {
      const prevReps = exactPrevSet.reps || minTarget;
      targetReps = Math.min(maxTarget, prevReps >= maxTarget ? maxTarget : prevReps + 1);
    } else {
      targetReps = minTarget;
    }

    if (this.deloadActive) {
      targetWeight = Math.max(0, Math.round((targetWeight * 0.9) / 5) * 5);
      isProgressionIncrease = false;
    }

    return {
      targetWeight,
      targetReps,
      targetRepsDisplay: effectiveTargetReps,
      targetWeightDisplay: targetWeight > 0 ? `${targetWeight}` : '—',
      isProgressionIncrease,
      note: isProgressionIncrease ? `+${increment} lbs unlocked!` : `Target: ${targetReps} reps`
    };
  }

  setSetRIR(exId, setIdx, rirVal) {
    const list = this.session && this.session.logs && this.session.logs[exId];
    if (!list || !list[setIdx]) return;
    list[setIdx].rir = (list[setIdx].rir === rirVal) ? null : rirVal;
    list[setIdx].rirAnswered = true;
    if (this.pendingRir?.exId === exId && this.pendingRir?.setIdx === setIdx) {
      this.pendingRir = null;
      if (list.every(s => s.completed)) this.collapsedCards.add(exId);
    }
    this.saveCurrentSession();
    this.renderWorkout();
  }

  getSessionKey(dayId) {
    return `${this.storageKeys.currentSessionPrefix}${dayId}`;
  }

  hasSessionProgress(session) {
    if (!session?.logs) return false;
    return Boolean(session.startTime || Object.values(session.logs).some(sets => sets.some(s => s.completed)) ||
      (session.initialLogs && JSON.stringify(session.logs) !== JSON.stringify(session.initialLogs)) ||
      Object.keys(session.swaps || {}).length);
  }

  getResumeDayIndex() {
    const lastDay = localStorage.getItem('gym_last_active_day_v1');
    const candidates = this.routine.map((day, index) => {
      try {
        const session = JSON.parse(localStorage.getItem(this.getSessionKey(day.id)) || 'null');
        return this.hasSessionProgress(session) && !this.history.some(w => w.sessionId === session.id)
          ? { index, dayId: day.id, updatedAt: Date.parse(session.updatedAt || session.startTime || session.createdAt) || 0 } : null;
      } catch (_) { return null; }
    }).filter(Boolean);
    return candidates.find(item => item.dayId === lastDay)?.index ??
      candidates.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.index ?? this.getSuggestedDayIndex();
  }

  getSessionResumeInfo() {
    const date = this.session?.startTime || this.session?.createdAt || this.session?.updatedAt;
    const parsed = date ? new Date(date) : null;
    return { date, inProgress: this.hasSessionProgress(this.session),
      savedDraftId: localStorage.getItem(`gym_saved_draft_for_${this.session?.dayId}`),
      stale: Boolean(parsed && !Number.isNaN(parsed.getTime()) && parsed.toDateString() !== new Date().toDateString()) };
  }

  showSessionResumePrompt() {
    const info = this.getSessionResumeInfo();
    if (!info.inProgress || !info.stale || !this.summaryContentEl) return;
    const sessionId = this.session.id;
    this.summaryContentEl.innerHTML = `<h2>Resume workout?</h2><p>${this.escapeHtml(this.session.dayTitle)} · Started ${this.escapeHtml(new Date(info.date).toLocaleString())}</p><p>Resume keeps every saved set. Start new keeps this draft available for recovery.</p><button class="primary-btn" id="resumeDraftBtn">Resume workout</button><button class="secondary-btn" id="startNewDraftBtn">Start new workout</button>`;
    this.summaryModalEl.classList.add('open');
    document.getElementById('resumeDraftBtn')?.addEventListener('click', () => {
      this.summaryModalEl.classList.remove('open');
      this.jumpToActiveExercise?.();
    });
    document.getElementById('startNewDraftBtn')?.addEventListener('click', () => this.startNewSession(sessionId));
  }

  startNewSession(expectedId = this.session?.id) {
    if (expectedId !== this.session?.id) return false;
    if (this.hasSessionProgress(this.session)) {
      localStorage.setItem(`gym_saved_draft_${this.session.id}`, JSON.stringify(this.session));
      localStorage.setItem(`gym_saved_draft_for_${this.session.dayId}`, this.session.id);
    }
    this.stopTimer();
    this.session = this.initNewSession(this.activeDayIndex);
    this.pendingRir = null;
    this.collapsedCards = new Set();
    this.saveCurrentSession();
    this.summaryModalEl?.classList.remove('open');
    this.renderWorkout();
    return true;
  }

  restoreSavedDraft(draftId) {
    let draft;
    try { draft = JSON.parse(localStorage.getItem(`gym_saved_draft_${draftId}`)); } catch (_) { return false; }
    const dayIndex = this.routine.findIndex(day => day.id === draft?.dayId);
    if (dayIndex < 0 || !draft?.logs) return false;
    if (this.hasSessionProgress(this.loadSession(dayIndex))) { this.showToast('Save or finish the current workout before restoring the previous draft.'); return false; }
    this.saveCurrentSession();
    this.stopTimer();
    this.activeDayIndex = dayIndex;
    this.session = draft;
    this.pendingRir = null;
    this.collapsedCards = new Set();
    this.saveCurrentSession();
    localStorage.removeItem(`gym_saved_draft_${draftId}`);
    localStorage.removeItem(`gym_saved_draft_for_${draft.dayId}`);
    this.summaryModalEl?.classList.remove('open');
    this.render();
    return true;
  }

  loadSession(dayIndex = this.activeDayIndex) {
    const day = this.routine[dayIndex] || this.routine[0];
    const saved = localStorage.getItem(this.getSessionKey(day.id)) || localStorage.getItem(this.storageKeys.legacyCurrentSession);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.dayId === day.id && parsed.logs && typeof parsed.logs === 'object') {
          if (this.history.some(workout => workout.sessionId === parsed.id)) return this.initNewSession(dayIndex);
          parsed.swaps ||= {};
          // Only a provably untouched session may be recalculated when deload changes.
          const untouched = parsed.initialLogs && JSON.stringify(parsed.logs) === JSON.stringify(parsed.initialLogs) && !parsed.startTime && Object.keys(parsed.swaps).length === 0;
          if (untouched && Boolean(parsed.deload) !== Boolean(this.deloadActive)) return this.initNewSession(dayIndex);
          if (typeof parsed.deload !== 'boolean') parsed.deload = Boolean(this.deloadActive);
          parsed.id ||= `s_${day.id}_${parsed.startTime || Date.now()}`;
          return parsed;
        }
      } catch (e) { console.error(e); }
    }
    return this.initNewSession(dayIndex);
  }

  saveCurrentSession() {
    if (!this.session || !this.session.dayId) return;
    this.session.id ||= `s_${this.session.dayId}_${Date.now()}`;
    this.session.updatedAt = new Date().toISOString();
    localStorage.setItem(this.getSessionKey(this.session.dayId), JSON.stringify(this.session));
    localStorage.setItem('gym_last_active_day_v1', this.session.dayId);
  }

  initNewSession(dayIndex) {
    const day = this.routine[dayIndex] || this.routine[0];
    const session = {
      id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      dayId: day.id,
      dayTitle: day.title,
      startTime: null,
      createdAt: new Date().toISOString(),
      logs: {},
      swaps: {},
      disabledSupersets: {},
      deload: Boolean(this.deloadActive)
    };

    day.exercises.forEach(ex => {
      const effectiveName = ex.name;
      const targetSetsCount = this.deloadActive ? Math.max(2, Math.floor(ex.sets * 0.67)) : ex.sets;
      session.logs[ex.id] = [];
      for (let i = 1; i <= targetSetsCount; i++) {
        const target = this.getSetTarget(ex, i - 1, effectiveName);
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
    return session;
  }

  findExerciseById(exId) {
    if (!this.routine) return null;
    for (const day of this.routine) {
      const found = day.exercises.find(e => e.id === exId);
      if (found) return found;
    }
    return null;
  }

  parseInitialWeight(str) {
    if (!str) return 0;
    if (typeof str === 'string' && str.toLowerCase().includes('bodyweight')) return 0;
    const m = String(str).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  parseInitialReps(str) {
    if (!str) return 10;
    const m = str.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 10;
  }

  parseRestSeconds(restStr) {
    if (typeof restStr === 'number') return Number.isFinite(restStr) && restStr > 0 ? restStr : 120;
    const lower = String(restStr || '').toLowerCase();
    const values = lower.match(/\d+(?:\.\d+)?/g)?.map(Number);
    if (!values?.length) return 120;
    return Math.round(Math.max(...values) * (/min|\d\s*m\b/.test(lower) ? 60 : 1));
  }

  formatRest(seconds) {
    return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} sec`;
  }

  isSupersetEnabled(ex) {
    return Boolean(ex?.superset && !this.session?.disabledSupersets?.[ex.superset.id]);
  }

  getRestSeconds(ex) {
    if (this.isSupersetEnabled(ex)) {
      return this.parseRestSeconds(ex.superset.restSeconds || ex.superset.rest);
    }
    return Math.max(120, this.parseRestSeconds(ex?.restSeconds || ex?.rest));
  }

  getNextSet() {
    const exercises = this.routine?.[this.activeDayIndex]?.exercises || [];
    const visited = new Set();
    for (const ex of exercises) {
      if (visited.has(ex.id)) continue;
      const group = this.isSupersetEnabled(ex)
        ? exercises.filter(candidate => candidate.superset?.id === ex.superset.id)
        : [ex];
      group.forEach(candidate => visited.add(candidate.id));
      const maxSets = Math.max(0, ...group.map(candidate => this.session?.logs?.[candidate.id]?.length || 0));
      for (let setIdx = 0; setIdx < maxSets; setIdx++) {
        for (const candidate of group) {
          const set = this.session?.logs?.[candidate.id]?.[setIdx];
          if (set && !set.completed) return { ex: candidate, setIdx };
        }
      }
    }
    return null;
  }

  getSuggestedDayIndex() {
    // Current day of week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    const day = new Date().getDay();
    if (day === 0) return 3; // Sunday -> Sun DB Arms & Shoulders
    if (day === 1) return 4; // Monday -> Mon Lower B
    if (day === 2) return 0; // Tuesday -> Wed Upper A (upcoming)
    if (day === 3) return 0; // Wednesday -> Wed Upper A
    if (day === 4) return 1; // Thursday -> Fri Lower A (upcoming)
    if (day === 5) return 1; // Friday -> Fri Lower A
    if (day === 6) return 2; // Saturday -> Sat Upper B
    return 0;
  }

  getPreviousProgressionFlag(exerciseName, targetRepsStr, requiredSetsCount = 3, ex = null) {
    if (this.deloadActive) return { unlocked: false };
    const prev = this.getPreviousExercisePerformance(exerciseName);
    if (!prev || !prev.sets || prev.sets.length === 0) return { unlocked: false };
    const maxTarget = this.getMaxTargetReps(targetRepsStr);
    const validSets = prev.sets.filter(s => s && s.completed !== false && (s.reps > 0 || s.weight > 0));
    const targetSets = requiredSetsCount || 3;
    if (validSets.length < targetSets) return { unlocked: false };
    
    const topWeight = Math.max(...validSets.map(s => s.weight || 0));
    // Weight increase flag is ONLY unlocked if top-end target reps were hit for all sets at the working weight
    const allSetsHit = validSets.every(s => (s.reps || 0) >= maxTarget && (topWeight === 0 || (s.weight || 0) >= topWeight));

    if (allSetsHit) {
      const increment = this.getExerciseIncrement(ex, exerciseName);
      return {
        unlocked: true,
        allSetsHit: true,
        maxReps: maxTarget,
        setsCount: validSets.length,
        topWeight,
        increment
      };
    }
    return { unlocked: false };
  }

  bumpExerciseWeight(exId, delta = 5) {
    const list = this.session && this.session.logs && this.session.logs[exId];
    if (!list) return;
    if (this.session && !this.session.startTime) {
      this.session.startTime = new Date().toISOString();
    }
    list.forEach((s) => {
      const cur = parseFloat(s.weight) || 0;
      s.weight = Math.max(0, cur + delta);
    });
    this.saveCurrentSession();
    this.renderWorkout();
  }

  updateSetWeight(exId, setIdx, newWeight) {
    const list = this.session && this.session.logs && this.session.logs[exId];
    if (!list || !list[setIdx]) return;
    if (!this.session.startTime) this.session.startTime = new Date().toISOString();
    const blank = newWeight === null || String(newWeight).trim() === '';
    const parsed = blank ? NaN : Number(newWeight);
    const value = blank ? null : Number.isFinite(parsed) ? parsed : String(newWeight);
    const valid = Number.isFinite(value) && value >= 0;
    const affected = [setIdx];
    if (setIdx === 0 && valid) list.forEach((set, idx) => {
      if (idx > 0 && !set.completed && (!set.exerciseName || !list[0].exerciseName || set.exerciseName === list[0].exerciseName)) affected.push(idx);
    });
    affected.forEach(idx => {
      list[idx].weight = value;
      list[idx].needsBaseline = !valid;
      const row = this.exerciseListEl.querySelector(`.set-row[data-exid="${exId}"][data-setidx="${idx}"]`);
      if (!row) return;
      const input = row.querySelector('.set-weight-input');
      if (input && document.activeElement !== input) input.value = value === null ? '' : value;
      const button = row.querySelector('.set-check-btn');
      if (button) button.disabled = value === null && !list[idx].completed;
      const prompt = row.querySelector('.baseline-prompt');
      if (prompt) prompt.hidden = value !== null;
    });
    const warmup = this.exerciseListEl.querySelector(`#card_${exId} .warmup-btn`);
    if (warmup) warmup.disabled = list.some(set => set.needsBaseline || set.weight === null);
    this.saveCurrentSession();
    this.updateNowLiftingHUD();
  }

  updateSetReps(exId, setIdx, newReps) {
    const list = this.session && this.session.logs && this.session.logs[exId];
    if (!list || !list[setIdx]) return;
    if (!this.session.startTime) this.session.startTime = new Date().toISOString();
    const blank = newReps === null || String(newReps).trim() === '';
    const parsed = blank ? NaN : Number(newReps);
    list[setIdx].reps = blank ? '' : Number.isFinite(parsed) ? parsed : String(newReps);
    const input = this.exerciseListEl.querySelector(`.set-reps-input[data-exid="${exId}"][data-setidx="${setIdx}"]`);
    if (input && document.activeElement !== input) input.value = list[setIdx].reps;
    this.saveCurrentSession();
    this.updateNowLiftingHUD();
  }

  getSetValidationError(set) {
    if (set.weight === null || set.weight === '' || !Number.isFinite(set.weight) || set.weight < 0 || set.needsBaseline)
      return 'Enter a valid load of 0 lb or more for this equipment.';
    if (!Number.isInteger(set.reps) || set.reps <= 0)
      return 'Enter a positive whole number of reps before completing this set.';
    return '';
  }

  getPreviousExercisePerformance(exerciseName) {
    // 1. Check completed history (most recent first)
    let historyEntry = null;
    if (this.history && Array.isArray(this.history)) {
      for (let i = this.history.length - 1; i >= 0; i--) {
        const workout = this.history[i];
        if (workout.deload || workout.isDeload || workout.deloadActive) continue;
        if (workout.exercises && workout.exercises[exerciseName] && Array.isArray(workout.exercises[exerciseName].sets)) {
          const validSets = workout.exercises[exerciseName].sets.filter(s => s && s.completed !== false && (s.reps > 0 || s.weight > 0));
          if (validSets.length > 0) {
            historyEntry = {
              date: workout.date,
              sets: validSets
            };
            break;
          }
        }
      }
    }

    // 2. Check persistent lastWeights store only if no history entry exists
    if (!historyEntry && this.lastWeights && this.lastWeights[exerciseName] && !this.lastWeights[exerciseName].deload && Array.isArray(this.lastWeights[exerciseName].sets)) {
      const validSets = this.lastWeights[exerciseName].sets.filter(s => s && s.completed !== false && (s.reps > 0 || s.weight > 0));
      if (validSets.length > 0) {
        return {
          date: this.lastWeights[exerciseName].date,
          sets: validSets
        };
      }
    }

    return historyEntry;
  }

  formatPreviousSetsSummary(sets) {
    if (!sets || !Array.isArray(sets)) return null;
    const valid = sets.filter(s => s && typeof s.weight !== 'undefined' && typeof s.reps !== 'undefined' && s.weight !== null && s.reps !== null);
    if (valid.length === 0) return null;

    const weights = valid.map(s => Number(s.weight));
    const reps = valid.map(s => Number(s.reps));

    const allSameWeight = weights.every(w => w === weights[0]);
    const allSameReps = reps.every(r => r === reps[0]);

    if (allSameWeight && allSameReps) {
      if (valid.length === 1) {
        return `${weights[0]} lbs × ${reps[0]}`;
      }
      return `${weights[0]} lbs × ${reps[0]} (all ${valid.length} sets)`;
    }

    if (allSameWeight) {
      return `${weights[0]} lbs × [${reps.join(', ')}]`;
    }

    // Group consecutive identical sets for ultra-compact display
    const groups = [];
    for (let i = 0; i < valid.length; i++) {
      const cur = valid[i];
      if (groups.length > 0) {
        const last = groups[groups.length - 1];
        if (last.weight === cur.weight && last.reps === cur.reps) {
          last.count++;
          continue;
        }
      }
      groups.push({ weight: cur.weight, reps: cur.reps, count: 1 });
    }

    return groups.map(g => `${g.weight}lbs×${g.reps}${g.count > 1 ? ` (×${g.count})` : ''}`).join(' • ');
  }

  getPersonalRecord(exerciseName) {
    let maxWeight = 0;
    let max1RM = 0;
    let bestReps = 0;

    const processSet = (s) => {
      if (!s || s.completed === false) return;
      const weight = parseFloat(s.weight) || 0;
      const reps = parseInt(s.reps, 10) || 0;
      if (weight > 0) {
        const est1RM = Math.round(weight * (1 + (reps || 1) / 30));
        if (est1RM > max1RM) max1RM = est1RM;
        if (weight > maxWeight) {
          maxWeight = weight;
          bestReps = reps;
        } else if (weight === maxWeight && reps > bestReps) {
          bestReps = reps;
        }
      } else if (weight === 0 && reps > 0) {
        if (maxWeight === 0) {
          bestReps = Math.max(bestReps, reps);
        }
      }
    };

    // Check history
    if (this.history && Array.isArray(this.history)) {
      this.history.forEach(h => {
        if (h.exercises && h.exercises[exerciseName] && Array.isArray(h.exercises[exerciseName].sets)) {
          h.exercises[exerciseName].sets.forEach(processSet);
        }
      });
    }

    // Check persistent last weights
    if (this.lastWeights && this.lastWeights[exerciseName] && Array.isArray(this.lastWeights[exerciseName].sets)) {
      this.lastWeights[exerciseName].sets.filter(Boolean).forEach(processSet);
    }

    return { maxWeight, max1RM, bestReps };
  }

  initElements() {
    this.daySelectorEl = document.getElementById('daySelector');
    this.sessionInfoEl = document.getElementById('sessionInfo');
    this.exerciseListEl = document.getElementById('exerciseList');
    this.timerDockEl = document.getElementById('timerDock');
    this.timerDisplayEl = document.getElementById('timerDisplay');
    this.timerProgressBarEl = document.getElementById('timerProgressBar');

    // Modals
    this.summaryModalEl = document.getElementById('summaryModal');
    this.summaryContentEl = document.getElementById('summaryContent');
    this.analyticsContentEl = document.getElementById('analyticsContent');
    this.routineEditorEl = document.getElementById('routineEditor');

    // Gym Power Modals
    this.swapModalEl = document.getElementById('swapModal');
    this.swapContentEl = document.getElementById('swapContent');
    this.swapModalTitleEl = document.getElementById('swapModalTitle');
    this.warmupModalEl = document.getElementById('warmupModal');
    this.warmupContentEl = document.getElementById('warmupContent');
    this.warmupModalTitleEl = document.getElementById('warmupModalTitle');
    this.quickHistoryModalEl = document.getElementById('quickHistoryModal');
    this.quickHistoryContentEl = document.getElementById('quickHistoryContent');
    this.quickHistoryTitleEl = document.getElementById('quickHistoryTitle');

    // Wake Lock Status Badge
    this.wakeLockBadgeEl = document.getElementById('wakeLockBadge');
  }

  bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const view = btn.dataset.view;
        this.switchMainView(view);
      });
    });

    // Finish Workout button
    const finishBtn = document.getElementById('finishWorkoutBtn');
    if (finishBtn) {
      finishBtn.addEventListener('click', () => this.showWorkoutSummary());
    }

    // Timer controls
    document.getElementById('timerSkipBtn')?.addEventListener('click', () => this.skipTimer());
    document.getElementById('timerPlus30Btn')?.addEventListener('click', () => this.adjustTimer(30));
    document.getElementById('timerMinus30Btn')?.addEventListener('click', () => this.adjustTimer(-30));

    // Modal closes
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal-backdrop');
        if (modal) modal.classList.remove('open');
      });
    });

    // Close on backdrop tap
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.classList.remove('open');
      });
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
      }
    });

    // Import file input handler
    const fileInput = document.getElementById('importFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          this.importData(event.target.result);
          fileInput.value = '';
        };
        reader.readAsText(file);
      });
    }

    // Now-Lifting HUD jump listeners
    document.getElementById('nowLiftingJumpBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.jumpToActiveExercise();
    });
    document.getElementById('nowLiftingDock')?.addEventListener('click', () => {
      this.jumpToActiveExercise();
    });
  }

  switchMainView(view) {
    this.activeView = view;
    const workoutView = document.getElementById('workoutView');
    const analyticsView = document.getElementById('analyticsView');
    const routineView = document.getElementById('routineView');
    const hud = document.getElementById('nowLiftingDock');

    if (view === 'workout') {
      workoutView.style.display = 'block';
      analyticsView.style.display = 'none';
      routineView.style.display = 'none';
      if (this.wakeLockEnabled) {
        this.requestWakeLock();
      }
      this.renderWorkout();
      this.updateNowLiftingHUD();
    } else {
      if (hud) hud.style.display = 'none';
      if (view === 'analytics') {
        workoutView.style.display = 'none';
        analyticsView.style.display = 'block';
        routineView.style.display = 'none';
        this.releaseWakeLock();
        this.renderAnalytics();
      } else if (view === 'routine') {
        workoutView.style.display = 'none';
        analyticsView.style.display = 'none';
        routineView.style.display = 'block';
        this.releaseWakeLock();
        this.renderRoutineEditor();
      }
    }
  }

  render() {
    this.renderDaySelector();
    this.renderWorkout();
  }

  renderDaySelector() {
    const todayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
    this.daySelectorEl.innerHTML = `<label class="day-picker-label" for="workoutDayPicker">Workout day</label>
      <select id="workoutDayPicker" class="day-picker">${this.routine.map((day, idx) =>
        `<option value="${idx}" ${idx === this.activeDayIndex ? 'selected' : ''}>${this.escapeHtml(day.title)}${day.title.startsWith(todayName) ? ' · Today' : ''}</option>`).join('')}</select>`;
    document.getElementById('workoutDayPicker').addEventListener('change', e => {
      this.saveCurrentSession();
      this.activeDayIndex = Number(e.target.value);
      this.focusedExerciseId = null;
      this.pendingRir = null;
      this.session = this.loadSession();
      this.renderDaySelector();
      this.renderWorkout();
    });
  }

  renderWorkout() {
    const day = this.routine[this.activeDayIndex];
    if (!day) return;
    const core = day.exercises.filter(ex => !ex.isOptional);
    const total = core.reduce((sum, ex) => sum + (this.session.logs[ex.id] || []).length, 0);
    const complete = core.reduce((sum, ex) => sum + (this.session.logs[ex.id] || []).filter(set => set.completed).length, 0);
    const estimateSeconds = core.reduce((sum, ex) => {
      const count = (this.session.logs[ex.id] || []).length;
      return sum + count * 45 + Math.max(0, count - 1) * this.getRestSeconds(ex) + 90;
    }, 0);
    const normalSets = core.reduce((sum, ex) => sum + ex.sets, 0);
    const reducedSets = core.reduce((sum, ex) => sum + Math.max(2, Math.floor(ex.sets * .67)), 0);
    const next = this.getNextSet();
    const pending = this.pendingRir && day.exercises.find(ex => ex.id === this.pendingRir.exId);
    const focus = day.exercises.find(ex => ex.id === this.focusedExerciseId) || (next && next.ex) || pending || core[0];
    const visible = focus ? day.exercises.filter(ex => ex.id === focus.id ||
      (this.isSupersetEnabled(focus) && this.isSupersetEnabled(ex) && ex.superset.id === focus.superset.id)) : [];
    const overviewOpen = this.sessionInfoEl.querySelector('.workout-overview')?.open || false;
    this.sessionInfoEl.innerHTML = `<details class="workout-overview" ${overviewOpen ? 'open' : ''}>
      <summary><span class="session-completion"><strong>${complete} / ${total}</strong> sets</span><span class="session-overview-label">Overview</span></summary>
      <div class="workout-progress-track" role="progressbar" aria-label="Workout sets" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${complete}"><div class="workout-progress-fill" style="width:${total ? complete / total * 100 : 0}%"></div></div>
      <div class="session-detail-summary">${day.exercises.length} exercises · ~${Math.ceil(estimateSeconds / 60)} min planned</div>
      ${this.deloadActive ? `<div class="deload-banner">Deload: ${reducedSets} of ${normalSets} planned sets (${Math.round((normalSets - reducedSets) / normalSets * 100)}% fewer), loads eased 10%.</div>` : ''}
      <div class="overview-list">${day.exercises.map(ex => {
        const sets = this.session.logs[ex.id] || [];
        const pendingEffort = sets.filter(set => set.completed && !set.rirAnswered && set.rir == null).length;
        return `<button type="button" class="overview-exercise ${visible.includes(ex) ? 'selected' : ''}" data-exid="${ex.id}"><span>${this.escapeHtml(this.getEffectiveExerciseName(ex.id, ex))}${ex.isOptional ? ' · Optional' : ''}${pendingEffort ? `<small>${pendingEffort} effort ${pendingEffort === 1 ? 'entry' : 'entries'} pending</small>` : ''}</span><span>${sets.filter(set => set.completed).length}/${sets.length}</span></button>`;
      }).join('')}</div>
    </details>`;
    const pendingSet = pending && this.session.logs[pending.id]?.[this.pendingRir.setIdx];
    const effortPrompt = pending && !visible.includes(pending) && pendingSet?.completed && !pendingSet.rirAnswered ? `<aside class="pending-effort" aria-label="Last exercise effort">
      <p><strong>Last set: ${this.escapeHtml(pendingSet.exerciseName || pending.name)}</strong></p>${this.renderEffortPrompt(pending.id, this.pendingRir.setIdx, pendingSet)}
    </aside>` : '';
    this.exerciseListEl.innerHTML = `${effortPrompt}${this.focusedExerciseId && next && this.focusedExerciseId !== next.ex.id ? '<button type="button" class="secondary-btn return-next-btn">Return to next set</button>' : ''}
    ${visible.map(ex => this.renderExerciseCard(ex, ex.isOptional)).join('')}`;
    this.bindWorkoutCardEvents();
  }

  renderEffortPrompt(exId, setIdx, set) {
    return `<div class="rir-selector-row" data-exid="${exId}" data-setidx="${setIdx}" tabindex="-1" aria-label="Set ${setIdx + 1} effort">
      <span class="rir-prompt">Reps left in reserve</span>${[3,2,1,0].map(rir => `<button type="button" class="rir-chip ${set.rir === rir ? 'active' : ''}" data-exid="${exId}" data-setidx="${setIdx}" data-rir="${rir}" aria-label="${rir === 3 ? '3 or more' : rir} reps left in reserve" aria-pressed="${set.rir === rir}">${rir === 3 ? '3+' : rir}</button>`).join('')}<button type="button" class="rir-chip" data-exid="${exId}" data-setidx="${setIdx}" data-rir="skip">Skip effort</button>
    </div>`;
  }

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
    const conventionLabel = {'per-hand':'per hand', 'total':'total load', 'plates-only':'plates only; exclude Smith bar', 'including-bar':'including Smith bar'}[convention] || 'total load';
    const next = this.getNextSet();
    const allDone = sets.length > 0 && sets.every(set => set.completed);
    const pending = this.pendingRir && this.pendingRir.exId === ex.id;
    const collapsed = false; // Completed sets remain individually reviewable; effort is never hidden.
    const enabled = this.isSupersetEnabled(ex);
    const progression = this.getPreviousProgressionFlag(name, targetReps, this.deloadActive ? Math.max(2, Math.floor(ex.sets * .67)) : ex.sets, ex);
    const position = this.routine[this.activeDayIndex].exercises.findIndex(item => item.id === ex.id) + 1;
    const exerciseCount = this.routine[this.activeDayIndex].exercises.length;
    const seat = this.machineSettings[ex.id] || '';
    const note = this.exerciseNotes[name] || '';
    return `<article class="exercise-card focused-card ${allDone ? 'completed' : ''}" id="card_${ex.id}" data-exid="${ex.id}">
      <div class="card-header">
        <div class="focus-card-eyebrow">Exercise ${position} of ${exerciseCount} · ${this.escapeHtml(ex.muscle)}${isBonus ? ' · Optional' : ''}${enabled ? ` · Superset ${this.escapeHtml(ex.superset.tag)}` : ''}</div>
        <h3 class="exercise-name">${this.escapeHtml(name)}</h3>
        ${swapped ? `<div class="muted-text">Alternative for ${this.escapeHtml(ex.name)}</div>` : ''}
        <div class="focus-prescription">${sets.length} sets × ${this.escapeHtml(targetReps)} reps · Rest ${rest}</div>
        <div class="load-convention">Weight in lbs · ${conventionLabel}</div>
        <div class="exercise-heading-tools"><button type="button" class="warmup-btn secondary-btn" data-exid="${ex.id}" data-exname="${this.escapeHtml(name)}" ${sets.some(set => set.needsBaseline || set.weight === null) ? 'disabled title="Enter a baseline weight first"' : ''}>Warmup</button><button type="button" class="swap-btn secondary-btn" data-exid="${ex.id}" data-exname="${this.escapeHtml(ex.name)}">Swap equipment</button></div>
        <div class="saved-setup-cue" ${!seat && !note ? 'hidden' : ''}><span class="saved-seat-cue">${seat ? `Seat / pin: ${this.escapeHtml(seat)}` : ''}</span><span class="saved-note-cue">${this.escapeHtml(note)}</span></div>
      </div>
      ${collapsed ? `<button type="button" class="card-collapse-toggle-btn" data-exid="${ex.id}">✓ All sets complete · Review sets</button>` : `<div class="set-blocks">
      ${sets.map((set, idx) => {
        const prev = previous && previous.sets && previous.sets[idx];
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
        return `<section class="set-row set-block ${set.completed ? 'completed' : ''} ${next && next.ex.id === ex.id && next.setIdx === idx ? 'active-next-set' : ''}" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Set ${idx + 1}">
          <div class="set-heading" tabindex="-1"><strong>Set ${idx + 1}${next && next.ex.id === ex.id && next.setIdx === idx ? ' · Up next' : ''}</strong><span>Target ${this.escapeHtml(target.targetRepsDisplay)} reps${!needsBaseline && target.targetWeight > 0 ? ` · ${target.targetWeightDisplay} lb` : ''}</span></div>
          <div class="previous-set">Last: ${prev ? `${prev.weight === 0 ? 'BW' : prev.weight + ' lb'} × ${prev.reps}` : 'No previous set'}${set.completed && set.exerciseName && set.exerciseName !== name ? ` · Logged as ${this.escapeHtml(set.exerciseName)}` : ''}</div>
          ${needsBaseline ? '<p class="baseline-prompt">Enter a baseline weight for this equipment (0 for bodyweight).</p>' : ''}
          <div class="set-entry-grid">
            <label>Weight (lb)<span class="stepper-wrap weight-stepper"><button type="button" class="stepper-btn" data-type="weight" data-delta="-${increment}" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Decrease set ${idx + 1} weight by ${increment} pounds">−</button><input type="number" class="set-input set-weight-input" value="${set.weight === null ? '' : set.weight}" data-exid="${ex.id}" data-setidx="${idx}" min="0" step="${increment}" inputmode="decimal" placeholder="Enter" aria-label="Set ${idx + 1} weight in pounds"><button type="button" class="stepper-btn" data-type="weight" data-delta="${increment}" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Increase set ${idx + 1} weight by ${increment} pounds">+</button></span></label>
            <label>Reps<span class="stepper-wrap reps-stepper"><button type="button" class="stepper-btn" data-type="reps" data-delta="-1" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Decrease set ${idx + 1} reps">−</button><input type="number" class="set-input set-reps-input" value="${set.reps}" data-exid="${ex.id}" data-setidx="${idx}" min="0" step="1" inputmode="numeric" aria-label="Set ${idx + 1} reps"><button type="button" class="stepper-btn" data-type="reps" data-delta="1" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Increase set ${idx + 1} reps">+</button></span></label>
          </div>
          <button type="button" class="set-check-btn" data-exid="${ex.id}" data-setidx="${idx}" data-rest="${rest}" ${needsBaseline && !set.completed ? 'disabled' : ''} aria-pressed="${set.completed}">${set.completed ? '✓ Completed · Undo' : 'Complete set'}</button>
          ${set.completed ? `${this.renderEffortPrompt(ex.id, idx, set)}<button type="button" class="done-editing-set-btn secondary-btn" data-exid="${ex.id}" data-setidx="${idx}">Done editing</button>` : ''}
        </section>`;
      }).join('')}</div>`}
      <details class="exercise-details"><summary>Setup, notes & exercise options</summary>
        <div class="exercise-detail-content">
          <p>${this.escapeHtml(notes || '')}</p>
          ${video ? `<a class="video-link-btn" href="${this.escapeHtml(video)}" target="_blank" rel="noopener noreferrer">Watch form guide ↗</a>` : ''}
          <div class="exercise-option-buttons"><button type="button" class="prev-weight-pill-btn" data-exname="${this.escapeHtml(name)}">Performance history</button></div>
          ${ex.superset ? `<label class="superset-mode"><input type="checkbox" class="superset-enabled-input" data-group="${ex.superset.id}" ${enabled ? 'checked' : ''}> Alternate this superset</label><p class="muted-text">When off, use straight sets with at least 2 minutes of rest.</p>` : ''}
          <label>Weight increment<select class="exercise-increment-input" data-exname="${this.escapeHtml(name)}">${[1,2.5,5,10].map(value => `<option value="${value}" ${increment === value ? 'selected' : ''}>${value} lb</option>`).join('')}</select></label>
          <label>Weight convention<select class="exercise-convention-input" data-exname="${this.escapeHtml(name)}">${[['total','Total load'],['per-hand','Dumbbell weight per hand'],['plates-only','Smith plates only (exclude bar)'],['including-bar','Smith total including bar']].map(([value,label]) => `<option value="${value}" ${convention === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
          <p class="muted-text">Changing the label keeps your recorded numbers unchanged.</p>
          <label>Pin / seat<input type="text" class="machine-settings-input" value="${this.escapeHtml(this.machineSettings[ex.id] || '')}" data-exid="${ex.id}" placeholder="Seat #4, pin #8"></label>
          <label>Note to self<input type="text" class="exercise-note-input" value="${this.escapeHtml(this.exerciseNotes[name] || '')}" data-exname="${this.escapeHtml(name)}" data-exid="${ex.id}" placeholder="Setup or technique reminders"></label>
          ${progression.unlocked ? `<p>All previous sets reached ${progression.maxReps} reps. Progression step: ${progression.increment} lb.</p><button class="bump-weight-btn" data-exid="${ex.id}" data-bump="${sets[0] && sets[0].weight > progression.topWeight ? -progression.increment : progression.increment}">${sets[0] && sets[0].weight > progression.topWeight ? 'Revert' : 'Apply'} ${progression.increment} lb progression</button>` : ''}
          <div class="card-footer"><button type="button" class="add-set-btn" data-exid="${ex.id}">+ Add set</button>${sets.length > 1 ? `<button type="button" class="remove-set-btn icon-btn" data-exid="${ex.id}">− Remove set</button>` : ''}</div>
        </div>
      </details>
    </article>`;
  }

  bindWorkoutCardEvents() {
    this.sessionInfoEl.querySelectorAll('.overview-exercise').forEach(button => {
      button.addEventListener('click', () => {
        this.focusedExerciseId = button.dataset.exid;
        this.collapsedCards.delete(button.dataset.exid);
        this.renderWorkout();
        const overview = this.sessionInfoEl.querySelector('.workout-overview');
        if (overview) overview.open = false;
        const first = (this.session.logs[button.dataset.exid] || []).findIndex(set => !set.completed);
        this.revealWorkoutSet(button.dataset.exid, first >= 0 ? first : 0, true);
      });
    });
    this.exerciseListEl.querySelector('.return-next-btn')?.addEventListener('click', () => {
      this.jumpToActiveExercise();
    });
    this.exerciseListEl.querySelectorAll('.superset-enabled-input').forEach(input => {
      input.addEventListener('input', () => {
        this.session.disabledSupersets = this.session.disabledSupersets || {};
        this.session.disabledSupersets[input.dataset.group] = !input.checked;
        this.saveCurrentSession();
        this.renderWorkout();
      });
    });
    this.exerciseListEl.querySelectorAll('.exercise-increment-input, .exercise-convention-input').forEach(input => {
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
    this.exerciseListEl.querySelectorAll('.edit-set-btn').forEach(button => {
      button.addEventListener('click', () => {
        const exId = button.dataset.exid;
        const setIdx = Number(button.dataset.setidx);
        this.editingCompletedSet = {exId, setIdx};
        this.focusedExerciseId = exId;
        this.renderWorkout();
        this.revealWorkoutSet(exId, setIdx, true);
      });
    });
    this.exerciseListEl.querySelectorAll('.done-editing-set-btn').forEach(button => {
      button.addEventListener('click', () => {
        const exId = button.dataset.exid;
        const setIdx = Number(button.dataset.setidx);
        this.editingCompletedSet = null;
        this.renderWorkout();
        this.revealWorkoutSet(exId, setIdx, true);
      });
    });
    // Optional finisher drawer toggle
    const optHeader = document.getElementById('optionalToggleHeader');
    const optList = document.getElementById('optionalCardsList');
    const optPill = document.getElementById('optionalTogglePill');
    if (optHeader && optList) {
      optHeader.addEventListener('click', () => {
        const isOpen = optList.classList.toggle('open');
        // Keep the drawer state when set edits rebuild the workout cards.
        const dayId = this.routine[this.activeDayIndex].id;
        if (isOpen) {
          this.expandedOptionalDays.add(dayId);
        } else {
          this.expandedOptionalDays.delete(dayId);
        }
        if (optPill) {
          optPill.textContent = isOpen ? 'Hide Finisher ▴' : 'View Finisher (+5m) ▾';
        }
      });
    }

    // Warmup ramp buttons
    this.exerciseListEl.querySelectorAll('.warmup-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const exId = btn.dataset.exid;
        const exName = btn.dataset.exname;
        this.openWarmupModal(exId, exName);
      });
    });

    // Equipment swap buttons
    this.exerciseListEl.querySelectorAll('.swap-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const exId = btn.dataset.exid;
        const exName = btn.dataset.exname;
        this.openSwapModal(exId, exName);
      });
    });

    // Prev weight pill buttons (Quick Performance Sheet)
    this.exerciseListEl.querySelectorAll('.prev-weight-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const exName = btn.dataset.exname;
        this.openQuickHistoryModal(exName);
      });
    });

    // Stepper (+ / -) buttons for weight and reps
    this.exerciseListEl.querySelectorAll('.stepper-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
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
          const cur = parseInt(list[setIdx].reps, 10) || 0;
          const nextVal = Math.max(0, cur + delta);
          this.updateSetReps(exId, setIdx, nextVal);
        }
      });
    });

    // Card collapse toggle buttons
    this.exerciseListEl.querySelectorAll('.card-collapse-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const exId = btn.dataset.exid;
        if (this.collapsedCards.has(exId)) {
          this.collapsedCards.delete(exId);
        } else {
          this.collapsedCards.add(exId);
        }
        this.renderWorkout();
      });
    });

    // Check buttons
    this.exerciseListEl.querySelectorAll('.set-check-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const exId = btn.dataset.exid;
        const setIdx = parseInt(btn.dataset.setidx, 10);
        const rest = btn.dataset.rest;
        this.focusedExerciseId = null;
        this.editingCompletedSet = null;
        this.toggleSetCompletion(exId, setIdx, rest);
        if (this.session.logs[exId]?.[setIdx]?.completed) this.jumpToActiveExercise({automatic: true});
      });
    });

    // Bump weight (+5 lbs) button
    this.exerciseListEl.querySelectorAll('.bump-weight-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const exId = btn.dataset.exid;
        const bump = parseFloat(btn.dataset.bump) || 5;
        this.bumpExerciseWeight(exId, bump);
      });
    });

    // Weight and Rep input changes - auto-save immediately to persistent store
    this.exerciseListEl.querySelectorAll('.set-weight-input').forEach(input => {
      input.addEventListener('input', () => {
        const exId = input.dataset.exid;
        const setIdx = parseInt(input.dataset.setidx, 10);
        const val = input.value === '' ? null : parseFloat(input.value);
        this.updateSetWeight(exId, setIdx, val);
      });
    });

    this.exerciseListEl.querySelectorAll('.set-reps-input').forEach(input => {
      input.addEventListener('input', () => {
        const exId = input.dataset.exid;
        const setIdx = parseInt(input.dataset.setidx, 10);
        this.updateSetReps(exId, setIdx, input.value);
      });
    });

    // Machine Settings input changes
    this.exerciseListEl.querySelectorAll('.machine-settings-input').forEach(input => {
      input.addEventListener('input', () => {
        const exId = input.dataset.exid;
        this.machineSettings[exId] = input.value;
        this.saveMachineSettings();
        const cue = input.closest('.exercise-card').querySelector('.saved-seat-cue');
        if (cue) { cue.textContent = input.value ? 'Seat / pin: ' + input.value : ''; cue.parentElement.hidden = !cue.parentElement.textContent.trim(); }
      });
    });

    // Exercise Notes input changes
    this.exerciseListEl.querySelectorAll('.exercise-note-input').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.dataset.exname || input.dataset.exid;
        this.exerciseNotes[key] = input.value.trim();
        this.saveExerciseNotes();
        const cue = input.closest('.exercise-card').querySelector('.saved-note-cue');
        if (cue) { cue.textContent = input.value.trim(); cue.parentElement.hidden = !cue.parentElement.textContent.trim(); }
      });
    });

    // RIR selector chips
    this.exerciseListEl.querySelectorAll('.rir-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const exId = chip.dataset.exid;
        const setIdx = parseInt(chip.dataset.setidx, 10);
        const rir = chip.dataset.rir === 'skip' ? null : parseInt(chip.dataset.rir, 10);
        this.setSetRIR(exId, setIdx, rir);
        if (!this.editingCompletedSet) this.jumpToActiveExercise({automatic: true});
      });
    });

    // Add / Remove Set buttons
    this.exerciseListEl.querySelectorAll('.add-set-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const exId = btn.dataset.exid;
        this.addSetToExercise(exId);
      });
    });

    this.exerciseListEl.querySelectorAll('.remove-set-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const exId = btn.dataset.exid;
        this.removeLastSetFromExercise(exId);
      });
    });

    this.updateNowLiftingHUD();
  }

  toggleSetCompletion(exId, setIdx, restStr) {
    const setObj = this.session.logs[exId] && this.session.logs[exId][setIdx];
    if (!setObj) return;
    const ex = this.findExerciseById(exId);
    const validationError = this.getSetValidationError(setObj);
    if (!setObj.completed && validationError) {
      this.showToast(validationError);
      return;
    }

    if (this.session && !this.session.startTime) {
      this.session.startTime = new Date().toISOString();
    }

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
    this.saveCurrentSession();

    // Tactile haptic pulse on completing set
    this.triggerHaptic([40]);

    // Trigger Rest Timer if marking as completed
    if (setObj.completed) {
      this.primeAudioContext();

      // Keep the final effort prompt accessible until answered or skipped.
      const list = this.session.logs[exId] || [];
      if (list.length > 0 && list.every(s => s.completed)) {
        this.pendingRir = { exId, setIdx };
        this.collapsedCards.delete(exId);
      }

      const restSeconds = this.getRestSeconds(ex);
      this.startTimer(restSeconds, this.isSupersetEnabled(ex) ? 0 : 120);
    } else {
      // If unchecked, uncollapse
      this.collapsedCards.delete(exId);
      if (this.pendingRir?.exId === exId) this.pendingRir = null;
    }

    this.renderWorkout();
    this.updateNowLiftingHUD();
  }

  addSetToExercise(exId) {
    const list = this.session.logs[exId];
    const ex = this.findExerciseById(exId);
    if (!list || !ex) return;
    const activeSwap = this.session.swaps?.[exId];
    const effectiveName = this.getEffectiveExerciseName(exId, ex);
    const currentSets = list.filter(set => set.exerciseName === effectiveName ||
      (!set.exerciseName && !activeSwap && !ex.needsBaseline));
    const lastSet = currentSets[currentSets.length - 1];
    const lastLoadedSet = [...currentSets].reverse().find(set => !set.needsBaseline && Number.isFinite(set.weight));
    const target = this.getSetTarget(ex, currentSets.length, effectiveName);
    const weight = lastLoadedSet ? lastLoadedSet.weight : target.targetWeight;
    list.push({
      setNum: list.length + 1,
      weight,
      reps: lastSet ? lastSet.reps : target.targetReps,
      completed: false,
      rir: null,
      exerciseName: effectiveName,
      muscle: activeSwap?.muscle || ex.muscle,
      targetReps: activeSwap?.targetReps || ex.targetReps,
      needsBaseline: !Number.isFinite(weight)
    });
    this.saveCurrentSession();
    this.renderWorkout();
  }

  removeLastSetFromExercise(exId) {
    const list = this.session.logs[exId];
    if (list && list.length > 1) {
      list.pop();
      this.saveCurrentSession();
      this.renderWorkout();
    }
  }

  updateNowLiftingHUD() {
    const dock = document.getElementById('nowLiftingDock');
    if (!dock) return;
    const next = this.activeView === 'workout' && this.session ? this.getNextSet() : null;
    if (!next) { dock.style.display = 'none'; return; }
    const set = this.session.logs[next.ex.id][next.setIdx];
    const name = this.getEffectiveExerciseName(next.ex.id, next.ex);
    const swap = this.session.swaps && this.session.swaps[next.ex.id];
    const targetReps = (swap && swap.targetReps) || next.ex.targetReps;
    document.getElementById('nowLiftingTitle').textContent = name;
    document.getElementById('nowLiftingMeta').textContent = `Next: set ${next.setIdx + 1} · ${targetReps} reps · ${set.weight === null ? 'Enter baseline' : set.weight + ' lb'}`;
    dock.dataset.activeExid = next.ex.id;
    dock.style.display = 'flex';
  }

  revealWorkoutSet(exId, setIdx, focus = false, automatic = false) {
    // Value-entry handlers preserve their input nodes; navigation must not steal their keyboard.
    if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
    const row = this.exerciseListEl.querySelector(`.set-row[data-exid="${exId}"][data-setidx="${setIdx}"]`);
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
      window.scrollTo({top: targetTop, behavior: automatic || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    }
    if (focus) (row.querySelector('.set-heading, .edit-set-btn, .rir-selector-row') || row).focus({preventScroll: true});
  }

  jumpToActiveExercise({automatic = false} = {}) {
    if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
    const next = this.getNextSet();
    if (!next) {
      const effort = this.exerciseListEl.querySelector('.rir-selector-row');
      if (effort) { effort.scrollIntoView({block: 'center', behavior: 'instant'}); effort.focus({preventScroll: true}); }
      return;
    }
    const selector = `.set-row[data-exid="${next.ex.id}"][data-setidx="${next.setIdx}"]`;
    this.focusedExerciseId = null;
    this.collapsedCards.delete(next.ex.id);
    if (!this.exerciseListEl.querySelector(selector)) this.renderWorkout();
    this.revealWorkoutSet(next.ex.id, next.setIdx, true, automatic);
  }

  // Rest Timer Controller
  primeAudioContext() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      // Play a 1-sample silent sound to unlock audio playback in mobile Safari
      const buffer = this.audioCtx.createBuffer(1, 1, 22050);
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioCtx.destination);
      source.start(0);
    } catch (e) {
      console.warn('Audio priming:', e);
    }
  }

  async requestWakeLock() {
    if (!this.wakeLockEnabled || this.activeView !== 'workout') {
      this.updateWakeLockBadge(false, 'Disabled');
      return;
    }
    try {
      if ('wakeLock' in navigator) {
        if (!this.wakeLock) {
          this.wakeLock = await navigator.wakeLock.request('screen');
          this.wakeLock.addEventListener('release', () => {
            this.wakeLock = null;
            this.updateWakeLockBadge(false);
          });
        }
        this.updateWakeLockBadge(true);
      } else {
        this.updateWakeLockBadge(false, 'Unsupported');
      }
    } catch (e) {
      console.warn('Wake Lock request error:', e);
      this.wakeLock = null;
      this.updateWakeLockBadge(false, 'Inactive');
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      try {
        this.wakeLock.release();
      } catch (e) {}
      this.wakeLock = null;
    }
    this.updateWakeLockBadge(false);
  }

  updateWakeLockBadge(isActive, message) {
    if (!this.wakeLockBadgeEl) return;
    if (isActive) {
      this.wakeLockBadgeEl.classList.add('active');
      this.wakeLockBadgeEl.innerHTML = '🛡️ <span class="wake-dot">●</span> Screen Awake';
      this.wakeLockBadgeEl.title = 'Screen will stay awake during your workout';
    } else {
      this.wakeLockBadgeEl.classList.remove('active');
      const label = message && message !== 'Inactive' ? `Screen Sleep (${message})` : 'Screen Sleep';
      this.wakeLockBadgeEl.innerHTML = `🛡️ ${label}`;
      this.wakeLockBadgeEl.title = 'Screen wake lock is not active';
    }
  }

  triggerHaptic(pattern = [200, 100, 200, 100, 400]) {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {}
    }
  }

  showToast(message) {
    const existing = document.querySelector('.app-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'app-toast timer-complete-toast show';
    toast.style.background = '#1e293b';
    toast.style.borderColor = 'var(--accent-blue)';
    toast.style.color = '#fff';
    toast.style.top = '75px';
    toast.innerHTML = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 3200);
  }

  // Equipment Swapper Controller
  getSubstitutionsForExercise(exerciseName, exercise) {
    if (typeof EXERCISE_SUBSTITUTIONS !== 'undefined') {
      // 1. Direct match
      if (EXERCISE_SUBSTITUTIONS[exerciseName]) {
        return EXERCISE_SUBSTITUTIONS[exerciseName];
      }
      // 2. Partial / cleaned match
      const cleanName = exerciseName.replace(/\s*\(alt for.*?\)/i, '').trim();
      if (EXERCISE_SUBSTITUTIONS[cleanName]) {
        return EXERCISE_SUBSTITUTIONS[cleanName];
      }
      // 3. Substring match in keys
      for (const key of Object.keys(EXERCISE_SUBSTITUTIONS)) {
        if (cleanName.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(cleanName.toLowerCase())) {
          return EXERCISE_SUBSTITUTIONS[key];
        }
      }
    }
    // 4. Fallback based on muscle group
    return [
      { name: `Dumbbell Alternative (${exercise ? exercise.muscle : 'Lift'})`, type: 'Dumbbell', muscle: exercise ? exercise.muscle : '', targetReps: '8–12', notes: 'Perform with controlled tempo and full range of motion.', videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(exerciseName + ' dumbbell alternative')}` },
      { name: `Cable Alternative (${exercise ? exercise.muscle : 'Lift'})`, type: 'Cable', muscle: exercise ? exercise.muscle : '', targetReps: '10–12', notes: 'Maintain steady cable tension throughout the movement.', videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(exerciseName + ' cable alternative')}` }
    ];
  }

  openSwapModal(exId, exName) {
    const ex = this.findExerciseById(exId);
    const subs = this.getSubstitutionsForExercise(exName, ex);
    const currentName = ex ? ex.name : exName;

    if (this.swapModalTitleEl) {
      this.swapModalTitleEl.textContent = `🔄 Equipment Swap: ${currentName}`;
    }

    if (this.swapContentEl) {
      const isCurrentlySwapped = Boolean(this.session && this.session.swaps && this.session.swaps[exId]);
      this.swapContentEl.innerHTML = `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--radius-md); padding: 12px; margin-bottom: 14px;">
          <div style="font-size: 0.74rem; color: var(--text-muted); text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em;">Current Exercise</div>
          <div style="font-size: 0.95rem; font-weight: 700; color: #fff; margin-top: 2px;">${this.escapeHtml(currentName)}</div>
          <div style="font-size: 0.78rem; color: var(--accent-blue); margin-top: 2px;">Target: ${ex ? ex.targetReps : '8–12'} reps • ${ex ? ex.muscle : ''}</div>
        </div>

        ${isCurrentlySwapped ? `
          <div style="margin-bottom: 14px;">
            <button type="button" id="restoreSwapBtn" style="width: 100%; padding: 10px; background: rgba(59, 130, 246, 0.15); border: 1px solid var(--accent-blue); color: var(--accent-blue); border-radius: var(--radius-md); font-weight: 700; cursor: pointer;">
              ↩️ Restore Original (${this.escapeHtml(ex ? ex.name : exName)})
            </button>
          </div>
        ` : ''}

        <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px;">
          Select Alternative (${subs.length} available):
        </div>

        <div class="swap-options-list">
          ${subs.map((sub, sIdx) => `
            <div class="swap-option-card">
              <div class="swap-option-header">
                <div>
                  <span class="swap-type-badge ${sub.type.toLowerCase().replace(/\s+/g, '-')}">${sub.type}</span>
                  <div class="swap-option-name">${this.escapeHtml(sub.name)}</div>
                </div>
                ${sub.videoUrl ? `
                  <a href="${sub.videoUrl}" target="_blank" rel="noopener noreferrer" class="video-link-btn" style="font-size: 0.7rem; padding: 3px 8px;">
                    ▶ Form
                  </a>
                ` : ''}
              </div>
              <div class="swap-option-notes">${this.escapeHtml(sub.notes || 'Target: ' + sub.targetReps + ' reps.')}</div>
              <div class="swap-actions">
                <button type="button" class="swap-btn-today" data-exid="${exId}" data-subidx="${sIdx}">
                  ⚡ Today Only
                </button>
                <button type="button" class="swap-btn-perm" data-exid="${exId}" data-subidx="${sIdx}">
                  💾 Replace in Routine
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `;

      // Bind restore button
      document.getElementById('restoreSwapBtn')?.addEventListener('click', () => {
        if (this.session && this.session.swaps) {
          delete this.session.swaps[exId];
        }
        // Recalculate uncompleted sets back to original targets
        const sets = (this.session && this.session.logs && this.session.logs[exId]) || [];
        sets.forEach((s, sIdx) => {
          if (!s.completed && ex) {
            const target = this.getSetTarget(ex, sIdx, ex.name);
            s.weight = target.targetWeight;
            s.reps = target.targetReps;
          }
        });
        this.saveCurrentSession();
        if (this.swapModalEl) this.swapModalEl.classList.remove('open');
        this.showToast(`↩️ Restored original exercise "${ex ? ex.name : exName}"!`);
        this.renderWorkout();
      });

      // Bind swap action buttons
      this.swapContentEl.querySelectorAll('.swap-btn-today').forEach(btn => {
        btn.addEventListener('click', () => {
          const sIdx = parseInt(btn.dataset.subidx, 10);
          this.applyExerciseSwap(exId, subs[sIdx], 'today');
        });
      });

      this.swapContentEl.querySelectorAll('.swap-btn-perm').forEach(btn => {
        btn.addEventListener('click', () => {
          const sIdx = parseInt(btn.dataset.subidx, 10);
          this.applyExerciseSwap(exId, subs[sIdx], 'permanent');
        });
      });
    }

    if (this.swapModalEl) this.swapModalEl.classList.add('open');
  }

  applyExerciseSwap(exId, sub, mode) {
    const ex = this.findExerciseById(exId);
    if (!ex) return;
    const previousName = this.getEffectiveExerciseName(exId, ex);
    const previousSwap = this.session?.swaps?.[exId];
    const sets = this.session?.logs?.[exId] || [];
    sets.filter(s => s.completed).forEach(s => {
      s.exerciseName = s.exerciseName || previousName;
      s.muscle = s.muscle || previousSwap?.muscle || ex.muscle;
      s.targetReps = s.targetReps || previousSwap?.targetReps || ex.targetReps;
    });
    const hasHistory = Boolean(this.getPreviousExercisePerformance(sub.name));

    if (mode === 'permanent') {
      const oldName = ex.name;
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
      this.saveRoutine();
      this.showToast(`✅ Replaced "${oldName}" with "${sub.name}" permanently in your routine!`);
    } else {
      // Today only: mark in session
      if (!this.session.swaps) this.session.swaps = {};
      this.session.swaps[exId] = sub;
      this.showToast(`⚡ Swapped to "${sub.name}" for today's workout!`);
    }

    // Recalculate uncompleted sets in this.session.logs[exId]
    const effectiveName = sub.name;
    sets.forEach((s, sIdx) => {
      if (!s.completed) {
        const target = this.getSetTarget(ex, sIdx, effectiveName);
        s.weight = hasHistory ? target.targetWeight : null;
        s.reps = target.targetReps;
        s.needsBaseline = !hasHistory;
        s.exerciseName = effectiveName;
        s.muscle = sub.muscle || ex.muscle;
        s.targetReps = target.targetRepsDisplay;
        s.rir = null;
      }
    });
    this.saveCurrentSession();

    if (this.swapModalEl) this.swapModalEl.classList.remove('open');
    this.renderWorkout();
  }

  // Warmup Pyramid Calculator Controller
  openWarmupModal(exId, exName, targetWeight = null, targetReps = null) {
    const ex = this.findExerciseById(exId);
    const sessionSets = (this.session && this.session.logs && this.session.logs[exId]) || [];
    
    const effectiveName = ex ? this.getEffectiveExerciseName(exId, ex) : exName;
    const matchingSets = sessionSets.filter(set => !set.exerciseName || set.exerciseName === effectiveName);
    const workingSet = matchingSets.find(set => !set.completed && Number.isFinite(set.weight)) || matchingSets.find(set => Number.isFinite(set.weight));
    const weight = Number.isFinite(targetWeight) && targetWeight > 0 ? targetWeight : workingSet?.weight;
    if (!Number.isFinite(weight) || weight <= 0) {
      this.showToast('Enter a working load for this equipment before calculating a warmup.');
      return;
    }
    const repsStr = targetReps || this.session?.swaps?.[exId]?.targetReps || ex?.targetReps || '8–10';
    if (this.warmupModalTitleEl) this.warmupModalTitleEl.textContent = `Warm-Up Ramp: ${effectiveName}`;

    this.renderWarmupModalContent(exId, effectiveName, weight, repsStr);
    if (this.warmupModalEl) this.warmupModalEl.classList.add('open');
  }

  renderWarmupModalContent(exId, exName, workingWeight, repsStr) {
    if (!this.warmupContentEl) return;

    // Calculate smart ramp pyramid:
    // Warmup 1: 50% for 10 reps (neural prep & synovial fluid)
    const w1 = Math.max(10, Math.round((workingWeight * 0.50) / 5) * 5);
    // Warmup 2: 70% for 5 reps (grooving motor pathway)
    const w2 = Math.max(15, Math.round((workingWeight * 0.70) / 5) * 5);
    // Warmup 3: 85% for 2 reps (neural potentiation, acclimation)
    const w3 = Math.max(20, Math.round((workingWeight * 0.85) / 5) * 5);

    this.warmupContentEl.innerHTML = `
      <div class="warmup-target-box">
        <div>
          <div style="font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.05em; color: #fbbf24; font-weight: 800;">Target Working Weight</div>
          <div style="font-size: 1.15rem; font-weight: 800; color: #fff;">${workingWeight} lbs <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">(${repsStr} reps)</span></div>
        </div>
        <div class="warmup-target-input-group">
          <button type="button" class="stepper-btn" id="warmupMinus5" style="width: 36px; height: 36px;">−5</button>
          <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); padding: 0 4px;">Adjust</span>
          <button type="button" class="stepper-btn" id="warmupPlus5" style="width: 36px; height: 36px;">+5</button>
        </div>
      </div>

      <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px;">
        Prep Ramp (3 Neural Acclimation Sets):
      </div>

      <div class="warmup-step-card">
        <div class="warmup-step-badge">Ramp 1</div>
        <div class="warmup-step-info">
          <div class="warmup-step-title">
            <span>${w1} lbs × 10 reps</span>
            <span style="font-size: 0.75rem; color: #fbbf24; font-weight: 700;">(50%)</span>
          </div>
          <div class="warmup-step-desc">Neural activation & synovial fluid flow. Move with brisk cadence.</div>
        </div>
      </div>

      <div class="warmup-step-card">
        <div class="warmup-step-badge">Ramp 2</div>
        <div class="warmup-step-info">
          <div class="warmup-step-title">
            <span>${w2} lbs × 5 reps</span>
            <span style="font-size: 0.75rem; color: #fbbf24; font-weight: 700;">(70%)</span>
          </div>
          <div class="warmup-step-desc">Motor pattern grooving. Crisp form, moderate speed.</div>
        </div>
      </div>

      <div class="warmup-step-card">
        <div class="warmup-step-badge">Ramp 3</div>
        <div class="warmup-step-info">
          <div class="warmup-step-title">
            <span>${w3} lbs × 2 reps</span>
            <span style="font-size: 0.75rem; color: #fbbf24; font-weight: 700;">(85%)</span>
          </div>
          <div class="warmup-step-desc">Heavy neural potentiation. Zero fatigue build-up.</div>
        </div>
      </div>

      <div class="warmup-step-card" style="border-color: rgba(16, 185, 129, 0.35); background: rgba(16, 185, 129, 0.05);">
        <div class="warmup-step-badge working">Working</div>
        <div class="warmup-step-info">
          <div class="warmup-step-title" style="color: #34d399;">
            <span>${workingWeight} lbs × ${repsStr} reps</span>
            <span style="font-size: 0.75rem; color: #34d399; font-weight: 700;">(100%)</span>
          </div>
          <div class="warmup-step-desc" style="color: #a7f3d0;">Your working sets! Track progress on table below.</div>
        </div>
      </div>

      <div style="margin-top: 14px; text-align: center;">
        <button type="button" class="primary-btn" id="closeWarmupModalBtnInner" style="width: 100%;">
          Got it, Ready to Lift!
        </button>
      </div>
    `;

    document.getElementById('warmupMinus5')?.addEventListener('click', () => {
      const nextW = Math.max(10, workingWeight - 5);
      this.renderWarmupModalContent(exId, exName, nextW, repsStr);
    });

    document.getElementById('warmupPlus5')?.addEventListener('click', () => {
      const nextW = workingWeight + 5;
      this.renderWarmupModalContent(exId, exName, nextW, repsStr);
    });

    document.getElementById('closeWarmupModalBtnInner')?.addEventListener('click', () => {
      if (this.warmupModalEl) this.warmupModalEl.classList.remove('open');
    });
  }

  // Quick Performance History Controller
  openQuickHistoryModal(exerciseName) {
    if (this.quickHistoryTitleEl) {
      this.quickHistoryTitleEl.textContent = `📈 ${exerciseName}`;
    }

    const pr = this.getPersonalRecord(exerciseName);
    const historyList = this.getExerciseHistoryOverTime(exerciseName);

    if (this.quickHistoryContentEl) {
      this.quickHistoryContentEl.innerHTML = `
        <div class="quick-pr-card">
          <div>
            <div style="font-size: 0.75rem; color: #f59e0b; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">All-Time Records</div>
            <div style="font-size: 1.25rem; font-weight: 800; color: #fff; margin-top: 2px;">
              ${pr.maxWeight > 0 ? `${pr.maxWeight} lbs` : '—'} 
              <span style="font-size: 0.82rem; font-weight: 600; color: var(--text-muted);">(Est 1RM: ${pr.max1RM > 0 ? pr.max1RM + ' lbs' : '—'})</span>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.75rem; color: var(--text-muted);">Best Reps</div>
            <div style="font-size: 1.1rem; font-weight: 800; color: var(--accent-emerald);">${pr.bestReps > 0 ? pr.bestReps : '—'}</div>
          </div>
        </div>

        <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px;">
          Session History (${historyList.length} recorded):
        </div>

        <div class="quick-history-list">
          ${historyList.length === 0 ? `
            <div style="text-align: center; padding: 24px 12px; color: var(--text-muted); font-size: 0.85rem;">
              No completed sessions recorded for this exercise yet. Your sets today will be saved when you finish!
            </div>
          ` : historyList.slice(-8).reverse().map(item => {
            const dateStr = new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            return `
              <div class="quick-history-session-card">
                <div class="quick-history-session-header">
                  <div class="quick-history-date">📅 ${dateStr}</div>
                  <div class="quick-history-day">${this.escapeHtml(item.dayTitle || '')}</div>
                </div>
                <div style="font-size: 0.85rem; font-weight: 700; color: var(--accent-blue); margin-bottom: 4px;">
                  ${item.sets ? item.sets.filter(Boolean).map(s => `${s.weight}lbs×${s.reps}`).join(' • ') : '—'}
                </div>
                <div style="font-size: 0.74rem; color: var(--text-muted);">
                  Top Weight: ${item.maxWeight} lbs • Volume: ${item.totalVolume.toLocaleString()} lbs
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    if (this.quickHistoryModalEl) this.quickHistoryModalEl.classList.add('open');
  }

  requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        Notification.requestPermission();
      } catch (e) {}
    }
  }

  triggerTimerNotification() {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.ready.then(reg => {
            reg.showNotification('Rest Completed! 🏋️‍♂️', {
              body: 'Time for your next set! Let\'s get it.',
              icon: './icon-192.png',
              badge: './icon-192.png',
              vibrate: [250, 100, 250, 100, 400],
              tag: 'rest-timer'
            });
          });
        } else {
          new Notification('Rest Completed! 🏋️‍♂️', {
            body: 'Time for your next set! Let\'s get it.',
            icon: './icon-192.png'
          });
        }
      } catch (e) {}
    }
  }

  startTimer(seconds, minimumDuration = 120) {
    this.stopTimer(false);
    this.primeAudioContext();
    this.requestWakeLock();
    this.requestNotificationPermission();

    seconds = Math.max(minimumDuration, this.parseRestSeconds(seconds));
    const startedAt = Date.now();
    const targetEndTime = startedAt + (seconds * 1000);
    this.timer.startedAt = startedAt;
    this.timer.minimumDuration = minimumDuration;
    this.timer.totalDuration = seconds;
    this.timer.targetEndTime = targetEndTime;
    this.timer.remaining = seconds;
    this.timer.active = true;

    localStorage.setItem(this.storageKeys.timerTargetEnd, String(targetEndTime));
    localStorage.setItem(this.storageKeys.timerTotalDuration, String(seconds));
    localStorage.setItem('gym_timer_started_at_v1', String(startedAt));
    localStorage.setItem('gym_timer_minimum_v1', String(minimumDuration));

    this.updateTimerUI();
    this.timerDockEl.classList.add('active');
    document.body.classList.add('timer-active');

    this.timer.intervalId = setInterval(() => {
      this.tickTimer();
    }, 1000);
  }

  tickTimer() {
    if (!this.timer.active) return;
    const remaining = Math.max(0, Math.ceil((this.timer.targetEndTime - Date.now()) / 1000));
    this.timer.remaining = remaining;
    this.updateTimerUI();

    if (remaining <= 0) {
      this.onTimerFinished();
    }
  }

  onTimerFinished() {
    // Another tab or a newer set may already have started a different timer.
    const savedEnd = Number(localStorage.getItem(this.storageKeys.timerTargetEnd));
    if (savedEnd && savedEnd !== this.timer.targetEndTime) {
      this.syncTimerFromBackground();
      return;
    }
    this.stopTimer(true);
    this.playTimerAlarm();
    this.showRestCompleteBanner();
  }

  syncTimerFromBackground() {
    const savedEnd = localStorage.getItem(this.storageKeys.timerTargetEnd);
    const savedTotal = localStorage.getItem(this.storageKeys.timerTotalDuration);
    if (!savedEnd) return;

    const targetEndTime = parseInt(savedEnd, 10);
    const totalDuration = parseInt(savedTotal, 10) || 120;
    const now = Date.now();
    const remaining = Math.ceil((targetEndTime - now) / 1000);
    if (!Number.isFinite(targetEndTime)) return;
    this.timer.targetEndTime = targetEndTime;
    this.timer.startedAt = Number(localStorage.getItem('gym_timer_started_at_v1')) || targetEndTime - totalDuration * 1000;
    const savedMinimum = localStorage.getItem('gym_timer_minimum_v1');
    this.timer.minimumDuration = savedMinimum === null ? Math.min(120, totalDuration) : Number(savedMinimum);

    if (remaining > 0) {
      this.timer.totalDuration = totalDuration;
      this.timer.targetEndTime = targetEndTime;
      this.timer.remaining = remaining;
      this.timer.active = true;
      this.updateTimerUI();
      this.timerDockEl.classList.add('active');
      document.body.classList.add('timer-active');
      this.requestWakeLock();
      if (!this.timer.intervalId) {
        this.timer.intervalId = setInterval(() => this.tickTimer(), 1000);
      }
    } else if (remaining <= 0) {
      this.onTimerFinished();
    }
  }

  restoreActiveTimer() {
    const savedEnd = localStorage.getItem(this.storageKeys.timerTargetEnd);
    if (savedEnd) {
      const targetEndTime = parseInt(savedEnd, 10);
      if (targetEndTime > Date.now()) {
        this.syncTimerFromBackground();
      } else {
        this.timer.targetEndTime = targetEndTime;
        this.stopTimer(true);
      }
    }
  }

  stopTimer(clearStorage = true) {
    if (this.timer.intervalId) {
      clearInterval(this.timer.intervalId);
      this.timer.intervalId = null;
    }
    this.timer.active = false;
    if (this.activeView !== 'workout' || !this.wakeLockEnabled) {
      this.releaseWakeLock();
    }
    if (clearStorage && Number(localStorage.getItem(this.storageKeys.timerTargetEnd)) === this.timer.targetEndTime) {
      localStorage.removeItem(this.storageKeys.timerTargetEnd);
      localStorage.removeItem(this.storageKeys.timerTotalDuration);
      localStorage.removeItem('gym_timer_started_at_v1');
      localStorage.removeItem('gym_timer_minimum_v1');
    }
    this.timerDockEl.classList.remove('active');
    document.body.classList.remove('timer-active');
  }

  adjustTimer(delta) {
    if (!this.timer.active) return;
    this.timer.targetEndTime = Math.max(
      this.timer.targetEndTime + delta * 1000,
      this.timer.startedAt + this.timer.minimumDuration * 1000,
      Date.now() + 1000
    );
    const newRemaining = Math.max(1, Math.ceil((this.timer.targetEndTime - Date.now()) / 1000));
    this.timer.remaining = newRemaining;
    this.timer.totalDuration = Math.ceil((this.timer.targetEndTime - this.timer.startedAt) / 1000);
    localStorage.setItem(this.storageKeys.timerTargetEnd, String(this.timer.targetEndTime));
    localStorage.setItem(this.storageKeys.timerTotalDuration, String(this.timer.totalDuration));
    this.updateTimerUI();
  }

  skipTimer() {
    if (this.timer.active && Date.now() < this.timer.startedAt + this.timer.minimumDuration * 1000) {
      this.showToast('Your two-minute minimum rest is still running.');
      return false;
    }
    this.stopTimer();
    return true;
  }

  getMinimumRestLabel() {
    const minimum = Number(this.timer.minimumDuration) || 0;
    const remaining = Math.max(0, Math.ceil(((Number(this.timer.startedAt) || 0) + minimum * 1000 - Date.now()) / 1000));
    if (minimum > 0 && remaining > 0) {
      return `Minimum rest: ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} left`;
    }
    return minimum > 0 ? 'Minimum rest complete' : 'Superset rest';
  }

  updateTimerUI() {
    const mins = Math.floor(this.timer.remaining / 60);
    const secs = this.timer.remaining % 60;
    this.timerDisplayEl.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    const pct = ((this.timer.totalDuration - this.timer.remaining) / this.timer.totalDuration) * 100;
    this.timerProgressBarEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    const status = document.getElementById('timerMinimumStatus');
    if (status) status.textContent = this.getMinimumRestLabel();
    const skip = document.getElementById('timerSkipBtn');
    if (skip) {
      skip.disabled = this.timer.active && Date.now() < this.timer.startedAt + this.timer.minimumDuration * 1000;
      skip.title = skip.disabled ? 'Available after two minutes of rest' : 'Finish rest';
    }
  }

  playTimerAlarm() {
    // Vibration if available on mobile
    if (navigator.vibrate) {
      try {
        navigator.vibrate([250, 100, 250, 100, 400]);
      } catch (e) {}
    }

    // Audible Web Audio Chime (Ascending 3-tone chime: D5 -> G5 -> B5)
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        if (!this.audioCtx) this.audioCtx = new AudioContextClass();
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        const ctx = this.audioCtx;

        const playTone = (freq, start, duration) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
          gain.gain.setValueAtTime(0.45, ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + start + duration);
        };

        playTone(587.33, 0, 0.2);     // D5
        playTone(783.99, 0.22, 0.2);  // G5
        playTone(987.77, 0.44, 0.45); // B5
      }
    } catch (e) {
      console.warn('Audio alarm chime error:', e);
    }

    this.triggerTimerNotification();
  }

  showRestCompleteBanner() {
    const existing = document.querySelector('.timer-complete-toast');
    if (existing) existing.remove();

    // Trigger visual screen flash
    const flash = document.createElement('div');
    flash.className = 'timer-complete-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 1200);

    const banner = document.createElement('div');
    banner.className = 'timer-complete-toast';
    banner.innerHTML = '🔔 <strong>Rest Finished!</strong> Time to lift!';
    document.body.appendChild(banner);
    setTimeout(() => banner.classList.add('show'), 20);
    setTimeout(() => {
      banner.classList.remove('show');
      setTimeout(() => banner.remove(), 400);
    }, 4500);
  }

  // Workout Completion & Summary
  showWorkoutSummary() {
    const sets = Object.values(this.session?.logs || {}).flat();
    const completed = sets.filter(set => set.completed).length;
    if (!completed) { this.showToast('Complete at least one set before finishing.'); return; }
    const sessionId = this.session.id;
    const remaining = sets.length - completed;
    this.summaryContentEl.innerHTML = `<h2>Review workout</h2><p>${this.escapeHtml(this.session.dayTitle)}</p><p><strong>${completed} sets completed · ${remaining} remaining</strong></p><p>Your workout stays open until you confirm.</p><button class="primary-btn" id="keepTrainingBtn">Keep training</button><button class="secondary-btn" id="confirmFinishBtn">${remaining ? 'Finish early' : 'Finish workout'}</button>`;
    this.summaryModalEl.classList.add('open');
    document.getElementById('keepTrainingBtn')?.addEventListener('click', () => this.summaryModalEl.classList.remove('open'));
    document.getElementById('confirmFinishBtn')?.addEventListener('click', () => this.finishSession(sessionId));
  }

  finishSession(expectedId = this.session?.id) {
    if (!this.session || expectedId !== this.session.id || this.history.some(w => w.sessionId === expectedId)) return false;
    const invalid = Object.values(this.session.logs || {}).flat().find(set => set.completed && this.getSetValidationError(set));
    if (invalid) { this.showToast(this.getSetValidationError(invalid)); return false; }
    const currentDay = this.routine[this.activeDayIndex];
    if (!currentDay) return;

    let totalCompletedSets = 0;
    currentDay.exercises.forEach(ex => {
      const sets = (this.session && this.session.logs && this.session.logs[ex.id]) || [];
      totalCompletedSets += sets.filter(s => s.completed).length;
    });

    if (totalCompletedSets === 0) {
      this.showToast('⚠️ No completed sets to finish. Complete at least one set first!');
      return;
    }

    const startMs = Date.parse(this.session.startTime);
    const durationSeconds = Number.isFinite(startMs) ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : null;
    const durationMins = durationSeconds === null ? null : Math.floor(durationSeconds / 60);
    const durationLabel = durationSeconds === null ? 'Not recorded' : durationSeconds < 60 ? '<1 min' : `${durationMins} min`;

    let totalVolume = 0;
    const newPRs = [];
    const weightIncreaseUnlocked = [];
    const recordedExercises = {};

    currentDay.exercises.forEach(ex => {
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
        const targetSetsCount = this.session.deload ? Math.max(2, Math.floor(ex.sets * 0.67)) : ex.sets;
        const topW = Math.max(...completedSets.map(s => s.weight || 0));
        if (!this.session.deload && completedSets.length >= targetSetsCount && completedSets.every(s => (s.reps || 0) >= maxTarget && (topW === 0 || (s.weight || 0) >= topW))) {
          weightIncreaseUnlocked.push({ name: effectiveName, reps: maxTarget, setsCount: completedSets.length, topWeight: topW, increment: this.getExerciseIncrement(ex, effectiveName) });
        }
        const priorPR = this.getPersonalRecord(effectiveName);
        completedSets.forEach(s => {
          totalVolume += (s.weight || 0) * (s.reps || 0);
          let description = '';
          if (s.weight > priorPR.maxWeight && priorPR.maxWeight > 0) description = `${effectiveName}: New Weight Record (${s.weight} lbs)`;
          else if (s.weight === 0 && s.reps > priorPR.bestReps && priorPR.bestReps > 0) description = `${effectiveName}: New Rep Record (BW × ${s.reps})`;
          if (description && !newPRs.includes(description)) newPRs.push(description);
        });
        const entry = recordedExercises[effectiveName] ||= { swappedFrom: isSwapped ? ex.name : null, sets: [] };
        completedSets.forEach(s => entry.sets.push({ ...s, setNum: entry.sets.length + 1, exerciseName: effectiveName, muscle: s.muscle || (currentSwap?.name === effectiveName ? currentSwap.muscle : ex.muscle), completed: true, rir: typeof s.rir === 'number' ? s.rir : null, type: s.type || 'working' }));
        // A recovery week must not overwrite the normal progression baseline.
        if (!this.session.deload) {
          this.lastWeights ||= {};
          this.lastWeights[effectiveName] = { date: new Date().toISOString(), deload: false, sets: entry.sets.map(s => ({ ...s })) };
        }
      });
    });
    this.saveLastWeights();

    // Save to history
    const workoutRecord = {
      id: 'w_' + this.session.id,
      sessionId: this.session.id,
      dayId: currentDay.id,
      date: new Date().toISOString(),
      dayTitle: currentDay.title,
      deload: Boolean(this.session.deload),
      totalVolume,
      totalCompletedSets,
      durationMins,
      durationSeconds,
      durationLabel,
      sessionSnapshot: JSON.parse(JSON.stringify(this.session)),
      exercises: recordedExercises
    };

    this.history.push(workoutRecord);
    this.saveHistory();

    this.stopTimer();
    this.pendingRir = null;
    this.collapsedCards = new Set();
    // Reset current session
    this.session = this.initNewSession(this.activeDayIndex);
    this.saveCurrentSession();

    // Render Modal
    this.summaryContentEl.innerHTML = `
      <div style="text-align: center; margin-bottom: 20px;">
        <div style="font-size: 50px;">🏆</div>
        <h2 style="font-size: 1.5rem; font-weight: 800; color: var(--accent-emerald);">Workout Complete!</h2>
        <p style="color: var(--text-secondary);">${this.escapeHtml(currentDay.title)}</p>
      </div>

      <div class="stats-grid" style="margin-bottom: 20px;">
        <div class="stat-box">
          <div class="stat-val">${totalVolume.toLocaleString()}</div>
          <div class="stat-label">Total Volume (lbs)</div>
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

      ${weightIncreaseUnlocked.length > 0 ? `
        <div class="summary-progression-box">
          <h4>🚀 Weight Increases Unlocked for Next Workout!</h4>
          <ul>
            ${weightIncreaseUnlocked.map(item => `
              <li><strong>${this.escapeHtml(item.name)}</strong>: Hit ${item.reps} reps across all ${item.setsCount} sets (${item.topWeight} lbs) — Ready to increase weight (+${item.increment} lbs) next workout!</li>
            `).join('')}
          </ul>
        </div>
      ` : ''}

      ${newPRs.length > 0 ? `
        <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid var(--accent-emerald); border-radius: var(--radius-md); padding: 12px; margin-bottom: 20px;">
          <h4 style="color: var(--accent-emerald); font-weight: 700; margin-bottom: 6px;">🎉 New Records Hit!</h4>
          <ul style="padding-left: 20px; font-size: 0.85rem; color: #e2e8f0;">
            ${newPRs.map(pr => `<li>${this.escapeHtml(pr)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <button class="primary-btn" id="finishSummaryBtn">Done & View Progress</button>
      <button class="secondary-btn" id="reopenSummaryBtn">Reopen this workout</button>
    `;

    this.summaryModalEl.classList.add('open');

    document.getElementById('reopenSummaryBtn')?.addEventListener('click', () => this.reopenWorkout(workoutRecord.id));
    document.getElementById('finishSummaryBtn')?.addEventListener('click', () => {
      this.summaryModalEl.classList.remove('open');
      document.querySelector('[data-view="analytics"]').click();
    });

    this.renderWorkout();
  }

  reopenWorkout(recordId) {
    const record = this.history.find(workout => workout.id === recordId);
    if (!record?.sessionSnapshot) { this.showToast('This older workout has no recoverable session draft.'); return false; }
    const dayIndex = this.routine.findIndex(day => day.id === record.dayId);
    if (dayIndex < 0) { this.showToast('Restore this workout’s routine day before reopening.'); return false; }
    const saved = this.loadSession(dayIndex);
    if (this.hasSessionProgress(saved) && saved.id !== record.sessionId) {
      this.showToast('A newer workout is in progress for this day. Finish it or start a new draft before reopening.');
      return false;
    }
    this.saveCurrentSession();
    this.stopTimer();
    this.activeDayIndex = dayIndex;
    this.session = JSON.parse(JSON.stringify(record.sessionSnapshot));
    this.history = this.history.filter(workout => workout.id !== recordId);
    this.saveHistory();
    this.rebuildLastWeightsFromHistory();
    this.pendingRir = null;
    this.collapsedCards = new Set();
    this.saveCurrentSession();
    this.summaryModalEl?.classList.remove('open');
    this.activeView = 'workout';
    document.querySelector('[data-view="workout"]')?.click();
    this.render();
    this.jumpToActiveExercise?.();
    return true;
  }

  getAllUniqueExercises() {
    const list = [];
    const seen = new Set();
    if (this.routine) {
      this.routine.forEach(day => {
        day.exercises.forEach(ex => {
          if (!seen.has(ex.name)) {
            seen.add(ex.name);
            list.push({ name: ex.name, muscle: ex.muscle, dayTitle: day.title });
          }
        });
      });
    }
    return list;
  }

  getExerciseHistoryOverTime(exerciseName) {
    const results = [];
    // 1. From completed history
    this.history.forEach(h => {
      if (h.exercises && h.exercises[exerciseName]) {
        const entry = h.exercises[exerciseName];
        const completedEntrySets = (entry.sets || []).filter(s => s && s.completed !== false);
        if (completedEntrySets.length > 0) {
          const maxW = Math.max(...completedEntrySets.map(s => s.weight || 0));
          const totalVol = completedEntrySets.reduce((sum, s) => sum + ((s.weight || 0) * (s.reps || 0)), 0);
          results.push({
            date: h.date,
            dayTitle: h.dayTitle,
            sets: completedEntrySets,
            maxWeight: maxW,
            totalVolume: totalVol
          });
        }
      }
    });

    // 2. From persistent last weights if not already present for this date
    if (this.lastWeights && this.lastWeights[exerciseName] && this.lastWeights[exerciseName].sets) {
      const validSets = this.lastWeights[exerciseName].sets.filter(s => s && s.completed !== false);
      if (validSets.length > 0) {
        const lastDate = this.lastWeights[exerciseName].date || new Date().toISOString();
        const alreadyInHistory = results.some(r => new Date(r.date).toDateString() === new Date(lastDate).toDateString());
        if (!alreadyInHistory) {
          const maxW = Math.max(...validSets.map(s => s.weight || 0));
          const totalVol = validSets.reduce((sum, s) => sum + ((s.weight || 0) * (s.reps || 0)), 0);
          results.push({
            date: lastDate,
            dayTitle: 'Recent Log',
            sets: validSets,
            maxWeight: maxW,
            totalVolume: totalVol
          });
        }
      }
    }

    return results.sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  generateSVGProgressionChart(exHistory, exerciseName) {
    if (!exHistory || exHistory.length === 0) {
      return `
        <div style="text-align: center; padding: 20px 12px; color: var(--text-muted); font-size: 0.85rem; background: rgba(255,255,255,0.02); border-radius: var(--radius-md);">
          <span>📊 Complete sets for this lift to view your dynamic progress chart here!</span>
        </div>
      `;
    }

    const hasAnyWeighted = exHistory.some(session => (session.sets || []).some(s => s && s.weight > 0));
    const isBodyweight = !hasAnyWeighted;

    // Extract best e1RM or best Reps for each session
    const points = [];
    exHistory.forEach((session, sIdx) => {
      let metricVal = 0;
      let topWeight = 0;
      let topReps = 0;
      (session.sets || []).forEach(s => {
        if (!s) return;
        if (!isBodyweight && s.weight > 0) {
          const reps = s.reps || 1;
          const e1rm = Math.round(s.weight * (1 + reps / 30));
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
        <div style="text-align: center; padding: 20px 12px; color: var(--text-muted); font-size: 0.85rem; background: rgba(255,255,255,0.02); border-radius: var(--radius-md);">
          <span>📊 Complete sets for this lift to view your dynamic progress chart here!</span>
        </div>
      `;
    }

    // Progress stats
    const firstPoint = points[0];
    const latestPoint = points[points.length - 1];
    const diff = latestPoint.e1rm - firstPoint.e1rm;
    const diffSign = diff > 0 ? `+${diff}` : `${diff}`;
    const diffPct = firstPoint.e1rm > 0 ? Math.round((diff / firstPoint.e1rm) * 100) : 0;
    const allTimeBest = Math.max(...points.map(p => p.e1rm));
    const chartTitle = isBodyweight ? '📈 Rep Progression Trend (Bodyweight)' : '📈 Estimated 1-Rep Max Trend';
    const unitLabel = isBodyweight ? 'reps' : 'lbs';

    // SVG geometry
    const svgW = 340;
    const svgH = 135;
    const padLeft = 38;
    const padRight = 18;
    const padTop = 16;
    const padBottom = 26;
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

    const getX = (i) => padLeft + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const getY = (val) => padTop + (1 - (val - minVal) / (maxVal - minVal)) * plotH;

    const coords = points.map((p, i) => ({ x: getX(i), y: getY(p.e1rm), ...p }));
    const polylinePts = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

    const areaPath = `M ${coords[0].x.toFixed(1)},${(padTop + plotH).toFixed(1)} ` +
      coords.map(c => `L ${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ') +
      ` L ${coords[coords.length - 1].x.toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;

    const midY = getY(midVal);
    const maxY = getY(maxVal);
    const minY = getY(minVal);

    return `
      <div class="svg-chart-wrapper">
        <div class="chart-headline-banner">
          <div>
            <div class="chart-headline-title">${chartTitle}</div>
            <div class="chart-headline-sub">${points.length} session${points.length > 1 ? 's' : ''} logged • All-Time Peak: <strong style="color: #60a5fa;">${allTimeBest} ${unitLabel}</strong></div>
          </div>
          <div style="text-align: right;">
            ${points.length > 1 ? `
              <span class="micro-badge ${diff >= 0 ? 'weight-pr' : 'reps-pr'}" style="font-size: 0.75rem; padding: 2px 8px;">
                ${diff >= 0 ? '🚀' : '📉'} ${diffSign} ${unitLabel} (${diffPct > 0 ? '+' : ''}${diffPct}%)
              </span>
            ` : `<span style="font-size: 0.75rem; color: var(--accent-emerald);">Baseline Session</span>`}
          </div>
        </div>

        <svg class="svg-chart-stage" viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="none">
          <defs>
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.35" />
              <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.0" />
            </linearGradient>
          </defs>

          <!-- Grid lines -->
          <line x1="${padLeft}" y1="${maxY.toFixed(1)}" x2="${svgW - padRight}" y2="${maxY.toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3,3" />
          <line x1="${padLeft}" y1="${midY.toFixed(1)}" x2="${svgW - padRight}" y2="${midY.toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3,3" />
          <line x1="${padLeft}" y1="${minY.toFixed(1)}" x2="${svgW - padRight}" y2="${minY.toFixed(1)}" stroke="rgba(255,255,255,0.12)" />

          <!-- Axis Labels -->
          <text x="${padLeft - 6}" y="${(maxY + 4).toFixed(1)}" text-anchor="end" fill="var(--text-muted)" font-size="9" font-weight="600">${maxVal}</text>
          <text x="${padLeft - 6}" y="${(midY + 3).toFixed(1)}" text-anchor="end" fill="var(--text-muted)" font-size="9">${midVal}</text>
          <text x="${padLeft - 6}" y="${(minY + 3).toFixed(1)}" text-anchor="end" fill="var(--text-muted)" font-size="9">${minVal}</text>

          <!-- Area fill -->
          <path d="${areaPath}" fill="url(#chartGradient)" />

          <!-- Curve Polyline -->
          <polyline points="${polylinePts}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

          <!-- Interactive markers -->
          ${coords.map(c => `
            <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5" 
                    fill="#1e293b" stroke="#38bdf8" stroke-width="2.2" 
                    class="chart-data-dot" 
                    style="cursor: pointer;"
                    data-date="${this.escapeHtml(c.fullDate)}" 
                    data-day="${this.escapeHtml(c.dayTitle)}"
                    data-e1rm="${c.e1rm}" 
                    data-weight="${c.weight}" 
                    data-reps="${c.reps}"
                    data-isbw="${c.isBodyweight}" />
            <text x="${c.x.toFixed(1)}" y="${(padTop + plotH + 16).toFixed(1)}" text-anchor="middle" fill="var(--text-muted)" font-size="8">${this.escapeHtml(c.date)}</text>
          `).join('')}
        </svg>

        <div class="chart-tooltip-box" id="chartTooltipBox">
          💡 Tap any data point on the chart to inspect your workout performance.
        </div>
      </div>
    `;
  }

  mapMuscleToLandmark(muscleStr) {
    const labels = { chest: 'Chest', back: 'Back / Lats', lats: 'Back / Lats', quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', calves: 'Calves', biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms', abs: 'Abs / Core', core: 'Abs / Core', 'front delts': 'Front Delts', 'side delts': 'Side Delts', 'rear delts': 'Rear Delts' };
    return labels[String(muscleStr || '').toLowerCase().trim()] || null;
  }

  getExerciseMuscleCredits(name, muscle) {
    // Only names from the exercise catalog (or explicitly tagged custom exercises) are mapped.
    const catalog = [...DEFAULT_ROUTINE.flatMap(d => d.exercises), ...(typeof EXERCISE_SUBSTITUTIONS === 'object' ? Object.values(EXERCISE_SUBSTITUTIONS).flat() : []), ...(this.routine || []).flatMap(d => d.exercises)];
    const exercise = catalog.find(ex => ex.name === name);
    if (!exercise && !muscle) return null;
    const n = name.toLowerCase();
    let direct = [...new Set(String(muscle || exercise?.muscle || '').split('/').map(tag => this.mapMuscleToLandmark(tag)).filter(Boolean))];
    const indirect = {};
    if (/calf/.test(n)) direct = ['Calves'];
    else if (/lateral raise/.test(n)) direct = ['Side Delts'];
    else if (/rear delt|reverse pec|face pull/.test(n)) direct = ['Rear Delts'];
    else if (/shoulder press|overhead press/.test(n)) { direct = ['Front Delts']; indirect['Side Delts'] = 0.5; indirect.Triceps = 0.5; }
    else if (/hip thrust|glute drive/.test(n)) direct = ['Glutes'];
    else if (/leg curl/.test(n)) direct = ['Hamstrings'];
    else if (/leg press|hack squat|goblet squat|smith machine squat/.test(n)) { direct = ['Quads']; indirect.Glutes = 0.5; }
    else if (/romanian deadlift|back extension|pull-through/.test(n)) direct = /glute focus/i.test(name) ? ['Glutes'] : ['Hamstrings', 'Glutes'];
    else if (/press|push-up/.test(n) && direct.includes('Chest')) { indirect.Triceps = 0.5; indirect['Front Delts'] = 0.5; }
    else if (/row|pulldown|pull-up|chin-up/.test(n) && direct.includes('Back / Lats')) { indirect.Biceps = 0.5; indirect.Forearms = 0.5; if (/row/.test(n)) indirect['Rear Delts'] = 0.25; }
    if (/hammer|reverse curl/.test(n)) indirect.Forearms = 0.5;
    direct.forEach(m => delete indirect[m]);
    return direct.length ? { direct, indirect } : null;
  }

  getStoredSessions() {
    const sessions = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith(this.storageKeys.currentSessionPrefix)) continue;
      try { const item = JSON.parse(localStorage.getItem(key)); if (item?.dayId && item.logs) sessions.push(item); } catch (_) {}
    }
    if (this.session?.dayId) {
      const index = sessions.findIndex(s => s.dayId === this.session.dayId);
      if (index >= 0) sessions[index] = this.session; else sessions.push(this.session);
    }
    return sessions;
  }

  calculateWeeklyVolume(now = Date.now()) {
    const muscles = ['Chest', 'Back / Lats', 'Front Delts', 'Side Delts', 'Rear Delts', 'Biceps', 'Triceps', 'Forearms', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs / Core'];
    const makeTotals = () => Object.fromEntries(muscles.map(m => [m, { direct: 0, indirect: 0 }]));
    const result = { planned: makeTotals(), completed: makeTotals(), unmapped: new Set() };
    const add = (kind, name, muscle, count) => {
      const mapping = this.getExerciseMuscleCredits(name, muscle);
      if (!mapping) { result.unmapped.add(name); return; }
      mapping.direct.forEach(m => { if (result[kind][m]) result[kind][m].direct += count; });
      Object.entries(mapping.indirect).forEach(([m, credit]) => { if (result[kind][m]) result[kind][m].indirect += count * credit; });
    };
    (this.routine || []).forEach(day => day.exercises.forEach(ex => add('planned', ex.name, ex.muscle, this.deloadActive ? Math.max(2, Math.floor(ex.sets * 0.67)) : ex.sets)));
    const cutoff = now - 7 * 86400000;
    const recent = date => { const value = new Date(date).getTime(); return value >= cutoff && value <= now; };
    const savedSessionIds = new Set((this.history || []).map(h => h.sessionId).filter(Boolean));
    (this.history || []).filter(h => recent(h.date)).forEach(h => {
      Object.entries(h.exercises || {}).forEach(([name, entry]) => (entry.sets || []).filter(set => set.completed !== false && set.type !== 'warmup' && (!set.completedAt || recent(set.completedAt))).forEach(set => add('completed', set.exerciseName || name, set.muscle, 1)));
    });
    this.getStoredSessions().filter(session => !savedSessionIds.has(session.id)).forEach(session => {
      const day = (this.routine || []).find(d => d.id === session.dayId);
      Object.entries(session.logs).forEach(([id, sets]) => (Array.isArray(sets) ? sets : []).filter(set => set.completed && set.type !== 'warmup' && recent(set.completedAt || session.startTime || session.updatedAt)).forEach(set => {
        const ex = day?.exercises.find(e => e.id === id);
        const swap = session.swaps?.[id];
        const name = set.exerciseName || swap?.name || ex?.name || id;
        const muscle = set.muscle || (name === swap?.name ? swap.muscle : name === ex?.name ? ex.muscle : undefined);
        add('completed', name, muscle, 1);
      }));
    });
    return { ...result, unmapped: [...result.unmapped] };
  }

  generateWeeklyVolumeLandmarksHTML() {
    const volume = this.calculateWeeklyVolume();
    const format = value => Math.round(value * 10) / 10;
    const rows = Object.keys(volume.planned).map(muscle => `<tr><th scope="row">${muscle}</th><td>${format(volume.planned[muscle].direct)} <small>+ ${format(volume.planned[muscle].indirect)} indirect</small></td><td>${format(volume.completed[muscle].direct)} <small>+ ${format(volume.completed[muscle].indirect)} indirect</small></td></tr>`).join('');
    return `<section class="volume-landmarks-box"><h3>Weekly training volume</h3><p class="volume-explanation">Planned sets for your current week${this.deloadActive ? ' (deload)' : ''} and completed sets over the last 7 days, including workouts in progress. Indirect contributions are estimates; useful volume varies with effort and recovery.</p><table class="volume-comparison"><thead><tr><th scope="col">Muscle</th><th scope="col">Planned</th><th scope="col">Completed</th></tr></thead><tbody>${rows}</tbody></table>${volume.unmapped.length ? `<p class="volume-unmapped">Unmapped exercises (excluded): ${volume.unmapped.map(n => this.escapeHtml(n)).join(', ')}</p>` : ''}</section>`;
  }

  // Analytics & History View
  renderAnalytics() {
    const totalWorkouts = this.history.length;
    const totalVolumeAllTime = this.history.reduce((sum, h) => sum + (h.totalVolume || 0), 0);

    const allExercises = this.getAllUniqueExercises();
    if (!this.selectedProgressExercise && allExercises.length > 0) {
      this.selectedProgressExercise = allExercises[0].name;
    }

    const exHistory = this.selectedProgressExercise ? this.getExerciseHistoryOverTime(this.selectedProgressExercise) : [];
    const prData = this.selectedProgressExercise ? this.getPersonalRecord(this.selectedProgressExercise) : { maxWeight: 0, max1RM: 0 };
    const latestSession = exHistory.length > 0 ? exHistory[exHistory.length - 1] : null;

    // Group workouts for volume chart (last 7 workouts)
    const recentWorkouts = this.history.slice(-7);
    const maxVol = Math.max(...recentWorkouts.map(w => w.totalVolume || 0), 1000);

    const historyHTML = this.history.slice().reverse().map(h => {
      const d = new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const exEntries = Object.entries(h.exercises || {});

      return `
        <div class="history-item">
          <div class="history-item-header">
            <span class="history-item-title">${this.escapeHtml(h.dayTitle)}</span>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="history-item-date">${d}</span>
              <button type="button" class="history-delete-btn" data-wid="${h.id}" title="Delete this workout from history" aria-label="Delete workout">🗑️</button>
            </div>
          </div>
          <div class="history-pills">
            <span class="history-pill">🏋️ ${(h.totalVolume || 0).toLocaleString()} lbs</span>
            <span class="history-pill">⚡ ${h.totalCompletedSets || 0} sets</span>
            <span class="history-pill">⏱️ ${h.durationMins || 45} mins</span>
          </div>
          
          <button class="history-expand-toggle" data-wid="${h.id}">
            <span>View Exercise Sets ▾</span>
          </button>

          <div class="history-details-drawer" id="drawer_${h.id}">
            ${exEntries.map(([exName, exData]) => `
              <div style="margin-bottom: 8px;">
                <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-primary);">${this.escapeHtml(exName)}</div>
                <div class="progress-set-chips" style="margin-top: 4px;">
                  ${(exData.sets || []).map(s => `
                    <span class="progress-set-chip">Set ${s.setNum}: ${s.weight} lbs × ${s.reps}${s.completed ? ' ✓' : ''}</span>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    this.analyticsContentEl.innerHTML = `
      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-val">${totalWorkouts}</div>
          <div class="stat-label">Workouts Logged</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${(totalVolumeAllTime / 1000).toFixed(1)}k</div>
          <div class="stat-label">Total Volume (lbs)</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">5-Day</div>
          <div class="stat-label">Split (Wed–Mon)</div>
        </div>
      </div>

      <!-- Exercise Progress Tracker -->
      <div class="exercise-progress-box">
        <div class="exercise-progress-header">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <h3 style="font-size: 1.05rem; font-weight: 800; color: var(--text-primary);">📈 Progress Over Time</h3>
            ${exHistory.length > 0 ? `<span style="font-size: 0.75rem; color: var(--accent-emerald); font-weight: 700;">🟢 ${exHistory.length} Session${exHistory.length > 1 ? 's' : ''} Tracked</span>` : ''}
          </div>
          <select class="exercise-select" id="progressExerciseSelect">
            ${this.routine.map(day => `
              <optgroup label="${this.escapeHtml(day.title)}">
                ${day.exercises.map(ex => `
                  <option value="${this.escapeHtml(ex.name)}" ${ex.name === this.selectedProgressExercise ? 'selected' : ''}>
                    ${this.escapeHtml(ex.name)}
                  </option>
                `).join('')}
              </optgroup>
            `).join('')}
          </select>
        </div>

        <div class="progress-kpi-grid">
          <div class="progress-kpi-card">
            <div class="progress-kpi-val">${prData.maxWeight > 0 ? `${prData.maxWeight} lbs` : '—'}</div>
            <div class="progress-kpi-label">🏆 Best Weight</div>
          </div>
          <div class="progress-kpi-card">
            <div class="progress-kpi-val">${prData.max1RM > 0 ? `${prData.max1RM} lbs` : '—'}</div>
            <div class="progress-kpi-label">⚡ Est. 1-Rep Max</div>
          </div>
          <div class="progress-kpi-card">
            <div class="progress-kpi-val">${latestSession ? `${latestSession.maxWeight} lbs` : '—'}</div>
            <div class="progress-kpi-label">⏱️ Last Session</div>
          </div>
        </div>

        ${this.generateSVGProgressionChart(exHistory, this.selectedProgressExercise)}

        ${exHistory.length > 0 ? `
          <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); margin: 14px 0 8px;">
            Recorded Session Log:
          </div>
          <div class="progress-session-list">
            ${exHistory.slice().reverse().map(s => {
              const d = new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              return `
                <div class="progress-session-row">
                  <div class="progress-session-top">
                    <span class="progress-session-date">${d} (${this.escapeHtml(s.dayTitle || '')})</span>
                    <span class="progress-session-topweight">Top: ${s.maxWeight} lbs</span>
                  </div>
                  <div class="progress-set-chips">
                    ${s.sets.filter(Boolean).map(set => `
                      <span class="progress-set-chip">Set ${set.setNum}: ${set.weight} lbs × ${set.reps}</span>
                    `).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}
      </div>

      ${recentWorkouts.length > 0 ? `
        <div class="volume-chart-container">
          <div class="chart-header">
            <div class="chart-title">Overall Volume Progression (lbs per session)</div>
          </div>
          <div class="chart-bars">
            ${recentWorkouts.map((w, idx) => {
              const heightPct = Math.round(((w.totalVolume || 0) / maxVol) * 100);
              const isLast = idx === recentWorkouts.length - 1;
              const d = new Date(w.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
              return `
                <div class="chart-bar-wrap">
                  <div class="chart-bar ${isLast ? 'current' : ''}" style="height: ${Math.max(12, heightPct)}%;">
                    <span class="chart-bar-val">${Math.round(w.totalVolume / 1000)}k</span>
                  </div>
                  <span class="chart-bar-label">${d}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${this.generateWeeklyVolumeLandmarksHTML()}

      <div style="margin-top: 24px;">
        <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 12px;">Full Workout History</h3>
        ${this.history.length > 0 ? historyHTML : `
          <div class="empty-state">
            <div class="empty-icon">📊</div>
            <p>No workouts recorded yet. Finish a workout to see your strength progress!</p>
          </div>
        `}
      </div>
    `;

    // Bind exercise dropdown change
    const exSelect = document.getElementById('progressExerciseSelect');
    if (exSelect) {
      exSelect.addEventListener('change', (e) => {
        this.selectedProgressExercise = e.target.value;
        this.renderAnalytics();
      });
    }

    // Bind chart data dot tooltips
    this.analyticsContentEl.querySelectorAll('.chart-data-dot').forEach(dot => {
      const showTip = () => {
        const tip = document.getElementById('chartTooltipBox');
        if (!tip) return;
        const date = dot.dataset.date;
        const day = dot.dataset.day;
        const e1rm = dot.dataset.e1rm;
        const w = dot.dataset.weight;
        const r = dot.dataset.reps;
        const isBw = dot.dataset.isbw === 'true';
        if (isBw) {
          tip.innerHTML = `<strong>📅 ${date} (${day})</strong>: Best set <strong>Bodyweight × ${r} reps</strong>`;
        } else {
          tip.innerHTML = `<strong>📅 ${date} (${day})</strong>: Best set <strong>${w} lbs × ${r} reps</strong> → Est. 1-Rep Max: <strong style="color: #60a5fa;">${e1rm} lbs</strong>`;
        }
      };
      dot.addEventListener('click', showTip);
      dot.addEventListener('mouseenter', showTip);
    });

    // Bind workout history expansion toggles
    this.analyticsContentEl.querySelectorAll('.history-expand-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const wid = btn.dataset.wid;
        const drawer = document.getElementById(`drawer_${wid}`);
        if (drawer) {
          const isOpen = drawer.classList.toggle('open');
          btn.querySelector('span').textContent = isOpen ? 'Hide Exercise Sets ▴' : 'View Exercise Sets ▾';
        }
      });
    });

    // Bind workout history deletion
    this.analyticsContentEl.querySelectorAll('.history-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wid = btn.dataset.wid;
        this.deleteWorkoutFromHistory(wid);
      });
    });
  }

  deleteWorkoutFromHistory(workoutId) {
    if (!confirm('Are you sure you want to delete this workout from your history?')) return;
    this.history = this.history.filter(h => h.id !== workoutId);
    this.saveHistory();
    this.rebuildLastWeightsFromHistory();
    this.showToast('🗑️ Workout deleted from history.');
    this.renderAnalytics();
  }

  rebuildLastWeightsFromHistory() {
    this.lastWeights = {};
    [...(this.history || [])].sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(workout => {
      if (workout.deload || workout.isDeload || workout.deloadActive) return;
      Object.entries(workout.exercises || {}).forEach(([name, entry]) => {
        const sets = (entry.sets || []).filter(set => set && set.completed !== false);
        if (sets.length) this.lastWeights[name] = { date: workout.date, deload: false, sets: sets.map(set => ({...set})) };
      });
    });
    this.saveLastWeights();
  }

  // Routine & Customizer View
  renderRoutineEditor() {
    const exercises = this.routine.flatMap(day => day.exercises).filter(ex => !ex.isOptional);
    const normalSets = exercises.reduce((sum, ex) => sum + ex.sets, 0);
    const deloadSets = exercises.reduce((sum, ex) => sum + Math.max(2, Math.floor(ex.sets * .67)), 0);
    this.routineEditorEl.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 8px;">Routine Customization & Preferences</h3>
        <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4;">
          Tailor your 5-Day Machine & Dumbbell Split, enable systemic deload recovery, and protect your workout history with full JSON backups.
        </p>
      </div>

      <!-- Deload Week Toggle -->
      <div class="setting-row" style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: var(--radius-lg); padding: 14px; margin-bottom: 16px;">
        <div>
          <div style="font-weight: 700; font-size: 0.95rem; color: #34d399; display: flex; align-items: center; gap: 6px;">
            <span>🌿 7-Day Deload Week</span>
            ${this.deloadActive ? `<span style="font-size: 0.68rem; background: rgba(16, 185, 129, 0.25); color: #a7f3d0; padding: 1px 6px; border-radius: var(--radius-full);">Active</span>` : ''}
          </div>
          <p style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
            Reduces planned sets from ${normalSets} to ${deloadSets} (${Math.round((normalSets - deloadSets) / normalSets * 100)}% fewer) and eases loads by 10%. Auto-expires after 7 days.
            ${this.deloadActive ? `<span style="display:block; color: #a7f3d0; font-weight: 700; margin-top: 4px;">⏳ ${this.getDeloadDaysLeft()} day${this.getDeloadDaysLeft() === 1 ? '' : 's'} remaining</span>` : ''}
          </p>
        </div>
        <label class="switch">
          <input type="checkbox" id="deloadSettingToggle" ${this.deloadActive ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>

      <!-- Screen Wake Lock Toggle -->
      <div class="setting-row" style="margin-bottom: 16px;">
        <div>
          <div style="font-weight: 700; font-size: 0.95rem; color: #fff;">🛡️ Keep Screen Awake</div>
          <p>Prevent your phone screen from dimming or sleeping during active workouts.</p>
        </div>
        <label class="switch">
          <input type="checkbox" id="wakeLockSettingToggle" ${this.wakeLockEnabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>

      <!-- Data Shield & Backup Center -->
      <div style="background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: var(--radius-lg); padding: 14px; margin-bottom: 20px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; flex-wrap: wrap; gap: 6px;">
          <div style="font-weight: 700; font-size: 0.95rem; color: var(--accent-blue); display: flex; align-items: center; gap: 6px;">
            <span>🛡️ Data Shield & Backup</span>
          </div>
          <span style="font-size: 0.7rem; background: rgba(59, 130, 246, 0.2); color: #93c5fd; padding: 2px 8px; border-radius: var(--radius-full); font-weight: 700;">
            ${this.getBackupStatusText()}
          </span>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4; margin-bottom: 12px;">
          Download a JSON backup to keep a separate copy of your history, active workouts, routine and preferences. Keep the backup file somewhere you can retrieve after changing phones.
        </p>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button class="secondary-btn" id="exportDataBtn" style="flex: 1; min-width: 140px; font-size: 0.82rem; padding: 8px 12px;">
            📥 Export Backup (JSON)
          </button>
          <button class="secondary-btn" id="importBackupBtn" style="flex: 1; min-width: 140px; font-size: 0.82rem; padding: 8px 12px; color: #38bdf8; border-color: rgba(56, 189, 248, 0.35);">
            📤 Restore Backup (JSON)
          </button>
        </div>
      </div>

      <!-- Active Workout Days Routine Preview -->
      <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 20px;">
        <h4 style="font-size: 0.95rem; font-weight: 700; margin-bottom: 12px;">Active Workout Days</h4>
        ${this.routine.map(day => `
          <div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
            <div style="font-weight: 700; font-size: 0.95rem; color: var(--accent-blue);">${this.escapeHtml(day.title)} (${day.exercises.length} lifts)</div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
              ${day.exercises.map(e => `${this.escapeHtml(e.name)} (${e.sets}×${this.escapeHtml(e.targetReps)}${e.isOptional ? ' - optional' : ''})`).join(' • ')}
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Audio & Haptics Check -->
      <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: var(--radius-lg); padding: 14px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
        <div>
          <div style="font-weight: 700; font-size: 0.9rem; color: var(--accent-emerald);">🔔 Rest Timer Chime & Haptic Check</div>
          <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px;">Test sound and vibration while this page is open. Locked-screen and background alerts may not fire on iPhone; reopening restores the countdown.</div>
        </div>
        <button class="secondary-btn" id="testChimeBtn" style="padding: 6px 14px; font-size: 0.8rem; border-color: rgba(16, 185, 129, 0.4); color: #6ee7b7;">
          🔊 Test Chime & Vibrate
        </button>
      </div>

      <!-- Version & Cache Reset -->
      <div style="background: rgba(148, 163, 184, 0.08); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: var(--radius-lg); padding: 14px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
        <div>
          <div style="font-weight: 700; font-size: 0.9rem; color: #e2e8f0;">⚡ MachineMaster <span style="font-size: 0.75rem; color: #38bdf8; font-weight: 600;">(Build v28 • Rev ${localStorage.getItem(this.storageKeys.routineRev) || '14'})</span></div>
          <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">Saved workouts, configurable progression & focused logging</div>
        </div>
        <button class="secondary-btn" id="forceUpdateBtn" style="padding: 6px 14px; font-size: 0.8rem;">
          🔄 Check for App Update
        </button>
      </div>

      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        <button class="secondary-btn" id="resetRoutineBtn" style="flex: 1; min-width: 160px; color: #f87171; border-color: rgba(239,68,68,0.3);">
          🔄 Reset Routine to Original Spreadsheet
        </button>
      </div>
    `;

    document.getElementById('deloadSettingToggle')?.addEventListener('change', (e) => {
      this.deloadActive = e.target.checked;
      localStorage.setItem(this.storageKeys.deloadActive, String(this.deloadActive));
      if (this.deloadActive) {
        this.deloadStartDate = Date.now();
        localStorage.setItem(this.storageKeys.deloadStartDate, String(this.deloadStartDate));
        this.showToast('🌿 7-Day Deload Week activated! Sets scaled & loads eased.');
      } else {
        this.deloadStartDate = 0;
        localStorage.removeItem(this.storageKeys.deloadStartDate);
        this.showToast('💪 Deload Week deactivated. Full training intensity restored.');
      }
      this.session = this.loadSession();
      this.saveCurrentSession();
      this.render();
    });

    document.getElementById('wakeLockSettingToggle')?.addEventListener('change', (e) => {
      this.wakeLockEnabled = e.target.checked;
      localStorage.setItem(this.storageKeys.wakeLockEnabled, String(this.wakeLockEnabled));
      if (this.wakeLockEnabled && this.activeView === 'workout') {
        this.requestWakeLock();
      } else {
        this.releaseWakeLock();
      }
      this.showToast(this.wakeLockEnabled ? '🛡️ Screen Wake Lock enabled' : '🛡️ Screen Wake Lock disabled');
    });

    document.getElementById('testChimeBtn')?.addEventListener('click', () => {
      this.primeAudioContext();
      this.triggerHaptic([150, 80, 250]);
      this.playTimerAlarm();
    });

    document.getElementById('forceUpdateBtn')?.addEventListener('click', () => this.forceAppUpdate());
    document.getElementById('exportDataBtn')?.addEventListener('click', () => this.exportData());
    document.getElementById('importBackupBtn')?.addEventListener('click', () => {
      document.getElementById('importFileInput')?.click();
    });
    document.getElementById('resetRoutineBtn')?.addEventListener('click', () => this.resetRoutine());
  }

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
  }

  createBackupData() {
    return {
      version: '3.0', routine: this.routine, history: this.history,
      machineSettings: this.machineSettings, exerciseNotes: this.exerciseNotes,
      lastWeights: this.lastWeights, exercisePreferences: this.exercisePreferences || {},
      wakeLockEnabled: this.wakeLockEnabled, routineRev: localStorage.getItem(this.storageKeys.routineRev) || '15',
      sessions: this.getStoredSessions(), deloadActive: this.deloadActive, deloadStartDate: this.deloadStartDate,
      timer: { targetEnd: localStorage.getItem(this.storageKeys.timerTargetEnd), totalDuration: localStorage.getItem(this.storageKeys.timerTotalDuration), minimumRest: localStorage.getItem('gym_timer_minimum_v1'), startedAt: localStorage.getItem('gym_timer_started_at_v1') },
      exportedAt: new Date().toISOString()
    };
  }

  exportData() {
    this.saveCurrentSession();
    const blob = new Blob([JSON.stringify(this.createBackupData(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MachineMaster_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem(this.storageKeys.lastBackupTime, String(Date.now()));
    this.showToast('Backup exported successfully!');
    if (this.activeView === 'routine') this.renderRoutineEditor();
  }

  validateBackup(data) {
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const setsValid = sets => Array.isArray(sets) && sets.every(s => object(s) && (s.weight === null || Number.isFinite(Number(s.weight))) && Number.isFinite(Number(s.reps)) && Number(s.reps) >= 0 && Number(s.weight) >= 0);
    const draftSetsValid = sets => Array.isArray(sets) && sets.every(s => object(s) &&
      [s.weight, s.reps].every(value => value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))));
    if (!object(data) || !['routine', 'history', 'sessions'].some(key => key in data)) throw new Error('This is not a workout backup');
    if (data.routine !== undefined && (!Array.isArray(data.routine) || !data.routine.length || !data.routine.every(d => object(d) && typeof d.id === 'string' && Array.isArray(d.exercises) && d.exercises.every(ex => object(ex) && typeof ex.id === 'string' && typeof ex.name === 'string' && Number.isInteger(ex.sets) && ex.sets > 0 && typeof ex.targetReps === 'string')))) throw new Error('Invalid routine in backup');
    if (data.history !== undefined && (!Array.isArray(data.history) || !data.history.every(h => object(h) && typeof h.id === 'string' && Number.isFinite(new Date(h.date).getTime()) && object(h.exercises) && Object.values(h.exercises).every(ex => object(ex) && setsValid(ex.sets))))) throw new Error('Invalid workout history in backup');
    if (data.sessions !== undefined && (!Array.isArray(data.sessions) || !data.sessions.every(session => object(session) && typeof session.dayId === 'string' && object(session.logs) && Object.values(session.logs).every(draftSetsValid)))) throw new Error('Invalid sessions in backup');
    ['machineSettings', 'exerciseNotes', 'lastWeights', 'exercisePreferences', 'timer'].forEach(key => { if (data[key] !== undefined && !object(data[key])) throw new Error(`Invalid ${key} in backup`); });
    if (data.exercisePreferences && !Object.values(data.exercisePreferences).every(pref => object(pref) && (pref.increment === undefined || [1, 2.5, 5, 10].includes(pref.increment)))) throw new Error('Invalid exercise preferences');
    if (data.lastWeights && !Object.values(data.lastWeights).every(entry => object(entry) && Array.isArray(entry.sets) && setsValid(entry.sets.filter(Boolean)))) throw new Error('Invalid previous weights');
    if (data.deloadActive !== undefined && typeof data.deloadActive !== 'boolean') throw new Error('Invalid deload setting');
    if (data.deloadStartDate !== undefined && (!Number.isFinite(data.deloadStartDate) || data.deloadStartDate < 0)) throw new Error('Invalid deload start');
    if (data.timer && !Object.values(data.timer).every(value => value === null || (Number.isFinite(Number(value)) && Number(value) >= 0))) throw new Error('Invalid timer');
    return data;
  }

  importData(jsonString) {
    try {
      // Validate the complete backup before changing memory or browser storage.
      const data = this.validateBackup(JSON.parse(jsonString));
      const restoreRoutine = data.routine && confirm('Restore routine configurations from this backup? Cancel keeps your current routine.');
      const existingIds = new Set(this.history.map(h => h.id));
      const added = (data.history || []).filter(h => !existingIds.has(h.id) && existingIds.add(h.id));
      const history = [...this.history, ...added].sort((a, b) => new Date(a.date) - new Date(b.date));
      const writes = new Map([[this.storageKeys.history, JSON.stringify(history)]]);
      const merged = {};
      ['machineSettings', 'exerciseNotes', 'lastWeights', 'exercisePreferences'].forEach(key => {
        merged[key] = { ...(this[key] || {}), ...(data[key] || {}) };
        if (key === 'lastWeights') Object.entries(this.lastWeights || {}).forEach(([name, entry]) => {
          if (new Date(entry.date).getTime() > new Date(merged[key][name]?.date).getTime()) merged[key][name] = entry;
        });
        writes.set(this.storageKeys[key], JSON.stringify(merged[key]));
      });
      if (restoreRoutine) writes.set(this.storageKeys.routine, JSON.stringify(data.routine));
      (data.sessions || []).forEach(session => writes.set(this.getSessionKey(session.dayId), JSON.stringify(session)));
      ['wakeLockEnabled', 'deloadActive', 'deloadStartDate'].forEach(key => { if (data[key] !== undefined) writes.set(this.storageKeys[key], String(data[key])); });
      if (data.timer) {
        const keys = { targetEnd: this.storageKeys.timerTargetEnd, totalDuration: this.storageKeys.timerTotalDuration, minimumRest: 'gym_timer_minimum_v1', startedAt: 'gym_timer_started_at_v1' };
        Object.entries(keys).forEach(([field, key]) => { if (field in data.timer) writes.set(key, data.timer[field] === null ? null : String(data.timer[field])); });
      }
      writes.set(this.storageKeys.lastBackupTime, String(Date.now()));
      const before = new Map([...writes.keys()].map(key => [key, localStorage.getItem(key)]));
      try { writes.forEach((value, key) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value)); }
      catch (e) { before.forEach((value, key) => { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch (_) {} }); throw e; }
      this.history = history;
      Object.assign(this, merged);
      this.lastWeights = this.loadLastWeights();
      ['wakeLockEnabled', 'deloadActive', 'deloadStartDate'].forEach(key => { if (data[key] !== undefined) this[key] = data[key]; });
      if (restoreRoutine) this.routine = this.loadRoutine();
      this.activeDayIndex = Math.min(this.activeDayIndex, this.routine.length - 1);
      this.session = this.loadSession();
      if (data.timer) {
        if (this.timer?.intervalId) clearInterval(this.timer.intervalId);
        if (this.timer) { this.timer.active = false; this.timer.intervalId = null; }
        this.restoreActiveTimer();
      }
      this.showToast(`Restore complete! Added ${added.length} workouts.`);
      this.render();
    } catch (e) {
      console.error('Import error:', e);
      alert('Could not restore backup file: ' + (e.message || 'Invalid format'));
    }
  }

  resetRoutine() {
    if (confirm('Reset your routine to the original spreadsheet defaults?')) {
      this.routine = JSON.parse(JSON.stringify(DEFAULT_ROUTINE));
      this.saveRoutine();
      this.session = this.initNewSession(this.activeDayIndex);
      this.saveCurrentSession();
      alert('Routine reset to original spreadsheet successfully!');
      this.render();
    }
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  window.app = new WorkoutApp();
});
