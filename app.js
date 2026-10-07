// State Management & Controller for Hypertrophy Routine Tracker (5-Day Split)

class WorkoutApp {
  constructor() {
    this.storageKeys = {
      routine: 'gym_routine_v4',
      history: 'gym_history_v1',
      machineSettings: 'gym_machine_settings_v1',
      streamlineMode: 'gym_streamline_mode_v1',
      currentSessionPrefix: 'gym_session_',
      legacyCurrentSession: 'gym_current_session_v4',
      lastWeights: 'gym_last_weights_v1',
      timerTargetEnd: 'gym_timer_target_end_v1',
      timerTotalDuration: 'gym_timer_total_duration_v1'
    };

    // Load History & Last Recorded Weights
    this.history = this.loadHistory();
    this.lastWeights = this.loadLastWeights();
    this.machineSettings = this.loadMachineSettings();
    this.streamlineMode = localStorage.getItem(this.storageKeys.streamlineMode) !== 'false'; // Default to true

    // Load Routine
    this.routine = this.loadRoutine();

    // Active Day: determine suggested day based on current weekday
    this.activeDayIndex = this.getSuggestedDayIndex();

    // Audio & WakeLock state
    this.audioCtx = null;
    this.wakeLock = null;

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

    // Background App-Swap & Visibility Listeners for Rest Timer
    document.addEventListener('visibilitychange', () => this.syncTimerFromBackground());
    window.addEventListener('pageshow', () => this.syncTimerFromBackground());
    window.addEventListener('focus', () => this.syncTimerFromBackground());

    // Check if a rest countdown was running in background
    this.restoreActiveTimer();

    this.render();
  }

