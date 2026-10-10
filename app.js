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
      streamlineMode: 'gym_streamline_mode_v1',
      currentSessionPrefix: 'gym_session_',
      legacyCurrentSession: 'gym_current_session_v4',
      lastWeights: 'gym_last_weights_v1',
      timerTargetEnd: 'gym_timer_target_end_v1',
      timerTotalDuration: 'gym_timer_total_duration_v1'
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
    this.streamlineMode = localStorage.getItem(this.storageKeys.streamlineMode) !== 'false'; // Default to true

    // Load Routine
    this.routine = this.loadRoutine();

    // Active Day: determine suggested day based on current weekday
    this.activeDayIndex = this.getSuggestedDayIndex();

    // Audio & WakeLock state
    this.audioCtx = null;
    this.wakeLock = null;
    this.wakeLockEnabled = localStorage.getItem('gym_wake_lock_enabled') !== 'false';
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
    const CURRENT_ROUTINE_REV = 11;
    const savedRev = localStorage.getItem('gym_routine_rev');
    const saved = localStorage.getItem(this.storageKeys.routine);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Correct any legacy muscle tags for calves
        parsed.forEach(day => {
          day.exercises.forEach(ex => {
            if (ex.name.toLowerCase().includes('calf') && ex.muscle === 'Quads') {
              ex.muscle = 'Calves';
            }
          });
        });

        // Migrate routine to Revision 11 (Dedicated Standing DB Reverse Curl forearm finisher for Sunday)
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
          localStorage.setItem('gym_routine_backup_v10', JSON.stringify(parsed));
          const updatedRoutine = JSON.parse(JSON.stringify(DEFAULT_ROUTINE));
          localStorage.setItem('gym_routine_rev', String(CURRENT_ROUTINE_REV));
          localStorage.setItem(this.storageKeys.routine, JSON.stringify(updatedRoutine));
          return updatedRoutine;
        }

        return parsed;
      } catch (e) { console.error(e); }
    }
    localStorage.setItem('gym_routine_rev', String(CURRENT_ROUTINE_REV));
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

  getExerciseIncrement(ex) {
    if (ex && typeof ex.increment === 'number') return ex.increment;
    const name = (ex ? ex.name : '').toLowerCase();
    const muscle = (ex ? ex.muscle : '').toLowerCase();
    if (name.includes('leg press') || name.includes('hip thrust') || name.includes('calf') || muscle.includes('quad')) return 10;
    if (name.includes('lateral raise') || name.includes('rear delt') || name.includes('curl')) return 5;
    return 5;
  }

  getMinTargetReps(targetRepsStr) {
    if (!targetRepsStr) return 8;
    const matches = targetRepsStr.match(/\d+/g);
    if (!matches || matches.length === 0) return 8;
    return Math.min(...matches.map(n => parseInt(n, 10)));
  }

  getSetTarget(ex, setIdx, effectiveName) {
    const minTarget = this.getMinTargetReps(ex.targetReps);
    const maxTarget = this.getMaxTargetReps(ex.targetReps);
    const increment = this.getExerciseIncrement(ex);
    const prev = this.getPreviousExercisePerformance(effectiveName);

    if (!prev || !prev.sets || prev.sets.length === 0) {
      const parsedStart = this.parseInitialWeight(ex.startingWeight);
      const targetWeight = this.deloadActive ? Math.max(0, Math.round((parsedStart * 0.9) / 5) * 5) : parsedStart;
      return {
        targetWeight,
        targetReps: minTarget,
        targetRepsDisplay: ex.targetReps,
        targetWeightDisplay: targetWeight > 0 ? `${targetWeight}` : '—',
        isProgressionIncrease: false,
        note: 'Baseline set'
      };
    }

    const validPrevSets = prev.sets.filter(s => s && (s.completed !== false || s.reps > 0));
    const targetSetsCount = ex.sets || 3;
    const prevSet = validPrevSets[setIdx] || validPrevSets[0] || {};
    let baseWeight = prevSet.weight || 0;
    const prevReps = prevSet.reps || minTarget;

    const allSetsHitMax = validPrevSets.length >= targetSetsCount && validPrevSets.every(s => (s.reps || 0) >= maxTarget);

    let targetWeight = baseWeight;
    let targetReps = prevReps;
    let isProgressionIncrease = false;

    if (allSetsHitMax && baseWeight > 0) {
      targetWeight = baseWeight + increment;
      targetReps = minTarget;
      isProgressionIncrease = true;
    } else {
      targetReps = Math.min(maxTarget, prevReps >= maxTarget ? maxTarget : prevReps + 1);
    }

    if (this.deloadActive) {
      targetWeight = Math.max(0, Math.round((targetWeight * 0.9) / 5) * 5);
      isProgressionIncrease = false;
    }

    return {
      targetWeight,
      targetReps,
      targetRepsDisplay: `${targetReps}`,
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
          // Ensure all exercises in the current routine definition have logs initialized
          if (day && day.exercises) {
            day.exercises.forEach(ex => {
              if (!parsed.logs[ex.id] || parsed.logs[ex.id].length === 0) {
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
      startTime: new Date().toISOString(),
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
    if (!str) return '';
    const m = str.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : '';
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

  getMaxTargetReps(targetRepsStr) {
    if (!targetRepsStr) return 10;
    const matches = targetRepsStr.match(/\d+/g);
    if (!matches || matches.length === 0) return 10;
    return Math.max(...matches.map(n => parseInt(n, 10)));
  }

  getPreviousProgressionFlag(exerciseName, targetRepsStr, requiredSetsCount = 3) {
    const prev = this.getPreviousExercisePerformance(exerciseName);
    if (!prev || !prev.sets || prev.sets.length === 0) return { unlocked: false };
    const maxTarget = this.getMaxTargetReps(targetRepsStr);
    const validSets = prev.sets.filter(s => s && (s.completed !== false || s.reps > 0));
    const targetSets = requiredSetsCount || 3;
    if (validSets.length < targetSets) return { unlocked: false };
    
    // Weight increase flag is ONLY unlocked if top-end target reps were hit for all sets (all 3 sets)
    const allSetsHit = validSets.every(s => (s.reps || 0) >= maxTarget);

    if (allSetsHit) {
      const topWeight = Math.max(...validSets.map(s => s.weight || 0));
      return {
        unlocked: true,
        allSetsHit: true,
        maxReps: maxTarget,
        setsCount: validSets.length,
        topWeight
      };
    }
    return { unlocked: false };
  }

  bumpExerciseWeight(exId, delta = 5) {
    const list = this.session.logs[exId];
    if (!list) return;
    const effectiveName = this.getEffectiveExerciseName(exId);
    list.forEach((s, idx) => {
      const cur = parseFloat(s.weight) || 0;
      s.weight = Math.max(0, cur + delta);
      if (effectiveName) {
        this.recordExerciseWeight(effectiveName, idx + 1, s.weight, s.reps, s.completed);
      }
    });
    this.saveCurrentSession();
    this.renderWorkout();
  }

  updateSetWeight(exId, setIdx, newWeight) {
    const list = this.session.logs[exId];
    if (!list || !list[setIdx]) return;
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
    const effectiveName = this.getEffectiveExerciseName(exId);
    if (effectiveName) {
      list.forEach((s, idx) => {
        this.recordExerciseWeight(effectiveName, idx + 1, s.weight, s.reps, s.completed);
      });
    }
    this.renderWorkout();
  }

  updateSetReps(exId, setIdx, newReps) {
    const list = this.session.logs[exId];
    if (!list || !list[setIdx]) return;
    const val = Math.max(0, parseInt(newReps, 10) || 0);
    list[setIdx].reps = val;

    this.saveCurrentSession();
    const effectiveName = this.getEffectiveExerciseName(exId);
    if (effectiveName) {
      this.recordExerciseWeight(effectiveName, setIdx + 1, list[setIdx].weight, val, list[setIdx].completed);
    }
    this.renderWorkout();
  }

  getPreviousExercisePerformance(exerciseName) {
    // 1. Check persistent lastWeights store
    if (this.lastWeights && this.lastWeights[exerciseName] && this.lastWeights[exerciseName].sets) {
      const validSets = this.lastWeights[exerciseName].sets.filter(Boolean);
      if (validSets.length > 0) {
        return {
          date: this.lastWeights[exerciseName].date,
          sets: validSets
        };
      }
    }
    // 2. Check completed history
    for (let i = this.history.length - 1; i >= 0; i--) {
      const workout = this.history[i];
      if (workout.exercises && workout.exercises[exerciseName]) {
        return {
          date: workout.date,
          sets: workout.exercises[exerciseName].sets
        };
      }
    }
    return null;
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

    // Check history
    this.history.forEach(h => {
      if (h.exercises && h.exercises[exerciseName]) {
        h.exercises[exerciseName].sets.forEach(s => {
          if (s.weight > 0) {
            if (s.weight > maxWeight) maxWeight = s.weight;
            const reps = s.reps || 1;
            const est1RM = Math.round(s.weight * (1 + reps / 30));
            if (est1RM > max1RM) max1RM = est1RM;
            if (reps > bestReps) bestReps = reps;
          }
        });
      }
    });

    // Check persistent last weights
    if (this.lastWeights && this.lastWeights[exerciseName] && this.lastWeights[exerciseName].sets) {
      this.lastWeights[exerciseName].sets.filter(Boolean).forEach(s => {
        if (s.weight > 0) {
          if (s.weight > maxWeight) maxWeight = s.weight;
          const reps = s.reps || 1;
          const est1RM = Math.round(s.weight * (1 + reps / 30));
          if (est1RM > max1RM) max1RM = est1RM;
          if (reps > bestReps) bestReps = reps;
        }
      });
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
    this.timerSoundToggleEl = document.getElementById('timerSoundToggle');

    // Modals
    this.summaryModalEl = document.getElementById('summaryModal');
    this.summaryContentEl = document.getElementById('summaryContent');
    this.analyticsModalEl = document.getElementById('analyticsModal');
    this.analyticsContentEl = document.getElementById('analyticsContent');
    this.routineModalEl = document.getElementById('routineModal');
    this.routineEditorEl = document.getElementById('routineEditor');

    // New Gym Power Modals
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

    // Time saver toggle
    this.streamlineToggleBtn = document.getElementById('streamlineToggleBtn');
  }

  bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const view = btn.dataset.view;
        this.switchMainView(view);
      });
    });

    // Streamline toggle
    if (this.streamlineToggleBtn) {
      this.streamlineToggleBtn.addEventListener('click', () => {
        this.streamlineMode = !this.streamlineMode;
        localStorage.setItem(this.storageKeys.streamlineMode, this.streamlineMode);
        this.updateStreamlineButton();
        this.renderWorkout();
      });
    }

    // Finish Workout button
    const finishBtn = document.getElementById('finishWorkoutBtn');
    if (finishBtn) {
      finishBtn.addEventListener('click', () => this.showWorkoutSummary());
    }

    // Timer controls
    document.getElementById('timerSkipBtn')?.addEventListener('click', () => this.stopTimer());
    document.getElementById('timerPlus30Btn')?.addEventListener('click', () => this.adjustTimer(30));
    document.getElementById('timerMinus30Btn')?.addEventListener('click', () => this.adjustTimer(-30));
    document.getElementById('timerMinus15Btn')?.addEventListener('click', () => this.adjustTimer(-30));

    // Modal closes
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
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

    // Export & Reset buttons
    document.getElementById('exportDataBtn')?.addEventListener('click', () => this.exportData());
    document.getElementById('resetRoutineBtn')?.addEventListener('click', () => this.resetRoutine());

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

  updateStreamlineButton() {
    if (!this.streamlineToggleBtn) return;
    if (this.streamlineMode) {
      this.streamlineToggleBtn.classList.add('active');
      this.streamlineToggleBtn.innerHTML = '⚡ Streamlined (ON)';
    } else {
      this.streamlineToggleBtn.classList.remove('active');
      this.streamlineToggleBtn.innerHTML = '⚡ Streamlined (OFF)';
    }
  }

  render() {
    this.renderDaySelector();
    this.updateStreamlineButton();
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
    const totalCoreSets = coreExercises.reduce((sum, ex) => sum + ex.sets, 0);
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
      <h2>${cleanDayTitle}</h2>
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
    const optionalHTML = optionalExercises.length > 0 ? `
      <div class="optional-section-wrap">
        <div class="optional-section-header" id="optionalToggleHeader">
          <div class="optional-header-left">
            <span class="optional-badge-pill">⚡ 100% EXCLUSIVELY OPTIONAL</span>
            <div class="optional-section-title">${optionalExercises.length} Bonus Finisher${optionalExercises.length > 1 ? 's' : ''}</div>
            <div class="optional-section-subtitle">Only do this if you have 10+ mins left on your 60m timer!</div>
          </div>
          <span class="optional-toggle-pill" id="optionalTogglePill">View Finisher (+5m) ▾</span>
        </div>
        <div class="optional-cards-list" id="optionalCardsList">
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
    const setsHittingMax = completedSets.filter(s => (s.reps || 0) >= maxTarget);
    const targetSetsCount = (this.deloadActive ? Math.max(2, Math.floor(ex.sets * 0.67)) : ex.sets) || sessionSets.length || 3;
    const allCurrentHit = sessionSets.length >= targetSetsCount && completedSets.length === sessionSets.length && completedSets.every(s => s.completed && (s.reps || 0) >= maxTarget);
    const prevProgression = this.getPreviousProgressionFlag(effectiveName, effectiveTargetReps, targetSetsCount);
    const nextIncompleteIdx = sessionSets.findIndex(s => !s.completed);
    const prevSummaryText = this.formatPreviousSetsSummary(prev ? prev.sets : null);

    return `
      <div class="exercise-card ${isAllDone ? 'completed' : ''} ${isBonus ? 'is-optional' : ''} ${ex.superset ? 'is-superset' : ''}" id="card_${ex.id}">
        
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

          <h3 class="exercise-name">${displayName}</h3>

          <div class="card-tools-row">
            ${prevSummaryText ? `
              <button type="button" class="prev-weight-pill-btn" data-exname="${ex.name}" title="Tap to view performance log">⏱️ Last: ${prevSummaryText} ▾</button>
            ` : '<div class="card-tools-spacer"></div>'}
            <div class="card-actions-pills">
              <button type="button" class="action-pill-btn warmup-btn" data-exid="${ex.id}" data-exname="${displayName}" title="Calculate neural warmup ramp sets">
                🔥 Warmup
              </button>
              <button type="button" class="action-pill-btn swap-btn" data-exid="${ex.id}" data-exname="${ex.name}" title="Swap with alternative equipment">
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
                <div class="form-notes-content">${effectiveNotes}</div>
              </details>
            ` : ''}
            
            <div class="machine-settings-row">
              <span class="machine-settings-label">⚙️ Pin / Seat:</span>
              <input type="text" class="machine-settings-input" 
                     placeholder="e.g. Seat #4, Pin #8" 
                     value="${machineSetting}" 
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

          ${prevProgression.unlocked ? `
            <div class="progression-banner">
              <div class="progression-banner-left">
                <span class="progression-icon">🚀</span>
                <div class="progression-text">
                  <strong>Weight Increase Flag:</strong> Hit ${prevProgression.maxReps} reps on all ${prevProgression.setsCount} sets last workout! Ready to increase weight today (+5 lbs recommended).
                </div>
              </div>
              <button class="bump-weight-btn" data-exid="${ex.id}" data-bump="5" title="Add 5 lbs to all sets today">
                +5 lbs All Sets
              </button>
            </div>
          ` : ''}

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
                  const prevText = prevSet && prevSet.weight > 0 ? `${prevSet.weight}×${prevSet.reps}` : '—';
                  const isActiveNext = sIdx === nextIncompleteIdx;
                  const target = this.getSetTarget(ex, sIdx, effectiveName);

                  // Micro-PR badge calculation
                  let microBadge = '';
                  if (s.completed && prevSet && prevSet.weight > 0) {
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
                        ${target.targetWeight > 0 ? `<div class="target-wt">${target.targetWeightDisplay} lbs</div>` : ''}
                        ${target.isProgressionIncrease ? `<span class="target-bump-badge">▲ +${this.getExerciseIncrement(ex)}</span>` : ''}
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

    setObj.completed = !setObj.completed;
    this.saveCurrentSession();

    // Tactile haptic pulse on completing set
    this.triggerHaptic([40]);

    const ex = this.findExerciseById(exId);
    const effectiveName = this.getEffectiveExerciseName(exId, ex);
    if (effectiveName) {
      this.recordExerciseWeight(effectiveName, setIdx + 1, setObj.weight, setObj.reps, setObj.completed);
    }

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

    // Uncollapse if collapsed
    if (this.collapsedCards.has(exId)) {
      this.collapsedCards.delete(exId);
      this.renderWorkout();
    }

    const card = document.querySelector(`.exercise-card[data-exid="${exId}"]`);
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
      this.swapContentEl.innerHTML = `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--radius-md); padding: 12px; margin-bottom: 14px;">
          <div style="font-size: 0.74rem; color: var(--text-muted); text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em;">Current Exercise</div>
          <div style="font-size: 0.95rem; font-weight: 700; color: #fff; margin-top: 2px;">${currentName}</div>
          <div style="font-size: 0.78rem; color: var(--accent-blue); margin-top: 2px;">Target: ${ex ? ex.targetReps : '8–12'} reps • ${ex ? ex.muscle : ''}</div>
        </div>

        <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px;">
          Select Alternative (${subs.length} available):
        </div>

        <div class="swap-options-list">
          ${subs.map((sub, sIdx) => `
            <div class="swap-option-card">
              <div class="swap-option-header">
                <div>
                  <span class="swap-type-badge ${sub.type.toLowerCase()}">${sub.type}</span>
                  <div class="swap-option-name">${sub.name}</div>
                </div>
                ${sub.videoUrl ? `
                  <a href="${sub.videoUrl}" target="_blank" rel="noopener noreferrer" class="video-link-btn" style="font-size: 0.7rem; padding: 3px 8px;">
                    ▶ Form
                  </a>
                ` : ''}
              </div>
              <div class="swap-option-notes">${sub.notes || 'Target: ' + sub.targetReps + ' reps.'}</div>
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
      this.saveRoutine();
      this.showToast(`✅ Replaced "${oldName}" with "${sub.name}" permanently in your routine!`);
    } else {
      // Today only: mark in session
      if (!this.session.swaps) this.session.swaps = {};
      this.session.swaps[exId] = sub;
      this.saveCurrentSession();
      this.showToast(`⚡ Swapped to "${sub.name}" for today's workout!`);
    }

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
                  <div class="quick-history-day">${item.dayTitle || ''}</div>
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
    this.releaseWakeLock();
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
    let totalVolume = 0;
    let totalCompletedSets = 0;
    const newPRs = [];
    const weightIncreaseUnlocked = [];

    const recordedExercises = {};

    currentDay.exercises.forEach(ex => {
      const sets = this.session.logs[ex.id] || [];
      const completedSets = sets.filter(s => s.completed);
      totalCompletedSets += completedSets.length;
      const effectiveName = this.getEffectiveExerciseName(ex.id, ex);
      const isSwapped = Boolean(this.session && this.session.swaps && this.session.swaps[ex.id]);
      const maxTarget = this.getMaxTargetReps(ex.targetReps);

      // Check double progression: only unlocked if ALL sets hit top end target reps!
      const targetSetsCount = ex.sets || sets.length || 3;
      const allHit = completedSets.length >= targetSetsCount && completedSets.every(s => (s.reps || 0) >= maxTarget);
      if (allHit) {
        const topW = Math.max(...completedSets.map(s => s.weight || 0));
        weightIncreaseUnlocked.push({
          name: effectiveName,
          reps: maxTarget,
          setsCount: completedSets.length,
          topWeight: topW
        });
      }

      completedSets.forEach(s => {
        const vol = (s.weight || 0) * (s.reps || 0);
        totalVolume += vol;

        // Check PR on effective exercise name
        const pr = this.getPersonalRecord(effectiveName);
        if (s.weight > pr.maxWeight && pr.maxWeight > 0) {
          newPRs.push(`${effectiveName}: New Weight Record (${s.weight} lbs)`);
        }
      });

      if (completedSets.length > 0) {
        recordedExercises[effectiveName] = {
          swappedFrom: isSwapped ? ex.name : null,
          sets: sets.map(s => ({
            setNum: s.setNum,
            weight: s.weight,
            reps: s.reps,
            completed: s.completed,
            rir: typeof s.rir === 'number' ? s.rir : null,
            type: s.type || 'working'
          }))
        };
        sets.forEach(s => {
          this.recordExerciseWeight(effectiveName, s.setNum, s.weight, s.reps, s.completed);
        });
      }
    });

    const durationMins = Math.max(15, Math.round((new Date() - new Date(this.session.startTime)) / 60000));

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
        <p style="color: var(--text-secondary);">${currentDay.title}</p>
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
              <li><strong>${item.name}</strong>: Hit ${item.reps} reps on all ${item.setsCount} sets (${item.topWeight} lbs) — Ready to increase weight (+5 lbs) next workout!</li>
            `).join('')}
          </ul>
        </div>
      ` : ''}

      ${newPRs.length > 0 ? `
        <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid var(--accent-emerald); border-radius: var(--radius-md); padding: 12px; margin-bottom: 20px;">
          <h4 style="color: var(--accent-emerald); font-weight: 700; margin-bottom: 6px;">🎉 New Records Hit!</h4>
          <ul style="padding-left: 20px; font-size: 0.85rem; color: #e2e8f0;">
            ${newPRs.map(pr => `<li>${pr}</li>`).join('')}
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
        if (entry.sets && entry.sets.length > 0) {
          const maxW = Math.max(...entry.sets.map(s => s.weight || 0));
          const totalVol = entry.sets.reduce((sum, s) => sum + ((s.weight || 0) * (s.reps || 0)), 0);
          results.push({
            date: h.date,
            dayTitle: h.dayTitle,
            sets: entry.sets,
            maxWeight: maxW,
            totalVolume: totalVol
          });
        }
      }
    });

    // 2. From persistent last weights if not already present for this date
    if (this.lastWeights && this.lastWeights[exerciseName] && this.lastWeights[exerciseName].sets) {
      const validSets = this.lastWeights[exerciseName].sets.filter(Boolean);
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
          <span>📊 Complete sets with weight for this lift to view your dynamic 1RM strength curve!</span>
        </div>
      `;
    }

    // Extract best e1RM for each session
    const points = [];
    exHistory.forEach((session, sIdx) => {
      let maxE1RM = 0;
      let topWeight = 0;
      let topReps = 0;
      (session.sets || []).forEach(s => {
        if (s && s.weight > 0) {
          const reps = s.reps || 1;
          const e1rm = Math.round(s.weight * (1 + reps / 30));
          if (e1rm > maxE1RM) {
            maxE1RM = e1rm;
            topWeight = s.weight;
            topReps = reps;
          }
        }
      });
      if (maxE1RM > 0) {
        const d = new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        points.push({
          idx: sIdx,
          date: d,
          fullDate: new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          dayTitle: session.dayTitle || 'Workout',
          e1rm: maxE1RM,
          weight: topWeight,
          reps: topReps
        });
      }
    });

    if (points.length === 0) {
      return `
        <div style="text-align: center; padding: 20px 12px; color: var(--text-muted); font-size: 0.85rem; background: rgba(255,255,255,0.02); border-radius: var(--radius-md);">
          <span>📊 Enter your weights during your workout and they will automatically build your strength progress chart here!</span>
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
            <div class="chart-headline-title">📈 Estimated 1-Rep Max Trend</div>
            <div class="chart-headline-sub">${points.length} session${points.length > 1 ? 's' : ''} logged • All-Time Peak: <strong style="color: #60a5fa;">${allTimeBest} lbs</strong></div>
          </div>
          <div style="text-align: right;">
            ${points.length > 1 ? `
              <span class="micro-badge ${diff >= 0 ? 'weight-pr' : 'reps-pr'}" style="font-size: 0.75rem; padding: 2px 8px;">
                ${diff >= 0 ? '🚀' : '📉'} ${diffSign} lbs (${diffPct > 0 ? '+' : ''}${diffPct}%)
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
                    data-date="${c.fullDate}" 
                    data-day="${c.dayTitle}"
                    data-e1rm="${c.e1rm}" 
                    data-weight="${c.weight}" 
                    data-reps="${c.reps}" />
            <text x="${c.x.toFixed(1)}" y="${(padTop + plotH + 16).toFixed(1)}" text-anchor="middle" fill="var(--text-muted)" font-size="8">${c.date}</text>
          `).join('')}
        </svg>

        <div class="chart-tooltip-box" id="chartTooltipBox">
          💡 Tap any data point on the chart to inspect your workout performance.
        </div>
      </div>
    `;
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
          if (muscleDirectSets[ex.muscle] !== undefined) {
            muscleDirectSets[ex.muscle] += sets;
          } else {
            for (const key of Object.keys(VOLUME_LANDMARKS)) {
              if (key.toLowerCase().includes((ex.muscle || '').toLowerCase()) || (ex.muscle || '').toLowerCase().includes(key.toLowerCase())) {
                muscleDirectSets[key] += sets;
                break;
              }
            }
          }

          // Synergist secondary muscle credits
          if (typeof SECONDARY_MUSCLE_CONTRIBUTIONS !== 'undefined') {
            for (const [subKey, contribs] of Object.entries(SECONDARY_MUSCLE_CONTRIBUTIONS)) {
              if (ex.name.toLowerCase().includes(subKey.toLowerCase()) || subKey.toLowerCase().includes(ex.name.toLowerCase())) {
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
      let statusText = 'MAV (Optimal)';
      if (totalSets < bounds.mev) {
        statusClass = 'under';
        statusText = 'Below MEV';
      } else if (totalSets > bounds.mrv) {
        statusClass = 'over';
        statusText = 'Over MRV';
      } else if (totalSets >= bounds.mavMin && totalSets <= bounds.mavMax) {
        statusClass = 'optimal';
        statusText = 'Growth Sweet Spot';
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
            <span class="history-item-title">${h.dayTitle}</span>
            <span class="history-item-date">${d}</span>
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
                <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-primary);">${exName}</div>
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
              <optgroup label="${day.title}">
                ${day.exercises.map(ex => `
                  <option value="${ex.name}" ${ex.name === this.selectedProgressExercise ? 'selected' : ''}>
                    ${ex.name}
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
                    <span class="progress-session-date">${d} (${s.dayTitle})</span>
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
        tip.innerHTML = `<strong>📅 ${date} (${day})</strong>: Best set <strong>${w} lbs × ${r} reps</strong> → Est. 1-Rep Max: <strong style="color: #60a5fa;">${e1rm} lbs</strong>`;
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
            <div style="font-weight: 700; font-size: 0.95rem; color: var(--accent-blue);">${day.title} (${day.exercises.length} lifts)</div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
              ${day.exercises.map(e => `${e.name} (${e.sets}×${e.targetReps}${e.isOptional ? ' - optional' : ''})`).join(' • ')}
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
          <div style="font-weight: 700; font-size: 0.9rem; color: #e2e8f0;">⚡ MachineMaster v2.0 (Next-Level Upgrade)</div>
          <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">Data Shield • Deload Engine • SVG 1RM Curve • Volume Radar • Sticky Notes • Active HUD</div>
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
      this.render();
    });

    document.getElementById('wakeLockSettingToggle')?.addEventListener('change', (e) => {
      this.wakeLockEnabled = e.target.checked;
      localStorage.setItem('gym_wake_lock_enabled', String(this.wakeLockEnabled));
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
      localStorage.removeItem('gym_routine_rev');
      localStorage.removeItem(this.storageKeys.currentSessionPrefix + 'mon__lower_b');
      localStorage.removeItem(this.storageKeys.currentSessionPrefix + 'fri___lower_a');
      localStorage.removeItem(this.storageKeys.currentSessionPrefix + 'sat___upper_b');
      localStorage.removeItem(this.storageKeys.currentSessionPrefix + 'sun___db_arms');
      localStorage.removeItem(this.storageKeys.currentSessionPrefix + 'wed___upper_a');
      localStorage.removeItem(this.storageKeys.legacyCurrentSession);
      localStorage.removeItem(this.storageKeys.timerTargetEnd);
      localStorage.removeItem(this.storageKeys.timerTotalDuration);
    } catch (e) {
      console.error(e);
    }
    window.location.reload();
  }

  exportData() {
    const data = {
      version: '2.0',
      routine: this.routine,
      history: this.history,
      machineSettings: this.machineSettings,
      exerciseNotes: this.exerciseNotes,
      lastWeights: this.lastWeights,
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
