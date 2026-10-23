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
    this.selectionLocalDate = this.getLocalDateKey(new Date());

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

    // Check if a rest countdown was running in background
    this.restoreActiveTimer();

    this.render();
    this.showSessionResumePrompt();
    if (this.equipmentRepairFailed) this.showToast('Could not restore equipment defaults. Your saved workouts are unchanged; free some device storage and check for an update again.');
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
    const repair = this.prepareSaturdayEquipmentRepair(routine);
    repair.writes.set(this.storageKeys.routineRev, '16');
    repair.writes.set(this.storageKeys.routine, JSON.stringify(repair.routine));
    try {
      this.writeStorageTransaction(repair.writes);
      this.equipmentRepairFailed = false;
      return repair.routine;
    } catch (error) {
      this.equipmentRepairFailed = true;
      console.error('Equipment defaults could not be saved:', error);
      return routine;
    }
  }

  prepareSaturdayEquipmentRepair(routine) {
    const repaired = JSON.parse(JSON.stringify(routine));
    const writes = new Map(), changes = [];
    const day = repaired.find(day => day.id === 'sat___upper_b');
    const originals = DEFAULT_ROUTINE.find(day => day.id === 'sat___upper_b')?.exercises || [];
    const recognized = {
      sat___upper_b_ex1: ['Incline Dumbbell Bench Press', 'Flat Dumbbell Bench Press'],
      sat___upper_b_ex3: ['Seated Dumbbell Shoulder Press', 'Standing Overhead DB Press', 'Standing Dumbbell Overhead Press']
    };
    (day?.exercises || []).forEach(ex => {
      if (!recognized[ex.id] || ex.equipmentRepairVersion === 1) return;
      ex.equipmentRepairVersion = 1;
      if (!recognized[ex.id].includes(ex.name)) return;
      const canonical = originals.find(original => original.id === ex.id);
      if (!canonical) return;
      const old = this.getExerciseSnapshot(ex);
      const original = this.getExerciseSnapshot(canonical);
      // The equipment repair does not rewrite the user's prescribed rep ranges.
      original.targetReps = ex.targetReps;
      ex.equipmentAlternatives = [...(Array.isArray(ex.equipmentAlternatives) ? ex.equipmentAlternatives : []).filter(item => item?.name !== old.name), old];
      ex.originalExercise = original;
      ['name', 'muscle', 'notes', 'videoUrl', 'increment', 'startingWeight'].forEach(key => { ex[key] = canonical[key]; });
      ex.needsBaseline = true;
      changes.push({ex, old});
    });
    if (!changes.length) return {routine: repaired, writes};
    const keys = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key === this.storageKeys.legacyCurrentSession || key.startsWith(this.storageKeys.currentSessionPrefix) ||
          (key.startsWith('gym_saved_draft_') && !key.startsWith('gym_saved_draft_for_'))) keys.push(key);
    }
    keys.forEach(key => {
      let draft;
      try { draft = JSON.parse(localStorage.getItem(key)); } catch (_) { return; }
      if (draft?.dayId !== day.id || !draft.logs || typeof draft.logs !== 'object') return;
      const before = JSON.stringify(draft);
      changes.forEach(({ex, old}) => {
        const rows = draft.logs[ex.id], warmups = draft.warmups?.[ex.id] || [];
        if (!Array.isArray(rows)) return;
        const swap = draft.swaps?.[ex.id];
        const untouched = !swap && !warmups.length && Array.isArray(draft.initialLogs?.[ex.id]) &&
          !rows.some(set => set.completed) && JSON.stringify(rows) === JSON.stringify(draft.initialLogs[ex.id]);
        if (untouched) {
          const targets = Object.create(this);
          targets.session = draft;
          targets.deloadActive = Boolean(draft.deload);
          draft.logs[ex.id] = rows.map((set, index) => {
            const target = targets.getSetTarget(ex, index, ex.name);
            const restored = {...set, weight: target.targetWeight, reps: target.targetReps, needsBaseline: Boolean(target.needsBaseline),
              exerciseName: ex.name, muscle: ex.muscle, targetReps: ex.targetReps, completed: false, rir: null};
            delete restored.completedAt;
            delete restored.rirAnswered;
            return restored;
          });
          draft.initialLogs[ex.id] = JSON.parse(JSON.stringify(draft.logs[ex.id]));
        } else {
          this.reconcileSessionEquipmentIdentity(draft, ex, old);
        }
      });
      if (JSON.stringify(draft) !== before) writes.set(key, JSON.stringify(draft));
    });
    return {routine: repaired, writes};
  }

  reconcileSessionEquipmentIdentity(session, exercise, fallback = exercise, recordedExercises = {}) {
    const rows = session.logs?.[exercise.id];
    if (!Array.isArray(rows)) return;
    const warmups = Array.isArray(session.warmups?.[exercise.id]) ? session.warmups[exercise.id] : [];
    const named = set => typeof set?.exerciseName === 'string' && set.exerciseName.trim();
    const swap = session.swaps?.[exercise.id];
    const alternatives = this.getSubstitutionsForExercise(exercise.name, exercise);
    const descriptors = [swap, exercise, fallback, this.getOriginalExercise(exercise),
      ...(Array.isArray(exercise.equipmentAlternatives) ? exercise.equipmentAlternatives : []), ...alternatives];
    const familyNames = new Set(descriptors.filter(item => typeof item?.name === 'string').map(item => item.name));
    const recordedNames = Object.keys(recordedExercises || {}).filter(name => familyNames.has(name));
    const recordedName = recordedNames.length === 1 ? recordedNames[0] : null;
    const completed = [...rows, ...warmups].filter(set => set.completed && named(set));
    const completedNames = [...new Set(completed.map(set => set.exerciseName))];
    const completedName = completedNames.length === 1 ? completedNames[0] : null;
    const pending = rows.find(set => !set.completed && named(set)) || warmups.find(set => !set.completed && named(set));
    const activeName = (typeof swap?.name === 'string' && swap.name.trim() && swap.name) ||
      pending?.exerciseName || completedName || recordedName || fallback.name;
    const descriptor = name => {
      const known = descriptors.find(item => item?.name === name);
      const evidence = [...rows, ...warmups].find(set => set.exerciseName === name);
      return known ? this.getExerciseSnapshot(known) : {
        name, muscle: evidence?.muscle || fallback.muscle || exercise.muscle,
        targetReps: evidence?.targetReps || fallback.targetReps || exercise.targetReps
      };
    };
    const equipment = descriptor(activeName);
    if (!swap && activeName !== exercise.name) {
      session.swaps ||= {};
      session.swaps[exercise.id] = equipment;
    }
    // Completed rows retain their own equipment, including when pending sets use a newer swap.
    const completedEquipment = descriptor(completedName || recordedName || fallback.name);
    rows.forEach(set => {
      if (named(set)) return;
      const identity = set.completed ? completedEquipment : equipment;
      set.exerciseName ||= identity.name;
      set.muscle ||= identity.muscle || fallback.muscle;
      set.targetReps ||= identity.targetReps || fallback.targetReps;
    });
    warmups.forEach(set => {
      set.exerciseName ||= (set.completed ? completedEquipment : equipment).name;
    });
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
    const nextRir = (list[setIdx].rir === rirVal) ? null : rirVal;
    if (nextRir === list[setIdx].rir && list[setIdx].rirAnswered) return;
    if (!this.saveSessionFlowChange(() => {
      list[setIdx].rir = nextRir;
      list[setIdx].rirAnswered = true;
    }, false)) return;
    if (this.pendingRir?.exId === exId && this.pendingRir?.setIdx === setIdx) {
      this.pendingRir = null;
      if (list.every(s => s.completed)) this.collapsedCards.add(exId);
    }
    this.renderWorkout();
  }

  getSessionKey(dayId) {
    return `${this.storageKeys.currentSessionPrefix}${dayId}`;
  }

  hasSessionProgress(session) {
    if (!session?.logs) return false;
    const day = this.routine?.find(day => day.id === session.dayId);
    const defaultOrder = day?.exercises.map(ex => ex.id);
    const orderChanged = Array.isArray(session.exerciseOrder) && defaultOrder &&
      JSON.stringify(session.exerciseOrder) !== JSON.stringify(defaultOrder);
    return Boolean(session.startTime || Object.values(session.logs).some(sets => sets.some(s => s.completed)) ||
      (!session.initialLogs && Object.values(session.logs).some(sets => sets.length)) ||
      (session.initialLogs && JSON.stringify(session.logs) !== JSON.stringify(session.initialLogs)) ||
      Object.values(session.warmups || {}).some(sets => Array.isArray(sets) && sets.length) || orderChanged ||
      Object.values(session.disabledSupersets || {}).some(Boolean) ||
      Object.keys(session.swaps || {}).length);
  }

  normalizeSessionFlow(session, day = this.routine.find(day => day.id === session.dayId)) {
    const ids = day?.exercises.map(ex => ex.id) || [];
    const order = Array.isArray(session.exerciseOrder) ? session.exerciseOrder : [];
    session.exerciseOrder = [...new Set([...order.filter(id => ids.includes(id)), ...ids])];
    if (!session.warmups || typeof session.warmups !== 'object' || Array.isArray(session.warmups)) session.warmups = {};
    return session;
  }

  writeStorageTransaction(writes) {
    const before = new Map([...writes.keys()].map(key => [key, localStorage.getItem(key)]));
    try {
      writes.forEach((value, key) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value));
    } catch (error) {
      before.forEach((value, key) => { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch (_) {} });
      throw error;
    }
  }

  getScheduleDate(value) {
    if (value === null || value === undefined || value === '') return null;
    // A legacy date without a time denotes a local calendar date, not UTC midnight.
    const dateOnly = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const date = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12) : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    if (dateOnly && (date.getFullYear() !== Number(dateOnly[1]) || date.getMonth() !== Number(dateOnly[2]) - 1 || date.getDate() !== Number(dateOnly[3]))) return null;
    return date;
  }

  getLocalDateKey(value = new Date()) {
    const date = this.getScheduleDate(value);
    if (!date) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  getLocalWeekKey(value = new Date()) {
    const date = this.getScheduleDate(value);
    if (!date) return null;
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return this.getLocalDateKey(date);
  }

  getScheduledWeekday(day) {
    const defaults = typeof DEFAULT_ROUTINE === 'undefined' ? [] : DEFAULT_ROUTINE;
    const title = defaults.find(original => original.id === day.id)?.title || day.title || '';
    const weekday = /^\s*(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)\b/i.exec(title)?.[1].slice(0, 3).toLowerCase();
    return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(weekday);
  }

  getHistoryDayId(record) {
    if (record?.dayId) return record.dayId;
    if (record?.sessionSnapshot?.dayId) return record.sessionSnapshot.dayId;
    const title = record?.dayTitle;
    if (typeof title !== 'string') return null;
    const day = this.routine.find(day => day.title === title);
    if (day) return day.id;
    const defaults = typeof DEFAULT_ROUTINE === 'undefined' ? [] : DEFAULT_ROUTINE;
    const original = defaults.find(day => day.title === title);
    return original && this.routine.some(day => day.id === original.id) ? original.id : null;
  }

  getSessionInteractionTime(session, now = new Date()) {
    if (!session) return 0;
    const today = this.getLocalDateKey(now);
    if (!today) return 0;
    const timestamps = Object.prototype.hasOwnProperty.call(session, 'lastInteractionAt') ? [session.lastInteractionAt] : [
      session.startTime,
      ...[session.logs, session.warmups].flatMap(collection => Object.values(collection || {}).flatMap(sets =>
        Array.isArray(sets) ? sets.filter(set => set?.completed).map(set => set.completedAt) : []))
    ];
    return Math.max(0, ...timestamps.map(value => {
      const date = this.getScheduleDate(value);
      return date && this.getLocalDateKey(date) === today ? date.getTime() : 0;
    }));
  }

  getResumeDayIndex(now = new Date()) {
    const lastDay = localStorage.getItem('gym_last_active_day_v1');
    const candidates = this.routine.map((day, index) => {
      try {
        const session = JSON.parse(localStorage.getItem(this.getSessionKey(day.id)) || localStorage.getItem(this.storageKeys.legacyCurrentSession) || 'null');
        if (session?.dayId !== day.id || !this.hasSessionProgress(session) ||
          (session.id && (this.history || []).some(record => (record.sessionId || record.sessionSnapshot?.id) === session.id))) return null;
        const activity = this.getSessionInteractionTime(session, now);
        return activity ? { index, dayId: day.id, activity } : null;
      } catch (_) { return null; }
    }).filter(Boolean);
    candidates.sort((a, b) => b.activity - a.activity || Number(b.dayId === lastDay) - Number(a.dayId === lastDay) || a.index - b.index);
    return candidates[0]?.index ?? this.getSuggestedDayIndex(now);
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
    const title = document.getElementById('summaryModalTitle');
    if (title) title.textContent = 'Saved workout';
    this.summaryContentEl.innerHTML = `<p>${this.escapeHtml(this.session.dayTitle)} · Started ${this.escapeHtml(new Date(info.date).toLocaleString())}</p><p>Resume keeps every saved set. Start new keeps this draft available for recovery.</p><button class="primary-btn" id="resumeDraftBtn">Resume workout</button><button class="secondary-btn" id="startNewDraftBtn">Start new workout</button>`;
    this.summaryModalEl.classList.add('open');
    document.getElementById('resumeDraftBtn')?.addEventListener('click', () => {
      this.selectionLocalDate = this.getLocalDateKey(new Date());
      this.summaryModalEl.classList.remove('open');
      this.jumpToActiveExercise?.();
    });
    document.getElementById('startNewDraftBtn')?.addEventListener('click', () => this.startNewSession(sessionId));
  }

  startNewSession(expectedId = this.session?.id) {
    if (expectedId !== this.session?.id) return false;
    const writes = new Map();
    if (this.hasSessionProgress(this.session)) {
      writes.set(`gym_saved_draft_${this.session.id}`, JSON.stringify(this.session));
      writes.set(`gym_saved_draft_for_${this.session.dayId}`, this.session.id);
    }
    const next = this.initNewSession(this.activeDayIndex);
    writes.set(this.getSessionKey(next.dayId), JSON.stringify(next));
    writes.set('gym_last_active_day_v1', next.dayId);
    try { this.writeStorageTransaction(writes); }
    catch (_) { this.showToast('Could not save a new workout. Your current workout is still open.'); return false; }
    this.stopTimer();
    this.session = next;
    this.pendingRir = null;
    this.editingCompletedSet = null;
    this.editingCompletedWarmup = null;
    this.focusedExerciseId = null;
    this.collapsedCards = new Set();
    this.selectionLocalDate = this.getLocalDateKey(new Date());
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
    try {
      draft.lastInteractionAt = new Date().toISOString();
      const writes = new Map([
        [this.getSessionKey(draft.dayId), JSON.stringify(draft)],
        ['gym_last_active_day_v1', draft.dayId],
        [`gym_saved_draft_${draftId}`, null],
        [`gym_saved_draft_for_${draft.dayId}`, null]
      ]);
      if (this.session.dayId !== draft.dayId) writes.set(this.getSessionKey(this.session.dayId), JSON.stringify(this.session));
      this.writeStorageTransaction(writes);
    } catch (_) { this.showToast('Could not restore the draft. Both workouts are still saved.'); return false; }
    this.stopTimer();
    this.activeDayIndex = dayIndex;
    this.selectionLocalDate = this.getLocalDateKey(new Date());
    this.session = this.normalizeSessionFlow(draft);
    this.pendingRir = null;
    this.editingCompletedSet = null;
    this.editingCompletedWarmup = null;
    this.focusedExerciseId = null;
    this.collapsedCards = new Set();
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
          if (parsed.id && this.history.some(workout => (workout.sessionId || workout.sessionSnapshot?.id) === parsed.id)) return this.initNewSession(dayIndex);
          parsed.dayTitle ||= day.title;
          parsed.swaps ||= {};
          // Only a provably untouched session may be recalculated when deload changes.
          const untouched = parsed.initialLogs && !this.hasSessionProgress(parsed);
          if (untouched && Boolean(parsed.deload) !== Boolean(this.deloadActive)) return this.initNewSession(dayIndex);
          if (typeof parsed.deload !== 'boolean') parsed.deload = Boolean(this.deloadActive);
          parsed.id ||= `s_${day.id}_${parsed.startTime || Date.now()}`;
          return this.normalizeSessionFlow(parsed, day);
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

  getOrderedExercises() {
    const exercises = this.routine?.[this.activeDayIndex]?.exercises || [];
    const byId = new Map(exercises.map(ex => [ex.id, ex]));
    const order = Array.isArray(this.session?.exerciseOrder) ? this.session.exerciseOrder : [];
    const seen = new Set();
    const ordered = [];
    [...order, ...exercises.map(ex => ex.id)].forEach(id => {
      if (!byId.has(id) || seen.has(id)) return;
      seen.add(id);
      ordered.push(byId.get(id));
    });
    // A saved order may predate a superset being enabled. Keep its members together.
    const grouped = new Set();
    return ordered.flatMap(ex => {
      if (grouped.has(ex.id)) return [];
      const members = this.isSupersetEnabled(ex)
        ? ordered.filter(candidate => this.isSupersetEnabled(candidate) && candidate.superset.id === ex.superset.id)
        : [ex];
      members.forEach(candidate => grouped.add(candidate.id));
      return members;
    });
  }

  getExerciseGroups() {
    const exercises = this.getOrderedExercises();
    const visited = new Set();
    return exercises.flatMap(ex => {
      if (visited.has(ex.id)) return [];
      const group = this.isSupersetEnabled(ex)
        ? exercises.filter(candidate => this.isSupersetEnabled(candidate) && candidate.superset.id === ex.superset.id)
        : [ex];
      group.forEach(candidate => visited.add(candidate.id));
      return [group];
    });
  }

  isExerciseGroupUnfinished(group) {
    return group.some(ex => (this.session?.logs?.[ex.id] || []).some(set => !set.completed) ||
      (this.session?.warmups?.[ex.id] || []).some(set => !set.completed));
  }

  getDeferTargetGroup(exId) {
    const groups = this.getExerciseGroups();
    const currentIndex = groups.findIndex(group => group.some(ex => ex.id === exId));
    if (currentIndex < 0 || !this.isExerciseGroupUnfinished(groups[currentIndex])) return null;
    for (let offset = 1; offset < groups.length; offset++) {
      const group = groups[(currentIndex + offset) % groups.length];
      if (this.isExerciseGroupUnfinished(group)) return group;
    }
    return null;
  }

  canDeferExercise(exId) {
    return Boolean(this.getDeferTargetGroup(exId));
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

  getNextSet() {
    for (const group of this.getExerciseGroups()) {
      for (const candidate of group) {
        const warmup = this.getNextWarmup(candidate.id);
        if (warmup) return warmup;
      }
      const maxSets = Math.max(0, ...group.map(candidate => this.session?.logs?.[candidate.id]?.length || 0));
      for (let setIdx = 0; setIdx < maxSets; setIdx++) {
        for (const candidate of group) {
          const set = this.session?.logs?.[candidate.id]?.[setIdx];
          if (set && !set.completed) return { ex: candidate, setIdx, type: 'working' };
        }
      }
    }
    return null;
  }

  getSuggestedDayIndex(now = new Date()) {
    const schedule = this.routine.map((day, index) => ({ day, index, weekday: this.getScheduledWeekday(day) })).filter(item => item.weekday >= 0);
    const date = this.getScheduleDate(now);
    if (!schedule.length || !date) return 0;
    const history = this.history || [];
    const completed = new Map();
    history.forEach(record => {
      const id = this.getHistoryDayId(record), week = this.getLocalWeekKey(record?.date);
      if (!id || !week) return;
      if (!completed.has(week)) completed.set(week, new Set());
      completed.get(week).add(id);
    });
    date.setHours(12, 0, 0, 0);
    // Each saved record can skip at most one scheduled occurrence. Calendar-day
    // arithmetic preserves local weekdays across daylight-saving changes.
    for (let offset = 0; offset < (history.length + 1) * 7; offset++) {
      const done = completed.get(this.getLocalWeekKey(date));
      const next = schedule.find(item => item.weekday === date.getDay() && !done?.has(item.day.id));
      if (next) return next.index;
      date.setDate(date.getDate() + 1);
    }
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
    const weights = list.map(set => Math.max(0, (parseFloat(set.weight) || 0) + delta));
    if (!list.some((set, idx) => set.weight !== weights[idx])) return;
    if (!this.saveSessionFlowChange(() => {
      list.forEach((set, idx) => { set.weight = weights[idx]; });
    })) return;
    this.renderWorkout();
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
      if (idx > 0 && !set.completed && (!set.exerciseName || !list[0].exerciseName || set.exerciseName === list[0].exerciseName)) affected.push(idx);
    });
    if (!affected.some(idx => list[idx].weight !== value || Boolean(list[idx].needsBaseline) !== !valid)) return;
    if (!this.saveSessionFlowChange(() => affected.forEach(idx => {
      list[idx].weight = value;
      list[idx].needsBaseline = !valid;
    }))) return;
    affected.forEach(idx => {
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
    const input = this.exerciseListEl.querySelector(`.set-reps-input[data-exid="${exId}"][data-setidx="${setIdx}"]`);
    if (input && document.activeElement !== input) input.value = list[setIdx].reps;
    this.updateNowLiftingHUD();
  }

  getSetValidationError(set) {
    if (set.weight === null || set.weight === '' || !Number.isFinite(Number(set.weight)) || Number(set.weight) < 0 || set.needsBaseline)
      return 'Enter a valid load of 0 lb or more for this equipment.';
    if (set.reps === null || String(set.reps).trim() === '' || !Number.isInteger(Number(set.reps)) || Number(set.reps) <= 0)
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
        this.refreshWorkoutSelectionForDate();
      });
    });

    // Close on backdrop tap
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          backdrop.classList.remove('open');
          this.refreshWorkoutSelectionForDate();
        }
      });
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
        this.refreshWorkoutSelectionForDate();
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

  selectDefaultWorkout(now = new Date()) {
    this.activeDayIndex = this.getResumeDayIndex(now);
    this.session = this.loadSession();
    this.selectionLocalDate = this.getLocalDateKey(now);
    this.focusedExerciseId = null;
    this.pendingRir = null;
    this.editingCompletedSet = null;
    this.editingCompletedWarmup = null;
    this.collapsedCards = new Set();
    this.render();
  }

  refreshWorkoutSelectionForDate(now = new Date()) {
    if (document.visibilityState === 'hidden' || this.selectionLocalDate === this.getLocalDateKey(now)) return false;
    // Let an open review or equipment dialog finish before changing its workout.
    if (document.querySelector('.modal-backdrop.open')) return false;
    try { this.saveCurrentSession(); }
    catch (_) { this.showToast('Could not save your current workout. Try again before changing days.'); return false; }
    this.selectDefaultWorkout(now);
    this.showSessionResumePrompt();
    return true;
  }

  renderDaySelector() {
    const todayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
    this.daySelectorEl.innerHTML = `<label class="day-picker-label" for="workoutDayPicker">Workout day</label>
      <select id="workoutDayPicker" class="day-picker">${this.routine.map((day, idx) =>
        `<option value="${idx}" ${idx === this.activeDayIndex ? 'selected' : ''}>${this.escapeHtml(day.title)}${day.title.startsWith(todayName) ? ' · Today' : ''}</option>`).join('')}</select>`;
    document.getElementById('workoutDayPicker').addEventListener('change', e => {
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
  }

  renderWorkout() {
    const day = this.routine[this.activeDayIndex];
    if (!day) return;
    const orderedExercises = this.getOrderedExercises();
    const core = orderedExercises.filter(ex => !ex.isOptional);
    const total = core.reduce((sum, ex) => sum + (this.session.logs[ex.id] || []).length, 0);
    const complete = core.reduce((sum, ex) => sum + (this.session.logs[ex.id] || []).filter(set => set.completed).length, 0);
    const estimateSeconds = core.reduce((sum, ex) => {
      const count = (this.session.logs[ex.id] || []).length;
      return sum + count * 45 + Math.max(0, count - 1) * this.getRestSeconds(ex) + 90;
    }, 0);
    const normalSets = core.reduce((sum, ex) => sum + ex.sets, 0);
    const reducedSets = core.reduce((sum, ex) => sum + Math.max(2, Math.floor(ex.sets * .67)), 0);
    const next = this.getNextSet();
    if (!this.pendingRir) {
      const groups = this.getExerciseGroups();
      const nextGroupIndex = groups.findIndex(group => group.some(ex => ex.id === next?.ex.id));
      const eligible = nextGroupIndex < 0 ? orderedExercises : groups.slice(0, nextGroupIndex + 1).flat();
      const pendingExercise = eligible.find(ex => {
        const sets = this.session.logs[ex.id] || [];
        return sets.length && sets.every(set => set.completed) && !sets.at(-1).rirAnswered && sets.at(-1).rir == null;
      });
      if (pendingExercise) this.pendingRir = { exId: pendingExercise.id, setIdx: this.session.logs[pendingExercise.id].length - 1 };
    }
    const pending = this.pendingRir && orderedExercises.find(ex => ex.id === this.pendingRir.exId);
    const focus = orderedExercises.find(ex => ex.id === this.focusedExerciseId) || pending || (next && next.ex) || core[0];
    const visible = focus ? orderedExercises.filter(ex => ex.id === focus.id ||
      (this.isSupersetEnabled(focus) && this.isSupersetEnabled(ex) && ex.superset.id === focus.superset.id)) : [];
    const overviewOpen = this.sessionInfoEl.querySelector('.workout-overview')?.open || false;
    const resume = this.getSessionResumeInfo();
    this.sessionInfoEl.innerHTML = `<details class="workout-overview" ${overviewOpen ? 'open' : ''}>
      <summary><span class="session-summary-line"><span class="session-completion"><strong>${complete} / ${total}</strong> sets</span><span class="session-overview-label">Overview</span></span><span class="workout-progress-track" role="progressbar" aria-label="Workout sets" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${complete}"><span class="workout-progress-fill" style="width:${total ? complete / total * 100 : 0}%"></span></span></summary>
      <div class="session-detail-summary">${day.exercises.length} exercises · ~${Math.ceil(estimateSeconds / 60)} min planned</div>
      ${resume.inProgress ? `<div class="session-resume-info">In progress${resume.date ? ` · Started ${this.escapeHtml(new Date(resume.date).toLocaleString())}` : ''}<button type="button" class="secondary-btn start-new-session-btn">Start new workout</button></div>` : ''}
      ${resume.savedDraftId ? '<button type="button" class="secondary-btn restore-draft-btn">Restore previous draft</button>' : ''}
      ${this.session.deload ? `<div class="deload-banner">Deload: ${reducedSets} of ${normalSets} planned sets (${Math.round((normalSets - reducedSets) / normalSets * 100)}% fewer), loads eased 10%.</div>` : ''}
      <div class="overview-list">${orderedExercises.map(ex => {
        const sets = this.session.logs[ex.id] || [];
        const pendingEffort = sets.filter(set => set.completed && !set.rirAnswered && set.rir == null).length;
        return `<button type="button" class="overview-exercise ${visible.includes(ex) ? 'selected' : ''}" data-exid="${ex.id}"><span>${this.escapeHtml(this.getEffectiveExerciseName(ex.id, ex))}${ex.isOptional ? ' · Optional' : ''}${pendingEffort ? `<small>${pendingEffort} effort ${pendingEffort === 1 ? 'entry' : 'entries'} pending</small>` : ''}</span><span>${sets.filter(set => set.completed).length}/${sets.length}</span></button>`;
      }).join('')}</div>
    </details>`;
    const pendingSet = pending && this.session.logs[pending.id]?.[this.pendingRir.setIdx];
    const effortPrompt = pending && !visible.includes(pending) && pendingSet?.completed && !pendingSet.rirAnswered ? `<aside class="pending-effort" aria-label="Last exercise effort">
      <p><strong>Last set: ${this.escapeHtml(pendingSet.exerciseName || pending.name)}</strong></p>${this.renderEffortPrompt(pending.id, this.pendingRir.setIdx, pendingSet)}
    </aside>` : '';
    this.exerciseListEl.innerHTML = `${!next ? '<aside class="workout-ready"><strong>All sets complete</strong><button type="button" class="primary-btn review-finish-btn">Review & finish</button></aside>' : ''}${effortPrompt}${this.focusedExerciseId && next && this.focusedExerciseId !== next.ex.id ? '<button type="button" class="secondary-btn return-next-btn">Return to next set</button>' : ''}
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
    const position = this.getOrderedExercises().findIndex(item => item.id === ex.id) + 1;
    const exerciseCount = this.routine[this.activeDayIndex].exercises.length;
    const canDefer = this.canDeferExercise(ex.id);
    const deferHelp = this.isExerciseGroupUnfinished(this.getExerciseGroups().find(group => group.some(item => item.id === ex.id)) || [])
      ? 'No other unfinished exercise to switch to.' : 'This exercise is complete.';
    const seat = this.machineSettings[ex.id] || '';
    const note = this.exerciseNotes[name] || '';
    return `<article class="exercise-card focused-card ${allDone ? 'completed' : ''}" id="card_${ex.id}" data-exid="${ex.id}">
      <div class="card-header">
        <div class="focus-card-eyebrow">Exercise ${position} of ${exerciseCount} · ${this.escapeHtml(ex.muscle)}${isBonus ? ' · Optional' : ''}${enabled ? ` · Superset ${this.escapeHtml(ex.superset.tag)}` : ''}</div>
        <h3 class="exercise-name">${this.escapeHtml(name)}</h3>
        ${swapped ? `<div class="muted-text">Alternative for ${this.escapeHtml(ex.name)}</div>` : ''}
        <div class="focus-prescription">${sets.length} sets × ${this.escapeHtml(targetReps)} reps · Rest ${rest}</div>
        <div class="load-convention">Weight in lbs · ${conventionLabel}</div>
        <div class="exercise-heading-tools">${this.renderWarmupButton(ex)}<button type="button" class="swap-btn secondary-btn" aria-label="Swap equipment" data-exid="${ex.id}" data-exname="${this.escapeHtml(ex.name)}">Swap</button><button type="button" class="machine-taken-btn secondary-btn" data-exid="${ex.id}" ${canDefer ? '' : `disabled aria-describedby="machineTakenHelp_${ex.id}"`}>Machine taken</button></div>
        ${canDefer ? '' : `<small id="machineTakenHelp_${ex.id}" class="machine-availability-help muted-text">${deferHelp}</small>`}
        <div class="saved-setup-cue" ${!seat && !note ? 'hidden' : ''}><span class="saved-seat-cue">${seat ? `Seat / pin: ${this.escapeHtml(seat)}` : ''}</span><span class="saved-note-cue">${this.escapeHtml(note)}</span></div>
      </div>
      ${this.renderWarmupSets(ex)}
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
        return `<section class="set-row set-block ${set.completed ? 'completed' : ''} ${next && next.type !== 'warmup' && next.ex.id === ex.id && next.setIdx === idx ? 'active-next-set' : ''}" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Set ${idx + 1}">
          <div class="set-heading" tabindex="-1"><strong>Set ${idx + 1}${next && next.type !== 'warmup' && next.ex.id === ex.id && next.setIdx === idx ? ' · Up next' : ''}</strong><span>Target ${this.escapeHtml(target.targetRepsDisplay)} reps${!needsBaseline && target.targetWeight > 0 ? ` · ${target.targetWeightDisplay} lb` : ''}</span></div>
          <div class="previous-set">Last: ${prev ? `${prev.weight === 0 ? 'BW' : prev.weight + ' lb'} × ${prev.reps}` : 'No previous set'}${set.completed && set.exerciseName && set.exerciseName !== name ? ` · Logged as ${this.escapeHtml(set.exerciseName)}` : ''}</div>
          ${needsBaseline ? '<p class="baseline-prompt">Enter a baseline weight for this equipment (0 for bodyweight).</p>' : ''}
          <div class="set-entry-grid">
            <label>Weight (lb)<span class="stepper-wrap weight-stepper"><button type="button" class="stepper-btn" data-type="weight" data-delta="-${increment}" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Decrease set ${idx + 1} weight by ${increment} pounds">−</button><input type="number" class="set-input set-weight-input" value="${this.escapeHtml(set.weight === null ? '' : String(set.weight))}" data-exid="${ex.id}" data-setidx="${idx}" min="0" step="${increment}" inputmode="decimal" placeholder="Enter" aria-label="Set ${idx + 1} weight in pounds"><button type="button" class="stepper-btn" data-type="weight" data-delta="${increment}" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Increase set ${idx + 1} weight by ${increment} pounds">+</button></span></label>
            <label>Reps<span class="stepper-wrap reps-stepper"><button type="button" class="stepper-btn" data-type="reps" data-delta="-1" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Decrease set ${idx + 1} reps">−</button><input type="number" class="set-input set-reps-input" value="${this.escapeHtml(String(set.reps ?? ''))}" data-exid="${ex.id}" data-setidx="${idx}" min="1" step="1" inputmode="numeric" aria-label="Set ${idx + 1} reps"><button type="button" class="stepper-btn" data-type="reps" data-delta="1" data-exid="${ex.id}" data-setidx="${idx}" aria-label="Increase set ${idx + 1} reps">+</button></span></label>
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
    this.exerciseListEl.querySelectorAll('.machine-taken-btn').forEach(button => {
      button.addEventListener('click', () => this.deferExercise(button.dataset.exid));
    });
    this.exerciseListEl.querySelector('.review-finish-btn')?.addEventListener('click', () => this.showWorkoutSummary());
    this.sessionInfoEl.querySelector('.start-new-session-btn')?.addEventListener('click', () => this.startNewSession());
    this.sessionInfoEl.querySelector('.restore-draft-btn')?.addEventListener('click', () => this.restoreSavedDraft(this.getSessionResumeInfo().savedDraftId));
    this.sessionInfoEl.querySelectorAll('.overview-exercise').forEach(button => {
      button.addEventListener('click', () => {
        this.focusedExerciseId = button.dataset.exid;
        this.collapsedCards.delete(button.dataset.exid);
        this.renderWorkout();
        const overview = this.sessionInfoEl.querySelector('.workout-overview');
        if (overview) overview.open = false;
        const first = (this.session.logs[button.dataset.exid] || []).findIndex(set => !set.completed);
        const warmup = this.getNextWarmup(button.dataset.exid);
        this.revealWorkoutSet(button.dataset.exid, warmup ? warmup.setIdx : first >= 0 ? first : 0, true, false, warmup ? 'warmup' : 'working');
      });
    });
    this.exerciseListEl.querySelector('.return-next-btn')?.addEventListener('click', () => {
      this.jumpToActiveExercise();
    });
    this.exerciseListEl.querySelectorAll('.superset-enabled-input').forEach(input => {
      input.addEventListener('input', () => {
        if (Boolean(this.session.disabledSupersets?.[input.dataset.group]) === !input.checked) return;
        if (!this.saveSessionFlowChange(() => {
          this.session.disabledSupersets ||= {};
          this.session.disabledSupersets[input.dataset.group] = !input.checked;
        }, false)) return;
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
        const error = this.getSetValidationError(this.session.logs[exId][setIdx]);
        if (error) { this.showToast(error); return; }
        this.editingCompletedSet = null;
        this.editingCompletedWarmup = null;
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

    this.bindWarmupEvents();

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
        this.editingCompletedWarmup = null;
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
        this.updateSetWeight(exId, setIdx, input.value);
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
    }), false)) return;
    this.renderWorkout();
  }

  removeLastSetFromExercise(exId) {
    const list = this.session.logs[exId];
    if (list && list.length > 1) {
      if (!this.saveSessionFlowChange(() => list.pop(), false)) return;
      this.renderWorkout();
    }
  }

  updateNowLiftingHUD() {
    const dock = document.getElementById('nowLiftingDock');
    if (!dock) return;
    const next = this.activeView === 'workout' && this.session ? this.getNextSet() : null;
    if (!next) { dock.style.display = 'none'; return; }
    const set = (next.type === 'warmup' ? this.session.warmups : this.session.logs)[next.ex.id][next.setIdx];
    const name = this.getEffectiveExerciseName(next.ex.id, next.ex);
    const swap = this.session.swaps && this.session.swaps[next.ex.id];
    const targetReps = (swap && swap.targetReps) || next.ex.targetReps;
    document.getElementById('nowLiftingTitle').textContent = name;
    const number = next.type === 'warmup' ? this.getWarmupNumber(set, next.setIdx) : next.setIdx + 1;
    document.getElementById('nowLiftingMeta').textContent = `Next: ${next.type === 'warmup' ? 'warm-up' : 'set'} ${number} · ${next.type === 'warmup' ? set.reps : targetReps} reps · ${set.weight === null || set.weight === '' ? 'Enter load' : set.weight + ' lb'}`;
    dock.dataset.activeExid = next.ex.id;
    dock.style.display = 'flex';
  }

  revealWorkoutSet(exId, setIdx, focus = false, automatic = false, type = 'working') {
    // Value-entry handlers preserve their input nodes; navigation must not steal their keyboard.
    if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
    const row = this.exerciseListEl.querySelector(type === 'warmup'
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
      window.scrollTo({top: targetTop, behavior: automatic || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    }
    if (focus) (row.querySelector('.rir-selector-row') || row.querySelector('.set-heading, .edit-set-btn, .warmup-edit-btn') || row).focus({preventScroll: true});
  }

  jumpToActiveExercise({automatic = false} = {}) {
    if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (automatic && this.pendingRir) {
      const {exId, setIdx} = this.pendingRir;
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
      const effort = this.pendingRir && this.exerciseListEl.querySelector(`.rir-selector-row[data-exid="${this.pendingRir.exId}"][data-setidx="${this.pendingRir.setIdx}"]`);
      if (effort) { effort.scrollIntoView({block: 'center', behavior: 'instant'}); effort.focus({preventScroll: true}); }
      else {
        const finish = this.exerciseListEl.querySelector('.review-finish-btn');
        if (finish) { finish.scrollIntoView({block: 'center', behavior: 'instant'}); finish.focus({preventScroll: true}); }
      }
      return;
    }
    const selector = next.type === 'warmup'
      ? `.warmup-row[data-exid="${next.ex.id}"][data-warmupidx="${next.setIdx}"]`
      : `.set-row[data-exid="${next.ex.id}"][data-setidx="${next.setIdx}"]`;
    this.focusedExerciseId = next.ex.id;
    this.collapsedCards.delete(next.ex.id);
    if (!this.exerciseListEl.querySelector(selector)) this.renderWorkout();
    this.revealWorkoutSet(next.ex.id, next.setIdx, true, automatic, next.type);
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
  getExerciseSnapshot(exercise) {
    const snapshot = {};
    for (const key of ['name', 'muscle', 'targetReps', 'notes', 'videoUrl', 'increment', 'startingWeight', 'needsBaseline']) {
      const value = exercise?.[key];
      if (key === 'needsBaseline' ? typeof value === 'boolean' : key === 'increment' ? typeof value === 'number' && Number.isFinite(value) && value > 0 :
          typeof value === 'string' || (key === 'startingWeight' && typeof value === 'number' && Number.isFinite(value))) snapshot[key] = value;
    }
    return snapshot;
  }

  getOriginalExercise(exercise) {
    if (typeof exercise?.originalExercise?.name === 'string' && exercise.originalExercise.name.trim()) return this.getExerciseSnapshot(exercise.originalExercise);
    const canonical = typeof DEFAULT_ROUTINE !== 'undefined'
      ? DEFAULT_ROUTINE.flatMap(day => day.exercises).find(candidate => candidate.id === exercise?.id) : null;
    return this.getExerciseSnapshot(canonical || exercise);
  }

  getSwapEquipmentType(name) {
    if (/dumbbell|\bdb\b/i.test(name)) return 'Dumbbell';
    if (/cable/i.test(name)) return 'Cable';
    if (/barbell/i.test(name)) return 'Barbell';
    if (/machine|smith|hack|leg press/i.test(name)) return 'Machine';
    return 'Equipment';
  }

  getSubstitutionsForExercise(exerciseName, exercise) {
    const original = this.getOriginalExercise(exercise);
    const canonical = typeof DEFAULT_ROUTINE !== 'undefined'
      ? DEFAULT_ROUTINE.flatMap(day => day.exercises).find(candidate => candidate.id === exercise?.id) : null;
    const cleanName = (original.name || exerciseName).replace(/\s*\(alt for.*?\)/i, '').trim();
    let alternatives;
    if (typeof EXERCISE_SUBSTITUTIONS !== 'undefined') {
      const familyName = cleanName === 'Smith Machine Overhead Press' ? 'Machine Overhead Shoulder Press' : cleanName;
      alternatives = EXERCISE_SUBSTITUTIONS[familyName] || EXERCISE_SUBSTITUTIONS[canonical?.name];
      if (!alternatives) {
        const key = Object.keys(EXERCISE_SUBSTITUTIONS).find(candidate =>
          cleanName.toLowerCase().includes(candidate.toLowerCase()) || candidate.toLowerCase().includes(cleanName.toLowerCase()));
        if (key) alternatives = EXERCISE_SUBSTITUTIONS[key];
      }
    }
    alternatives ||= [
      { name: `Dumbbell Alternative (${exercise ? exercise.muscle : 'Lift'})`, type: 'Dumbbell', muscle: exercise ? exercise.muscle : '', targetReps: '8–12', notes: 'Perform with controlled tempo and full range of motion.', videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(exerciseName + ' dumbbell alternative')}` },
      { name: `Cable Alternative (${exercise ? exercise.muscle : 'Lift'})`, type: 'Cable', muscle: exercise ? exercise.muscle : '', targetReps: '10–12', notes: 'Maintain steady cable tension throughout the movement.', videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(exerciseName + ' cable alternative')}` }
    ];
    const currentName = exercise ? this.getEffectiveExerciseName(exercise.id, exercise) : exerciseName;
    const seen = new Set([String(currentName).trim().toLowerCase()]);
    return [original, exercise && this.getExerciseSnapshot(exercise), ...(Array.isArray(exercise?.equipmentAlternatives) ? exercise.equipmentAlternatives : []), ...alternatives].filter(Boolean).filter(sub => {
      const key = String(sub.name || '').trim().toLowerCase();
      if (typeof sub.name !== 'string' || !key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(sub => ({...this.getExerciseSnapshot(sub), type: typeof sub.type === 'string' ? sub.type : this.getSwapEquipmentType(sub.name)}));
  }

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
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--radius-md); padding: 12px; margin-bottom: 14px;">
          <div style="font-size: 0.875rem; color: var(--text-muted); font-weight: 700;">This workout</div>
          <div style="font-size: 0.95rem; font-weight: 700; color: #fff; margin-top: 2px;">${this.escapeHtml(currentName)}</div>
          <div class="swap-default-label">Routine default: ${this.escapeHtml(ex ? ex.name : exName)}</div>
          <div class="swap-scope-note">Equipment swaps apply to this workout. Your next workout uses the routine default.</div>
        </div>

        ${isCurrentlySwapped ? `
          <div style="margin-bottom: 14px;">
            <button type="button" id="restoreSwapBtn" style="width: 100%; padding: 10px; background: rgba(59, 130, 246, 0.15); border: 1px solid var(--accent-blue); color: var(--accent-blue); border-radius: var(--radius-md); font-weight: 700; cursor: pointer;">
              Use routine default for this workout (${this.escapeHtml(ex ? ex.name : exName)})
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
                  <span class="swap-type-badge ${this.escapeHtml(sub.type.toLowerCase().replace(/\s+/g, '-'))}">${this.escapeHtml(sub.type)}</span>
                  <div class="swap-option-name">${this.escapeHtml(sub.name)}</div>
                </div>
                ${/^https?:\/\//i.test(sub.videoUrl || '') ? `
                  <a href="${this.escapeHtml(sub.videoUrl)}" target="_blank" rel="noopener noreferrer" class="video-link-btn" style="font-size: 0.7rem; padding: 3px 8px;">
                    ▶ Form
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

      // Bind restore button
      document.getElementById('restoreSwapBtn')?.addEventListener('click', () => {
        if (!this.session.swaps?.[exId]) return;
        if (!this.saveSessionFlowChange(() => {
          if (this.session.warmups?.[exId]) this.session.warmups[exId] = this.session.warmups[exId].filter(set => set.completed);
          delete this.session.swaps[exId];
          // Recalculate uncompleted sets back to original targets.
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
              delete s.rirAnswered;
            }
          });
        }, false)) return;
        this.editingCompletedWarmup = null;
        if (this.swapModalEl) this.swapModalEl.classList.remove('open');
        this.showToast(`Using routine default "${this.escapeHtml(ex ? ex.name : exName)}" for this workout.`);
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
          const sub = btn.dataset.current ? this.session.swaps?.[exId] : subs[parseInt(btn.dataset.subidx, 10)];
          this.reviewRoutineDefaultChange(exId, sub);
        });
      });
      document.getElementById('restoreRoutineDefaultBtn')?.addEventListener('click', () => {
        if (canRestoreDefault) this.reviewRoutineDefaultChange(exId, original, true);
      });
    }

    if (this.swapModalEl) this.swapModalEl.classList.add('open');
  }

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
        <button type="button" id="cancelRoutineDefaultBtn" class="swap-btn-perm">Back to alternatives</button>
        <button type="button" id="confirmRoutineDefaultBtn" class="swap-btn-today">${restoring ? 'Restore routine default' : 'Save routine default'}</button>
      </div>`;
    document.getElementById('cancelRoutineDefaultBtn')?.addEventListener('click', () => this.openSwapModal(exId, ex.name));
    document.getElementById('confirmRoutineDefaultBtn')?.addEventListener('click', () => this.applyExerciseSwap(exId, sub, 'permanent'));
  }

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
      if (changingEquipment && this.session.warmups?.[exId]) this.session.warmups[exId] = this.session.warmups[exId].filter(set => set.completed);
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
        // Today only: mark in session
        if (!this.session.swaps) this.session.swaps = {};
        this.session.swaps[exId] = sub;
      }

      // Recalculate uncompleted sets in this.session.logs[exId]
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
          s.rir = null;
        }
      });
    }, false, mode === 'permanent')) return;
    this.editingCompletedWarmup = null;
    this.showToast(mode === 'permanent'
      ? `✅ Replaced "${this.escapeHtml(oldName)}" with "${this.escapeHtml(sub.name)}" permanently in your routine!`
      : `⚡ Swapped to "${this.escapeHtml(sub.name)}" for today's workout!`);

    if (this.swapModalEl) this.swapModalEl.classList.remove('open');
    this.renderWorkout();
  }

  // Warm-ups belong only to this workout and never enter the working-set log.
  getWarmupSets(exId) {
    const rows = this.session?.warmups?.[exId];
    return Array.isArray(rows) ? rows : [];
  }

  getWarmupNumber(set, index) {
    return Number.isInteger(set.setNum) && set.setNum > 0 ? set.setNum : index + 1;
  }

  getWarmupWorkingSet(exId) {
    const ex = this.findExerciseById(exId);
    if (!ex) return null;
    const name = this.getEffectiveExerciseName(exId, ex);
    const matches = (this.session?.logs?.[exId] || []).filter(set =>
      set.exerciseName === name || (!set.exerciseName && !this.session?.swaps?.[exId]));
    const positive = set => !set.needsBaseline && set.weight !== null && String(set.weight).trim() !== '' && Number.isFinite(Number(set.weight)) && Number(set.weight) > 0;
    return matches.find(set => !set.completed && positive(set)) || matches.find(positive) || null;
  }

  hasWarmupRamp(exId) {
    const ex = this.findExerciseById(exId);
    if (!ex) return false;
    const name = this.getEffectiveExerciseName(exId, ex);
    return this.getWarmupSets(exId).some(set => set.exerciseName === name || (!set.exerciseName && !this.session?.swaps?.[exId]));
  }

  getNextWarmup(exId) {
    const setIdx = this.getWarmupSets(exId).findIndex(set => !set.completed);
    const ex = this.findExerciseById(exId);
    return ex && setIdx >= 0 ? {ex, setIdx, type: 'warmup'} : null;
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
    // Keep the focused number input mounted while the user types.
    const input = this.exerciseListEl?.querySelector(`.warmup-input[data-exid="${exId}"][data-warmupidx="${setIdx}"][data-field="${field}"]`);
    if (input && document.activeElement !== input) input.value = value ?? '';
    this.updateNowLiftingHUD();
    return true;
  }

  toggleWarmupCompletion(exId, setIdx) {
    const set = this.getWarmupSets(exId)[setIdx];
    const ex = this.findExerciseById(exId);
    if (!set || !ex) return false;
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
      const finalWarmup = !this.getWarmupSets(exId).some(row => !row.completed);
      const seconds = finalWarmup ? this.getRestSeconds(ex) : 90;
      this.triggerHaptic([40]);
      this.startTimer(seconds, finalWarmup ? (this.isSupersetEnabled(ex) ? 0 : 120) : 90);
      this.focusedExerciseId = null;
    }
    this.renderWorkout();
    this.updateNowLiftingHUD();
    if (completed) this.jumpToActiveExercise({automatic: true});
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

  renderWarmupButton(ex) {
    const added = this.hasWarmupRamp(ex.id);
    const disabled = added || !this.getWarmupWorkingSet(ex.id);
    const title = added ? 'Warm-up sets are already on this card' : 'Enter a working load greater than 0 lb first';
    return `<button type="button" class="warmup-btn secondary-btn" aria-label="${added ? 'Warm-ups added' : 'Add warm-up sets'}" data-exid="${ex.id}" ${disabled ? `disabled title="${title}"` : ''}>${added ? 'Warm-ups ✓' : 'Warm-ups'}</button>`;
  }

  renderWarmupSets(ex) {
    const rows = this.getWarmupSets(ex.id);
    if (!rows.length) return '';
    const name = this.getEffectiveExerciseName(ex.id, ex);
    const next = this.getNextSet();
    const remaining = rows.filter(set => !set.completed).length;
    return `<section class="warmup-sets" aria-label="Warm-up sets for ${this.escapeHtml(name)}"><div class="warmup-section-heading"><strong>Warm-up sets</strong><span>This workout only</span></div>${rows.map((set, idx) => {
      const label = `Warm-up ${this.getWarmupNumber(set, idx)}`;
      const editing = this.editingCompletedWarmup?.exId === ex.id && this.editingCompletedWarmup.setIdx === idx;
      const active = next?.type === 'warmup' && next.ex.id === ex.id && next.setIdx === idx;
      const equipment = set.exerciseName && set.exerciseName !== name ? `<small>${this.escapeHtml(set.exerciseName)}</small>` : '';
      if (set.completed && !editing) return `<section class="warmup-row completed-warmup-row" data-exid="${ex.id}" data-warmupidx="${idx}" aria-label="Completed ${label.toLowerCase()}"><div class="completed-set-summary"><span><strong>✓ ${label}</strong> · ${this.escapeHtml(String(set.weight))} lb × ${this.escapeHtml(String(set.reps))}${equipment}</span><span class="warmup-summary-actions"><button type="button" class="warmup-edit-btn" data-exid="${ex.id}" data-warmupidx="${idx}" aria-label="Edit ${label.toLowerCase()}">Edit</button><button type="button" class="warmup-complete-btn warmup-undo-btn" data-exid="${ex.id}" data-warmupidx="${idx}" aria-label="Undo ${label.toLowerCase()}" aria-pressed="true">Undo</button></span></div></section>`;
      const increment = Number(this.getExerciseIncrement(ex, set.exerciseName || name)) || 5;
      return `<section class="warmup-row set-block ${active ? 'active-next-set' : ''}" data-exid="${ex.id}" data-warmupidx="${idx}" aria-label="${label}"><div class="set-heading warmup-heading" tabindex="-1"><strong>${label}${active ? ' · Up next' : ''}</strong><span>${set.completed ? 'Completed' : remaining === 1 ? `Rest ${this.formatRest(this.getRestSeconds(ex))} before working sets` : 'Rest 90 sec'}</span></div>${equipment}<div class="set-entry-grid">${[['weight', 'Weight (lb)', increment, 'decimal'], ['reps', 'Reps', 1, 'numeric']].map(([field, fieldLabel, step, mode]) => `<label>${fieldLabel}<span class="stepper-wrap"><button type="button" class="warmup-stepper-btn" data-exid="${ex.id}" data-warmupidx="${idx}" data-field="${field}" data-delta="-${step}" aria-label="Decrease ${label.toLowerCase()} ${field}">−</button><input type="number" class="warmup-input" data-exid="${ex.id}" data-warmupidx="${idx}" data-field="${field}" value="${this.escapeHtml(String(set[field] ?? ''))}" min="${field === 'weight' ? 0 : 1}" step="${step}" inputmode="${mode}" aria-label="${label} ${field === 'weight' ? 'weight in pounds' : 'reps'}"><button type="button" class="warmup-stepper-btn" data-exid="${ex.id}" data-warmupidx="${idx}" data-field="${field}" data-delta="${step}" aria-label="Increase ${label.toLowerCase()} ${field}">+</button></span></label>`).join('')}</div><button type="button" class="warmup-complete-btn primary-btn" data-exid="${ex.id}" data-warmupidx="${idx}" aria-pressed="${set.completed}">${set.completed ? 'Completed · Undo' : 'Complete warm-up'}</button>${set.completed ? `<button type="button" class="warmup-done-editing-btn secondary-btn" data-exid="${ex.id}" data-warmupidx="${idx}">Done editing</button>` : `<button type="button" class="warmup-remove-btn" data-exid="${ex.id}" data-warmupidx="${idx}" aria-label="Remove ${label.toLowerCase()}">Remove warm-up</button>`}</section>`;
    }).join('')}</section>`;
  }

  bindWarmupEvents() {
    this.exerciseListEl.querySelectorAll('.warmup-btn').forEach(button => button.addEventListener('click', () => this.addWarmupSets(button.dataset.exid)));
    this.exerciseListEl.querySelectorAll('.warmup-input').forEach(input => input.addEventListener('input', () => this.updateWarmupSet(input.dataset.exid, Number(input.dataset.warmupidx), input.dataset.field, input.value)));
    this.exerciseListEl.querySelectorAll('.warmup-stepper-btn').forEach(button => button.addEventListener('click', () => {
      const {exid, warmupidx, field, delta} = button.dataset;
      const set = this.getWarmupSets(exid)[Number(warmupidx)];
      if (!set) return;
      this.updateWarmupSet(exid, Number(warmupidx), field, Math.max(field === 'weight' ? 0 : 1, (Number(set[field]) || 0) + Number(delta)));
    }));
    this.exerciseListEl.querySelectorAll('.warmup-complete-btn').forEach(button => button.addEventListener('click', () => this.toggleWarmupCompletion(button.dataset.exid, Number(button.dataset.warmupidx))));
    this.exerciseListEl.querySelectorAll('.warmup-remove-btn').forEach(button => button.addEventListener('click', () => this.removeWarmupSet(button.dataset.exid, Number(button.dataset.warmupidx))));
    this.exerciseListEl.querySelectorAll('.warmup-edit-btn').forEach(button => button.addEventListener('click', () => {
      this.editingCompletedWarmup = {exId: button.dataset.exid, setIdx: Number(button.dataset.warmupidx)};
      this.focusedExerciseId = button.dataset.exid;
      this.renderWorkout();
      this.revealWorkoutSet(button.dataset.exid, Number(button.dataset.warmupidx), true, false, 'warmup');
    }));
    this.exerciseListEl.querySelectorAll('.warmup-done-editing-btn').forEach(button => button.addEventListener('click', () => {
      const set = this.getWarmupSets(button.dataset.exid)[Number(button.dataset.warmupidx)];
      if (!set) return;
      const error = this.getSetValidationError(set);
      if (error) { this.showToast(error); return; }
      this.editingCompletedWarmup = null;
      this.renderWorkout();
      this.revealWorkoutSet(button.dataset.exid, Number(button.dataset.warmupidx), true, false, 'warmup');
    }));
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
    const title = document.getElementById('summaryModalTitle');
    if (title) title.textContent = 'Review workout';
    this.summaryContentEl.innerHTML = `<p>${this.escapeHtml(this.session.dayTitle)}</p><p><strong>${completed} sets completed · ${remaining} remaining</strong></p><p>Your workout stays open until you confirm.</p><button class="primary-btn" id="keepTrainingBtn">Keep training</button><button class="secondary-btn" id="confirmFinishBtn">${remaining ? 'Finish early' : 'Finish workout'}</button>`;
    this.summaryModalEl.classList.add('open');
    document.getElementById('keepTrainingBtn')?.addEventListener('click', () => {
      this.selectionLocalDate = this.getLocalDateKey(new Date());
      this.summaryModalEl.classList.remove('open');
    });
    document.getElementById('confirmFinishBtn')?.addEventListener('click', () => this.finishSession(sessionId));
  }

  finishSession(expectedId = this.session?.id) {
    if (!this.session || expectedId !== this.session.id || this.history.some(w => w.sessionId === expectedId)) return false;
    const invalid = [...Object.values(this.session.logs || {}), ...Object.values(this.session.warmups || {})].flat().find(set => set.completed && this.getSetValidationError(set));
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
    const previousWeights = JSON.parse(JSON.stringify(this.lastWeights || {}));

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
    // Keep pending entries recoverable without duplicating the untouched baseline.
    const sessionSnapshot = JSON.parse(JSON.stringify(this.session));
    delete sessionSnapshot.initialLogs;
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
      sessionSnapshot,
      exercises: recordedExercises
    };

    const previousHistory = this.history;
    const previousSession = this.session;
    this.history = [...this.history, workoutRecord];
    const nextSession = this.initNewSession(this.activeDayIndex);
    try {
      this.writeStorageTransaction(new Map([
        [this.storageKeys.history, JSON.stringify(this.history)],
        [this.storageKeys.lastWeights, JSON.stringify(this.lastWeights)],
        [this.getSessionKey(nextSession.dayId), JSON.stringify(nextSession)],
        ['gym_last_active_day_v1', nextSession.dayId]
      ]));
    } catch (_) {
      this.history = previousHistory;
      this.session = previousSession;
      this.lastWeights = previousWeights;
      this.showToast('Could not save the workout. Your workout is still open; try again or download a backup.');
      return false;
    }
    this.stopTimer();
    this.pendingRir = null;
    this.editingCompletedSet = null;
    this.editingCompletedWarmup = null;
    this.focusedExerciseId = null;
    this.collapsedCards = new Set();
    // Reset current session
    this.session = nextSession;

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

    const title = document.getElementById('summaryModalTitle');
    if (title) title.textContent = 'Workout saved';
    this.summaryModalEl.classList.add('open');

    document.getElementById('reopenSummaryBtn')?.addEventListener('click', () => this.reopenWorkout(workoutRecord.id));
    document.getElementById('finishSummaryBtn')?.addEventListener('click', () => {
      this.summaryModalEl.classList.remove('open');
      document.querySelector('[data-view="analytics"]').click();
    });

    this.selectDefaultWorkout();
    return true;
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
    const snapshot = JSON.parse(JSON.stringify(record.sessionSnapshot));
    this.routine[dayIndex].exercises.forEach(exercise =>
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
      this.writeStorageTransaction(writes);
    } catch (_) { this.showToast('Could not reopen this workout. The saved workout is still in history.'); return false; }
    this.stopTimer();
    this.activeDayIndex = dayIndex;
    this.selectionLocalDate = this.getLocalDateKey(new Date());
    this.session = this.normalizeSessionFlow(snapshot);
    this.history = history;
    this.lastWeights = weights;
    this.pendingRir = null;
    this.editingCompletedSet = null;
    this.editingCompletedWarmup = null;
    this.focusedExerciseId = null;
    this.collapsedCards = new Set();
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
  renderHistoryCard(workout) {
    const title = this.escapeHtml(workout.dayTitle || 'Workout');
    const date = new Date(workout.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const id = this.escapeHtml(workout.id);
    const duration = workout.durationLabel || (Number.isFinite(workout.durationMins) ? `${workout.durationMins} min` : 'Duration unavailable');
    return `<article class="history-item insight-history">
      <div class="insight-history-heading"><h3>${title}</h3><time datetime="${this.escapeHtml(workout.date)}">${date}</time></div>
      <p class="insight-meta">${workout.totalCompletedSets || 0} sets · ${this.escapeHtml(duration)}${workout.deload ? ' · Deload' : ''}</p>
      <details class="insight-details"><summary>Exercise sets</summary>
        ${Object.entries(workout.exercises || {}).map(([name, entry]) => `<div class="insight-set-list"><h4>${this.escapeHtml(name)}</h4><ul>${(entry.sets || []).filter(Boolean).map(set => `<li>Set ${set.setNum}: ${set.weight === 0 ? 'Bodyweight' : `${set.weight} lb`} × ${set.reps}${typeof set.rir === 'number' ? ` · ${set.rir} RIR` : ''}</li>`).join('')}</ul></div>`).join('')}
        <p class="insight-meta">Recorded volume: ${(workout.totalVolume || 0).toLocaleString()} lb</p>
      </details>
      <div class="insight-actions">${workout.sessionSnapshot ? `<button type="button" class="secondary-btn history-reopen-btn" data-wid="${id}" aria-label="Reopen ${title}, ${date}">Reopen workout</button>` : ''}<button type="button" class="history-delete-btn" data-wid="${id}" aria-label="Delete ${title}, ${date}">Delete</button></div>
    </article>`;
  }

  getLiftComparisonHTML(exHistory) {
    if (!exHistory.length) return '<p class="insight-empty">No saved sets for this lift yet. Finish a workout to start comparing sessions.</p>';
    const best = session => session.sets.filter(s => s && s.completed !== false).slice().sort((a, b) => (b.weight || 0) - (a.weight || 0) || (b.reps || 0) - (a.reps || 0))[0];
    const latest = exHistory[exHistory.length - 1];
    const previous = exHistory.length > 1 ? exHistory[exHistory.length - 2] : null;
    const formatDate = date => new Date(date).toLocaleDateString('en-US', {month:'short', day:'numeric'});
    const format = set => set ? `${set.weight === 0 ? 'Bodyweight' : `${set.weight} lb`} × ${set.reps}` : 'No completed sets';
    const lastBest = best(latest);
    const priorBest = previous ? best(previous) : null;
    const signed = value => value > 0 ? `+${value}` : String(value);
    const delta = priorBest && lastBest ? `${signed(Math.round(((lastBest.weight || 0) - (priorBest.weight || 0)) * 100) / 100)} lb and ${signed((lastBest.reps || 0) - (priorBest.reps || 0))} reps at the heaviest set` : '';
    return `<div class="lift-comparison"><div><span class="insight-meta">Latest · ${formatDate(latest.date)}</span><strong>${format(lastBest)}</strong><span class="insight-meta">${latest.sets.filter(Boolean).length} sets recorded</span></div><div><span class="insight-meta">${previous ? `Previous · ${formatDate(previous.date)}` : 'Previous session'}</span><strong>${previous ? format(priorBest) : 'First session'}</strong><span class="insight-meta">${previous ? `${previous.sets.filter(Boolean).length} sets recorded` : 'Your starting point'}</span></div></div>${delta ? `<p class="lift-comparison-note">${delta}. Compare reps and load together.</p>` : ''}`;
  }

  renderAnalytics() {
    const sortedHistory = [...this.history].sort((a, b) => new Date(b.date) - new Date(a.date));
    const names = [...new Set([...this.getAllUniqueExercises().map(ex => ex.name), ...sortedHistory.flatMap(h => Object.keys(h.exercises || {}))])];
    if (!this.selectedProgressExercise || !names.includes(this.selectedProgressExercise)) this.selectedProgressExercise = Object.keys(sortedHistory[0]?.exercises || {})[0] || names[0] || null;
    const exHistory = this.selectedProgressExercise ? this.getExerciseHistoryOverTime(this.selectedProgressExercise) : [];
    const pr = this.selectedProgressExercise ? this.getPersonalRecord(this.selectedProgressExercise) : {maxWeight:0, max1RM:0};
    const recent = sortedHistory.slice(0, 7).reverse();
    const maxVolume = Math.max(1, ...recent.map(w => w.totalVolume || 0));
    this.analyticsContentEl.innerHTML = `<div class="insights-page">
      <section aria-labelledby="recentWorkoutsHeading"><div class="insight-section-heading"><h2 id="recentWorkoutsHeading">Recent workouts</h2><span class="insight-meta">${this.history.length} saved</span></div>
        ${sortedHistory.length ? this.renderHistoryCard(sortedHistory[0]) : '<p class="insight-empty">No saved workouts yet. Your completed workouts will appear here.</p>'}
      </section>
      <section class="insight-panel" aria-labelledby="liftProgressHeading"><h2 id="liftProgressHeading">Lift progress</h2>
        <label class="insight-field-label" for="progressExerciseSelect">Compare a lift</label><select class="exercise-select" id="progressExerciseSelect">${names.map(name => `<option value="${this.escapeHtml(name)}" ${name === this.selectedProgressExercise ? 'selected' : ''}>${this.escapeHtml(name)}</option>`).join('')}</select>
        ${this.getLiftComparisonHTML(exHistory)}
        <details class="insight-details"><summary>Lift trend & recorded sets</summary><p class="insight-meta">Best recorded weight: ${pr.maxWeight || 0} lb · Estimated 1-rep max: ${pr.max1RM || 0} lb</p>${this.generateSVGProgressionChart(exHistory, this.selectedProgressExercise)}
          <div class="progress-session-list">${[...exHistory].reverse().map(session => `<article class="insight-set-list"><h3>${new Date(session.date).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'})} · ${this.escapeHtml(session.dayTitle || 'Saved session')}</h3><ul>${session.sets.filter(Boolean).map(set => `<li>Set ${set.setNum}: ${set.weight === 0 ? 'Bodyweight' : `${set.weight} lb`} × ${set.reps}</li>`).join('')}</ul></article>`).join('')}</div>
        </details>
      </section>
      ${sortedHistory.length > 1 ? `<details class="insight-panel insight-details"><summary>Earlier workouts (${sortedHistory.length - 1})</summary>${sortedHistory.slice(1).map(workout => this.renderHistoryCard(workout)).join('')}</details>` : ''}
      <details class="insight-panel insight-details"><summary>Weekly muscle volume</summary>${this.generateWeeklyVolumeLandmarksHTML()}</details>
      <details class="insight-panel insight-details"><summary>Workout totals & volume trend</summary><p>${this.history.length} saved workouts · ${this.history.reduce((sum, h) => sum + (h.totalVolume || 0), 0).toLocaleString()} lb recorded total volume</p>
        <p class="insight-meta">Volume varies with exercise selection and set count. Compare the same lift for a clearer view of progress.</p>
        ${recent.length ? `<div class="volume-chart-container"><h3>Last ${recent.length} workouts</h3><div class="chart-bars">${recent.map(workout => `<div class="chart-bar-wrap"><div class="chart-bar" style="height:${Math.max(2, Math.round((workout.totalVolume || 0) / maxVolume * 100))}%"><span class="chart-bar-val">${Math.round(workout.totalVolume || 0).toLocaleString()}</span></div><span class="chart-bar-label">${new Date(workout.date).toLocaleDateString('en-US', {month:'numeric',day:'numeric'})}</span></div>`).join('')}</div></div>` : '<p class="insight-empty">Finish a workout to see volume history.</p>'}
      </details>
    </div>`;
    document.getElementById('progressExerciseSelect')?.addEventListener('change', event => {
      this.selectedProgressExercise = event.target.value;
      this.renderAnalytics();
      document.getElementById('progressExerciseSelect')?.focus({ preventScroll: true });
    });
    this.analyticsContentEl.querySelectorAll('.history-delete-btn').forEach(button => button.addEventListener('click', () => this.deleteWorkoutFromHistory(button.dataset.wid)));
    this.analyticsContentEl.querySelectorAll('.history-reopen-btn').forEach(button => button.addEventListener('click', () => this.reopenWorkout(button.dataset.wid)));
    this.analyticsContentEl.querySelectorAll('.chart-data-dot').forEach(dot => {
      const description = `${dot.dataset.date}, ${dot.dataset.day}: ${dot.dataset.isbw === 'true' ? 'Bodyweight' : `${dot.dataset.weight} lb`} × ${dot.dataset.reps}; estimated maximum ${dot.dataset.e1rm}`;
      dot.setAttribute('aria-label', description);
      const showTip = () => { const tip = document.getElementById('chartTooltipBox'); if (tip) tip.textContent = description; };
      dot.addEventListener('click', showTip);
      dot.addEventListener('mouseenter', showTip);
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
    this.lastWeights = this.buildLastWeightsFromHistory();
    this.saveLastWeights();
  }

  buildLastWeightsFromHistory(history = this.history) {
    const weights = {};
    [...(history || [])].sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(workout => {
      if (workout.deload || workout.isDeload || workout.deloadActive) return;
      Object.entries(workout.exercises || {}).forEach(([name, entry]) => {
        const sets = (entry.sets || []).filter(set => set && set.completed !== false);
        if (sets.length) weights[name] = { date: workout.date, deload: false, sets: sets.map(set => ({...set})) };
      });
    });
    return weights;
  }

  // Routine & Customizer View
  renderRoutineEditor() {
    const exercises = this.routine.flatMap(day => day.exercises).filter(ex => !ex.isOptional);
    const normalSets = exercises.reduce((sum, ex) => sum + ex.sets, 0);
    const deloadSets = exercises.reduce((sum, ex) => sum + Math.max(2, Math.floor(ex.sets * .67)), 0);
    this.routineEditorEl.innerHTML = `<div class="insights-page">
      <section class="program-overview" aria-labelledby="programOverviewHeading"><div class="insight-section-heading"><h2 id="programOverviewHeading">Your program</h2><a class="insight-jump" href="#settingsBackupHeading">Settings & backup</a></div><p class="insight-meta">${this.routine.length} training days · ${normalSets} planned sets per week</p>
        ${this.routine.map(day => `<details class="program-day insight-details"><summary><span>${this.escapeHtml(day.title)}</span><small>${day.exercises.length} lifts · ${day.exercises.reduce((sum, ex) => sum + ex.sets, 0)} sets</small></summary><ul>${day.exercises.map(ex => `<li><span>${this.escapeHtml(ex.name)}</span><strong>${ex.sets} × ${this.escapeHtml(ex.targetReps)}</strong></li>`).join('')}</ul></details>`).join('')}
      </section>
      <section aria-labelledby="settingsBackupHeading"><h2 id="settingsBackupHeading">Settings & backup</h2>
        <div class="insight-panel"><div class="insight-section-heading"><h3>Backup</h3><span class="insight-meta">${this.escapeHtml(this.getBackupStatusText())}</span></div><p>Save a copy of your history, active workouts, program and preferences before changing phones.</p><div class="insight-actions"><button type="button" class="secondary-btn" id="exportDataBtn">Download backup</button><button type="button" class="secondary-btn" id="importBackupBtn">Restore backup</button></div></div>
        <div class="insight-panel"><div class="insight-section-heading"><h3>App updates</h3><span class="insight-meta">Build v32</span></div><p>Update the app while keeping your saved workouts and settings.</p><button type="button" class="secondary-btn" id="forceUpdateBtn">Check for update</button></div>
        <div class="setting-row insight-panel"><div><label id="deloadSettingLabel" for="deloadSettingToggle">7-day deload</label><p id="deloadSettingDescription">${normalSets} → ${deloadSets} planned sets (${normalSets ? Math.round((normalSets-deloadSets)/normalSets*100) : 0}% fewer) and 10% lighter loads. Ends automatically after 7 days.${this.deloadActive ? ` ${this.getDeloadDaysLeft()} days remaining.` : ''}</p></div><label class="switch"><input type="checkbox" id="deloadSettingToggle" aria-labelledby="deloadSettingLabel" aria-describedby="deloadSettingDescription" ${this.deloadActive ? 'checked' : ''}><span class="slider"></span></label></div>
        <div class="setting-row insight-panel"><div><label id="wakeLockSettingLabel" for="wakeLockSettingToggle">Keep screen awake</label><p id="wakeLockSettingDescription">Keep the display on while logging a workout, when supported by your browser.</p></div><label class="switch"><input type="checkbox" id="wakeLockSettingToggle" aria-labelledby="wakeLockSettingLabel" aria-describedby="wakeLockSettingDescription" ${this.wakeLockEnabled ? 'checked' : ''}><span class="slider"></span></label></div>
        <details class="insight-panel insight-details"><summary>Rest sound & vibration</summary><p>Test alerts with the page open. Background and locked-screen alerts may not fire on iPhone; reopening restores the countdown.</p><button type="button" class="secondary-btn" id="testChimeBtn">Test sound & vibration</button></details>
        <details class="insight-panel insight-details"><summary>Reset program</summary><p>Restore the original exercises, sets and rep ranges. The selected day’s unfinished workout is reset; saved history is retained.</p><button type="button" class="secondary-btn insight-danger" id="resetRoutineBtn">Reset to original program</button></details>
      </section>
    </div>`;

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
    const savedDrafts = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith('gym_saved_draft_') || key.startsWith('gym_saved_draft_for_')) continue;
      try { const draft = JSON.parse(localStorage.getItem(key)); if (draft?.id && draft.logs) savedDrafts.push(draft); } catch (_) {}
    }
    return {
      version: '3.3', routine: this.routine, history: this.history,
      machineSettings: this.machineSettings, exerciseNotes: this.exerciseNotes,
      lastWeights: this.lastWeights, exercisePreferences: this.exercisePreferences || {},
      wakeLockEnabled: this.wakeLockEnabled, routineRev: localStorage.getItem(this.storageKeys.routineRev) || '15',
      sessions: this.getStoredSessions(), deloadActive: this.deloadActive, deloadStartDate: this.deloadStartDate,
      savedDrafts, lastActiveDay: localStorage.getItem('gym_last_active_day_v1'),
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
    const flowValid = session =>
      (session.lastInteractionAt === undefined || session.lastInteractionAt === null || (typeof session.lastInteractionAt === 'string' && Number.isFinite(Date.parse(session.lastInteractionAt)))) &&
      (session.exerciseOrder === undefined || (Array.isArray(session.exerciseOrder) && session.exerciseOrder.every(id => typeof id === 'string') && new Set(session.exerciseOrder).size === session.exerciseOrder.length)) &&
      (session.warmups === undefined || (object(session.warmups) && Object.values(session.warmups).every(sets => draftSetsValid(sets) && sets.every(set =>
        (set.completed === undefined || typeof set.completed === 'boolean') &&
        (set.setNum === undefined || (Number.isInteger(set.setNum) && set.setNum > 0)) &&
        (set.exerciseName === undefined || typeof set.exerciseName === 'string')))));
    const sessionValid = session => object(session) && typeof session.dayId === 'string' && object(session.logs) && Object.values(session.logs).every(draftSetsValid) && flowValid(session);
    if (!object(data) || !['routine', 'history', 'sessions'].some(key => key in data)) throw new Error('This is not a workout backup');
    if (data.routine !== undefined && (!Array.isArray(data.routine) || !data.routine.length || !data.routine.every(d => object(d) && typeof d.id === 'string' && Array.isArray(d.exercises) && d.exercises.every(ex => object(ex) && typeof ex.id === 'string' && typeof ex.name === 'string' && Number.isInteger(ex.sets) && ex.sets > 0 && typeof ex.targetReps === 'string')))) throw new Error('Invalid routine in backup');
    if (data.history !== undefined && (!Array.isArray(data.history) || !data.history.every(h => object(h) && typeof h.id === 'string' && Number.isFinite(new Date(h.date).getTime()) && object(h.exercises) && Object.values(h.exercises).every(ex => object(ex) && setsValid(ex.sets))))) throw new Error('Invalid workout history in backup');
    if (data.sessions !== undefined && (!Array.isArray(data.sessions) || !data.sessions.every(sessionValid))) throw new Error('Invalid sessions in backup');
    if (data.savedDrafts !== undefined && (!Array.isArray(data.savedDrafts) || !data.savedDrafts.every(draft => sessionValid(draft) && typeof draft.id === 'string'))) throw new Error('Invalid saved drafts in backup');
    if (data.history?.some(record => record.sessionSnapshot && !sessionValid(record.sessionSnapshot))) throw new Error('Invalid recoverable workout in backup');
    if (data.lastActiveDay != null && typeof data.lastActiveDay !== 'string') throw new Error('Invalid last active day');
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
      [...(data.savedDrafts || [])].sort((a, b) => Date.parse(a.updatedAt || a.createdAt) - Date.parse(b.updatedAt || b.createdAt)).forEach(draft => {
        writes.set(`gym_saved_draft_${draft.id}`, JSON.stringify(draft));
        writes.set(`gym_saved_draft_for_${draft.dayId}`, draft.id);
      });
      if (data.lastActiveDay) writes.set('gym_last_active_day_v1', data.lastActiveDay);
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
      this.activeDayIndex = this.getResumeDayIndex();
      this.session = this.loadSession();
      this.selectionLocalDate = this.getLocalDateKey(new Date());
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