  loadRoutine() {
    const CURRENT_ROUTINE_REV = 9;
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

        // Migrate routine to Revision 9 (Sunday 100% bench-free home routine, 6-8 compound reps, 8-12 supplemental reps)
        const needsUpdate = 
          savedRev !== String(CURRENT_ROUTINE_REV) ||
          parsed.length < 5 ||
          !parsed.some(d => d.id === 'sun___db_arms') ||
          parsed.some(d => d.exercises.some(e => e.id === 'fri___lower_a_ex_lunges' || e.id === 'mon__lower_b_ex4'));

        if (needsUpdate) {
          // Backup previous routine in localStorage just in case
          localStorage.setItem('gym_routine_backup_v8', JSON.stringify(parsed));
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
          // Ensure all exercises in the current routine definition have logs initialized
          if (day && day.exercises) {
            day.exercises.forEach(ex => {
              if (!parsed.logs[ex.id] || parsed.logs[ex.id].length === 0) {
                const prevData = this.getPreviousExercisePerformance(ex.name);
                parsed.logs[ex.id] = [];
                for (let i = 1; i <= ex.sets; i++) {
                  const prevSet = prevData && prevData.sets && prevData.sets[i - 1];
                  parsed.logs[ex.id].push({
                    setNum: i,
                    weight: prevSet ? prevSet.weight : this.parseInitialWeight(ex.startingWeight),
                    reps: prevSet ? prevSet.reps : this.parseInitialReps(ex.targetReps),
                    completed: false
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
      logs: {}
    };

    day.exercises.forEach(ex => {
      const prevData = this.getPreviousExercisePerformance(ex.name);
      session.logs[ex.id] = [];
      for (let i = 1; i <= ex.sets; i++) {
        const prevSet = prevData && prevData.sets && prevData.sets[i - 1];
        session.logs[ex.id].push({
          setNum: i,
          weight: prevSet ? prevSet.weight : this.parseInitialWeight(ex.startingWeight),
          reps: prevSet ? prevSet.reps : this.parseInitialReps(ex.targetReps),
          completed: false
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
    list.forEach((s, idx) => {
      const cur = parseFloat(s.weight) || 0;
      s.weight = Math.max(0, cur + delta);
      const ex = this.findExerciseById(exId);
      if (ex) {
        this.recordExerciseWeight(ex.name, idx + 1, s.weight, s.reps, s.completed);
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
    const ex = this.findExerciseById(exId);
    if (ex) {
      list.forEach((s, idx) => {
        this.recordExerciseWeight(ex.name, idx + 1, s.weight, s.reps, s.completed);
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
    const ex = this.findExerciseById(exId);
    if (ex) {
      this.recordExerciseWeight(ex.name, setIdx + 1, list[setIdx].weight, val, list[setIdx].completed);
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

    // Export & Reset buttons
    document.getElementById('exportDataBtn')?.addEventListener('click', () => this.exportData());
    document.getElementById('resetRoutineBtn')?.addEventListener('click', () => this.resetRoutine());
  }

  switchMainView(view) {
    const workoutView = document.getElementById('workoutView');
    const analyticsView = document.getElementById('analyticsView');
    const routineView = document.getElementById('routineView');

    if (view === 'workout') {
      workoutView.style.display = 'block';
      analyticsView.style.display = 'none';
      routineView.style.display = 'none';
      this.renderWorkout();
    } else if (view === 'analytics') {
      workoutView.style.display = 'none';
      analyticsView.style.display = 'block';
      routineView.style.display = 'none';
      this.renderAnalytics();
    } else if (view === 'routine') {
      workoutView.style.display = 'none';
      analyticsView.style.display = 'none';
      routineView.style.display = 'block';
      this.renderRoutineEditor();
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

    this.sessionInfoEl.innerHTML = `
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
    const sessionSets = this.session.logs[ex.id] || [];
    const prev = this.getPreviousExercisePerformance(ex.name);
    const pr = this.getPersonalRecord(ex.name);
    const machineSetting = this.machineSettings[ex.id] || '';
    const isAllDone = sessionSets.length > 0 && sessionSets.every(s => s.completed);
    const isCollapsed = isAllDone && this.collapsedCards.has(ex.id);

    const cleanTag = ex.muscle.replace(/[^a-zA-Z]/g, '');
    const effectiveRest = ex.superset ? ex.superset.rest : (ex.rest || '2 min');

    // Progression Flag Checks: only unlock weight increase if top-end reps hit on ALL sets
    const maxTarget = this.getMaxTargetReps(ex.targetReps);
    const completedSets = sessionSets.filter(s => s.completed);
    const setsHittingMax = completedSets.filter(s => (s.reps || 0) >= maxTarget);
    const targetSetsCount = ex.sets || sessionSets.length || 3;
    const allCurrentHit = sessionSets.length >= targetSetsCount && completedSets.length === sessionSets.length && completedSets.every(s => s.completed && (s.reps || 0) >= maxTarget);
    const prevProgression = this.getPreviousProgressionFlag(ex.name, ex.targetReps, ex.sets || 3);
    const nextIncompleteIdx = sessionSets.findIndex(s => !s.completed);

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
          <div class="card-title-group">
            <div>
              <span class="muscle-tag tag-${cleanTag}">${ex.muscle}</span>
              ${ex.superset ? `<span class="superset-badge">⚡ SUPERSET ${ex.superset.tag}</span>` : ''}
              ${isBonus ? '<span class="optional-badge">⚡ Optional Bonus</span>' : ''}
              ${allCurrentHit ? `<span class="progression-badge full">🚀 All ${sessionSets.length} Sets Hit ${maxTarget} Reps! Increase Weight Next Time</span>` : (setsHittingMax.length > 0 ? `<span class="progression-badge partial">🎯 ${setsHittingMax.length}/${sessionSets.length} sets @ ${maxTarget} reps</span>` : '')}
            </div>
            <h3 class="exercise-name">${ex.name}</h3>
            ${prev && prev.sets && prev.sets.length > 0 ? `
              <div class="prev-weight-pill">⏱️ Last: ${prev.sets.filter(Boolean).map(s => `${s.weight}lbs×${s.reps}`).join(' • ')}</div>
            ` : ''}
          </div>
          <div class="card-actions">
            ${isAllDone ? `
              <button type="button" class="card-collapse-toggle-btn" data-exid="${ex.id}" aria-label="Toggle exercise details">
                ${isCollapsed ? 'Show Details ▾' : 'Collapse ▴'}
              </button>
            ` : ''}
            ${ex.videoUrl ? `
              <a href="${ex.videoUrl}" target="_blank" rel="noopener noreferrer" class="video-link-btn" title="Watch form guide">
                ▶ Form
              </a>
            ` : ''}
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
              <div class="target-item"><strong>Target:</strong> ${ex.sets} sets × ${ex.targetReps} reps</div>
              <div class="target-item"><strong>Rest:</strong> <span style="${ex.superset ? 'color: #d8b4fe; font-weight: 700;' : ''}">${effectiveRest}</span></div>
              <div class="target-item"><strong>Start Weight:</strong> ${ex.startingWeight || 'Moderate'}</div>
              ${pr.maxWeight > 0 ? `<div class="target-item"><strong>PR:</strong> ${pr.maxWeight} lbs</div>` : ''}
            </div>
            ${ex.notes ? `
              <details class="form-notes-collapsible">
                <summary class="form-notes-summary">
                  <span>ℹ️ Setup & Form Guide</span>
                  <span class="chevron">▾</span>
                </summary>
                <div class="form-notes-content">${ex.notes}</div>
              </details>
            ` : ''}
            
            <div class="machine-settings-row">
              <span class="machine-settings-label">⚙️ Pin / Seat:</span>
              <input type="text" class="machine-settings-input" 
                     placeholder="e.g. Seat #4, Pin #8" 
                     value="${machineSetting}" 
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
                  return `
                    <tr class="set-row ${s.completed ? 'completed' : ''} ${isActiveNext ? 'active-next-set' : ''}" data-exid="${ex.id}" data-setidx="${sIdx}">
                      <td class="prev-cell">${prevText}</td>
                      <td class="target-cell" style="font-size: 0.78rem; color: var(--text-muted);">${ex.targetReps}</td>
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
  }

  toggleSetCompletion(exId, setIdx, restStr) {
    const setObj = this.session.logs[exId] && this.session.logs[exId][setIdx];
    if (!setObj) return;

    setObj.completed = !setObj.completed;
    this.saveCurrentSession();

    const ex = this.findExerciseById(exId);
    if (ex) {
      this.recordExerciseWeight(ex.name, setIdx + 1, setObj.weight, setObj.reps, setObj.completed);
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
    try {
      if ('wakeLock' in navigator && !this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
      }
    } catch (e) {
      // Ignore if unsupported or denied
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      try {
        this.wakeLock.release();
      } catch (e) {}
      this.wakeLock = null;
    }
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
      const maxTarget = this.getMaxTargetReps(ex.targetReps);

      // Check double progression: only unlocked if ALL sets hit top end target reps!
      const targetSetsCount = ex.sets || sets.length || 3;
      const allHit = completedSets.length >= targetSetsCount && completedSets.every(s => (s.reps || 0) >= maxTarget);
      if (allHit) {
        const topW = Math.max(...completedSets.map(s => s.weight || 0));
        weightIncreaseUnlocked.push({
          name: ex.name,
          reps: maxTarget,
          setsCount: completedSets.length,
          topWeight: topW
        });
      }

      completedSets.forEach(s => {
        const vol = (s.weight || 0) * (s.reps || 0);
        totalVolume += vol;

        // Check PR
        const pr = this.getPersonalRecord(ex.name);
        if (s.weight > pr.maxWeight && pr.maxWeight > 0) {
          newPRs.push(`${ex.name}: New Weight Record (${s.weight} lbs)`);
        }
      });

      if (completedSets.length > 0) {
        recordedExercises[ex.name] = {
          sets: sets.map(s => ({
            setNum: s.setNum,
            weight: s.weight,
            reps: s.reps,
            completed: s.completed
          }))
        };
        sets.forEach(s => {
          this.recordExerciseWeight(ex.name, s.setNum, s.weight, s.reps, s.completed);
        });
      }
    });

    const durationMins = Math.max(15, Math.round((new Date() - new Date(this.session.startTime)) / 60000));

    // Save to history
    const workoutRecord = {
      id: 'w_' + Date.now(),
      date: new Date().toISOString(),
      dayTitle: currentDay.title,
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
          <div class="stat-val">4-Day</div>
          <div class="stat-label">Machine Split</div>
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

        ${exHistory.length > 0 ? `
          <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px;">
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
        ` : `
          <div style="text-align: center; padding: 18px 12px; color: var(--text-muted); font-size: 0.85rem; background: rgba(255,255,255,0.02); border-radius: var(--radius-md);">
            <span>📊 Enter your weights during your workout and they will automatically build your strength progress chart here!</span>
          </div>
        `}
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
        <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 8px;">Routine Customization & Time-Saving</h3>
        <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4;">
          Tailor your 4-Day Machine routine. You can hide or toggle optional finishers to keep your gym sessions strictly under 45–50 minutes.
        </p>
      </div>

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

      <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: var(--radius-lg); padding: 14px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
        <div>
          <div style="font-weight: 700; font-size: 0.9rem; color: var(--accent-emerald);">🔔 Rest Timer Chime & Sensory Check</div>
          <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px;">Test the 3-tone chime through your AirPods or phone speaker.</div>
        </div>
        <button class="secondary-btn" id="testChimeBtn" style="padding: 6px 14px; font-size: 0.8rem; border-color: rgba(16, 185, 129, 0.4); color: #6ee7b7;">
          🔊 Test Chime
        </button>
      </div>

      <div style="background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: var(--radius-lg); padding: 14px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
        <div>
          <div style="font-weight: 700; font-size: 0.9rem; color: var(--accent-blue);">⚡ App Version 1.6.2 (Streamlined 5-Column Table & Quick Steppers)</div>
          <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px;">Wed: Upper A • Fri: Lower A • Sat: Upper B • Sun: DB Arms & Shoulders • Mon: Lower B</div>
        </div>
        <button class="primary-btn" id="forceUpdateBtn" style="padding: 6px 14px; font-size: 0.8rem;">
          🔄 Force Sync & Reload
        </button>
      </div>

      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        <button class="secondary-btn" id="exportDataBtn" style="flex: 1; min-width: 160px;">
          📥 Export Data (JSON)
        </button>
        <button class="secondary-btn" id="resetRoutineBtn" style="flex: 1; min-width: 160px; color: #f87171; border-color: rgba(239,68,68,0.3);">
          🔄 Reset to Original Sheet
        </button>
      </div>
    `;

    document.getElementById('testChimeBtn')?.addEventListener('click', () => {
      this.primeAudioContext();
      this.playTimerAlarm();
    });
    document.getElementById('forceUpdateBtn')?.addEventListener('click', () => this.forceAppUpdate());
    document.getElementById('exportDataBtn')?.addEventListener('click', () => this.exportData());
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
      routine: this.routine,
      history: this.history,
      machineSettings: this.machineSettings,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `4-Day_Machine_Lifting_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
