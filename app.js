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
      routineRev: 'gym_routine_rev'
    };

    // Load History, Notes, & Last Recorded Weights
    this.history = this.loadHistory();
    this.lastWeights = this.loadLastWeights();
    this.machineSettings = this.loadMachineSettings();
    this.exerciseNotes = this.loadExerciseNotes();
    this.deloadActive = localStorage.getItem(this.storageKeys.deloadActive) === 'true';
    this.deloadStartDate = parseInt(localStorage.getItem(this.storageKeys.deloadStartDate) || '0', 10);
    this.checkDeloadExpiry();
    this.initStoragePersistence();

    // Load Routine
    this.routine = this.loadRoutine();

    // Active Day: determine suggested day based on current weekday
    this.activeDayIndex = this.getSuggestedDayIndex();

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
    this.requestWakeLock();
  }

  loadRoutine() {
    const CURRENT_ROUTINE_REV = 14;
    const savedRev = localStorage.getItem(this.storageKeys.routineRev);
    const saved = localStorage.getItem(this.storageKeys.routine);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Correct any legacy muscle tags for calves & ensure all exercises are core
        parsed.forEach(day => {
          day.exercises.forEach(ex => {
            if (ex.name.toLowerCase().includes('calf') && ex.muscle === 'Quads') {
              ex.muscle = 'Calves';
            }
            if (ex.name.toLowerCase().includes('incline') && ex.name.toLowerCase().includes('press')) {
              ex.targetReps = '6–8';
            }
            ex.isOptional = false;
            if (typeof ex.increment !== 'number') {
              ex.increment = this.getExerciseIncrement(ex, ex.name);
            }
          });
        });

        // Migrate routine to Revision 14 (Double progression increments, no optional finishers, 6-8 incline press)
        const needsUpdate = 
          savedRev !== String(CURRENT_ROUTINE_REV) ||
          parsed.length < 5 ||
          !parsed.some(d => d.id === 'sun___db_arms') ||
          parsed.some(d => d.exercises.some(e => e.id === 'fri___lower_a_ex_lunges' || e.id === 'mon__lower_b_ex4')) ||
          parsed.find(d => d.id === 'sat___upper_b')?.exercises.some(e => e.id === 'sat___upper_b_ex5') ||
          parsed.find(d => d.id === 'sun___db_arms')?.exercises.some(e => e.id === 'sun___db_arms_ex1') ||
          !parsed.find(d => d.id === 'sun___db_arms')?.exercises.some(e => e.id === 'sun___db_arms_ex_forearms');

        if (needsUpdate) {
          // Backup previous routine in localStorage just in case
          localStorage.setItem('gym_routine_backup_v12', JSON.stringify(parsed));
          const updatedRoutine = JSON.parse(JSON.stringify(DEFAULT_ROUTINE));
          // Preserve any custom starting weights or notes from parsed if matched
          parsed.forEach(oldDay => {
            const newDay = updatedRoutine.find(d => d.id === oldDay.id);
            if (newDay && oldDay.exercises) {
              oldDay.exercises.forEach(oldEx => {
                const newEx = newDay.exercises.find(e => e.id === oldEx.id || e.name === oldEx.name);
                if (newEx) {
                  if (oldEx.notes && !oldEx.notes.includes('pad.;')) newEx.notes = oldEx.notes;
                  if (oldEx.startingWeight) newEx.startingWeight = oldEx.startingWeight;
                }
              });
            }
          });
          localStorage.setItem(this.storageKeys.routineRev, String(CURRENT_ROUTINE_REV));
          localStorage.setItem(this.storageKeys.routine, JSON.stringify(updatedRoutine));
          return updatedRoutine;
        }

        return parsed;
      } catch (e) { console.error(e); }
    }
    localStorage.setItem(this.storageKeys.routineRev, String(CURRENT_ROUTINE_REV));
    return JSON.parse(JSON.stringify(DEFAULT_ROUTINE));
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
    const effectiveTargetReps = (this.session && this.session.swaps && this.session.swaps[ex.id]?.targetReps) || ex.targetReps;
    const minTarget = this.getMinTargetReps(effectiveTargetReps);
    const maxTarget = this.getMaxTargetReps(effectiveTargetReps);
    const increment = this.getExerciseIncrement(ex, activeSubName);
    const prev = this.getPreviousExercisePerformance(activeSubName);

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
    this.saveCurrentSession();
    this.renderWorkout();
  }

  getSessionKey(dayId) {
    return `${this.storageKeys.currentSessionPrefix}${dayId}`;
  }

  loadSession(dayIndex = this.activeDayIndex) {
    const day = this.routine[dayIndex] || this.routine[0];
    const key = this.getSessionKey(day.id);
    const legacy = localStorage.getItem(this.storageKeys.legacyCurrentSession);
    let saved = localStorage.getItem(key);
    if (!saved && legacy) {
      try {
        const parsedLegacy = JSON.parse(legacy);
        if (parsedLegacy && parsedLegacy.dayId === day.id) saved = legacy;
      } catch (e) {}
    }

    if (saved) {
      try {
        const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
        if (parsed.dayId === day.id) {
          if (!parsed.swaps) parsed.swaps = {};
          Object.values(parsed.swaps).forEach(sub => {
            if (sub && sub.name && sub.name.toLowerCase().includes('incline') && sub.name.toLowerCase().includes('press')) {
              sub.targetReps = '6–8';
            }
          });
          
          if (day && day.exercises) {
            day.exercises.forEach(ex => {
              const existingSets = parsed.logs && parsed.logs[ex.id];
              const exHasCompleted = Array.isArray(existingSets) && existingSets.some(s => s && s.completed);
              if (!exHasCompleted) {
                // Refresh uncompleted exercise targets from getSetTarget()
                const activeSub = parsed.swaps && parsed.swaps[ex.id];
                const effectiveName = activeSub ? activeSub.name : ex.name;
                const targetSetsCount = this.deloadActive ? Math.max(2, Math.floor(ex.sets * 0.67)) : ex.sets;
                parsed.logs[ex.id] = [];
                for (let i = 1; i <= targetSetsCount; i++) {
                  const target = this.getSetTarget(ex, i - 1, effectiveName);
                  parsed.logs[ex.id].push({
                    setNum: i,
                    weight: target.targetWeight,
                    reps: target.targetReps,
                    completed: false,
                    rir: null
                  });
                }
              }
            });
          }
          return parsed;
        }
      } catch (e) { console.error(e); }
    }
    return this.initNewSession(dayIndex);
  }

  saveCurrentSession() {
    if (!this.session || !this.session.dayId) return;
    const key = this.getSessionKey(this.session.dayId);
    localStorage.setItem(key, JSON.stringify(this.session));
  }

  initNewSession(dayIndex) {
    const day = this.routine[dayIndex] || this.routine[0];
    const session = {
      dayId: day.id,
      dayTitle: day.title,
      startTime: null,
      logs: {},
      swaps: {}
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
          rir: null
        });
      }
    });

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
    if (!restStr) return 120;
    const lower = restStr.toLowerCase();
    if (lower.includes('3 min') || lower.includes('3m') || lower.includes('3.0')) return 180;
    if (lower.includes('2.5–3') || lower.includes('2.5-3')) return 165;
    if (lower.includes('2.5')) return 150;
    if (lower.includes('2 min') || lower.includes('2m')) return 120;
    if (lower.includes('90 sec') || lower.includes('90s')) return 90;
    if (lower.includes('45–60') || lower.includes('45-60') || lower.includes('60 sec') || lower.includes('60s')) return 60;
    if (lower.includes('45 sec') || lower.includes('45s')) return 45;
    return 120; // Default to 2 minutes
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
    if (this.session && !this.session.startTime) {
      this.session.startTime = new Date().toISOString();
    }
    const val = Math.max(0, parseFloat(newWeight) || 0);
    list[setIdx].weight = val;

    // Set 1 weight propagation: auto-update subsequent uncompleted sets!
    if (setIdx === 0 && list.length > 1) {
      for (let i = 1; i < list.length; i++) {
        if (!list[i].completed) {
          list[i].weight = val;
        }
      }
    }

    this.saveCurrentSession();
    this.renderWorkout();
  }

  updateSetReps(exId, setIdx, newReps) {
    const list = this.session && this.session.logs && this.session.logs[exId];
    if (!list || !list[setIdx]) return;
    if (this.session && !this.session.startTime) {
      this.session.startTime = new Date().toISOString();
    }
    const val = Math.max(0, parseInt(newReps, 10) || 0);
    list[setIdx].reps = val;

    this.saveCurrentSession();
    this.renderWorkout();
  }

  getPreviousExercisePerformance(exerciseName) {
    // 1. Check completed history (most recent first)
    let historyEntry = null;
    if (this.history && Array.isArray(this.history)) {
      for (let i = this.history.length - 1; i >= 0; i--) {
        const workout = this.history[i];
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
    if (!historyEntry && this.lastWeights && this.lastWeights[exerciseName] && Array.isArray(this.lastWeights[exerciseName].sets)) {
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
    document.getElementById('timerSkipBtn')?.addEventListener('click', () => this.stopTimer());
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
    const todayIndex = this.getSuggestedDayIndex();
    this.daySelectorEl.innerHTML = this.routine.map((day, idx) => {
      const isActive = idx === this.activeDayIndex;
      const isToday = idx === todayIndex;
      
      let dayAbbr = 'DAY';
      let routineName = day.title;
      if (day.title.includes('Wed')) { dayAbbr = 'WED'; routineName = 'Upper A'; }
      else if (day.title.includes('Fri')) { dayAbbr = 'FRI'; routineName = 'Lower A'; }
      else if (day.title.includes('Sat')) { dayAbbr = 'SAT'; routineName = 'Upper B'; }
      else if (day.title.includes('Sun')) { dayAbbr = 'SUN'; routineName = 'DB Arms'; }
      else if (day.title.includes('Mon')) { dayAbbr = 'MON'; routineName = 'Lower B'; }

      const coreCount = day.exercises.filter(e => !e.isOptional).length;

      return `
        <button class="day-btn ${isActive ? 'active' : ''}" data-index="${idx}">
          <div class="day-btn-header">
            <span class="day-btn-day">${dayAbbr}</span>
            ${isToday ? '<span class="today-dot">● Today</span>' : `<span style="font-size: 0.65rem; color: var(--text-muted);">${coreCount} lifts</span>`}
          </div>
          <div class="day-btn-title">${routineName}</div>
        </button>
      `;
    }).join('');

    this.daySelectorEl.querySelectorAll('.day-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        this.activeDayIndex = idx;
        this.session = this.loadSession();
        this.renderDaySelector();
        this.renderWorkout();
      });
    });
  }

  renderWorkout() {
    const currentDay = this.routine[this.activeDayIndex];
    if (!currentDay) return;

    // Separate Core Lifts and Exclusively Optional Finishers
    const coreExercises = currentDay.exercises.filter(ex => !ex.isOptional);
    const optionalExercises = currentDay.exercises.filter(ex => ex.isOptional);

    const hasSuperset = coreExercises.some(ex => ex.superset);
    const totalCoreSets = coreExercises.reduce((sum, ex) => sum + ((this.session.logs[ex.id] && this.session.logs[ex.id].length) || ex.sets), 0);
    const completedCoreSets = coreExercises.reduce((sum, ex) => {
      const logs = this.session.logs[ex.id] || [];
      return sum + logs.filter(s => s.completed).length;
    }, 0);
    const progressPct = totalCoreSets > 0 ? Math.round((completedCoreSets / totalCoreSets) * 100) : 0;
    const estimatedMins = currentDay.id === 'sun___db_arms' ? 30 : (hasSuperset ? (coreExercises.length * 8) - 8 : (coreExercises.length * 8));

    // Clean Day Title for header
    let cleanDayTitle = currentDay.title;
    if (cleanDayTitle.includes('Mon-')) cleanDayTitle = 'Mon - Lower B';

    const deloadBannerHTML = this.deloadActive ? `
      <div class="deload-banner">
        <div class="deload-banner-icon">🌿</div>
        <div class="deload-banner-text">
          <div class="deload-banner-title">Deload Week Active (${this.getDeloadDaysLeft()} day${this.getDeloadDaysLeft() === 1 ? '' : 's'} remaining)</div>
          <div>Volume automatically reduced by ~50% & loads eased by ~10% for systemic joint & CNS recovery.</div>
        </div>
      </div>
    ` : '';

    this.sessionInfoEl.innerHTML = `
      ${deloadBannerHTML}
      <h2>${this.escapeHtml(cleanDayTitle)}</h2>
      <div class="session-meta">
        <span>🏋️ ${coreExercises.length} Core Lifts</span>
        <span>•</span>
        <span>⚡ ${totalCoreSets} Sets</span>
        <span>•</span>
        <span>⏱️ ~${estimatedMins}m ${hasSuperset ? '<strong style="color: var(--accent-purple);">(⚡ Superset)</strong>' : ''}</span>
      </div>
      <div class="workout-progress-bar-wrap">
        <div class="workout-progress-info">
          <span>⚡ <strong>${completedCoreSets} of ${totalCoreSets}</strong> sets completed</span>
          <span class="workout-progress-pct">${progressPct}%</span>
        </div>
        <div class="workout-progress-track">
          <div class="workout-progress-fill" style="width: ${progressPct}%;"></div>
        </div>
      </div>
    `;

    // Render Core Cards
    const coreHTML = coreExercises.map(ex => this.renderExerciseCard(ex, false)).join('');

    // Render Dedicated Optional Drawer
    const isOptionalOpen = this.expandedOptionalDays.has(currentDay.id);
    const optionalHTML = optionalExercises.length > 0 ? `
      <div class="optional-section-wrap">
        <div class="optional-section-header" id="optionalToggleHeader">
          <div class="optional-header-left">
            <span class="optional-badge-pill">⚡ 100% EXCLUSIVELY OPTIONAL</span>
            <div class="optional-section-title">${optionalExercises.length} Bonus Finisher${optionalExercises.length > 1 ? 's' : ''}</div>
            <div class="optional-section-subtitle">Only do this if you have 10+ mins left on your 60m timer!</div>
          </div>
          <span class="optional-toggle-pill" id="optionalTogglePill">${isOptionalOpen ? 'Hide Finisher ▴' : 'View Finisher (+5m) ▾'}</span>
        </div>
        <div class="optional-cards-list ${isOptionalOpen ? 'open' : ''}" id="optionalCardsList">
          ${optionalExercises.map(ex => this.renderExerciseCard(ex, true)).join('')}
        </div>
      </div>
    ` : '';

    this.exerciseListEl.innerHTML = coreHTML + optionalHTML;
    this.bindWorkoutCardEvents();
  }

  renderExerciseCard(ex, isBonus) {
    const activeSub = this.session && this.session.swaps && this.session.swaps[ex.id];
    const isSwapped = Boolean(activeSub);
    const effectiveName = activeSub ? activeSub.name : ex.name;
    const sessionSets = this.session.logs[ex.id] || [];
    const prev = this.getPreviousExercisePerformance(effectiveName);
    const pr = this.getPersonalRecord(effectiveName);
    const machineSetting = this.machineSettings[ex.id] || '';
    const isAllDone = sessionSets.length > 0 && sessionSets.every(s => s.completed);
    const isCollapsed = isAllDone && this.collapsedCards.has(ex.id);

    const displayName = isSwapped ? `${activeSub.name} (Alt for ${ex.name})` : ex.name;
    const effectiveTargetReps = isSwapped && activeSub.targetReps ? activeSub.targetReps : ex.targetReps;
    const effectiveNotes = isSwapped && activeSub.notes ? activeSub.notes : ex.notes;
    const effectiveVideo = isSwapped && activeSub.videoUrl ? activeSub.videoUrl : ex.videoUrl;

    const cleanTag = ex.muscle.replace(/[^a-zA-Z]/g, '');
    const effectiveRest = ex.superset ? ex.superset.rest : (ex.rest || '2 min');

    // Progression Flag Checks: only unlock weight increase if top-end reps hit on ALL sets
    const maxTarget = this.getMaxTargetReps(effectiveTargetReps);
    const completedSets = sessionSets.filter(s => s.completed);
    const topCurrentWeight = completedSets.length > 0 ? Math.max(...completedSets.map(s => s.weight || 0)) : 0;
    const setsHittingMax = completedSets.filter(s => (s.reps || 0) >= maxTarget && (topCurrentWeight === 0 || (s.weight || 0) >= topCurrentWeight));
    const targetSetsCount = (this.deloadActive ? Math.max(2, Math.floor(ex.sets * 0.67)) : ex.sets) || sessionSets.length || 3;
    const allCurrentHit = !this.deloadActive && sessionSets.length >= targetSetsCount && completedSets.length === sessionSets.length && completedSets.every(s => s.completed && (s.reps || 0) >= maxTarget && (topCurrentWeight === 0 || (s.weight || 0) >= topCurrentWeight));
    const prevProgression = this.getPreviousProgressionFlag(effectiveName, effectiveTargetReps, targetSetsCount, ex);
    const nextIncompleteIdx = sessionSets.findIndex(s => !s.completed);
    const prevSummaryText = this.formatPreviousSetsSummary(prev ? prev.sets : null);

    return `
      <div class="exercise-card ${isAllDone ? 'completed' : ''} ${isBonus ? 'is-optional' : ''} ${ex.superset ? 'is-superset' : ''}" id="card_${ex.id}" data-exid="${ex.id}">
        
        ${ex.superset && ex.superset.tag.endsWith('A') ? `
          <div class="superset-guide-banner">
            <span style="font-size: 1.1rem;">⚡</span>
            <div>
              <strong>${ex.superset.name}</strong><br>
              <span>${ex.superset.tip}</span>
            </div>
          </div>
        ` : ''}

        <div class="card-header">
          <div class="card-meta-row">
            <div class="card-tags-group">
              <span class="muscle-tag tag-${cleanTag}">${ex.muscle}</span>
              ${ex.superset ? `<span class="superset-badge">⚡ SUPERSET ${ex.superset.tag}</span>` : ''}
              ${isBonus ? '<span class="optional-badge">⚡ Optional Bonus</span>' : ''}
              ${isSwapped ? '<span class="optional-badge alt-tag">🔄 Alt Equipment</span>' : ''}
              ${allCurrentHit ? `<span class="progression-badge full">🚀 All ${sessionSets.length} Sets Hit ${maxTarget} Reps! Increase Weight Next Time</span>` : (setsHittingMax.length > 0 ? `<span class="progression-badge partial">🎯 ${setsHittingMax.length}/${sessionSets.length} sets @ ${maxTarget} reps</span>` : '')}
            </div>
            <div class="card-meta-actions">
              ${effectiveVideo ? `
                <a href="${effectiveVideo}" target="_blank" rel="noopener noreferrer" class="video-link-btn" title="Watch form guide">
                  ▶ Form
                </a>
              ` : ''}
              ${isAllDone ? `
                <button type="button" class="card-collapse-toggle-btn" data-exid="${ex.id}" aria-label="Toggle exercise details">
                  ${isCollapsed ? 'Show Details ▾' : 'Collapse ▴'}
                </button>
              ` : ''}
            </div>
          </div>

          <h3 class="exercise-name">${this.escapeHtml(displayName)}</h3>

          <div class="card-tools-row">
            ${prevSummaryText ? `
              <button type="button" class="prev-weight-pill-btn" data-exname="${this.escapeHtml(effectiveName)}" title="Tap to view performance log">⏱️ Last: ${prevSummaryText} ▾</button>
            ` : '<div class="card-tools-spacer"></div>'}
            <div class="card-actions-pills">
              <button type="button" class="action-pill-btn warmup-btn" data-exid="${ex.id}" data-exname="${this.escapeHtml(displayName)}" title="Calculate neural warmup ramp sets">
                🔥 Warmup
              </button>
              <button type="button" class="action-pill-btn swap-btn" data-exid="${ex.id}" data-exname="${this.escapeHtml(ex.name)}" title="Swap with alternative equipment">
                🔄 Swap
              </button>
            </div>
          </div>
        </div>

        ${isCollapsed ? `
          <div class="completed-summary-row">
            <span class="completed-check-icon">✓</span>
            <div class="completed-summary-text">
              <strong>All ${sessionSets.length} Sets Completed!</strong>
              <span>${sessionSets.map(s => `${s.weight}lbs×${s.reps}`).join(' • ')}</span>
            </div>
          </div>
        ` : ''}

        <div class="card-body-collapsible" style="display: ${isCollapsed ? 'none' : 'block'};">
          <div class="exercise-meta-box">
            <div class="target-targets">
              <div class="target-item"><strong>Target:</strong> ${ex.sets} sets × ${effectiveTargetReps} reps</div>
              <div class="target-item"><strong>Rest:</strong> <span style="${ex.superset ? 'color: #d8b4fe; font-weight: 700;' : ''}">${effectiveRest}</span></div>
              <div class="target-item"><strong>Start Weight:</strong> ${ex.startingWeight || 'Moderate'}</div>
              ${pr.maxWeight > 0 ? `<div class="target-item"><strong>PR:</strong> ${pr.maxWeight} lbs</div>` : ''}
            </div>
            ${effectiveNotes ? `
              <details class="form-notes-collapsible">
                <summary class="form-notes-summary">
                  <span>ℹ️ Setup & Form Guide</span>
                  <span class="chevron">▾</span>
                </summary>
                <div class="form-notes-content">${this.escapeHtml(effectiveNotes)}</div>
              </details>
            ` : ''}
            
            <div class="machine-settings-row">
              <span class="machine-settings-label">⚙️ Pin / Seat:</span>
              <input type="text" class="machine-settings-input" 
                     placeholder="e.g. Seat #4, Pin #8" 
                     value="${this.escapeHtml(machineSetting)}" 
                     data-exid="${ex.id}" />
            </div>

            <div class="exercise-note-wrap">
              <span class="note-icon">📝</span>
              <input type="text" class="exercise-note-input" 
                     placeholder="Note to self (e.g. seat #4, pause at bottom, handle width)..." 
                     value="${this.escapeHtml(this.exerciseNotes[effectiveName] || '')}" 
                     data-exname="${this.escapeHtml(effectiveName)}"
                     data-exid="${ex.id}" />
            </div>
          </div>

          ${prevProgression.unlocked ? (() => {
            const isBumped = sessionSets.length > 0 && sessionSets[0].weight > prevProgression.topWeight;
            return `
            <div class="progression-banner">
              <div class="progression-banner-left">
                <span class="progression-icon">🚀</span>
                <div class="progression-text">
                  <strong>Double Progression Auto-Bump (+${prevProgression.increment} lbs):</strong> Hit ${prevProgression.maxReps} reps across all ${prevProgression.setsCount} sets last workout! ${isBumped ? `Weight auto-bumped +${prevProgression.increment} lbs.` : `Staying at ${prevProgression.topWeight} lbs.`}
                </div>
              </div>
              ${isBumped ? `
                <button class="bump-weight-btn revert" data-exid="${ex.id}" data-bump="-${prevProgression.increment}" title="Revert to previous session weight (${prevProgression.topWeight} lbs)">
                  ↩️ Keep ${prevProgression.topWeight} lbs (-${prevProgression.increment} lbs)
                </button>
              ` : `
                <button class="bump-weight-btn" data-exid="${ex.id}" data-bump="${prevProgression.increment}" title="Apply +${prevProgression.increment} lbs progression bump">
                  +${prevProgression.increment} lbs All Sets
                </button>
              `}
            </div>
            `;
          })() : ''}

          <div class="sets-table-wrap">
            <table class="sets-table">
              <thead>
                <tr>
                  <th>Prev</th>
                  <th>Target</th>
                  <th>Lbs</th>
                  <th>Reps</th>
                  <th>Done</th>
                </tr>
              </thead>
              <tbody>
                ${sessionSets.map((s, sIdx) => {
                  const prevSet = prev && prev.sets && prev.sets[sIdx];
                  let prevText = '—';
                  if (prevSet) {
                    if (prevSet.weight > 0) {
                      prevText = `${prevSet.weight}×${prevSet.reps}`;
                    } else if (prevSet.weight === 0 && prevSet.reps > 0) {
                      prevText = `BW×${prevSet.reps}`;
                    }
                  }
                  const isActiveNext = sIdx === nextIncompleteIdx;
                  const target = this.getSetTarget(ex, sIdx, effectiveName);

                  // Micro-PR badge calculation
                  let microBadge = '';
                  if (s.completed && prevSet && (prevSet.weight > 0 || (prevSet.weight === 0 && prevSet.reps > 0))) {
                    const weightDiff = (s.weight || 0) - (prevSet.weight || 0);
                    const repsDiff = (s.reps || 0) - (prevSet.reps || 0);
                    if (weightDiff > 0) {
                      microBadge = `<span class="micro-badge weight-pr">🚀 +${weightDiff} lbs</span>`;
                    } else if (weightDiff === 0 && repsDiff > 0) {
                      microBadge = `<span class="micro-badge reps-pr">🔥 +${repsDiff} rep${repsDiff > 1 ? 's' : ''}</span>`;
                    } else if (weightDiff === 0 && repsDiff === 0) {
                      microBadge = `<span class="micro-badge match-prev">✓ Match</span>`;
                    }
                  }

                  return `
                    <tr class="set-row ${s.completed ? 'completed' : ''} ${isActiveNext ? 'active-next-set' : ''}" data-exid="${ex.id}" data-setidx="${sIdx}">
                      <td class="prev-cell">
                        <div>${prevText}</div>
                        ${microBadge ? `<div>${microBadge}</div>` : ''}
                      </td>
                      <td class="target-cell">
                        <div class="target-val">${target.targetRepsDisplay} <span style="font-size: 0.65rem; color: var(--text-muted); font-weight: normal;">reps</span></div>
                        ${target.targetWeight > 0 ? `<div class="target-wt">${target.targetWeightDisplay} lbs</div>` : (target.targetWeight === 0 && ex.startingWeight && ex.startingWeight.toLowerCase().includes('bodyweight') ? `<div class="target-wt">Bodyweight</div>` : '')}
                        ${target.isProgressionIncrease ? `<span class="target-bump-badge">▲ +${this.getExerciseIncrement(ex, effectiveName)} lbs</span>` : ''}
                      </td>
                      <td>
                        <div class="stepper-wrap weight-stepper">
                          <button type="button" class="stepper-btn minus" data-type="weight" data-delta="-5" data-exid="${ex.id}" data-setidx="${sIdx}" aria-label="Decrease weight by 5 lbs">−</button>
                          <input type="number" class="set-input set-weight-input" 
                                 value="${s.weight}" 
                                 data-exid="${ex.id}" data-setidx="${sIdx}" 
                                 step="5" min="0" placeholder="0" 
                                 inputmode="decimal" pattern="[0-9]*"
                                 aria-label="Set ${s.setNum} weight in lbs" />
                          <button type="button" class="stepper-btn plus" data-type="weight" data-delta="5" data-exid="${ex.id}" data-setidx="${sIdx}" aria-label="Increase weight by 5 lbs">+</button>
                        </div>
                      </td>
                      <td>
                        <div class="stepper-wrap reps-stepper">
                          <button type="button" class="stepper-btn minus" data-type="reps" data-delta="-1" data-exid="${ex.id}" data-setidx="${sIdx}" aria-label="Decrease reps by 1">−</button>
                          <input type="number" class="set-input set-reps-input" 
                                 value="${s.reps}" 
                                 data-exid="${ex.id}" data-setidx="${sIdx}" 
                                 step="1" min="0" placeholder="0" 
                                 inputmode="numeric" pattern="[0-9]*"
                                 aria-label="Set ${s.setNum} reps" />
                          <button type="button" class="stepper-btn plus" data-type="reps" data-delta="1" data-exid="${ex.id}" data-setidx="${sIdx}" aria-label="Increase reps by 1">+</button>
                        </div>
                      </td>
                      <td>
                        <button class="set-check-btn" data-exid="${ex.id}" data-setidx="${sIdx}" data-rest="${effectiveRest}" aria-label="Mark set ${s.setNum} ${s.completed ? 'incomplete' : 'complete'}">
                          ${s.completed ? '✓' : '○'}
                        </button>
                      </td>
                    </tr>
                    ${s.completed ? `
                      <tr class="rir-tr" data-exid="${ex.id}" data-setidx="${sIdx}">
                        <td colspan="5" style="padding: 0; border-top: none;">
                          <div class="rir-selector-row">
                            <span class="rir-prompt">RIR:</span>
                            <button type="button" class="rir-chip ${s.rir === 3 ? 'active' : ''}" data-exid="${ex.id}" data-setidx="${sIdx}" data-rir="3">3+ (Light)</button>
                            <button type="button" class="rir-chip ${s.rir === 2 ? 'active' : ''}" data-exid="${ex.id}" data-setidx="${sIdx}" data-rir="2">2 (Solid)</button>
                            <button type="button" class="rir-chip ${s.rir === 1 ? 'active' : ''}" data-exid="${ex.id}" data-setidx="${sIdx}" data-rir="1">1 (Tough)</button>
                            <button type="button" class="rir-chip ${s.rir === 0 ? 'active' : ''}" data-exid="${ex.id}" data-setidx="${sIdx}" data-rir="0">0 (Max)</button>
                          </div>
                        </td>
                      </tr>
                    ` : ''}
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>

          <div class="card-footer">
            <button class="add-set-btn" data-exid="${ex.id}">
              <span>+</span> Add Set
            </button>
            <div class="card-footer-right">
              ${sessionSets.length > 1 ? `
                <button class="icon-btn remove-set-btn" data-exid="${ex.id}" title="Remove last set">
                  − Remove Set
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  bindWorkoutCardEvents() {
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
        this.toggleSetCompletion(exId, setIdx, rest);
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
      input.addEventListener('change', () => {
        const exId = input.dataset.exid;
        const setIdx = parseInt(input.dataset.setidx, 10);
        const val = parseFloat(input.value) || 0;
        this.updateSetWeight(exId, setIdx, val);
      });
    });

    this.exerciseListEl.querySelectorAll('.set-reps-input').forEach(input => {
      input.addEventListener('change', () => {
        const exId = input.dataset.exid;
        const setIdx = parseInt(input.dataset.setidx, 10);
        const val = parseInt(input.value, 10) || 0;
        this.updateSetReps(exId, setIdx, val);
      });
    });

    // Machine Settings input changes
    this.exerciseListEl.querySelectorAll('.machine-settings-input').forEach(input => {
      input.addEventListener('change', () => {
        const exId = input.dataset.exid;
        this.machineSettings[exId] = input.value;
        this.saveMachineSettings();
      });
    });

    // Exercise Notes input changes
    this.exerciseListEl.querySelectorAll('.exercise-note-input').forEach(input => {
      input.addEventListener('change', () => {
        const key = input.dataset.exname || input.dataset.exid;
        this.exerciseNotes[key] = input.value.trim();
        this.saveExerciseNotes();
      });
    });

    // RIR selector chips
    this.exerciseListEl.querySelectorAll('.rir-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const exId = chip.dataset.exid;
        const setIdx = parseInt(chip.dataset.setidx, 10);
        const rir = parseInt(chip.dataset.rir, 10);
        this.setSetRIR(exId, setIdx, rir);
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

    if (this.session && !this.session.startTime) {
      this.session.startTime = new Date().toISOString();
    }

    setObj.completed = !setObj.completed;
    this.saveCurrentSession();

    // Tactile haptic pulse on completing set
    this.triggerHaptic([40]);

    // Trigger Rest Timer if marking as completed
    if (setObj.completed) {
      this.primeAudioContext();

      // Check if all sets for this exercise are now completed -> auto-collapse
      const list = this.session.logs[exId] || [];
      if (list.length > 0 && list.every(s => s.completed)) {
        this.collapsedCards.add(exId);
      }

      const restSeconds = this.parseRestSeconds(restStr);
      this.startTimer(restSeconds);
    } else {
      // If unchecked, uncollapse
      this.collapsedCards.delete(exId);
    }

    this.renderWorkout();
    this.updateNowLiftingHUD();
  }

  addSetToExercise(exId) {
    const list = this.session.logs[exId];
    if (!list) return;
    const lastSet = list[list.length - 1];
    list.push({
      setNum: list.length + 1,
      weight: lastSet ? lastSet.weight : 50,
      reps: lastSet ? lastSet.reps : 10,
      completed: false
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

    if (this.activeView !== 'workout' || !this.session) {
      dock.style.display = 'none';
      return;
    }

    const currentDay = this.routine && this.routine[this.activeDayIndex];
    if (!currentDay || !currentDay.exercises) {
      dock.style.display = 'none';
      return;
    }

    // Find first exercise that has at least one incomplete set
    let activeEx = null;
    let activeSetIdx = -1;

    for (const ex of currentDay.exercises) {
      const sets = this.session.logs[ex.id] || [];
      const idx = sets.findIndex(s => !s.completed);
      if (idx !== -1) {
        activeEx = ex;
        activeSetIdx = idx;
        break;
      }
    }

    if (!activeEx) {
      dock.style.display = 'none';
      return;
    }

    const effectiveName = this.getEffectiveExerciseName(activeEx.id, activeEx);
    const sets = this.session.logs[activeEx.id] || [];
    const activeSet = sets[activeSetIdx];

    const titleEl = document.getElementById('nowLiftingTitle');
    const metaEl = document.getElementById('nowLiftingMeta');

    if (titleEl) titleEl.textContent = effectiveName;
    if (metaEl) {
      const wtStr = (activeSet && activeSet.weight > 0) ? ` • ${activeSet.weight} lbs` : '';
      metaEl.textContent = `Set ${activeSetIdx + 1}/${sets.length}${wtStr}`;
    }

    dock.dataset.activeExid = activeEx.id;
    dock.style.display = 'flex';
  }

  jumpToActiveExercise() {
    const dock = document.getElementById('nowLiftingDock');
    const exId = dock ? dock.dataset.activeExid : null;
    if (!exId) return;

    // If target exercise is an optional finisher and drawer is closed, open it
    const currentDay = this.routine && this.routine[this.activeDayIndex];
    const targetEx = currentDay && currentDay.exercises.find(e => e.id === exId);
    if (targetEx && targetEx.isOptional) {
      this.expandedOptionalDays.add(currentDay.id);
      const optList = document.getElementById('optionalCardsList');
      if (optList) optList.classList.add('open');
      const optPill = document.getElementById('optionalTogglePill');
      if (optPill) optPill.textContent = 'Hide Finisher ▴';
    }

    // Uncollapse if collapsed
    if (this.collapsedCards.has(exId)) {
      this.collapsedCards.delete(exId);
      this.renderWorkout();
    }

    const card = document.getElementById('card_' + exId) || document.querySelector(`.exercise-card[data-exid="${exId}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease';
      card.style.borderColor = 'var(--accent-blue)';
      card.style.boxShadow = '0 0 25px rgba(59, 130, 246, 0.45)';
      setTimeout(() => {
        card.style.borderColor = '';
        card.style.boxShadow = '';
      }, 1400);
    }
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

    if (mode === 'permanent') {
      const oldName = ex.name;
      ex.name = sub.name;
      if (sub.targetReps) ex.targetReps = sub.targetReps;
      if (sub.notes) ex.notes = sub.notes;
      if (sub.videoUrl) ex.videoUrl = sub.videoUrl;
      ex.increment = this.getExerciseIncrement(sub, sub.name);
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
    const sets = (this.session && this.session.logs && this.session.logs[exId]) || [];
    sets.forEach((s, sIdx) => {
      if (!s.completed) {
        const target = this.getSetTarget(ex, sIdx, effectiveName);
        s.weight = target.targetWeight;
        s.reps = target.targetReps;
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
    
    // Determine target weight
    let weight = parseFloat(targetWeight);
    if (!weight || isNaN(weight) || weight <= 0) {
      if (sessionSets.length > 0 && sessionSets[0].weight > 0) {
        weight = sessionSets[0].weight;
      } else if (ex) {
        weight = this.parseInitialWeight(ex.startingWeight) || 100;
      } else {
        weight = 100;
      }
    }

    const repsStr = targetReps || (ex ? ex.targetReps : '8–10');
    
    if (this.warmupModalTitleEl) {
      this.warmupModalTitleEl.textContent = `🔥 Warm-Up Ramp: ${ex ? ex.name : exName}`;
    }

    this.renderWarmupModalContent(exId, exName, weight, repsStr);
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

  startTimer(seconds) {
    this.stopTimer(false);
    this.primeAudioContext();
    this.requestWakeLock();
    this.requestNotificationPermission();

    const targetEndTime = Date.now() + (seconds * 1000);
    this.timer.totalDuration = seconds;
    this.timer.targetEndTime = targetEndTime;
    this.timer.remaining = seconds;
    this.timer.active = true;

    localStorage.setItem(this.storageKeys.timerTargetEnd, String(targetEndTime));
    localStorage.setItem(this.storageKeys.timerTotalDuration, String(seconds));

    this.updateTimerUI();
    this.timerDockEl.classList.add('active');
    document.body.classList.add('timer-active');

    this.timer.intervalId = setInterval(() => {
      this.tickTimer();
    }, 1000);
  }

  tickTimer() {
    if (!this.timer.active) return;
    const remaining = Math.max(0, Math.round((this.timer.targetEndTime - Date.now()) / 1000));
    this.timer.remaining = remaining;
    this.updateTimerUI();

    if (remaining <= 0) {
      this.onTimerFinished();
    }
  }

  onTimerFinished() {
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
    const remaining = Math.round((targetEndTime - now) / 1000);

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
    } else if (remaining <= 0 && this.timer.active) {
      localStorage.removeItem(this.storageKeys.timerTargetEnd);
      localStorage.removeItem(this.storageKeys.timerTotalDuration);
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
        localStorage.removeItem(this.storageKeys.timerTargetEnd);
        localStorage.removeItem(this.storageKeys.timerTotalDuration);
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
    if (clearStorage) {
      localStorage.removeItem(this.storageKeys.timerTargetEnd);
      localStorage.removeItem(this.storageKeys.timerTotalDuration);
    }
    this.timerDockEl.classList.remove('active');
    document.body.classList.remove('timer-active');
  }

  adjustTimer(delta) {
    if (!this.timer.active) return;
    this.timer.targetEndTime += (delta * 1000);
    const newRemaining = Math.max(5, Math.round((this.timer.targetEndTime - Date.now()) / 1000));
    this.timer.remaining = newRemaining;
    this.timer.totalDuration = Math.max(this.timer.totalDuration, newRemaining);
    localStorage.setItem(this.storageKeys.timerTargetEnd, String(this.timer.targetEndTime));
    localStorage.setItem(this.storageKeys.timerTotalDuration, String(this.timer.totalDuration));
    this.updateTimerUI();
  }

  updateTimerUI() {
    const mins = Math.floor(this.timer.remaining / 60);
    const secs = this.timer.remaining % 60;
    this.timerDisplayEl.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    const pct = ((this.timer.totalDuration - this.timer.remaining) / this.timer.totalDuration) * 100;
    this.timerProgressBarEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
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

    let durationMins = Math.max(15, totalCompletedSets * 3);
    if (this.session && this.session.startTime) {
      const startMs = new Date(this.session.startTime).getTime();
      const elapsedMins = Math.round((Date.now() - startMs) / 60000);
      if (elapsedMins > 0 && elapsedMins <= 240) {
        durationMins = elapsedMins;
      }
    }

    let totalVolume = 0;
    const newPRs = [];
    const weightIncreaseUnlocked = [];
    const recordedExercises = {};

    currentDay.exercises.forEach(ex => {
      const sets = this.session.logs[ex.id] || [];
      const completedSets = sets.filter(s => s.completed);
      if (completedSets.length === 0) return;

      const effectiveName = this.getEffectiveExerciseName(ex.id, ex);
      const isSwapped = Boolean(this.session && this.session.swaps && this.session.swaps[ex.id]);
      const effectiveTargetReps = isSwapped && this.session.swaps[ex.id].targetReps ? this.session.swaps[ex.id].targetReps : ex.targetReps;
      const maxTarget = this.getMaxTargetReps(effectiveTargetReps);
      const targetSetsCount = (this.deloadActive ? Math.max(2, Math.floor(ex.sets * 0.67)) : ex.sets) || sets.length || 3;

      // Check double progression: only unlocked if ALL sets hit top end target reps at working weight and NOT deloading!
      const topW = Math.max(...completedSets.map(s => s.weight || 0));
      if (!this.deloadActive && completedSets.length >= targetSetsCount && completedSets.every(s => (s.reps || 0) >= maxTarget && (topW === 0 || (s.weight || 0) >= topW))) {
        const increment = this.getExerciseIncrement(ex, effectiveName);
        weightIncreaseUnlocked.push({
          name: effectiveName,
          reps: maxTarget,
          setsCount: completedSets.length,
          topWeight: topW,
          increment
        });
      }

      // Check PRs before committing new sets
      const priorPR = this.getPersonalRecord(effectiveName);
      let hitNewPR = false;
      let prDescription = '';

      completedSets.forEach(s => {
        const vol = (s.weight || 0) * (s.reps || 0);
        totalVolume += vol;

        if (s.weight > priorPR.maxWeight && priorPR.maxWeight > 0) {
          hitNewPR = true;
          prDescription = `${effectiveName}: New Weight Record (${s.weight} lbs)`;
        } else if (s.weight === 0 && s.reps > priorPR.bestReps && priorPR.bestReps > 0) {
          hitNewPR = true;
          prDescription = `${effectiveName}: New Rep Record (BW × ${s.reps})`;
        }
      });

      if (hitNewPR && prDescription && !newPRs.includes(prDescription)) {
        newPRs.push(prDescription);
      }

      recordedExercises[effectiveName] = {
        swappedFrom: isSwapped ? ex.name : null,
        sets: completedSets.map((s, idx) => ({
          setNum: idx + 1,
          weight: s.weight,
          reps: s.reps,
          completed: true,
          rir: typeof s.rir === 'number' ? s.rir : null,
          type: s.type || 'working'
        }))
      };

      // Record to lastWeights NOW as workout is completed (replace stale sets cleanly)
      if (!this.lastWeights) this.lastWeights = {};
      this.lastWeights[effectiveName] = {
        date: new Date().toISOString(),
        sets: completedSets.map((s, idx) => ({
          setNum: idx + 1,
          weight: parseFloat(s.weight) || 0,
          reps: parseInt(s.reps, 10) || 0,
          completed: true
        }))
      };
      this.saveLastWeights();
    });

    // Save to history
    const workoutRecord = {
      id: 'w_' + Date.now(),
      date: new Date().toISOString(),
      dayTitle: currentDay.title,
      deload: Boolean(this.deloadActive),
      totalVolume,
      totalCompletedSets,
      durationMins,
      exercises: recordedExercises
    };

    this.history.push(workoutRecord);
    this.saveHistory();

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
          <div class="stat-val">${durationMins}m</div>
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
    `;

    this.summaryModalEl.classList.add('open');

    document.getElementById('finishSummaryBtn')?.addEventListener('click', () => {
      this.summaryModalEl.classList.remove('open');
      document.querySelector('[data-view="analytics"]').click();
    });

    this.renderWorkout();
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
    if (!muscleStr || typeof muscleStr !== 'string') return null;
    const tokens = muscleStr.toLowerCase().split('/').map(t => t.trim()).filter(Boolean);
    for (const token of tokens) {
      if (token === 'glutes' || token === 'hamstrings') return 'Hamstrings / Glutes';
      if (token === 'quads') return 'Quads';
      if (token === 'back' || token === 'lats') return 'Back / Lats';
      if (token === 'chest') return 'Chest';
      if (token === 'shoulders' || token === 'delts') return 'Shoulders';
      if (token === 'biceps') return 'Biceps';
      if (token === 'triceps') return 'Triceps';
      if (token === 'forearms') return 'Forearms';
      if (token === 'calves') return 'Calves';
      if (token === 'abs' || token === 'core') return 'Abs / Core';
    }
    return null;
  }

  generateWeeklyVolumeLandmarksHTML() {
    if (typeof VOLUME_LANDMARKS === 'undefined') return '';

    // Calculate planned direct sets per muscle group across this.routine
    const muscleDirectSets = {};
    const muscleSecondarySets = {};

    Object.keys(VOLUME_LANDMARKS).forEach(m => {
      muscleDirectSets[m] = 0;
      muscleSecondarySets[m] = 0;
    });

    if (this.routine) {
      this.routine.forEach(day => {
        (day.exercises || []).forEach(ex => {
          const sets = ex.sets || 3;
          // Direct muscle
          const landmarkKey = this.mapMuscleToLandmark(ex.muscle);
          if (landmarkKey && muscleDirectSets[landmarkKey] !== undefined) {
            muscleDirectSets[landmarkKey] += sets;
          }

          // Synergist secondary muscle credits
          if (typeof SECONDARY_MUSCLE_CONTRIBUTIONS !== 'undefined') {
            const effectiveName = (this.session && this.session.swaps && this.session.swaps[ex.id]) ? this.session.swaps[ex.id].name : ex.name;
            for (const [key, contribs] of Object.entries(SECONDARY_MUSCLE_CONTRIBUTIONS)) {
              if (effectiveName === key || effectiveName.startsWith(key)) {
                Object.entries(contribs).forEach(([targetMuscle, creditFraction]) => {
                  if (muscleSecondarySets[targetMuscle] !== undefined) {
                    muscleSecondarySets[targetMuscle] += creditFraction * sets;
                  }
                });
                break;
              }
            }
          }
        });
      });
    }

    const rowsHTML = Object.entries(VOLUME_LANDMARKS).map(([muscle, bounds]) => {
      const direct = muscleDirectSets[muscle] || 0;
      const secondary = Math.round((muscleSecondarySets[muscle] || 0) * 10) / 10;
      const totalSets = Math.round((direct + secondary) * 10) / 10;

      let statusClass = 'optimal';
      let statusText = 'Growth Sweet Spot';
      if (totalSets < bounds.mev) {
        statusClass = 'under';
        statusText = 'Below MEV';
      } else if (totalSets < bounds.mavMin) {
        statusClass = 'near';
        statusText = 'Above MEV — room to grow';
      } else if (totalSets <= bounds.mavMax) {
        statusClass = 'optimal';
        statusText = 'Growth Sweet Spot';
      } else if (totalSets <= bounds.mrv) {
        statusClass = 'high';
        statusText = 'High Volume';
      } else {
        statusClass = 'over';
        statusText = 'Over MRV';
      }

      const pct = Math.min(100, Math.round((totalSets / bounds.mrv) * 100));

      return `
        <div class="volume-row">
          <div class="volume-row-labels">
            <span class="volume-muscle-name">
              ${muscle}
              <span class="volume-status-tag ${statusClass}">${statusText}</span>
            </span>
            <span class="volume-sets-val">
              ${totalSets} sets <span style="font-size: 0.68rem; color: var(--text-muted); font-weight: normal;">(Target: ${bounds.mavMin}–${bounds.mavMax})</span>
            </span>
          </div>
          <div class="volume-bar-track">
            <div class="volume-bar-fill ${statusClass}" style="width: ${pct}%;"></div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="volume-landmarks-box">
        <div class="volume-landmarks-header">
          <div>
            <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--text-primary); margin: 0;">🎯 Weekly Hypertrophy Volume Radar</h4>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">
              Scientific landmarks (Dr. Israetel): Direct + compound synergist sets vs MEV/MAV/MRV.
            </div>
          </div>
          <span style="font-size: 0.72rem; background: rgba(16, 185, 129, 0.15); color: #34d399; padding: 2px 8px; border-radius: var(--radius-full); font-weight: 700;">
            Science Backed
          </span>
        </div>
        ${rowsHTML}
      </div>
    `;
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
    if (this.history && Array.isArray(this.history)) {
      this.history.forEach(workout => {
        if (!workout.exercises) return;
        Object.entries(workout.exercises).forEach(([exName, exData]) => {
          if (!this.lastWeights[exName]) {
            this.lastWeights[exName] = { sets: [], date: workout.date };
          }
          if (Array.isArray(exData.sets)) {
            exData.sets.forEach(s => {
              if (s && s.completed) {
                const sIdx = (s.setNum || 1) - 1;
                this.lastWeights[exName].sets[sIdx] = {
                  weight: s.weight,
                  reps: s.reps,
                  completed: true
                };
                this.lastWeights[exName].date = workout.date;
              }
            });
          }
        });
      });
    }
    this.saveLastWeights();
  }

  // Routine & Customizer View
  renderRoutineEditor() {
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
            Auto-scales workout sets down by ~50% and eases loads by ~10% for systemic joint & CNS restoration. Auto-expires after 7 days.
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
          Browser storage is persistent, but downloading an offline JSON backup guarantees your workout history, personal records, and exercise notes remain 100% immune to browser cache clearing or phone switches.
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
          <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px;">Test the 3-tone chime & tactile vibration pattern.</div>
        </div>
        <button class="secondary-btn" id="testChimeBtn" style="padding: 6px 14px; font-size: 0.8rem; border-color: rgba(16, 185, 129, 0.4); color: #6ee7b7;">
          🔊 Test Chime & Vibrate
        </button>
      </div>

      <!-- Version & Cache Reset -->
      <div style="background: rgba(148, 163, 184, 0.08); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: var(--radius-lg); padding: 14px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
        <div>
          <div style="font-weight: 700; font-size: 0.9rem; color: #e2e8f0;">⚡ MachineMaster v2.6 <span style="font-size: 0.75rem; color: #38bdf8; font-weight: 600;">(Build v26 • Rev ${localStorage.getItem(this.storageKeys.routineRev) || '14'})</span></div>
          <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">Smart +10/+5lb Auto-Bump • Core-Only Split • Deload Engine • SVG 1RM Curve • Active HUD</div>
        </div>
        <button class="secondary-btn" id="forceUpdateBtn" style="padding: 6px 14px; font-size: 0.8rem;">
          🔄 Force Sync & Reload
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
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let reg of registrations) {
          await reg.unregister();
        }
      }
      localStorage.removeItem(this.storageKeys.routine);
      localStorage.removeItem(this.storageKeys.routineRev);
      localStorage.removeItem(this.storageKeys.currentSessionPrefix + 'mon__lower_b');
      localStorage.removeItem(this.storageKeys.currentSessionPrefix + 'fri___lower_a');
      localStorage.removeItem(this.storageKeys.currentSessionPrefix + 'sat___upper_b');
      localStorage.removeItem(this.storageKeys.currentSessionPrefix + 'sun___db_arms');
      localStorage.removeItem(this.storageKeys.currentSessionPrefix + 'wed___upper_a');
      localStorage.removeItem(this.storageKeys.legacyCurrentSession);
      localStorage.removeItem(this.storageKeys.timerTargetEnd);
      localStorage.removeItem(this.storageKeys.timerTotalDuration);
      await fetch(window.location.pathname, { cache: 'reload' }).catch(() => {});
    } catch (e) {
      console.error(e);
    }
    window.location.replace(window.location.pathname + '?v=' + Date.now());
  }

  exportData() {
    const data = {
      version: '2.4',
      routine: this.routine,
      history: this.history,
      machineSettings: this.machineSettings,
      exerciseNotes: this.exerciseNotes,
      lastWeights: this.lastWeights,
      wakeLockEnabled: this.wakeLockEnabled,
      routineRev: localStorage.getItem(this.storageKeys.routineRev) || '13',
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MachineMaster_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    localStorage.setItem(this.storageKeys.lastBackupTime, String(Date.now()));
    this.showToast('📥 Backup exported successfully!');
    if (this.activeView === 'routine') this.renderRoutineEditor();
  }

  importData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid JSON backup file');
      }

      let newWorkoutsCount = 0;
      if (Array.isArray(data.history)) {
        const existingIds = new Set(this.history.map(h => h.id));
        data.history.forEach(h => {
          if (h && h.id && !existingIds.has(h.id)) {
            this.history.push(h);
            existingIds.add(h.id);
            newWorkoutsCount++;
          }
        });
        this.saveHistory();
      }

      if (data.machineSettings && typeof data.machineSettings === 'object') {
        this.machineSettings = { ...this.machineSettings, ...data.machineSettings };
        this.saveMachineSettings();
      }

      if (data.exerciseNotes && typeof data.exerciseNotes === 'object') {
        this.exerciseNotes = { ...this.exerciseNotes, ...data.exerciseNotes };
        this.saveExerciseNotes();
      }

      if (data.lastWeights && typeof data.lastWeights === 'object') {
        this.lastWeights = { ...this.lastWeights, ...data.lastWeights };
        localStorage.setItem(this.storageKeys.lastWeights, JSON.stringify(this.lastWeights));
      }

      if (typeof data.wakeLockEnabled === 'boolean') {
        this.wakeLockEnabled = data.wakeLockEnabled;
        localStorage.setItem(this.storageKeys.wakeLockEnabled, String(this.wakeLockEnabled));
      }

      if (data.routineRev !== undefined && data.routineRev !== null) {
        localStorage.setItem(this.storageKeys.routineRev, String(data.routineRev));
      }

      if (Array.isArray(data.routine) && data.routine.length > 0) {
        if (confirm('Do you also want to restore routine configurations from this backup? Click OK to restore routine, or Cancel to keep your current routine.')) {
          this.routine = data.routine;
          this.saveRoutine();
        }
      }

      localStorage.setItem(this.storageKeys.lastBackupTime, String(Date.now()));
      this.showToast(`✅ Restore complete! Added ${newWorkoutsCount} workouts.`);
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
